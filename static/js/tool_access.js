/* ═══════════════════════════════════════════════════════════════
   tool_access.js
   ─ "My Tool Access" settings modal for AI Navigator.
   ─ Each user can toggle which tools the AI is allowed to
     recommend when they submit a task.
   ─ Preferences are stored in localStorage under a key scoped
     to the user's email, so each user has their own settings.
   ─ When ALL tools are enabled (default), the full registry is
     used — no change from current behaviour.
   ─ The enabled list is read by app.js and sent in every
     /api/run request as "enabled_tools".
   ─ Backend (run.py + service.py) filters AI_TOOLS_REGISTRY
     to only those tools before running the agents.

   Storage key:   navigator_tool_access:<email>
   Storage value: JSON array of enabled tool names, e.g.
                  ["Copilot", "ChatGPT", "Gemini"]
   If no key exists → all tools are considered enabled.
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Storage helpers ──────────────────────────────────────── */
  const STORAGE_PREFIX = 'navigator_tool_access:';

  function _getEmail() {
    try {
      return (JSON.parse(sessionStorage.getItem('navigator_session')) || {}).email || '';
    } catch { return ''; }
  }

  function _storageKey() {
    return STORAGE_PREFIX + (_getEmail() || 'default');
  }

  /**
   * Returns the Set of enabled tool names for the current user.
   * If nothing is stored yet, returns null (means "all enabled").
   */
  function getEnabledTools() {
    try {
      const raw = localStorage.getItem(_storageKey());
      if (!raw) return null;                // null = all tools enabled
      return new Set(JSON.parse(raw));
    } catch { return null; }
  }

  /**
   * Returns true if a given tool name is enabled for the current user.
   * If user has never configured → all tools are enabled by default.
   */
  function isToolEnabled(toolName) {
    const enabled = getEnabledTools();
    if (!enabled) return true;              // no preference → all on
    return enabled.has(toolName);
  }

  /**
   * Returns array of enabled tool names to send to /api/run.
   * If user has never configured → returns empty array (means "use all").
   */
  function getEnabledToolsList() {
    const enabled = getEnabledTools();
    if (!enabled) return [];               // empty = backend uses all tools
    return Array.from(enabled);
  }

  function _saveEnabledTools(toolNamesArray) {
    localStorage.setItem(_storageKey(), JSON.stringify(toolNamesArray));
  }

  /* ── Modal state ──────────────────────────────────────────── */
  let _allTools    = {};   // { toolName: { icon, description, category } }
  let _pending     = {};   // { toolName: true/false } — unsaved working state
  let _searchQuery = '';

  /* ── DOM refs (resolved at open time) ────────────────────── */
  function _el(id) { return document.getElementById(id); }

  /* ── Open modal ───────────────────────────────────────────── */
  async function openModal() {
    // Load the full tool list from the API
    try {
      const res  = await fetch('/api/tools');
      _allTools  = await res.json();
    } catch {
      _allTools  = {};
    }

    // Build pending state from current saved prefs
    const saved = getEnabledTools();
    _pending = {};
    for (const name of Object.keys(_allTools)) {
      _pending[name] = saved ? saved.has(name) : true;
    }

    _searchQuery = '';
    if (_el('taSearch')) _el('taSearch').value = '';

    _render();
    _updateCounts();

    _el('taOverlay').classList.add('open');
    _el('taModal').classList.add('open');
    if (_el('taSaveNote')) _el('taSaveNote').textContent = '';
  }

  /* ── Close modal ──────────────────────────────────────────── */
  function closeModal() {
    _el('taOverlay')?.classList.remove('open');
    _el('taModal')?.classList.remove('open');
  }

  /* ── Render tool rows ─────────────────────────────────────── */
  function _render() {
    const body  = _el('taBody');
    if (!body) return;

    const q     = _searchQuery.trim().toLowerCase();
    const names = Object.keys(_allTools).filter(name =>
      !q || name.toLowerCase().includes(q) ||
      (_allTools[name].category || '').toLowerCase().includes(q) ||
      (_allTools[name].description || '').toLowerCase().includes(q)
    );

    if (!names.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af;font-size:13px;">No tools match your search.</div>';
      return;
    }

    body.innerHTML = names.map(name => {
      const info    = _allTools[name] || {};
      const enabled = _pending[name] !== false;   // default true
      const icon    = info.icon || '🤖';
      const cat     = info.category || '';
      const desc    = info.description || '';

      return `
      <div class="ta-tool-row" data-tool="${_esc(name)}">
        <div class="ta-tool-icon">${icon}</div>
        <div class="ta-tool-info">
          <div class="ta-tool-name">${_esc(name)}</div>
          ${cat ? `<div class="ta-tool-cat">${_esc(cat)}</div>` : ''}
          ${desc ? `<div class="ta-tool-desc">${_esc(desc.slice(0, 120))}${desc.length > 120 ? '…' : ''}</div>` : ''}
        </div>
        <label class="ta-toggle" title="${enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}">
          <input type="checkbox" class="ta-toggle-input" data-tool="${_esc(name)}" ${enabled ? 'checked' : ''} />
          <span class="ta-toggle-track">
            <span class="ta-toggle-thumb"></span>
          </span>
        </label>
      </div>`;
    }).join('');

    // Bind checkbox events
    body.querySelectorAll('.ta-toggle-input').forEach(cb => {
      cb.addEventListener('change', e => {
        const tool = e.target.dataset.tool;
        _pending[tool] = e.target.checked;
        _updateCounts();
        // Update row style instantly
        const row = body.querySelector(`.ta-tool-row[data-tool="${tool}"]`);
        if (row) row.classList.toggle('ta-tool-disabled', !e.target.checked);
      });
    });

    // Apply disabled style to already-off rows
    names.forEach(name => {
      if (!_pending[name]) {
        const row = body.querySelector(`.ta-tool-row[data-tool="${_esc(name)}"]`);
        if (row) row.classList.add('ta-tool-disabled');
      }
    });
  }

  function _updateCounts() {
    const total   = Object.keys(_pending).length;
    const enabled = Object.values(_pending).filter(Boolean).length;
    if (_el('taEnabledCount')) _el('taEnabledCount').textContent = enabled;
    if (_el('taTotalCount'))   _el('taTotalCount').textContent   = total;
  }

  function _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Save ─────────────────────────────────────────────────── */
  function _save() {
    const enabledNames = Object.keys(_pending).filter(n => _pending[n]);

    // If all tools enabled, clear storage (= default = all on)
    if (enabledNames.length === Object.keys(_allTools).length) {
      localStorage.removeItem(_storageKey());
    } else {
      _saveEnabledTools(enabledNames);
    }

    const note = _el('taSaveNote');
    if (note) {
      note.textContent = `✅ Saved — ${enabledNames.length} tool${enabledNames.length !== 1 ? 's' : ''} enabled for recommendations.`;
    }
    setTimeout(closeModal, 900);
  }

  /* ── Wire up after DOM ready ──────────────────────────────── */
  function _init() {
    // Open from AI Tools header button
    document.getElementById('btnToolAccess')?.addEventListener('click', openModal);

    // Close
    document.getElementById('taCloseBtn')?.addEventListener('click',  closeModal);
    document.getElementById('taCancelBtn')?.addEventListener('click', closeModal);
    document.getElementById('taOverlay')?.addEventListener('click',   closeModal);

    // Save
    document.getElementById('taSaveBtn')?.addEventListener('click', _save);

    // Enable All
    document.getElementById('taEnableAll')?.addEventListener('click', () => {
      for (const n of Object.keys(_pending)) _pending[n] = true;
      _render();
      _updateCounts();
    });

    // Disable All
    document.getElementById('taDisableAll')?.addEventListener('click', () => {
      for (const n of Object.keys(_pending)) _pending[n] = false;
      _render();
      _updateCounts();
    });

    // Search
    document.getElementById('taSearch')?.addEventListener('input', e => {
      _searchQuery = e.target.value;
      _render();
    });

    // Close on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  /* ── Public API (used by app.js) ──────────────────────────── */
  window._toolAccess = {
    getEnabledToolsList,
    isToolEnabled,
    getEnabledTools,
  };

})();