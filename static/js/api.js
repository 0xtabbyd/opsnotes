/**
 * HomeOps - API Client Module
 * Handles all REST API requests to FastAPI backend
 */

export const api = {
  // --- Snippets ---
  async getSnippets(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/snippets?${query}`);
    return await res.json();
  },

  async getSnippet(id) {
    const res = await fetch(`/api/snippets/${id}`);
    if (!res.ok) throw new Error("Snippet not found");
    return await res.json();
  },

  async createSnippet(data) {
    const res = await fetch('/api/snippets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async updateSnippet(id, data) {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async deleteSnippet(id) {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'DELETE'
    });
    return await res.json();
  },

  async recordCopy(id) {
    const res = await fetch(`/api/snippets/${id}/copy`, {
      method: 'POST'
    });
    return await res.json();
  },

  // --- Notes ---
  async getNotes(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/notes?${query}`);
    return await res.json();
  },

  async getNote(id) {
    const res = await fetch(`/api/notes/${id}`);
    if (!res.ok) throw new Error("Note not found");
    return await res.json();
  },

  async createNote(data) {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async updateNote(id, data) {
    const res = await fetch(`/api/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async deleteNote(id) {
    const res = await fetch(`/api/notes/${id}`, {
      method: 'DELETE'
    });
    return await res.json();
  },

  async getRelatedNotes(id, limit = 3) {
    const res = await fetch(`/api/notes/${id}/related?limit=${limit}`);
    return await res.json();
  },

  async getPreviewStyles() {
    const res = await fetch('/api/preview-styles');
    return await res.json();
  },

  // --- Variables ---
  async getVariables() {
    const res = await fetch('/api/variables');
    return await res.json();
  },

  async setVariable(data) {
    const res = await fetch('/api/variables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async deleteVariable(name) {
    const res = await fetch(`/api/variables/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    return await res.json();
  },

  // --- Search & Meta ---
  async search(query) {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    return await res.json();
  },

  async getMeta() {
    const res = await fetch('/api/meta');
    return await res.json();
  },

  // --- Backups & Export/Import ---
  async getBackups() {
    const res = await fetch('/api/backups');
    return await res.json();
  },

  async createBackup() {
    const res = await fetch('/api/backups', { method: 'POST' });
    return await res.json();
  },

  async getBackupSettings() {
    const res = await fetch('/api/backups/settings');
    return await res.json();
  },

  async setBackupSettings(max_generations) {
    const res = await fetch('/api/backups/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_generations })
    });
    return await res.json();
  },

  async rollbackBackup(filename) {
    const res = await fetch(`/api/backups/${encodeURIComponent(filename)}/rollback`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'ロールバックに失敗しました');
    }
    return await res.json();
  },

  async exportData() {
    const res = await fetch('/api/export');
    return await res.json();
  },

  async importData(data) {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  }
};
