/**
 * OpsNotes - Main Application Entrypoint
 * Coordinates UI views, themes, sidebar navigation, and modular managers
 */

import { api } from './api.js';
import { themeManager } from './themes.js';
import { snippetsManager } from './snippets.js';
import { notesManager } from './notes.js';
import { searchManager } from './search.js';
import { backupManager } from './backup.js';
import { initCanvasModal, openCanvasModal } from './canvas/canvasModal.js';

// --- Toast Notification System ---
export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success'
    ? '<i class="fa-solid fa-circle-check" style="color:var(--accent-success);"></i>'
    : type === 'error'
    ? '<i class="fa-solid fa-circle-exclamation" style="color:var(--accent-warning);"></i>'
    : '<i class="fa-solid fa-circle-info" style="color:var(--accent-info);"></i>';
  toast.innerHTML = `<span style="display:inline-flex; align-items:center;">${icon}</span><span>${message}</span>`;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// --- App State & Navigation ---
class App {
  constructor() {
    this.currentView = 'snippets'; // 'snippets' | 'notes'
    this.activeCategory = 'all';
    this.activeTag = null;
    this.isFavoritesOnly = false;
  }

  async init() {
    // 1. テーマの初期化
    themeManager.init();

    // 2. 各サブマネージャーの初期化
    await snippetsManager.init({
      showToast,
      onRefreshMeta: () => this.refreshMeta()
    });

    await notesManager.init({
      showToast,
      onRefreshMeta: () => this.refreshMeta()
    });

    searchManager.init({
      showToast,
      onSelectSnippet: (id) => this.goToSnippet(id),
      onSelectNote: (id) => this.goToNote(id)
    });

    backupManager.init({
      showToast,
      onRefreshAll: async () => {
        await snippetsManager.loadVariables();
        await snippetsManager.loadSnippets();
        await notesManager.loadNotes();
        await this.refreshMeta();
      }
    });

    // 3. キャンバス（作図）モジュールの初期化
    initCanvasModal();

    // 4. UIイベントのバインド
    this.bindEvents();
    this.initPaneResizers();
    await this.refreshMeta();
  }

  bindEvents() {
    const navSnippets = document.getElementById('navSnippets');
    const navNotes = document.getElementById('navNotes');
    const navFavs = document.getElementById('navFavorites');
    const sortSelect = document.getElementById('snippetSortSelect');

    if (navSnippets) {
      navSnippets.addEventListener('click', () => {
        this.switchView('snippets');
        this.isFavoritesOnly = false;
        navFavs.classList.remove('active');
        snippetsManager.onlyFavorites = false;
        notesManager.onlyFavorites = false;
        snippetsManager.loadSnippets();
        notesManager.loadNotes();
      });
    }

    if (navNotes) {
      navNotes.addEventListener('click', () => {
        this.switchView('notes');
        notesManager.loadNotes();
      });
    }

    if (navFavs) {
      navFavs.addEventListener('click', () => {
        this.isFavoritesOnly = !this.isFavoritesOnly;
        navFavs.classList.toggle('active', this.isFavoritesOnly);
        if (this.isFavoritesOnly && this.currentView !== 'snippets') {
          this.switchView('snippets', false);
        }
        snippetsManager.onlyFavorites = this.isFavoritesOnly;
        notesManager.onlyFavorites = this.isFavoritesOnly;
        snippetsManager.loadSnippets();
        notesManager.loadNotes();
        this.updateFavoritesView();
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        snippetsManager.loadSnippets();
      });
    }
  }

  switchView(viewName, resetFavorites = true) {
    this.currentView = viewName;
    const snippetsView = document.getElementById('snippetsView');
    const notesView = document.getElementById('notesView');
    const navSnippets = document.getElementById('navSnippets');
    const navNotes = document.getElementById('navNotes');
    const navFavs = document.getElementById('navFavorites');

    if (resetFavorites) {
      this.isFavoritesOnly = false;
      if (navFavs) navFavs.classList.remove('active');
      snippetsManager.onlyFavorites = false;
      notesManager.onlyFavorites = false;
    }

    const relatedSection = document.getElementById('relatedNotesSection');

    if (viewName === 'snippets') {
      snippetsView.style.display = 'flex';
      notesView.style.display = 'none';
      navSnippets.classList.add('active');
      navNotes.classList.remove('active');
      if (relatedSection) relatedSection.style.display = 'none';
    } else {
      snippetsView.style.display = 'none';
      notesView.style.display = 'flex';
      navSnippets.classList.remove('active');
      navNotes.classList.add('active');
      if (relatedSection) relatedSection.style.display = 'flex';
    }
    this.updateFavoritesView();
  }

  updateFavoritesView() {
    const titleEl = document.getElementById('currentCategoryTitle');
    const favNotesWrap = document.getElementById('favoritesNotesSection');

    if (this.isFavoritesOnly) {
      if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-star" style="color:#eab308; margin-right:6px;"></i> お気に入りハブ';
      if (favNotesWrap) favNotesWrap.style.display = 'block';
      this.renderFavoritesNotes();
    } else {
      if (favNotesWrap) favNotesWrap.style.display = 'none';
      if (titleEl) {
        titleEl.innerHTML = this.activeCategory === 'all'
          ? '<i class="fa-solid fa-code" style="margin-right:6px;"></i> コマンドスニペット'
          : `<i class="fa-solid fa-folder" style="margin-right:6px;"></i> ${escapeHtml(this.activeCategory)} スニペット`;
      }
    }
  }

