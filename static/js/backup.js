/**
 * OpsNotes - Backup & Data Management Module
 * Manages automated backups, JSON export/import, and variable presets
 */

import { api } from './api.js';

export const backupManager = {
  showToast: null,
  onRefreshAll: null,

  init({ showToast, onRefreshAll }) {
    this.showToast = showToast;
    this.onRefreshAll = onRefreshAll;
    this.bindEvents();
  },

  bindEvents() {
    const btnBackup = document.getElementById('btnManageBackup');
    const modalBackup = document.getElementById('backupModalOverlay');
    const closeBackup = document.getElementById('btnCloseBackupModal');
    const doneBackup = document.getElementById('btnDoneBackupModal');
    const btnCreateNow = document.getElementById('btnCreateBackupNow');
    const btnExport = document.getElementById('btnExportJSON');
    const importInput = document.getElementById('importFileInput');

    const btnSaveSettings = document.getElementById('btnSaveBackupSettings');
    const inputMaxGen = document.getElementById('inputBackupMaxGenerations');

    if (btnBackup) btnBackup.addEventListener('click', () => this.openBackupModal());
    if (closeBackup) closeBackup.addEventListener('click', () => this.closeBackupModal());
    if (doneBackup) doneBackup.addEventListener('click', () => this.closeBackupModal());

    if (btnSaveSettings && inputMaxGen) {
      btnSaveSettings.addEventListener('click', async () => {
        const val = parseInt(inputMaxGen.value, 10);
        if (isNaN(val) || val < 1 || val > 100) {
          alert("1〜100の範囲で世代数を入力してください");
          return;
        }
        try {
          await api.setBackupSettings(val);
          this.showToast?.(`最大保持世代数を ${val} 世代に設定しました`, "success");
          await this.loadBackups();
        } catch (err) {
          this.showToast?.("設定の保存に失敗しました", "error");
        }
      });
    }

    if (btnCreateNow) {
      btnCreateNow.addEventListener('click', async () => {
        try {
          const res = await api.createBackup();
          this.showToast?.(`バックアップを作成しました: ${res.filename}`, "success");
          await this.loadBackups();
        } catch (err) {
          this.showToast?.("バックアップ作成に失敗しました", "error");
        }
      });
    }

    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        try {
          const data = await api.exportData();
          const jsonStr = JSON.stringify(data, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const date = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `opsnotes_export_${date}.json`;
          a.click();
          URL.revokeObjectURL(url);
          this.showToast?.("JSONデータをエクスポートしました", "success");
        } catch (err) {
          this.showToast?.("エクスポートに失敗しました", "error");
        }
      });
    }

    if (importInput) {
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const json = JSON.parse(text);
          if (confirm(`JSONファイルからデータを復元/追加しますか？\n(スニペット: ${json.snippets?.length || 0}件, メモ: ${json.notes?.length || 0}件)`)) {
            const res = await api.importData(json);
            this.showToast?.(`復元完了: スニペット +${res.imported_snippets}件, メモ +${res.imported_notes}件`, "success");
            if (this.onRefreshAll) this.onRefreshAll();
          }
        } catch (err) {
          this.showToast?.("インポートに失敗しました。正しいJSONファイルか確認してください", "error");
        } finally {
          importInput.value = '';
        }
      });
    }

    // --- Variables Modal Events ---
    const btnVars = document.getElementById('btnManageVariables');
    const modalVars = document.getElementById('variablesModalOverlay');
    const closeVars = document.getElementById('btnCloseVariablesModal');
    const doneVars = document.getElementById('btnDoneVariablesModal');
    const btnAddVar = document.getElementById('btnAddVariable');

    if (btnVars) btnVars.addEventListener('click', () => this.openVariablesModal());
    if (closeVars) closeVars.addEventListener('click', () => this.closeVariablesModal());
    if (doneVars) doneVars.addEventListener('click', () => this.closeVariablesModal());

    if (btnAddVar) {
      btnAddVar.addEventListener('click', async () => {
        const nameInput = document.getElementById('newVarName');
        const valInput = document.getElementById('newVarValue');
        const descInput = document.getElementById('newVarDesc');

        const name = nameInput.value.trim().toUpperCase();
        const default_value = valInput.value.trim();
        const description = descInput.value.trim();

        if (!name || !default_value) {
          alert("変数名と初期値を入力してください");
          return;
        }

        try {
          await api.setVariable({ name, default_value, description });
          this.showToast?.(`変数 {{${name}}} を保存しました`, "success");
          nameInput.value = '';
          valInput.value = '';
          descInput.value = '';
          await this.loadVariables();
          if (this.onRefreshAll) this.onRefreshAll();
        } catch (err) {
          this.showToast?.("変数の保存に失敗しました", "error");
        }
      });
    }
  },

  async openBackupModal() {
    const modal = document.getElementById('backupModalOverlay');
    if (modal) modal.classList.add('active');

    // 世代数設定の読み込み
    try {
      const settings = await api.getBackupSettings();
      const inputMaxGen = document.getElementById('inputBackupMaxGenerations');
      const titleEl = document.getElementById('backupHistoryTitle');
      if (inputMaxGen && settings.max_generations) {
        inputMaxGen.value = settings.max_generations;
        if (titleEl) {
          titleEl.textContent = `自動バックアップ履歴 (最新${settings.max_generations}世代)`;
        }
      }
    } catch (e) {
      console.error("Failed to load backup settings:", e);
    }

    await this.loadBackups();
  },

  closeBackupModal() {
    const modal = document.getElementById('backupModalOverlay');
    if (modal) modal.classList.remove('active');
  },

  async loadBackups() {
    const wrap = document.getElementById('backupsListWrap');
    if (!wrap) return;

    try {
      const backups = await api.getBackups();
      if (backups.length === 0) {
        wrap.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:0.85rem;">バックアップはありません</div>';
        return;
      }

      wrap.innerHTML = backups.map(b => {
        const isPreRollback = b.filename.includes('prerollback');
        const badge = isPreRollback 
          ? '<span style="font-size:0.7rem; background:rgba(234, 179, 8, 0.15); color:var(--accent-warning); padding:1px 5px; border-radius:3px; margin-right:6px;">復元直前退避</span>' 
          : '';
        return `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--border-subtle); font-size:0.82rem; background:var(--bg-card); transition:background 0.15s ease;">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis;">
              ${badge}
              <strong style="font-family:'Fira Code',monospace; color:var(--text-main); font-size:0.8rem;">${b.filename}</strong>
              <span style="color:var(--text-muted); font-size:0.75rem;"><i class="fa-regular fa-clock" style="margin-right:3px;"></i>${b.created_at}</span>
              <span style="color:var(--text-muted); font-size:0.75rem;">(${(b.size_bytes / 1024).toFixed(1)} KB)</span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm btn-rollback-backup" data-filename="${b.filename}" title="このバックアップ時点の状態に復元" style="padding:2px 10px; font-size:0.75rem; color:var(--accent-warning); border-color:var(--border-subtle); flex-shrink:0;">
              <i class="fa-solid fa-rotate-left" style="margin-right:4px;"></i>ロールバック
            </button>
          </div>
        `;
      }).join('');

      // ロールバックボタンのイベントリスナー
      wrap.querySelectorAll('.btn-rollback-backup').forEach(btn => {
        btn.addEventListener('click', async () => {
          const filename = btn.dataset.filename;
          if (!filename) return;

          const ok = confirm(`【確認】データベースを「${filename}」時点の状態にロールバック（復元）しますか？\n\n※現在のデータベース状態も自動で復元直前バックアップとして保存されます。`);
          if (!ok) return;

          const origHtml = btn.innerHTML;
          try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 復元中...';
            const res = await api.rollbackBackup(filename);
            this.showToast?.(`ロールバックが完了しました（復元元: ${res.restored_from}）`, "success");
            await this.loadBackups();
            if (this.onRefreshAll) {
              this.onRefreshAll();
            }
          } catch (err) {
            this.showToast?.(`ロールバックに失敗しました: ${err.message}`, "error");
          } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
          }
        });
      });
    } catch (err) {
      wrap.innerHTML = '<div style="color:var(--accent-secondary); padding:12px;">バックアップ履歴の取得に失敗しました</div>';
    }
  },

  async openVariablesModal() {
    const modal = document.getElementById('variablesModalOverlay');
    if (modal) modal.classList.add('active');
    await this.loadVariables();
  },

  closeVariablesModal() {
    const modal = document.getElementById('variablesModalOverlay');
    if (modal) modal.classList.remove('active');
  },

  async loadVariables() {
    const wrap = document.getElementById('variablesTableWrap');
    if (!wrap) return;

    try {
      const vars = await api.getVariables();
      if (vars.length === 0) {
        wrap.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:0.85rem;">変数は登録されていません</div>';
        return;
      }

      wrap.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-muted); text-align:left;">
              <th style="padding:6px;">変数名</th>
              <th style="padding:6px;">初期値</th>
              <th style="padding:6px;">説明</th>
              <th style="padding:6px; text-align:right;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${vars.map(v => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:6px; font-family:'Fira Code',monospace; color:var(--accent-primary);">{{${v.name}}}</td>
                <td style="padding:6px; font-family:'Fira Code',monospace;">${v.default_value}</td>
                <td style="padding:6px; color:var(--text-muted);">${v.description || '-'}</td>
                <td style="padding:6px; text-align:right;">
                  <button class="btn btn-icon btn-del-var" data-name="${v.name}" title="削除"><i class="fa-solid fa-trash-can"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      wrap.querySelectorAll('.btn-del-var').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const name = btn.dataset.name;
          if (confirm(`変数 {{${name}}} を削除しますか？`)) {
            await api.deleteVariable(name);
            await this.loadVariables();
            if (this.onRefreshAll) this.onRefreshAll();
          }
        });
      });
    } catch (err) {
      wrap.innerHTML = '<div style="color:var(--accent-secondary);">変数の取得に失敗しました</div>';
    }
  }
};
