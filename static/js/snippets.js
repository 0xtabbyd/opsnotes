/**
 * OpsNotes - Snippets Manager Module
 * Renders snippet cards, interactive parameter replacement, and 1-click clipboard copy
 */

import { api } from './api.js';

export const snippetsManager = {
  snippets: [],
  variables: {},
  currentCategory: 'all',
  currentTag: null,
  onlyFavorites: false,
  showToast: null,
  onRefreshMeta: null,

  async init({ showToast, onRefreshMeta }) {
    this.showToast = showToast;
    this.onRefreshMeta = onRefreshMeta;
    this.setupModalEvents();
    await this.loadVariables();
    await this.loadSnippets();
  },

  async loadVariables() {
    try {
      const vars = await api.getVariables();
      this.variables = {};
      vars.forEach(v => {
        this.variables[v.name] = v.default_value;
      });
    } catch (err) {
      console.error("Failed to load variables:", err);
    }
  },

  async loadSnippets() {
    try {
      const sortSelect = document.getElementById('snippetSortSelect');
      const sort = sortSelect ? sortSelect.value : 'pinned_updated';
      const params = { sort };

      if (this.currentCategory && this.currentCategory !== 'all') {
        params.category = this.currentCategory;
      }
      if (this.currentTag) {
        params.tag = this.currentTag;
      }
      if (this.onlyFavorites) {
        params.favorite = 1;
      }

      this.snippets = await api.getSnippets(params);
      this.render();
      if (this.onRefreshMeta) this.onRefreshMeta();
    } catch (err) {
      this.showToast?.("スニペットの取得に失敗しました", "error");
    }
  },

  // コマンド内の {{VARIABLE}} を抽出するユーティリティ
  extractVariables(command) {
    const regex = /\{\{([A-Za-z0-9_\-]+)\}\}/g;
    const matches = new Set();
    let m;
    while ((m = regex.exec(command)) !== null) {
      matches.add(m[1]);
    }
    return Array.from(matches);
  },

  render() {
    const container = document.getElementById('snippetsList');
    if (!container) return;

    if (this.snippets.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;"><i class="fa-solid fa-code"></i></div>
          <p style="font-weight: 500;">該当するスニペットが見つかりませんでした</p>
          <button class="btn btn-secondary btn-sm" id="btnEmptyCreateSnippet" style="margin-top: 12px;"><i class="fa-solid fa-plus"></i> スニペットを作成</button>
        </div>
      `;
      const btn = document.getElementById('btnEmptyCreateSnippet');
      if (btn) btn.addEventListener('click', () => this.openModal());
      return;
    }

    container.innerHTML = '';
    this.snippets.forEach(item => {
      const vars = this.extractVariables(item.command);
      const hasVars = vars.length > 0;

      const card = document.createElement('div');
      card.className = `snippet-card ${item.pinned ? 'pinned' : ''}`;
      card.dataset.id = item.id;

      const tagsHtml = (item.tags || []).map(t => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('');

      card.innerHTML = `
        <div class="snippet-header">
          <div class="snippet-title-area">
            <div class="snippet-title">
              ${item.pinned ? '<span class="pin-icon" title="ピン留め中"><i class="fa-solid fa-thumbtack" style="color:#ef4444;"></i></span>' : ''}
              <span>${escapeHtml(item.title)}</span>
            </div>
            ${item.description ? `<div class="snippet-desc">${escapeHtml(item.description)}</div>` : ''}
            <div class="snippet-meta-badges">
              <span class="badge-cat">${escapeHtml(item.category || 'General')}</span>
              <span class="badge-lang">${escapeHtml(item.language || 'bash')}</span>
              ${tagsHtml}
            </div>
          </div>
          <div class="snippet-actions">
            <button class="btn btn-icon btn-fav ${item.favorite ? 'active' : ''}" title="${item.favorite ? 'お気に入り解除' : 'お気に入りに追加'}">
              ${item.favorite ? '<i class="fa-solid fa-star" style="color:#eab308;"></i>' : '<i class="fa-regular fa-star"></i>'}
            </button>
            <button class="btn btn-icon btn-edit" title="編集"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-icon btn-del" title="削除"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>

        ${hasVars ? `
          <div class="variable-box">
            <div class="variable-box-title">
              <i class="fa-solid fa-sliders" style="margin-right:4px;"></i> プレースホルダー置換 (値を入力すると即座に展開)
            </div>
            <div class="variable-fields">
              ${vars.map(v => `
                <div class="variable-input-group">
                  <span class="variable-label">{{${escapeHtml(v)}}}</span>
                  <input type="text" class="variable-input" data-var="${escapeHtml(v)}" value="${escapeHtml(this.variables[v] || '')}" placeholder="${escapeHtml(v)}">
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="snippet-code-area">
          <pre class="snippet-code" data-raw-command="${escapeHtml(item.command)}"><code>${escapeHtml(item.command)}</code></pre>
          <div class="copy-button-overlay">
            <button class="btn btn-primary btn-sm btn-copy">
              <i class="fa-solid fa-copy"></i> コピー
            </button>
          </div>
        </div>

        <div class="snippet-footer">
          <div class="copy-counter">
            <span>コピー回数:</span> <strong class="copy-num">${item.copy_count || 0}</strong>
          </div>
          <div style="font-size:0.7rem; color:var(--text-muted);">
            更新: ${formatDate(item.updated_at)}
          </div>
        </div>
      `;

      // イベントバインド
      this.attachCardEvents(card, item, vars);
      container.appendChild(card);
    });
  },

  attachCardEvents(card, item, vars) {
    const codeEl = card.querySelector('.snippet-code code');
    const copyBtn = card.querySelector('.btn-copy');
    const favBtn = card.querySelector('.btn-fav');
    const editBtn = card.querySelector('.btn-edit');
    const delBtn = card.querySelector('.btn-del');
    const varInputs = card.querySelectorAll('.variable-input');

    // コマンド生成関数
    const getResolvedCommand = () => {
      let cmd = item.command;
      varInputs.forEach(input => {
        const vName = input.dataset.var;
        const val = input.value || `{{${vName}}}`;
        cmd = cmd.split(`{{${vName}}}`).join(val);
      });
      return cmd;
    };

    // 変数入力時のリアルタイムプレビュー更新
    const updatePreview = () => {
      const resolved = getResolvedCommand();
      codeEl.textContent = resolved;
    };

    varInputs.forEach(input => {
      input.addEventListener('input', updatePreview);
    });

    // 初期値があれば初回適用
    if (vars.length > 0) {
      updatePreview();
    }

    // クリップボードコピー
    copyBtn.addEventListener('click', async () => {
      const resolvedCmd = getResolvedCommand();
      try {
        await navigator.clipboard.writeText(resolvedCmd);
        await api.recordCopy(item.id);
        const copyNum = card.querySelector('.copy-num');
        if (copyNum) {
          copyNum.textContent = parseInt(copyNum.textContent || '0', 10) + 1;
        }
        this.showToast?.("クリップボードにコピーしました！", "success");
      } catch (err) {
        this.showToast?.("コピーに失敗しました", "error");
      }
    });

    // お気に入りトグル
    favBtn.addEventListener('click', async () => {
      const newFav = item.favorite ? 0 : 1;
      await api.updateSnippet(item.id, {
        ...item,
        favorite: newFav
      });
      item.favorite = newFav;
      favBtn.innerHTML = newFav ? '<i class="fa-solid fa-star" style="color:#eab308;"></i>' : '<i class="fa-regular fa-star"></i>';
      this.showToast?.(newFav ? "お気に入りに追加しました" : "お気に入りを解除しました", "info");
    });

    // 編集
    editBtn.addEventListener('click', () => {
      this.openModal(item);
    });

    // 削除
    delBtn.addEventListener('click', async () => {
      if (confirm(`スニペット「${item.title}」を削除してもよろしいですか？`)) {
        await api.deleteSnippet(item.id);
        this.showToast?.("スニペットを削除しました", "info");
        await this.loadSnippets();
        if (this.onRefreshMeta) this.onRefreshMeta();
      }
    });
  },

  // モーダル操作
  setupModalEvents() {
    const modal = document.getElementById('snippetModalOverlay');
    const closeBtn = document.getElementById('btnCloseSnippetModal');
    const cancelBtn = document.getElementById('btnCancelSnippetModal');
    const saveBtn = document.getElementById('btnSaveSnippet');
    const newBtn = document.getElementById('btnNewSnippet');

    if (newBtn) newBtn.addEventListener('click', () => this.openModal());
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const id = document.getElementById('snippetEditId').value;
        const title = document.getElementById('snippetFormTitle').value.trim();
        const desc = document.getElementById('snippetFormDesc').value.trim();
        const category = document.getElementById('snippetFormCategory').value.trim() || 'General';
        const language = document.getElementById('snippetFormLanguage').value;
        const command = document.getElementById('snippetFormCommand').value.trim();
        const rawTags = document.getElementById('snippetFormTags').value;
        const tags = rawTags.split(/[,\u3001]/).map(t => t.trim().replace(/^#+/, '').trim()).filter(Boolean);
        const pinned = document.getElementById('snippetFormPinned').checked ? 1 : 0;
        const favorite = document.getElementById('snippetFormFavorite').checked ? 1 : 0;

        if (!title || !command) {
          alert("タイトルとコマンド本文は必須です");
          return;
        }

        const payload = {
          title,
          description: desc,
          category,
          language,
          command,
          tags,
          pinned,
          favorite
        };

        try {
          if (id) {
            await api.updateSnippet(id, payload);
            this.showToast?.("スニペットを更新しました", "success");
          } else {
            await api.createSnippet(payload);
            this.showToast?.("スニペットを新規作成しました", "success");
          }
          this.closeModal();
          await this.loadSnippets();
          if (this.onRefreshMeta) this.onRefreshMeta();
        } catch (err) {
          this.showToast?.("保存中にエラーが発生しました", "error");
        }
      });
    }
  },

  openModal(snippet = null) {
    const modal = document.getElementById('snippetModalOverlay');
    const titleEl = document.getElementById('snippetModalTitle');
    const idInput = document.getElementById('snippetEditId');
    const formTitle = document.getElementById('snippetFormTitle');
    const formDesc = document.getElementById('snippetFormDesc');
    const formCat = document.getElementById('snippetFormCategory');
    const formLang = document.getElementById('snippetFormLanguage');
    const formCmd = document.getElementById('snippetFormCommand');
    const formTags = document.getElementById('snippetFormTags');
    const formPinned = document.getElementById('snippetFormPinned');
    const formFav = document.getElementById('snippetFormFavorite');

    if (snippet) {
      titleEl.textContent = "スニペットの編集";
      idInput.value = snippet.id;
      formTitle.value = snippet.title;
      formDesc.value = snippet.description || '';
      formCat.value = snippet.category || 'General';
      formLang.value = snippet.language || 'bash';
      formCmd.value = snippet.command;
      formTags.value = Array.isArray(snippet.tags) ? snippet.tags.join(', ') : (snippet.tags || '');
      formPinned.checked = !!snippet.pinned;
      formFav.checked = !!snippet.favorite;
    } else {
      titleEl.textContent = "新規スニペットの作成";
      idInput.value = '';
      formTitle.value = '';
      formDesc.value = '';
      formCat.value = this.currentCategory !== 'all' ? this.currentCategory : 'General';
      formLang.value = 'bash';
      formCmd.value = '';
      formTags.value = '';
      formPinned.checked = false;
      formFav.checked = false;
    }

    modal.classList.add('active');
  },

  closeModal() {
    const modal = document.getElementById('snippetModalOverlay');
    if (modal) modal.classList.remove('active');
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