  async renderFavoritesNotes() {
    const grid = document.getElementById('favoritesNotesGrid');
    const badge = document.getElementById('favNotesCountBadge');
    if (!grid) return;

    try {
      const favNotes = await api.getNotes({ favorite: 1 });
      if (badge) badge.textContent = favNotes.length;

      if (favNotes.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; padding:20px; color:var(--text-muted); font-size:0.85rem; text-align:center;">お気に入りのメモはまだありません。メモ画面の「☆」ボタンを押してお気に入りに追加できます。</div>';
        return;
      }

      grid.innerHTML = '';
      favNotes.forEach(n => {
        const card = document.createElement('div');
        card.className = 'snippet-card';
        card.style.cursor = 'pointer';
        card.style.padding = '14px 16px';
        card.innerHTML = `
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
            <div style="font-weight:600; font-size:0.95rem; color:var(--text-main);">
              ${n.pinned ? '<i class="fa-solid fa-thumbtack" style="margin-right:4px; color:#ef4444;"></i>' : ''}${escapeHtml(n.title)}
            </div>
            <span style="font-size:0.85rem; color:#eab308;"><i class="fa-solid fa-star"></i></span>
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin:6px 0 10px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
            ${escapeHtml(n.summary || '')}
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); margin-top:auto; border-top:1px solid var(--border-subtle); padding-top:8px;">
            <span class="badge-cat"><i class="fa-solid fa-folder" style="margin-right:4px;"></i>${escapeHtml(n.category || 'General')}</span>
            <span style="color:var(--accent-primary); font-weight:600;">開く <i class="fa-solid fa-arrow-right"></i></span>
          </div>
        `;
        card.addEventListener('click', () => {
          this.goToNote(n.id);
        });
        grid.appendChild(card);
      });
    } catch (err) {
      console.error("Failed to render favorite notes:", err);
    }
  }

