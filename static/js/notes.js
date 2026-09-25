/**
 * OpsNotes - Notes Module
 * Markdown Notes with Split View, Live Preview, Checklist Support, Enter-to-break,
 * 500ms Debounce Auto-Save, Rich Editor Toolbar (Color/Marker), TF-IDF Related Notes,
 * and Post-Mortem Incident Workflow.
 */

import { api } from './api.js';
import { renderDiagramToSvgString } from './canvas/shapes.js';
import { openDrawioModal, openDrawioWithData } from './drawio.js';

export const notesManager = {
  notes: [],
  activeNoteId: null,
  activeNote: null,
  currentCategory: 'all',
  currentTag: null,
  onlyFavorites: false,
  autoSaveTimer: null,
  isSaving: false,
  showToast: null,
  onRefreshMeta: null,

  async init({ showToast, onRefreshMeta }) {
    this.showToast = showToast;
    this.onRefreshMeta = onRefreshMeta;

    // marked.js のオプション設定: Enterキーで改行 (breaks: true), GFM有効
    if (window.marked) {
      window.marked.setOptions({
        breaks: true,
        gfm: true
      });
    }

    this.bindEvents();
    this.setupToolbar();
    this.initTemplateModal();
    await this.loadNotes();
  },

  async loadNotes() {
    try {
      const params = {};
      if (this.currentCategory && this.currentCategory !== 'all') {
        params.category = this.currentCategory;
      }
      if (this.currentTag) {
        params.tag = this.currentTag;
      }
      if (this.onlyFavorites) {
        params.favorite = 1;
      }

      this.notes = await api.getNotes(params);
      this.renderNotesList();

      // 現在選択中のノートがフィルタ後の一覧にあれば維持、なければ先頭を選択
      if (this.notes.length > 0) {
        const found = this.notes.find(n => n.id === this.activeNoteId);
        if (!found) {
          await this.selectNote(this.notes[0].id);
        } else {
          await this.loadRelatedNotes(this.activeNoteId);
        }
      } else {
        this.clearEditor();
      }

      if (this.onRefreshMeta) this.onRefreshMeta();
    } catch (err) {
      console.error("Failed to load notes:", err);
    }
  },

  clearEditor() {
    this.activeNoteId = null;
    this.activeNote = null;
    const titleInput = document.getElementById('noteTitleInput');
    const catInput = document.getElementById('noteCategoryInput');
    const tagsInput = document.getElementById('noteTagsInput');
    const mdInput = document.getElementById('noteMarkdownInput');
    const previewWrap = document.getElementById('noteMarkdownPreview');
    const relatedList = document.getElementById('relatedNotesList');

    if (titleInput) titleInput.value = '';
    if (catInput) catInput.value = '';
    if (tagsInput) tagsInput.value = '';
    if (mdInput) mdInput.value = '';
    if (previewWrap) previewWrap.innerHTML = '';
    if (relatedList) {
      relatedList.innerHTML = '<div class="related-empty-hint">メモを選択すると関連するノートが自動で繋がります</div>';
    }
    this.updateSaveStatus('saved');
  },

  renderNotesList() {
    const container = document.getElementById('notesItemList');
    if (!container) return;

    if (this.notes.length === 0) {
      container.innerHTML = `
        <div style="padding: 30px 16px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          該当するメモがありません。<br>
          <button type="button" class="btn btn-secondary btn-sm" id="btnEmptyCreateNote" style="margin-top:10px;">+ メモを作成</button>
        </div>
      `;
      const btn = document.getElementById('btnEmptyCreateNote');
      if (btn) btn.addEventListener('click', () => this.createNewNote());
      return;
    }

    container.innerHTML = '';
    this.notes.forEach(note => {
      const item = document.createElement('div');
      item.className = `note-item ${note.id === this.activeNoteId ? 'active' : ''}`;
      item.dataset.id = note.id;

      const createdStr = note.created_at || note.updated_at || '';
      const dateStr = createdStr ? createdStr.split(' ')[0] : '';
      const fullTooltip = createdStr ? `作成日時: ${createdStr}` : '';
      const pinIcon = note.pinned ? '<span style="margin-right:6px; color:#ef4444;"><i class="fa-solid fa-thumbtack"></i></span>' : '';
      const favIcon = note.favorite ? '<span style="font-size:0.75rem; margin-left:auto; color:#eab308;"><i class="fa-solid fa-star"></i></span>' : '';

      item.innerHTML = `
        <div class="note-item-title">${pinIcon}${escapeHtml(note.title || '無題のメモ')}</div>
        <div class="note-item-preview">${escapeHtml(note.summary || '')}</div>
        <div class="note-item-meta">
          <span><i class="fa-solid fa-folder" style="margin-right:4px;"></i>${escapeHtml(note.category || 'General')}</span>
          ${favIcon}
          <span title="${fullTooltip}" style="margin-left:${note.favorite ? '6px' : 'auto'}; cursor:help;"><i class="fa-regular fa-clock" style="margin-right:3px; opacity:0.7;"></i>${dateStr}</span>
        </div>
      `;

      item.addEventListener('click', () => this.selectNote(note.id));
      container.appendChild(item);
    });
  },

  async selectNote(noteId) {
    // 別のノートに切り替える前に、現在のノートに未保存の変更があれば直ちに保存
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
      await this.saveCurrentNote();
    }

    try {
      this.activeNoteId = noteId;
      this.activeNote = await api.getNote(noteId);
      
      const titleInput = document.getElementById('noteTitleInput');
      const catInput = document.getElementById('noteCategoryInput');
      const tagsInput = document.getElementById('noteTagsInput');
      const mdInput = document.getElementById('noteMarkdownInput');
      const btnFav = document.getElementById('btnNoteFavorite');
      const btnPin = document.getElementById('btnNotePin');
      
      if (titleInput) titleInput.value = this.activeNote.title || '';
      if (catInput) catInput.value = this.activeNote.category || 'General';
      if (tagsInput) tagsInput.value = Array.isArray(this.activeNote.tags) ? this.activeNote.tags.join(', ') : (this.activeNote.tags || '');
      if (mdInput) mdInput.value = this.activeNote.content || '';

      if (btnFav) {
        btnFav.innerHTML = this.activeNote.favorite ? '<i class="fa-solid fa-star" style="color:#eab308;"></i>' : '<i class="fa-regular fa-star"></i>';
        btnFav.title = this.activeNote.favorite ? 'お気に入りを解除' : 'お気に入りに追加';
        btnFav.classList.toggle('active', Boolean(this.activeNote.favorite));
      }
      if (btnPin) {
        btnPin.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
        btnPin.title = this.activeNote.pinned ? 'ピン留めを解除' : '上部にピン留め';
        btnPin.style.color = this.activeNote.pinned ? '#ef4444' : 'inherit';
        btnPin.style.opacity = this.activeNote.pinned ? '1' : '0.4';
        btnPin.classList.toggle('active', Boolean(this.activeNote.pinned));
      }

      this.updatePreview();
      this.renderNotesList();
      this.updateSaveStatus('saved');

      // TF-IDF関連メモを非同期ロード（サイドバーの領域）
      this.loadRelatedNotes(noteId);
    } catch (err) {
      this.showToast?.("メモの読み込みに失敗しました", "error");
    }
  },

  // ==========================================
  // TF-IDF 関連メモの自動表示 (サイドバー枠)
  // ==========================================
  async loadRelatedNotes(noteId) {
    const listEl = document.getElementById('relatedNotesList');
    if (!listEl) return;

    try {
      const related = await api.getRelatedNotes(noteId, 3);
      if (!related || related.length === 0) {
        listEl.innerHTML = '<div class="related-empty-hint">関連するメモは見つかりませんでした</div>';
        return;
      }

      listEl.innerHTML = related.map(r => `
        <div class="related-note-card" data-id="${r.id}" title="${escapeHtml(r.title)}&#10;類似度: ${r.similarity_percent}%&#10;クリックして開く">
          <div class="related-card-top">
            <span class="related-card-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</span>
            <span class="related-sim-badge">${r.similarity_percent}%</span>
          </div>
          <div class="related-card-preview">${escapeHtml(r.summary || '')}</div>
        </div>
      `).join('');

      listEl.querySelectorAll('.related-note-card').forEach(card => {
        card.addEventListener('click', () => {
          const targetId = parseInt(card.dataset.id, 10);
          if (targetId) {
            this.selectNote(targetId);
          }
        });
      });
    } catch (err) {
      console.warn("Failed to load related notes:", err);
      listEl.innerHTML = '<div class="related-empty-hint">関連メモの取得に失敗しました</div>';
    }
  },

  // ==========================================
  // Markdownレンダリング & チェックリスト対応
  // ==========================================
  updatePreview() {
    const mdInput = document.getElementById('noteMarkdownInput');
    const previewWrap = document.getElementById('noteMarkdownPreview');
    if (!mdInput || !previewWrap) return;

    let raw = mdInput.value || '';

    if (window.marked) {
      const processed = ensureBreaks(raw);
      let html = window.marked.parse(processed, { breaks: true, gfm: true });

      // チェックボックスの活性化
      html = html.replace(/<li([^>]*)>\s*<input([^>]*?)type=["']checkbox["']([^>]*?)>/gi, (match, liAttrs, p1, p2) => {
        const full = p1 + p2;
        const isChecked = /checked/i.test(full);
        return `<li class="task-list-item ${isChecked ? 'checked' : ''}"><input type="checkbox" class="task-checkbox" ${isChecked ? 'checked' : ''}> `;
      });

      html = html.replace(/<li>\[ \]\s*/gi, '<li class="task-list-item"><input type="checkbox" class="task-checkbox"> ');
      html = html.replace(/<li>\[[xX]\]\s*/gi, '<li class="task-list-item checked"><input type="checkbox" class="task-checkbox" checked> ');

      // GitHubスタイルCallout (> [!NOTE], > [!WARNING]) のレンダリング補正
      html = html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi, (match, type) => {
        const t = type.toUpperCase();
        const colors = {
          'NOTE': '#38bdf8',
          'TIP': '#22c55e',
          'IMPORTANT': '#a855f7',
          'WARNING': '#f59e0b',
          'CAUTION': '#ef4444'
        };
        const color = colors[t] || '#38bdf8';
        return `<blockquote class="markdown-alert markdown-alert-${t.toLowerCase()}" style="border-left:4px solid ${color} !important; background:rgba(255,255,255,0.03);"><p><strong style="color:${color};"><i class="fa-solid fa-circle-exclamation" style="margin-right:4px;"></i>${t}</strong><br>`;
      });

      // 改ページ <!-- pagebreak --> の変換対応
      html = html.replace(/<!--\s*pagebreak\s*-->/gi, '<div class="page-break"></div>');

      previewWrap.innerHTML = html;

      this.attachCheckboxEvents(previewWrap, mdInput);
      this.attachCanvasDiagrams(previewWrap, mdInput);

      if (window.hljs) {
        previewWrap.querySelectorAll('pre code').forEach((block) => {
          const isCanvasBlock = block.classList.contains('language-opsnotes-canvas') ||
                                block.classList.contains('lang-opsnotes-canvas') ||
                                block.classList.contains('language-homeops-canvas') ||
                                block.classList.contains('lang-homeops-canvas') ||
                                block.classList.contains('language-drawio') ||
                                block.classList.contains('lang-drawio');
          if (!isCanvasBlock) {
            window.hljs.highlightElement(block);
          }
        });
      }
    } else {
      previewWrap.innerHTML = `<pre>${escapeHtml(raw)}</pre>`;
    }
  },

  attachCheckboxEvents(previewWrap, mdInput) {
    const checkboxes = previewWrap.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb, index) => {
      cb.addEventListener('change', () => {
        let count = 0;
        const text = mdInput.value;
        const newText = text.replace(/(\*\s*\[[ xX]\]|\-\s*\[[ xX]\])/g, (match) => {
          if (count === index) {
            count++;
            return cb.checked ? '- [x]' : '- [ ]';
          }
          count++;
          return match;
        });
        if (newText !== text) {
          mdInput.value = newText;
          this.triggerAutoSave();
        }
      });
    });
  },

  attachCanvasDiagrams(previewWrap, mdInput) {
    // 1. draw.io blocks (Primary Diagram Engine in v0.4)
    const drawioBlocks = previewWrap.querySelectorAll('pre code.language-drawio, pre code.lang-drawio');
    drawioBlocks.forEach((codeEl, blockIndex) => {
      try {
        const rawContent = codeEl.textContent.trim();
        let diagramData = null;
        let svgHtml = '';

        if (rawContent.startsWith('{')) {
          diagramData = JSON.parse(rawContent);
          svgHtml = diagramData.svg || '';
        } else if (rawContent.startsWith('<')) {
          diagramData = {
            version: '1.0',
            type: 'drawio',
            title: 'draw.io 構成図',
            xml: rawContent,
            svg: ''
          };
        }

        if (!diagramData) return;

        if (!svgHtml) {
          svgHtml = `<div class="drawio-xml-placeholder" style="padding:24px; text-align:center; color:var(--text-muted);">
            <i class="fa-solid fa-diagram-project" style="font-size:1.6rem; color:var(--accent-primary); margin-bottom:8px; display:block;"></i>
            <span>draw.io 構成図（右上の「draw.ioで編集」から編集・保存すると描画されます）</span>
          </div>`;
        }

        const embedDiv = document.createElement('div');
        embedDiv.className = 'opsnotes-canvas-embed drawio-embed';
        embedDiv.innerHTML = `
          <div class="canvas-embed-header">
            <div class="canvas-embed-title">
              <i class="fa-solid fa-diagram-project" style="margin-right:6px; color:var(--accent-primary);"></i>
              <span>${escapeHtml(diagramData.title || 'draw.io 構成図')}</span>
              <span class="badge-cat" style="margin-left:8px; font-size:0.7rem; background:rgba(56,189,248,0.15); color:var(--accent-primary);">draw.io</span>
            </div>
            <div class="canvas-embed-actions">
              <button type="button" class="btn btn-secondary btn-sm btn-reedit-drawio">
                <i class="fa-solid fa-pen-to-square"></i> draw.ioで編集
              </button>
            </div>
          </div>
          <div class="canvas-embed-body">
            ${svgHtml}
          </div>
        `;

        const btnReedit = embedDiv.querySelector('.btn-reedit-drawio');
        if (btnReedit) {
          btnReedit.addEventListener('click', () => {
            openDrawioWithData(diagramData, (updatedDiagram) => {
              let currentIdx = 0;
              const text = mdInput.value;
              const newText = text.replace(/```(?:drawio)\s*[\s\S]*?```/g, (fullMatch) => {
                if (currentIdx === blockIndex) {
                  currentIdx++;
                  return `\`\`\`drawio\n${JSON.stringify(updatedDiagram, null, 2)}\n\`\`\``;
                }
                currentIdx++;
                return fullMatch;
              });
              mdInput.value = newText;
              this.updatePreview();
              this.triggerAutoSave();
            });
          });
        }

        const pre = codeEl.closest('pre');
        if (pre && pre.parentNode) {
          pre.parentNode.replaceChild(embedDiv, pre);
        }
      } catch (err) {
        console.warn('Failed to parse drawio block:', err);
      }
    });

    // 2. Legacy opsnotes-canvas blocks (Backward compatibility)
    const legacyBlocks = previewWrap.querySelectorAll('pre code.language-opsnotes-canvas, pre code.lang-opsnotes-canvas, pre code.language-homeops-canvas, pre code.lang-homeops-canvas');
    legacyBlocks.forEach((codeEl, blockIndex) => {
      try {
        const rawJson = codeEl.textContent.trim();
        const diagramData = JSON.parse(rawJson);
        const svgHtml = renderDiagramToSvgString(diagramData);

        const embedDiv = document.createElement('div');
        embedDiv.className = 'opsnotes-canvas-embed homeops-canvas-embed';
        embedDiv.innerHTML = `
          <div class="canvas-embed-header">
            <div class="canvas-embed-title"><i class="fa-solid fa-diagram-project" style="margin-right:6px;"></i>${escapeHtml(diagramData.title || 'ネットワーク構成図')}</div>
            <div class="canvas-embed-actions">
              <span class="badge-cat" style="font-size:0.7rem; color:var(--text-muted);">旧キャンバス形式</span>
            </div>
          </div>
          <div class="canvas-embed-body">
            ${svgHtml}
          </div>
        `;

        const pre = codeEl.closest('pre');
        if (pre && pre.parentNode) {
          pre.parentNode.replaceChild(embedDiv, pre);
        }
      } catch (err) {
        console.warn('Failed to parse legacy canvas block:', err);
      }
    });
  },

  insertDrawioIntoNote(diagramData) {
    const textarea = document.getElementById('noteMarkdownInput');
    if (!textarea) return;

    const jsonStr = JSON.stringify(diagramData, null, 2);
    const block = `\n\`\`\`drawio\n${jsonStr}\n\`\`\`\n`;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;

    textarea.value = val.substring(0, start) + block + val.substring(end);
    textarea.focus();
    const newCursorPos = start + block.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    this.updatePreview();
    this.triggerAutoSave();
  },

  // ==========================================
  // リッチエディタ・ツールバー操作 & スクロール位置維持
  // ==========================================
  setupToolbar() {
    const toolbar = document.getElementById('editorToolbar');
    const textarea = document.getElementById('noteMarkdownInput');
    if (!toolbar || !textarea) return;

    // 通常のツールバーボタン
    toolbar.querySelectorAll('.tb-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        this.executeToolbarAction(action);
      });
    });

    // 1. 文字色ドロップダウン
    const btnTextColor = document.getElementById('btnTextColorPicker');
    const popoverTextColor = document.getElementById('popoverTextColor');
    if (btnTextColor && popoverTextColor) {
      btnTextColor.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isShown = popoverTextColor.style.display === 'block';
        this.closeAllColorPopovers();
        popoverTextColor.style.display = isShown ? 'none' : 'block';
      });

      popoverTextColor.querySelectorAll('.palette-swatch-sm').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const color = swatch.dataset.color;
          const indicator = document.getElementById('textColorIndicator');
          if (indicator) indicator.style.background = color;
          popoverTextColor.style.display = 'none';
          this.executeToolbarAction('color', color);
        });
      });
    }

    // 2. マーカー（蛍光ペン）ドロップダウン
    const btnMarker = document.getElementById('btnMarkerPicker');
    const popoverMarker = document.getElementById('popoverMarkerColor');
    if (btnMarker && popoverMarker) {
      btnMarker.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isShown = popoverMarker.style.display === 'block';
        this.closeAllColorPopovers();
        popoverMarker.style.display = isShown ? 'none' : 'block';
      });

      popoverMarker.querySelectorAll('.palette-swatch-sm').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const bg = swatch.dataset.bg;
          const fg = swatch.dataset.fg || '#1e293b';
          const indicator = document.getElementById('markerColorIndicator');
          if (indicator) indicator.style.background = bg;
          popoverMarker.style.display = 'none';
          this.executeToolbarAction('marker', { bg, fg });
        });
      });
    }

    // 外部クリックでポップオーバーを閉じる
    document.addEventListener('click', () => {
      this.closeAllColorPopovers();
    });

    // キーボードショートカット (Ctrl+B, Ctrl+I)
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'b') {
          e.preventDefault();
          this.executeToolbarAction('bold');
        } else if (e.key.toLowerCase() === 'i') {
          e.preventDefault();
          this.executeToolbarAction('italic');
        }
      }
    });
  },

  closeAllColorPopovers() {
    const p1 = document.getElementById('popoverTextColor');
    const p2 = document.getElementById('popoverMarkerColor');
    if (p1) p1.style.display = 'none';
    if (p2) p2.style.display = 'none';
  },

  executeToolbarAction(action, extraParam = null) {
    const textarea = document.getElementById('noteMarkdownInput');
    if (!textarea) return;

    // スクロール位置の記憶（最下部へのジャンプを確実に防ぐ）
    const prevScrollTop = textarea.scrollTop;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    const selected = val.substring(start, end);

    let before = '';
    let after = '';
    let defaultText = '';

    switch (action) {
      case 'h1':
        before = '# ';
        defaultText = selected || '大見出し';
        break;
      case 'h2':
        before = '## ';
        defaultText = selected || '中見出し';
        break;
      case 'h3':
        before = '### ';
        defaultText = selected || '小見出し';
        break;
      case 'bold':
        before = '**';
        after = '**';
        defaultText = selected || '太字テキスト';
        break;
      case 'italic':
        before = '*';
        after = '*';
        defaultText = selected || '斜体テキスト';
        break;
      case 'strike':
        before = '~~';
        after = '~~';
        defaultText = selected || '打ち消しテキスト';
        break;
      case 'code':
        before = '`';
        after = '`';
        defaultText = selected || 'コード';
        break;
      case 'color': {
        const hex = extraParam || '#ef4444';
        const newOpenTag = `<span style="color: ${hex};">`;
        const closeTag = `</span>`;

        // 1. 選択範囲がない場合
        if (!selected) {
          before = newOpenTag;
          after = closeTag;
          defaultText = '色付き文字';
          break;
        }

        // 2. 選択範囲全体が既に <span style="color: ...">...</span> の場合
        const fullSpanMatch = selected.match(/^<span\s+style="color:\s*[^"]+;?">([\s\S]*?)<\/span>$/i);
        if (fullSpanMatch) {
          const inner = fullSpanMatch[1];
          const replacement = `${newOpenTag}${inner}${closeTag}`;
          textarea.value = val.substring(0, start) + replacement + val.substring(end);
          textarea.focus();
          textarea.setSelectionRange(start, start + replacement.length);
          textarea.scrollTop = prevScrollTop;
          this.updatePreview();
          this.triggerAutoSave();
          return;
        }

        // 3. 選択範囲の前後にちょうど <span style="color: ..."> と </span> が存在する場合
        const beforeText = val.substring(0, start);
        const afterText = val.substring(end);
        const beforeSpanMatch = beforeText.match(/<span\s+style="color:\s*[^"]+;?">\s*$/i);
        const afterSpanMatch = afterText.match(/^\s*<\/span>/i);

        if (beforeSpanMatch && afterSpanMatch) {
          const tagStart = start - beforeSpanMatch[0].length;
          const tagEnd = end + afterSpanMatch[0].length;
          const replacement = `${newOpenTag}${selected}${closeTag}`;
          textarea.value = val.substring(0, tagStart) + replacement + val.substring(tagEnd);
          textarea.focus();
          textarea.setSelectionRange(tagStart, tagStart + replacement.length);
          textarea.scrollTop = prevScrollTop;
          this.updatePreview();
          this.triggerAutoSave();
          return;
        }

        // 4. 選択範囲の内部に別の <span style="color: ..."> が含まれている場合（入れ子を解消）
        if (/<span\s+style="color:\s*[^"]+;?">/i.test(selected)) {
          const cleaned = selected.replace(/<span\s+style="color:\s*[^"]+;?">/gi, '').replace(/<\/span>/gi, '');
          const replacement = `${newOpenTag}${cleaned}${closeTag}`;
          textarea.value = val.substring(0, start) + replacement + val.substring(end);
          textarea.focus();
          textarea.setSelectionRange(start, start + replacement.length);
          textarea.scrollTop = prevScrollTop;
          this.updatePreview();
          this.triggerAutoSave();
          return;
        }

        // 5. 通常の選択テキスト
        before = newOpenTag;
        after = closeTag;
        defaultText = selected;
        break;
      }
      case 'marker': {
        const bg = (extraParam && extraParam.bg) ? extraParam.bg : '#fef08a';
        const newOpenTag = `<mark style="background: linear-gradient(transparent 50%, ${bg} 50%); padding: 0 3px; color: inherit; font-weight: 500;">`;
        const closeTag = `</mark>`;

        // 1. 選択範囲がない場合
        if (!selected) {
          before = newOpenTag;
          after = closeTag;
          defaultText = 'マーカー強調';
          break;
        }

        // 2. 選択範囲全体が既に <mark style="...">...</mark> の場合
        const fullMarkMatch = selected.match(/^<mark\s+style="[^"]*">([\s\S]*?)<\/mark>$/i);
        if (fullMarkMatch) {
          const inner = fullMarkMatch[1];
          const replacement = `${newOpenTag}${inner}${closeTag}`;
          textarea.value = val.substring(0, start) + replacement + val.substring(end);
          textarea.focus();
          textarea.setSelectionRange(start, start + replacement.length);
          textarea.scrollTop = prevScrollTop;
          this.updatePreview();
          this.triggerAutoSave();
          return;
        }

        // 3. 選択範囲の前後にちょうど <mark style="..."> と </mark> が存在する場合
        const beforeText = val.substring(0, start);
        const afterText = val.substring(end);
        const beforeMarkMatch = beforeText.match(/<mark\s+style="[^"]*">\s*$/i);
        const afterMarkMatch = afterText.match(/^\s*<\/mark>/i);

        if (beforeMarkMatch && afterMarkMatch) {
          const tagStart = start - beforeMarkMatch[0].length;
          const tagEnd = end + afterMarkMatch[0].length;
          const replacement = `${newOpenTag}${selected}${closeTag}`;
          textarea.value = val.substring(0, tagStart) + replacement + val.substring(tagEnd);
          textarea.focus();
          textarea.setSelectionRange(tagStart, tagStart + replacement.length);
          textarea.scrollTop = prevScrollTop;
          this.updatePreview();
          this.triggerAutoSave();
          return;
        }

        // 4. 選択範囲の内部に別の <mark ...> が含まれている場合（入れ子を解消）
        if (/<mark\s+style="[^"]*">/i.test(selected)) {
          const cleaned = selected.replace(/<mark\s+style="[^"]*">/gi, '').replace(/<\/mark>/gi, '');
          const replacement = `${newOpenTag}${cleaned}${closeTag}`;
          textarea.value = val.substring(0, start) + replacement + val.substring(end);
          textarea.focus();
          textarea.setSelectionRange(start, start + replacement.length);
          textarea.scrollTop = prevScrollTop;
          this.updatePreview();
          this.triggerAutoSave();
          return;
        }

        // 5. 通常の選択テキスト
        before = newOpenTag;
        after = closeTag;
        defaultText = selected;
        break;
      }
      case 'quote':
        before = '> ';
        defaultText = selected || '引用テキスト';
        break;
      case 'codeblock':
        before = '```bash\n';
        after = '\n```';
        defaultText = selected || '# コマンドや設定コード';
        break;
      case 'hr':
        before = '\n---\n';
        defaultText = '';
        break;
      case 'pagebreak': {
        const isAtStart = (start === 0);
        let leading = '';
        if (!isAtStart) {
          const beforeStr = val.substring(0, start);
          if (!beforeStr.endsWith('\n\n')) {
            leading = beforeStr.endsWith('\n') ? '\n' : '\n\n';
          }
        }
        const afterStr = val.substring(end);
        const trailing = afterStr.startsWith('\n\n') ? '' : (afterStr.startsWith('\n') ? '\n' : '\n\n');
        before = `${leading}<div class="page-break"></div>${trailing}`;
        defaultText = '';
        break;
      }
      case 'ul':
        before = '- ';
        defaultText = selected || 'リスト項目';
        break;
      case 'ol':
        before = '1. ';
        defaultText = selected || '番号付きリスト';
        break;
      case 'task':
        before = '- [ ] ';
        defaultText = selected || 'タスク項目';
        break;
      case 'table':
        before = '\n| 項目 | 設定値 | 備考 |\n| :--- | :--- | :--- |\n| ';
        after = ' | 値1 | 説明1 |\n| 項目2 | 値2 | 説明2 |\n';
        defaultText = selected || '項目1';
        break;
      case 'link':
        before = '[';
        after = '](https://example.com)';
        defaultText = selected || 'リンクテキスト';
        break;
      case 'alert-note':
        before = '> [!NOTE]\n> ';
        defaultText = selected || 'ここに重要な補足事項を記述';
        break;
      case 'alert-warn':
        before = '> [!WARNING]\n> ';
        defaultText = selected || 'ここに注意・警告事項を記述';
        break;
      default:
        return;
    }

    const replacement = before + (selected || defaultText) + after;
    textarea.value = val.substring(0, start) + replacement + val.substring(end);

    // カーソル位置を計算
    const selStart = selected ? start : start + before.length;
    const selEnd = selected ? start + replacement.length : start + before.length + (selected ? selected.length : defaultText.length);

    textarea.focus();
    textarea.setSelectionRange(selStart, selEnd);

    // スクロール位置を即座に復元
    textarea.scrollTop = prevScrollTop;

    this.updatePreview();
    this.triggerAutoSave();
  },

  // ==========================================
  // 自動保存 & メモCRUD
  // ==========================================
  triggerAutoSave() {
    this.updateSaveStatus('saving');
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);

    this.autoSaveTimer = setTimeout(async () => {
      await this.saveCurrentNote();
    }, 500);
  },

  async saveCurrentNote() {
    if (!this.activeNoteId) return;
    const titleInput = document.getElementById('noteTitleInput');
    const catInput = document.getElementById('noteCategoryInput');
    const tagsInput = document.getElementById('noteTagsInput');
    const mdInput = document.getElementById('noteMarkdownInput');
    if (!titleInput || !mdInput) return;

    const title = titleInput.value.trim() || '無題のメモ';
    const category = catInput ? (catInput.value.trim() || 'General') : 'General';
    const rawTags = tagsInput ? tagsInput.value.trim() : '';
    const tags = rawTags ? rawTags.split(/[,\u3001]/).map(t => t.trim().replace(/^#+/, '').trim()).filter(Boolean) : [];
    const content = mdInput.value;

    try {
      this.isSaving = true;
      const payload = {
        ...(this.activeNote || {}),
        title,
        category,
        tags,
        content
      };

      await api.updateNote(this.activeNoteId, payload);
      this.activeNote = { ...this.activeNote, ...payload };
      this.updateSaveStatus('saved');

      const noteInList = this.notes.find(n => n.id === this.activeNoteId);
      if (noteInList) {
        noteInList.title = title;
        noteInList.category = category;
        noteInList.tags = tags;
        noteInList.summary = content.replace(/[#*`\n]/g, ' ').substring(0, 100);
      }

      const activeEl = document.querySelector(`.note-item[data-id="${this.activeNoteId}"]`);
      if (activeEl) {
        const titleEl = activeEl.querySelector('.note-item-title');
        const prevEl = activeEl.querySelector('.note-item-preview');
        const metaEl = activeEl.querySelector('.note-item-meta span:first-child');
        if (titleEl) titleEl.textContent = title;
        if (prevEl) prevEl.textContent = content.replace(/[#*`\n]/g, ' ').substring(0, 100);
        if (metaEl) metaEl.textContent = `📁 ${category}`;
      }

      if (this.onRefreshMeta) this.onRefreshMeta();
    } catch (err) {
      console.error("Auto save error:", err);
      this.updateSaveStatus('error');
    } finally {
      this.isSaving = false;
    }
  },

  updateSaveStatus(status) {
    const dot = document.getElementById('saveStatusDot');
    const text = document.getElementById('saveStatusText');
    if (!dot || !text) return;

    if (status === 'saving') {
      dot.className = 'save-status-dot saving';
      dot.style.backgroundColor = 'var(--accent-warning)';
      text.textContent = '保存中...';
    } else if (status === 'saved') {
      dot.className = 'save-status-dot';
      dot.style.backgroundColor = 'var(--accent-success)';
      text.textContent = '保存済み';
    } else if (status === 'error') {
      dot.className = 'save-status-dot';
      dot.style.backgroundColor = 'var(--accent-secondary)';
      text.textContent = '保存失敗';
    }
  },

  async createNewNote() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
      await this.saveCurrentNote();
    }

    try {
      const initialCat = this.currentCategory && this.currentCategory !== 'all' ? this.currentCategory : 'General';
      const res = await api.createNote({
        title: "新規メモ",
        content: "# 新規メモ\n\nここにメモや検証ログを記録してください。\n\n- [ ] 未完了タスク\n- [x] 完了タスク\n",
        category: initialCat,
        tags: []
      });

      await this.loadNotes();
      if (res.id) {
        await this.selectNote(res.id);
        const titleInput = document.getElementById('noteTitleInput');
        if (titleInput) {
          titleInput.focus();
          titleInput.select();
        }
      }
      this.showToast?.("新しいメモを作成しました", "success");
    } catch (err) {
      this.showToast?.("メモの作成に失敗しました", "error");
    }
  },

  // ==========================================
  // テンプレート管理
  // ==========================================
  initTemplateModal() {
    const modal = document.getElementById('templateModalOverlay');
    const btnOpen = document.getElementById('btnOpenTemplateModal');
    const btnClose = document.getElementById('btnCloseTemplateModal');
    const btnCancel = document.getElementById('btnCancelTemplateModal');

    if (btnOpen) btnOpen.addEventListener('click', () => {
      if (modal) modal.classList.add('active');
    });

    const closeModal = () => {
      if (modal) modal.classList.remove('active');
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    if (modal) {
      modal.querySelectorAll('.template-card').forEach(card => {
        card.addEventListener('click', async () => {
          const key = card.dataset.templateKey;
          closeModal();
          await this.applyTemplate(key);
        });
      });
    }
  },

  async applyTemplate(templateKey) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let title = '';
    let category = 'Maintenance';
    let tags = [];
    let content = '';

    if (templateKey === 'incident') {
      title = `🚨 【障害速報】サービス障害初動ログ (${dateStr})`;
      category = 'Incident';
      tags = ['incident', 'troubleshooting', 'alert'];
      content = `# 🚨 【障害速報】[対象サービス・機器名] 障害初動ログ

- **発生検知**: ${dateStr} ${timeStr} (JST)
- **検知契機**: アラート通知 / ユーザー申告
- **影響範囲**: Web/APIサーバー停止・応答不可
- **重要度**: Sev-2 (重大)
- **対応担当**: @admin

---

## 1. 事象概要
対象ホストにおいてリクエストタイムアウトおよびプロセス停止が発生。

## 2. 初動調査チェックリスト
- [x] 死活監視 ping 疎通確認
- [x] SSH / コンソールログイン確認
- [ ] サービスデーモン状態確認 (\`systemctl status docker\`)
- [ ] リソース使用率確認 (\`top\`, \`df -h\`, \`free -m\`)

\`\`\`bash
# 実行した一次調査コマンド
docker ps -a
docker logs --tail 50 my-app
dmesg -T | grep -i oom
\`\`\`

## 3. 時系列対応タイムライン
- **${timeStr}** 障害検知。一次切り分け調査を開始。
- **+10m** コンテナ停止およびメモリ超過を確認。
- **+20m** 暫定対処としてコンテナ再起動を実施。

## 4. 暫定対処 & ステータス
- **現在の状態**: 暫定復旧 (稼働監視中)
- **次のアクション**: ポストモーテム作成および恒久対策の検討
`;
    } else if (templateKey === 'postmortem') {
      title = `📋 ポストモーテム: [インシデント名] 障害事後検証報告書`;
      category = 'Postmortem';
      tags = ['postmortem', 'incident', 'sre', 'report'];
      content = `# 📋 ポストモーテム: [インシデント名] 障害事後検証報告書

- **作成日**: ${dateStr}
- **執筆者**: @admin
- **ステータス**: レビュー中 (Draft / Under Review / Completed)
- **影響度**: Sev-2
- **総ダウンタイム**: 約20分間 (${timeStr} 〜)

---

## 1. エグゼクティブサマリー (概要)
${dateStr} ${timeStr}頃、[対象ホスト/サービス]において[直接原因]によりサービス停止が発生した。暫定対処により完全復旧済み。本報告書では根本原因の解明と再発防止策を策定する。

## 2. 影響範囲 & 被害状況
- **影響サービス**: [影響を受けたシステム/ポート]
- **ユーザー影響**: エラー発生率 100% (約200リクエスト失敗)
- **データ損失**: なし

## 3. 詳細タイムライン (JST)
| 時刻 | 出来事 / 調査・対応内容 |
| :--- | :--- |
| **${timeStr}** | 監視システムよりアラート発報。一次対応開始。 |
| **+05m** | 該当プロセスのクラッシュを確認。ログ保全。 |
| **+15m** | 設定修正およびサービス再起動を実施。 |
| **+20m** | ヘルスチェック正常応答を確認し復旧宣言。 |

## 4. 根本原因分析 (Root Cause & 5 Whys)
- **直接原因**: メモリ使用量急増によるOOM-Killerの強制終了。
- **なぜ起きたか (5 Whys)**:
  1. なぜプロセスが停止したか？ → メモリ制限を超過したため。
  2. なぜメモリ制限を超過したか？ → 想定を超えるバッチデータが一括処理されたため。
  3. なぜ事前検知できなかったか？ → メモリ警告閾値のアラート設計が不足していたため。

## 5. 恒久対策 & アクションアイテム (Action Items)
| 分類 | アクション内容 | 担当者 | 期日 | 状態 |
| :--- | :--- | :--- | :--- | :--- |
| **予防** | バッチ処理のメモリ分割ストリーム処理への改修 | @dev | ${dateStr} | [ ] 未着手 |
| **検知** | メモリ使用率80%超過時の事前Slack警告通知追加 | @ops | ${dateStr} | [ ] 未着手 |
| **緩和** | ホストメモリリミットの緩和とSwap領域の最適化 | @ops | ${dateStr} | [x] 完了 |

## 6. 得られた教訓 (Lessons Learned)
### うまくいった点 (What went well)
- 障害検知から初動対応まで迅速に着手でき、ログ保全もスムーズだった。

### 改善すべき点 (What went wrong)
- メモリ枯渇の事前予兆を捉えるメトリクス監視が不十分だった。

### 幸運だった点 (Where we got lucky)
- 深夜帯のトラフィック低下時だったため、一般ユーザーへの影響は限定的だった。
`;
    } else {
      title = `🛠️ 作業手順書: [作業タイトル] (${dateStr})`;
      category = 'Maintenance';
      tags = ['maintenance', 'setup', 'procedure'];
      content = `# 🛠️ 作業手順書: [作業タイトル]

- **実施予定日時**: ${dateStr} 22:00 〜 23:00 (JST)
- **作業担当者**: @admin
- **作業種別**: パッチ適用 / ネットワーク構成変更 / 機器再起動
- **停止影響**: あり (約10分間の瞬断)

---

## 1. 作業目的・概要
本番ホストの定期メンテナンスおよびセキュリティ更新の適用。

## 2. 事前準備・前提条件
- [ ] バックアップが最新状態で正常取得されていることを確認
- [ ] 影響先への事前アナウンス完了
- [ ] 踏み台・コンソール経由でのSSHアクセス疎通確認

## 3. 作業タイムライン & 詳細コマンド
\`\`\`bash
# 1. 現行ステータス確認
uname -a
uptime

# 2. パッケージ更新
sudo apt update && sudo apt upgrade -y

# 3. 再起動
sudo reboot
\`\`\`

## 4. 切り戻し計画 (Rollback Plan)
- 再起動後にネットワークが不通になった場合、ホストコンソール（VNC/IPMI）よりブートログを確認し、旧カーネルバージョンを選択してフォールバック起動する。

## 5. 完了確認チェックリスト
- [ ] サービスデーモンが正常稼働 (active running) であること
- [ ] 外部疎通 (HTTP/HTTPS) が正常であること
- [ ] 監視アラートがすべてグリーンであること
`;
    }

    try {
      const res = await api.createNote({
        title,
        content,
        category,
        tags
      });
      await this.loadNotes();
      if (res.id) {
        await this.selectNote(res.id);
        const titleInput = document.getElementById('noteTitleInput');
        if (titleInput) {
          titleInput.focus();
          titleInput.select();
        }
      }
      this.showToast?.(`テンプレート「${title}」を作成しました`, 'success');
    } catch (err) {
      this.showToast?.("テンプレートの作成に失敗しました", 'error');
    }
  },

  // ==========================================
  // インシデントメモ → ポストモーテムへの変換 (確実に実行)
  // ==========================================
  async convertToPostmortem() {
    if (!this.activeNoteId || !this.activeNote) {
      this.showToast?.("変換対象のメモを選択してください", "error");
      return;
    }

    const currentTitle = this.activeNote.title || '無題のメモ';
    const currentContent = this.activeNote.content || '';

    // タイトルの整形
    const postmortemTitle = `📋 ポストモーテム: ${currentTitle.replace(/^🚨\s*【[^】]+】\s*/, '').replace(/初動ログ.*/, '').trim() || '障害事後検証報告書'}`;

    // 既存メモからタイムラインを抽出
    let extractedTimeline = '';
    const timelineMatch = currentContent.match(/##\s*3\.\s*時系列対応タイムライン[\s\S]*?(?=##|$)/i);
    if (timelineMatch) {
      extractedTimeline = timelineMatch[0].replace(/##\s*3\.\s*時系列対応タイムライン/, '').trim();
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    const postmortemContent = `# ${postmortemTitle}

- **作成日**: ${dateStr}
- **元インシデントメモ**: [[${escapeHtml(currentTitle)}]]
- **執筆者**: @admin
- **ステータス**: レビュー中 (Draft / Under Review / Completed)
- **影響度**: Sev-2

---

## 1. エグゼクティブサマリー (概要)
【元インシデントからの要約】
${currentTitle} における事象の事後検証報告書です。暫定対処により復旧済みであり、根本原因の分析と再発防止策を以下にまとめます。

## 2. 影響範囲 & 被害状況
- **対象システム**: ${escapeHtml(this.activeNote.category || 'Server')}
- **影響時間**: 
- **データ損失**: なし

## 3. 詳細タイムライン (JST)
${extractedTimeline ? `### インシデント初動ログからの引き継ぎ:\n${extractedTimeline}\n` : ''}
| 時刻 | 出来事 / 対応内容 |
| :--- | :--- |
| **00:00** | 障害検知 |
| **+15m** | 暫定復旧完了 |

## 4. 根本原因分析 (Root Cause & 5 Whys)
- **直接原因**: 
- **なぜ起きたか (5 Whys)**:
  1. なぜ起きたか？ → 
  2. なぜ防げなかったか？ → 
  3. なぜ検知が遅れたか？ → 

## 5. 恒久対策 & アクションアイテム (Action Items)
| 分類 | アクション内容 | 担当者 | 期日 | 状態 |
| :--- | :--- | :--- | :--- | :--- |
| **予防** | 構成・コード改修 | @admin | ${dateStr} | [ ] 未着手 |
| **検知** | 監視アラートルール見直し | @admin | ${dateStr} | [ ] 未着手 |
| **緩和** | フェイルオーバー・リトライ機構の整備 | @admin | ${dateStr} | [ ] 未着手 |

## 6. 得られた教訓 (Lessons Learned)
### うまくいった点 (What went well)
- 

### 改善すべき点 (What went wrong)
- 

### 幸運だった点 (Where we got lucky)
- 

---

<details>
<summary><b>参考: 元インシデントメモ初動記録</b></summary>

\`\`\`markdown
${currentContent}
\`\`\`
</details>
`;

    // アラートの即消えを防ぐため、安全に新規メモとして即時作成しトーストで通知
    try {
      const res = await api.createNote({
        title: postmortemTitle,
        content: postmortemContent,
        category: 'Postmortem',
        tags: ['postmortem', 'incident', 'report']
      });
      await this.loadNotes();
      if (res.id) {
        await this.selectNote(res.id);
      }
      this.showToast?.("ポストモーテム報告書を作成しました！", "success");
    } catch (err) {
      console.error("Failed to convert to postmortem:", err);
      this.showToast?.("ポストモーテムの作成に失敗しました", "error");
    }
  },

  async deleteCurrentNote() {
    if (!this.activeNoteId) return;
    if (confirm(`現在のメモ「${this.activeNote?.title || ''}」を削除してもよろしいですか？`)) {
      try {
        await api.deleteNote(this.activeNoteId);
        this.showToast?.("メモを削除しました", "info");
        this.activeNoteId = null;
        this.activeNote = null;
        await this.loadNotes();
        if (this.onRefreshMeta) this.onRefreshMeta();
      } catch (err) {
        this.showToast?.("メモの削除に失敗しました", "error");
      }
    }
  },

  // スニペットをメモに挿入 (専用モーダル表示)
  async insertSnippetPrompt() {
    const mdInput = document.getElementById('noteMarkdownInput');
    if (!mdInput) return;

    const modal = document.getElementById('insertSnippetModalOverlay');
    const listEl = document.getElementById('insertSnippetList');
    const searchInput = document.getElementById('insertSnippetSearchInput');
    const btnClose = document.getElementById('btnCloseInsertSnippetModal');
    const btnCancel = document.getElementById('btnCancelInsertSnippetModal');
    if (!modal || !listEl) return;

    let snippets = [];
    try {
      snippets = await api.getSnippets();
    } catch (err) {
      this.showToast?.("スニペットの取得に失敗しました", "error");
      return;
    }

    if (!snippets || snippets.length === 0) {
      this.showToast?.("登録されているスニペットがありません", "info");
      return;
    }

    const renderList = (filterText = '') => {
      const q = filterText.toLowerCase().trim();
      const filtered = snippets.filter(s => {
        if (!q) return true;
        return (s.title && s.title.toLowerCase().includes(q)) ||
               (s.command && s.command.toLowerCase().includes(q)) ||
               (s.category && s.category.toLowerCase().includes(q)) ||
               (s.tags && s.tags.some(t => t.toLowerCase().includes(q)));
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:0.85rem;">該当するスニペットがありません</div>';
        return;
      }

      listEl.innerHTML = filtered.map(s => {
        const cmdPreview = (s.command || '').split('\n')[0];
        return `
          <div class="insert-snippet-item" data-id="${s.id}">
            <div class="insert-snippet-info">
              <div class="insert-snippet-header">
                <span class="badge-cat" style="font-size:0.7rem;">${escapeHtml(s.category || 'General')}</span>
                <span class="insert-snippet-title">${escapeHtml(s.title)}</span>
              </div>
              <div class="insert-snippet-cmd">${escapeHtml(cmdPreview)}</div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" style="flex-shrink:0;">
              <i class="fa-solid fa-plus"></i> 挿入
            </button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.insert-snippet-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = parseInt(item.getAttribute('data-id'), 10);
          const s = snippets.find(x => x.id === id);
          if (s) {
            const snippetBlock = `\n\`\`\`${s.language || 'bash'}\n# ${s.title}\n${s.command}\n\`\`\`\n`;
            const start = mdInput.selectionStart || 0;
            const end = mdInput.selectionEnd || 0;
            const val = mdInput.value;
            mdInput.value = val.substring(0, start) + snippetBlock + val.substring(end);
            mdInput.selectionStart = mdInput.selectionEnd = start + snippetBlock.length;
            this.updatePreview();
            this.triggerAutoSave();
            this.showToast?.(`「${s.title}」を挿入しました`, "success");
            closeModal();
            mdInput.focus();
          }
        });
      });
    };

    const closeModal = () => {
      modal.style.display = 'none';
      if (searchInput) searchInput.value = '';
    };

    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    if (searchInput) {
      searchInput.value = '';
      searchInput.oninput = (e) => renderList(e.target.value);
    }

    renderList();
    modal.style.display = 'flex';
    if (searchInput) searchInput.focus();
  },

  bindEvents() {
    const titleInput = document.getElementById('noteTitleInput');
    const catInput = document.getElementById('noteCategoryInput');
    const tagsInput = document.getElementById('noteTagsInput');
    const mdInput = document.getElementById('noteMarkdownInput');
    const btnNewInline = document.getElementById('btnCreateNoteInline');
    const btnNewHeader = document.getElementById('btnNewNote');
    const btnDel = document.getElementById('btnDeleteCurrentNote');
    const btnInsertSnippet = document.getElementById('btnInsertSnippetIntoNote');
    const btnFav = document.getElementById('btnNoteFavorite');
    const btnPin = document.getElementById('btnNotePin');
    const btnPostmortem = document.getElementById('btnConvertToPostmortem');

    if (btnFav) {
      btnFav.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!this.activeNoteId || !this.activeNote) return;
        const newFav = this.activeNote.favorite ? 0 : 1;
        await api.updateNote(this.activeNoteId, {
          ...this.activeNote,
          favorite: newFav
        });
        this.activeNote.favorite = newFav;
        btnFav.innerHTML = newFav ? '<i class="fa-solid fa-star" style="color:#eab308;"></i>' : '<i class="fa-regular fa-star"></i>';
        btnFav.title = newFav ? 'お気に入りを解除' : 'お気に入りに追加';
        btnFav.classList.toggle('active', Boolean(newFav));
        this.showToast?.(newFav ? "メモをお気に入りに追加しました" : "お気に入りを解除しました", "info");
        await this.loadNotes();
      });
    }

    if (btnPin) {
      btnPin.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!this.activeNoteId || !this.activeNote) return;
        const newPin = this.activeNote.pinned ? 0 : 1;
        await api.updateNote(this.activeNoteId, {
          ...this.activeNote,
          pinned: newPin
        });
        this.activeNote.pinned = newPin;
        btnPin.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
        btnPin.title = newPin ? 'ピン留めを解除' : '上部にピン留め';
        btnPin.style.color = newPin ? '#ef4444' : 'inherit';
        btnPin.style.opacity = newPin ? '1' : '0.4';
        btnPin.classList.toggle('active', Boolean(newPin));
        this.showToast?.(newPin ? "メモを上部にピン留めしました" : "ピン留めを解除しました", "info");
        await this.loadNotes();
      });
    }

    if (btnPostmortem) {
      btnPostmortem.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.convertToPostmortem();
      });
    }

    if (titleInput) titleInput.addEventListener('input', () => this.triggerAutoSave());
    if (catInput) catInput.addEventListener('input', () => this.triggerAutoSave());
    if (tagsInput) tagsInput.addEventListener('input', () => this.triggerAutoSave());

    if (mdInput) {
      mdInput.addEventListener('input', () => {
        this.updatePreview();
        this.triggerAutoSave();
      });

      // Smart List Continuation (箇条書き・番号リスト・チェックリストのEnter自動継続)
      mdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
          const val = mdInput.value;
          const cursorPos = mdInput.selectionStart;

          // カーソル直前の行の開始位置を探す
          const lastNewline = val.lastIndexOf('\n', cursorPos - 1);
          const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
          const lineText = val.substring(lineStart, cursorPos);

          // 1. チェックリスト: ^(\s*)-\s\[([ xX])\]\s(.*)$
          const taskMatch = lineText.match(/^(\s*)-\s\[([ xX])\]\s(.*)$/);
          if (taskMatch) {
            e.preventDefault();
            const indent = taskMatch[1];
            const content = taskMatch[3];

            if (!content.trim()) {
              // 項目が空ならプレフィックスを消去してリスト終了
              const beforeLine = val.substring(0, lineStart);
              const afterCursor = val.substring(cursorPos);
              mdInput.value = beforeLine + afterCursor;
              mdInput.selectionStart = mdInput.selectionEnd = lineStart;
            } else {
              insertAtCursor(`\n${indent}- [ ] `);
            }
            this.updatePreview();
            this.triggerAutoSave();
            return;
          }

          // 2. 番号付きリスト: ^(\s*)(\d+)\.\s(.*)$
          const numMatch = lineText.match(/^(\s*)(\d+)\.\s(.*)$/);
          if (numMatch) {
            e.preventDefault();
            const indent = numMatch[1];
            const num = parseInt(numMatch[2], 10);
            const content = numMatch[3];

            if (!content.trim()) {
              const beforeLine = val.substring(0, lineStart);
              const afterCursor = val.substring(cursorPos);
              mdInput.value = beforeLine + afterCursor;
              mdInput.selectionStart = mdInput.selectionEnd = lineStart;
            } else {
              insertAtCursor(`\n${indent}${num + 1}. `);
            }
            this.updatePreview();
            this.triggerAutoSave();
            return;
          }

          // 3. 箇条書きリスト: ^(\s*)([-*+])\s(.*)$
          const bulletMatch = lineText.match(/^(\s*)([-*+])\s(.*)$/);
          if (bulletMatch) {
            e.preventDefault();
            const indent = bulletMatch[1];
            const bullet = bulletMatch[2];
            const content = bulletMatch[3];

            if (!content.trim()) {
              const beforeLine = val.substring(0, lineStart);
              const afterCursor = val.substring(cursorPos);
              mdInput.value = beforeLine + afterCursor;
              mdInput.selectionStart = mdInput.selectionEnd = lineStart;
            } else {
              insertAtCursor(`\n${indent}${bullet} `);
            }
            this.updatePreview();
            this.triggerAutoSave();
            return;
          }

          function insertAtCursor(insertStr) {
            const before = val.substring(0, cursorPos);
            const after = val.substring(cursorPos);
            const prevScroll = mdInput.scrollTop;
            mdInput.value = before + insertStr + after;
            mdInput.selectionStart = mdInput.selectionEnd = cursorPos + insertStr.length;
            mdInput.scrollTop = prevScroll;
          }
        }
      });
    }

    const btnPrintHeaderPdf = document.getElementById('btnPrintNoteHeaderPdf');
    if (btnPrintHeaderPdf) {
      btnPrintHeaderPdf.addEventListener('click', (e) => {
        e.preventDefault();
        this.printPreviewAsPdf();
      });
    }

    const btnPrintMaxPdf = document.getElementById('btnPrintMaxPreviewPdf');
    if (btnPrintMaxPdf) {
      btnPrintMaxPdf.addEventListener('click', (e) => {
        e.preventDefault();
        this.printPreviewAsPdf();
      });
    }

    if (btnNewInline) btnNewInline.addEventListener('click', (e) => {
      e.preventDefault();
      this.createNewNote();
    });

    if (btnNewHeader) btnNewHeader.addEventListener('click', (e) => {
      e.preventDefault();
      const navNotes = document.getElementById('navNotes');
      if (navNotes) navNotes.click();
      this.createNewNote();
    });

    if (btnDel) btnDel.addEventListener('click', (e) => {
      e.preventDefault();
      this.deleteCurrentNote();
    });

    if (btnInsertSnippet) btnInsertSnippet.addEventListener('click', (e) => {
      e.preventDefault();
      this.insertSnippetPrompt();
    });

    const btnOpenCanvasFromNote = document.getElementById('btnOpenCanvasFromNote');
    if (btnOpenCanvasFromNote) {
      btnOpenCanvasFromNote.addEventListener('click', (e) => {
        e.preventDefault();
        openDrawioModal({}, (diagramData) => {
          this.insertDrawioIntoNote(diagramData);
        });
      });
    }

    // Preview Maximize Controls
    const btnToggleMax = document.getElementById('btnToggleMaximizePreview');
    const btnCloseMax = document.getElementById('btnCloseMaxPreview');

    if (btnToggleMax) {
      btnToggleMax.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleMaximizePreview();
      });
    }
    if (btnCloseMax) {
      btnCloseMax.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleMaximizePreview(false);
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const wrap = document.getElementById('noteMarkdownPreviewWrap');
        if (wrap && wrap.classList.contains('is-maximized')) {
          this.toggleMaximizePreview(false);
          e.stopPropagation();
        }
        const insertModal = document.getElementById('insertSnippetModalOverlay');
        if (insertModal && insertModal.style.display !== 'none') {
          insertModal.style.display = 'none';
          e.stopPropagation();
        }
      }
    });
  },

  toggleMaximizePreview(forceState = null) {
    const wrap = document.getElementById('noteMarkdownPreviewWrap');
    const topbar = document.getElementById('previewMaxTopbar');
    const iconSpan = document.getElementById('iconMaximizePreview');
    const textSpan = document.getElementById('textMaximizePreview');
    const titleText = document.getElementById('previewMaxTitleText');
    const catBadge = document.getElementById('previewMaxCategoryBadge');
    if (!wrap) return;

    const nextState = forceState !== null ? forceState : !wrap.classList.contains('is-maximized');

    wrap.classList.toggle('is-maximized', nextState);
    if (topbar) topbar.style.display = nextState ? 'flex' : 'none';

    if (iconSpan) {
      iconSpan.className = nextState ? 'fa-solid fa-compress' : 'fa-solid fa-up-right-and-down-left-from-center';
      iconSpan.textContent = '';
    }
    if (textSpan) textSpan.textContent = nextState ? '通常表示に戻す' : 'プレビュー最大化';

    if (nextState) {
      const currentTitle = document.getElementById('noteTitleInput')?.value || this.activeNote?.title || '無題のメモ';
      const currentCat = document.getElementById('noteCategoryInput')?.value || this.activeNote?.category || 'General';
      if (titleText) titleText.textContent = currentTitle;
      if (catBadge) catBadge.textContent = currentCat;
    }
  },

  printPreviewAsPdf() {
    const previewEl = document.getElementById('noteMarkdownPreview');
    if (!previewEl) return;

    const title = document.getElementById('noteTitleInput')?.value || this.activeNote?.title || '無題のメモ';
    const category = document.getElementById('noteCategoryInput')?.value || this.activeNote?.category || 'General';
    const createdAt = this.activeNote?.created_at || '';

    // プレビューのクローンを作成し、不要なUI要素（ボタン類・最大化バー・ポート結合ソケット）を除去
    const clone = previewEl.cloneNode(true);
    clone.querySelectorAll('.canvas-embed-actions, button, .preview-max-topbar, .device-port-socket').forEach(el => el.remove());

    // 構成図のダーク背景インラインスタイルを白・印刷用に正規化
    clone.querySelectorAll('.opsnotes-canvas-embed, .canvas-embed-body, .opsnotes-canvas-embed svg, svg.opsnotes-canvas-svg').forEach(el => {
      el.style.backgroundColor = '#ffffff';
      el.style.background = '#ffffff';
    });
    const previewHtml = clone.innerHTML;

    // 既存の印刷用iframeがあれば削除
    const oldIframe = document.getElementById('opsnotesPrintFrame');
    if (oldIframe) oldIframe.remove();

    // 印刷専用の非表示iframeを生成（ポップアップブロックを完全に回避）
    const iframe = document.createElement('iframe');
    iframe.id = 'opsnotesPrintFrame';
    iframe.style.position = 'fixed';
    iframe.style.right = '100%';
    iframe.style.bottom = '100%';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} - OpsNotes</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/atom-one-dark.min.css">
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm 16mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
      color: #0f172a;
      background: #ffffff;
      line-height: 1.7;
      font-size: 10pt;
      margin: 0;
      padding: 0;
    }
    .print-doc-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .print-doc-title {
      font-size: 16pt;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }
    .print-doc-meta {
      font-size: 8.5pt;
      color: #64748b;
      text-align: right;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #0f172a;
      page-break-after: avoid;
      break-after: avoid;
      margin-top: 18pt;
      margin-bottom: 8pt;
    }
    h1 { font-size: 16pt; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
    h2 { font-size: 13pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
    h3 { font-size: 11pt; }
    p, ul, ol, blockquote {
      margin-top: 6pt;
      margin-bottom: 8pt;
    }
    li {
      margin-bottom: 3pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12pt 0;
      font-size: 9.5pt;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 10px;
      text-align: left;
    }
    th {
      background-color: #f1f5f9;
      font-weight: 600;
    }
    pre {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 10px 12px;
      overflow-x: auto;
      font-family: Consolas, Monaco, monospace;
      font-size: 9pt;
      line-height: 1.5;
      page-break-inside: avoid;
      break-inside: avoid;
      margin: 10pt 0;
    }
    code {
      font-family: Consolas, Monaco, monospace;
      background-color: #f1f5f9;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 9pt;
      color: #0f172a;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      border-radius: 0;
    }
    blockquote {
      margin: 10pt 0;
      padding: 8px 14px;
      border-left: 4px solid #3b82f6;
      background-color: #f8fafc;
      color: #334155;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    img, svg, .opsnotes-canvas-embed {
      max-width: 100%;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .opsnotes-canvas-embed {
      margin: 14pt 0;
      text-align: center;
      background-color: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 6px;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .canvas-embed-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6pt 10pt;
      background-color: #f8fafc !important;
      border-bottom: 1px solid #e2e8f0 !important;
      font-size: 9pt;
      font-weight: 600;
      color: #334155 !important;
    }
    .canvas-embed-title {
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .canvas-embed-body {
      padding: 12pt;
      background-color: #ffffff !important;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .opsnotes-canvas-embed svg,
    svg.opsnotes-canvas-svg {
      max-width: 100% !important;
      height: auto !important;
      background-color: #ffffff !important;
      background: #ffffff !important;
      border: 1px solid #f1f5f9;
      border-radius: 4px;
    }
    .device-port-socket {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
    }
    mark {
      padding: 0 3px;
    }
    .page-break {
      page-break-after: always !important;
      break-after: page !important;
      clear: both !important;
      display: block !important;
      height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
    }
    .page-break::after {
      display: none !important;
    }
    .print-doc-footer {
      margin-top: 30pt;
      padding-top: 8pt;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="print-doc-header">
    <div>
      <div style="font-size:8.5pt; font-weight:600; color:#3b82f6; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">📁 ${escapeHtml(category)}</div>
      <h1 class="print-doc-title">${escapeHtml(title)}</h1>
    </div>
    <div class="print-doc-meta">
      ${createdAt ? `<div>作成: ${escapeHtml(createdAt)}</div>` : ''}
      <div>印刷: ${new Date().toLocaleString('ja-JP')}</div>
    </div>
  </div>
  <div class="print-content">
    ${previewHtml}
  </div>
  <div class="print-doc-footer">
    <span>OpsNotes - ホームラボ運用ノート</span>
    <span>Powered by Local OpsNotes System</span>
  </div>
</body>
</html>`);
    doc.close();

    // 印刷完了または破棄の待機
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        console.error("Print error:", err);
      }
    }, 250);
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

function ensureBreaks(md) {
  if (!md) return '';

  const codeBlocks = [];
  let pIdx = 0;
  let text = md.replace(/```[\s\S]*?```/g, (match) => {
    const key = `@@@HOME_OPS_CODE_${pIdx++}@@@`;
    codeBlocks.push({ key, content: match });
    return key;
  });

  text = text.replace(/([^\n \t])\n(?!\n)/g, '$1  \n');

  codeBlocks.forEach(cb => {
    text = text.replace(cb.key, cb.content);
  });

  return text;
}
