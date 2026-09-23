/**
 * HomeOps / OpsNotes - Theme Manager
 * Supports VS Code themes and dynamically loaded Custom Themes from styles/ directory.
 */

const STORAGE_KEY = 'opsnotes_theme';
const LEGACY_STORAGE_KEY = 'homeops_theme';
const DEFAULT_THEME = 'monokai-ristretto';

export const themeManager = {
  currentTheme: DEFAULT_THEME,
  customThemes: {},

  async init() {
    await this.loadCustomThemes();

    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || DEFAULT_THEME;
    this.setTheme(saved, false);

    const selector = document.getElementById('themeSelector');
    if (selector) {
      selector.value = saved;
      selector.addEventListener('change', (e) => {
        this.setTheme(e.target.value, true);
      });
    }
  },

  async loadCustomThemes() {
    try {
      const res = await fetch('/api/preview-styles');
      const list = await res.json();
      const group = document.getElementById('customThemesGroup');
      if (!group) return;

      group.innerHTML = '';
      this.customThemes = {};

      list.forEach(t => {
        if (t.id === 'default' || !t.url) return;
        this.customThemes[t.id] = t.url;

        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `★ ${t.name}`;
        group.appendChild(opt);
      });
    } catch (err) {
      console.warn("Failed to load custom themes from server:", err);
    }
  },

  setTheme(themeName, persist = true) {
    this.currentTheme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);

    // カスタムテーマ用のCSSシート切り替え
    const linkEl = document.getElementById('customThemeStylesheet');
    if (linkEl) {
      if (this.customThemes[themeName]) {
        linkEl.href = `${this.customThemes[themeName]}?t=${Date.now()}`;
      } else {
        linkEl.href = '';
      }
    }

    const selector = document.getElementById('themeSelector');
    if (selector && selector.value !== themeName) {
      selector.value = themeName;
    }

    if (persist) {
      localStorage.setItem(STORAGE_KEY, themeName);
    }
  }
};