  async refreshMeta() {
    try {
      const meta = await api.getMeta();
      
      // サイドバーバッジ更新
      const cntSnippets = document.getElementById('countSnippets');
      const cntNotes = document.getElementById('countNotes');
      const statCopies = document.getElementById('statCopies');

      if (cntSnippets) cntSnippets.textContent = meta.metrics.snippets_count;
      if (cntNotes) cntNotes.textContent = meta.metrics.notes_count;
      if (statCopies) statCopies.textContent = meta.metrics.copies_count;

      // カテゴリ一覧描画
      const catContainer = document.getElementById('sidebarCategories');
      if (catContainer) {
        catContainer.innerHTML = `
          <div class="sidebar-nav-item ${this.activeCategory === 'all' ? 'active' : ''}" data-category="all">
            <span>すべて</span>
            <span class="item-count">${meta.metrics.snippets_count + meta.metrics.notes_count}</span>
          </div>
        `;

        meta.categories.forEach(cat => {
          const item = document.createElement('div');
          item.className = `sidebar-nav-item ${this.activeCategory === cat.name ? 'active' : ''}`;
          item.dataset.category = cat.name;
          item.innerHTML = `
            <span>📁 ${escapeHtml(cat.name)}</span>
            <span class="item-count">${cat.snippet_count + cat.note_count}</span>
          `;
          item.addEventListener('click', () => {
            this.setCategory(cat.name);
          });
          catContainer.appendChild(item);
        });

        // 「すべて」のクリックイベント
        catContainer.querySelector('[data-category="all"]').addEventListener('click', () => {
          this.setCategory('all');
        });
      }

      // タグクラウド描画
      const tagContainer = document.getElementById('sidebarTags');
      if (tagContainer) {
        tagContainer.innerHTML = '';
        if (!meta.tags || meta.tags.length === 0) {
          tagContainer.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted); padding:2px 4px;">タグなし</span>';
        } else {
          meta.tags.slice(0, 100).forEach(t => {
            const badge = document.createElement('span');
            badge.className = `tag-badge ${this.activeTag === t.name ? 'active' : ''}`;
            badge.textContent = `#${t.name} (${t.count})`;
            badge.addEventListener('click', () => {
              if (this.activeTag === t.name) {
                this.activeTag = null;
                badge.classList.remove('active');
              } else {
                this.activeTag = t.name;
                tagContainer.querySelectorAll('.tag-badge').forEach(b => b.classList.remove('active'));
                badge.classList.add('active');
              }
              snippetsManager.currentTag = this.activeTag;
              notesManager.currentTag = this.activeTag;
              snippetsManager.loadSnippets();
              notesManager.loadNotes();
            });
            tagContainer.appendChild(badge);
          });
        }
      }

    } catch (err) {
      console.error("Failed to refresh meta:", err);
    }
  }

  setCategory(category) {
    this.activeCategory = category;
    const catItems = document.querySelectorAll('#sidebarCategories .sidebar-nav-item');
    catItems.forEach(el => {
      el.classList.toggle('active', el.dataset.category === category);
    });

    const titleEl = document.getElementById('currentCategoryTitle');
    if (titleEl) {
      titleEl.innerHTML = category === 'all'
        ? '<i class="fa-solid fa-code" style="margin-right:6px;"></i> コマンドスニペット'
        : `<i class="fa-solid fa-folder" style="margin-right:6px;"></i> ${escapeHtml(category)} スニペット`;
    }

    snippetsManager.currentCategory = category;
    notesManager.currentCategory = category;
    snippetsManager.loadSnippets();
    notesManager.loadNotes();
  }

  goToSnippet(id) {
    this.switchView('snippets');
    // カードを探してスクロール
    setTimeout(() => {
      const card = document.querySelector(`.snippet-card[data-id="${id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.outline = '2px solid var(--accent-primary)';
        setTimeout(() => { card.style.outline = ''; }, 2000);
      }
    }, 150);
  }

  goToNote(id) {
    this.switchView('notes');
    notesManager.selectNote(id);
  }

  initPaneResizers() {
    // 1. Sidebar Resizer & Toggle
    const sidebar = document.querySelector('.app-sidebar');
    const sidebarResizer = document.getElementById('sidebarResizer');
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');

    // 2. Notes List Resizer & Toggle
    const notesListPane = document.querySelector('.notes-list-pane');
    const notesListResizer = document.getElementById('notesListResizer');
    const btnToggleNotesList = document.getElementById('btnToggleNotesList');
    const btnReopenNotesList = document.getElementById('btnReopenNotesList');

    // Helper for Sidebar collapsed state
    const setSidebarCollapsed = (collapsed) => {
      if (!sidebar) return;
      sidebar.classList.toggle('is-collapsed', collapsed);
      if (btnToggleSidebar) {
        const icon = btnToggleSidebar.querySelector('i');
        if (icon) {
          icon.className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
        }
        btnToggleSidebar.title = collapsed ? 'サイドバーを展開' : 'サイドバーを閉じる';
      }
      localStorage.setItem('opsnotes_sidebar_collapsed', collapsed);
    };

    // Restore saved widths and collapsed states
    const savedSidebarWidth = localStorage.getItem('opsnotes_sidebar_width');
    const savedSidebarCollapsed = localStorage.getItem('opsnotes_sidebar_collapsed') === 'true';
    if (savedSidebarWidth && sidebar) {
      sidebar.style.width = `${savedSidebarWidth}px`;
    }
    if (savedSidebarCollapsed && sidebar) {
      setSidebarCollapsed(true);
    }

    const savedNotesListWidth = localStorage.getItem('opsnotes_noteslist_width');
    const savedNotesListCollapsed = localStorage.getItem('opsnotes_noteslist_collapsed') === 'true';
    if (savedNotesListWidth && notesListPane) {
      notesListPane.style.width = `${savedNotesListWidth}px`;
    }
    if (savedNotesListCollapsed && notesListPane) {
      notesListPane.classList.add('is-collapsed');
      if (btnReopenNotesList) btnReopenNotesList.style.display = 'inline-flex';
    }

    // Toggle Sidebar
    if (btnToggleSidebar) {
      btnToggleSidebar.addEventListener('click', () => {
        const isCollapsed = sidebar ? sidebar.classList.contains('is-collapsed') : false;
        setSidebarCollapsed(!isCollapsed);
      });
    }

    // Toggle Notes List
    const setNotesListCollapsed = (collapsed) => {
      if (!notesListPane) return;
      notesListPane.classList.toggle('is-collapsed', collapsed);
      if (btnReopenNotesList) {
        btnReopenNotesList.style.display = collapsed ? 'inline-flex' : 'none';
      }
      localStorage.setItem('opsnotes_noteslist_collapsed', collapsed);
    };

    if (btnToggleNotesList) {
      btnToggleNotesList.addEventListener('click', () => setNotesListCollapsed(true));
    }
    if (btnReopenNotesList) {
      btnReopenNotesList.addEventListener('click', () => setNotesListCollapsed(false));
    }

    // Helper for drag resizing
    const makeResizable = (resizer, targetPane, storageKey, minW, maxW) => {
      if (!resizer || !targetPane) return;

      let startX = 0;
      let startW = 0;

      const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        let newW = startW + dx;
        if (newW < minW) newW = minW;
        if (newW > maxW) newW = maxW;
        targetPane.style.width = `${newW}px`;
        localStorage.setItem(storageKey, Math.round(newW));
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        resizer.classList.remove('is-resizing');
        targetPane.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = targetPane.getBoundingClientRect().width;
        resizer.classList.add('is-resizing');
        targetPane.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    };

    makeResizable(sidebarResizer, sidebar, 'opsnotes_sidebar_width', 160, 500);
    makeResizable(notesListResizer, notesListPane, 'opsnotes_noteslist_width', 180, 600);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 起動
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
