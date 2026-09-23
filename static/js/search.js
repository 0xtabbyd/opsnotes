/**
 * HomeOps - Command Palette & Search Module
 * Handles Ctrl+K modal, instant FTS5 search, and keyboard navigation
 */

import { api } from './api.js';

export const searchManager = {
  isOpen: false,
  results: [],
  selectedIndex: -1,
  searchTimer: null,
  showToast: null,
  onSelectSnippet: null,
  onSelectNote: null,

  init({ showToast, onSelectSnippet, onSelectNote }) {
    this.showToast = showToast;
    this.onSelectSnippet = onSelectSnippet;
    this.onSelectNote = onSelectNote;
    this.bindEvents();
  },

  bindEvents() {
    const trigger = document.getElementById('searchTriggerBtn');
    const modal = document.getElementById('searchModalOverlay');
    const input = document.getElementById('paletteSearchInput');

    if (trigger) trigger.addEventListener('click', () => this.open());

    // グローバルショートカット: Ctrl + K, Cmd + K
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (this.isOpen) {
          this.close();
        } else {
          this.open();
        }
      } else if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.close();
      });
    }

    if (input) {
      input.addEventListener('input', () => {
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
          this.performSearch(input.value.trim());
        }, 120);
      });

      // キーボード矢印・Enterナビゲーション
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.moveSelection(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.moveSelection(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.executeSelected();
        }
      });
    }
  },

  open() {
    this.isOpen = true;
    const modal = document.getElementById('searchModalOverlay');
    const input = document.getElementById('paletteSearchInput');
    if (modal) modal.classList.add('active');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.renderDefault();
  },

  close() {
    this.isOpen = false;
    const modal = document.getElementById('searchModalOverlay');
    if (modal) modal.classList.remove('active');
  },

  renderDefault() {
    const resultsContainer = document.getElementById('paletteResults');
    if (!resultsContainer) return;
    resultsContainer.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        <div><i class="fa-solid fa-magnifying-glass" style="margin-right:6px;"></i> コマンド、引数、メモの本文をミリ秒単位で全文検索</div>
        <div style="font-size: 0.75rem; margin-top: 6px;">↑ ↓ キーで選択、Enter で開く</div>
      </div>
    `;
    this.results = [];
    this.selectedIndex = -1;
  },

  async performSearch(query) {
    const resultsContainer = document.getElementById('paletteResults');
    if (!resultsContainer) return;

    if (!query) {
      this.renderDefault();
      return;
    }

    try {
      this.results = await api.search(query);
      this.selectedIndex = this.results.length > 0 ? 0 : -1;
      this.renderResults();
    } catch (err) {
      console.error("Search error:", err);
    }
  },

  renderResults() {
    const resultsContainer = document.getElementById('paletteResults');
    if (!resultsContainer) return;

    if (this.results.length === 0) {
      resultsContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          一致するアイテムは見つかりませんでした
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = '';
    this.results.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = `palette-item ${index === this.selectedIndex ? 'selected' : ''}`;
      el.dataset.index = index;

      const isSnippet = item.type === 'snippet';
      const icon = isSnippet ? '<i class="fa-solid fa-code"></i>' : '<i class="fa-solid fa-file-lines"></i>';
      const badge = isSnippet ? (item.language || 'code') : 'Note';

      el.innerHTML = `
        <div class="palette-item-left">
          <span class="palette-icon">${icon}</span>
          <div>
            <div class="palette-title">${escapeHtml(item.title)}</div>
            <div class="palette-preview">${escapeHtml(item.preview || '')}</div>
          </div>
        </div>
        <span class="palette-badge">${escapeHtml(badge)}</span>
      `;

      el.addEventListener('click', () => {
        this.selectedIndex = index;
        this.executeSelected();
      });

      resultsContainer.appendChild(el);
    });
  },

  moveSelection(delta) {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.results.length) % this.results.length;

    const items = document.querySelectorAll('.palette-item');
    items.forEach((item, idx) => {
      if (idx === this.selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  },

  executeSelected() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.results.length) return;
    const item = this.results[this.selectedIndex];
    this.close();

    if (item.type === 'snippet') {
      this.onSelectSnippet?.(item.id);
    } else if (item.type === 'note') {
      this.onSelectNote?.(item.id);
    }
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
