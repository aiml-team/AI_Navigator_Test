/* ═══════════════════════════════════════════════════════════════
   personalization.js
   ─ Personalization modal for AI Navigator.
   ─ Manages per-user AI tool access preferences stored in the DB.
   ─ Replaces localStorage-based tool_access.js for cross-device support.

   Public API (window._personalization):
     loadPrefs()           — fetch prefs from DB for the current user
     hasToolAccess(name)   — true if user has access (false = "No" / not set)
     openModal()           — open the Personalization modal
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Session helper ───────────────────────────────────────────── */
  function _getEmail() {
    try {
      return (JSON.parse(sessionStorage.getItem('navigator_session')) || {}).email || '';
    } catch { return ''; }
  }

  /* ── In-memory prefs cache ────────────────────────────────────── */
  // null  = not yet loaded
  // Map<toolName, boolean>  = loaded (false = no access)
  let _prefsCache = null;
  let _prefsLoaded = false;

  /* ── All tools from the last API load ─────────────────────────── */
  let _allTools = [];   // [{tool_name, has_access, icon, category, description, url}]

  /* ── Unsaved working state (in modal) ─────────────────────────── */
  let _pending = {};   // { toolName: true/false }
  let _searchQuery = '';

  /* ── Default role ─────────────────────────────────────────────── */
  let _defaultRole = '';   // '' = no default set

  /* ── Load preferences from backend ───────────────────────────── */
  async function loadPrefs() {
    const email = _getEmail();
    if (!email) return;
    try {
      const res = await fetch(`/api/user-ai-tools/preferences?user_email=${encodeURIComponent(email)}`);
      if (!res.ok) return;
      const data = await res.json();
      _allTools = data;
      _prefsCache = new Map(data.map(t => [t.tool_name, t.has_access]));
      _prefsLoaded = true;
    } catch (e) {
      console.warn('[personalization] Could not load prefs:', e);
    }
  }

  /* ── Load default role from backend ──────────────────────────── */
  async function loadDefaultRole() {
    const email = _getEmail();
    if (!email) return;
    try {
      const res = await fetch(`/api/user-role?user_email=${encodeURIComponent(email)}`);
      if (!res.ok) return;
      const data = await res.json();
      _defaultRole = (data.default_role || '').trim();
    } catch (e) {
      console.warn('[personalization] Could not load default role:', e);
    }
  }

  /* ── Public: get the current saved default role ───────────────── */
  function getDefaultRole() {
    return _defaultRole;
  }

  /* ── Public: check if the current user has access to a tool ───── */
  function hasToolAccess(toolName) {
    if (!_prefsLoaded || !_prefsCache) return true;  // prefs not yet loaded → fail-safe open
    const name = (toolName || '').trim().toLowerCase();
    for (const [key, val] of _prefsCache) {
      if (key.toLowerCase() === name) return val;
    }
    return true;  // no explicit preference → default Yes (accessible until explicitly revoked)
  }

  /* ── Helpers ──────────────────────────────────────────────────── */
  function _el(id) { return document.getElementById(id); }

  function _esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Modal open/close ─────────────────────────────────────────── */
  async function openModal() {
    // Always refresh from DB when opening
    await Promise.all([loadPrefs(), loadDefaultRole()]);

    // Build pending state from loaded prefs
    _pending = {};
    _searchQuery = '';
    for (const t of _allTools) {
      _pending[t.tool_name] = t.has_access;
    }

    const searchEl = _el('pzToolSearch');
    if (searchEl) searchEl.value = '';

    _renderTools();
    _updateCounts();
    _populateRoleSelector();

    // Switch to General tab by default
    _switchTab('general');

    const overlay = _el('pzOverlay');
    const modal   = _el('pzModal');
    if (overlay) overlay.classList.add('open');
    if (modal)   modal.classList.add('open');

    const note = _el('pzSaveNote');
    if (note) note.textContent = '';
  }

  function closeModal() {
    _el('pzOverlay')?.classList.remove('open');
    _el('pzModal')?.classList.remove('open');
  }

  /* ── Tab switching ────────────────────────────────────────────── */
  function _switchTab(tabKey) {
    document.querySelectorAll('#pzModal .pz-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pztab === tabKey);
    });
    document.querySelectorAll('#pzModal .pz-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.pzpanel === tabKey);
    });
  }

  /* ── Render tools list ────────────────────────────────────────── */
  function _renderTools() {
    const list = _el('pzToolsList');
    if (!list) return;

    const q = _searchQuery.trim().toLowerCase();
    const tools = _allTools.filter(t =>
      !q ||
      (t.tool_name  || '').toLowerCase().includes(q) ||
      (t.category   || '').toLowerCase().includes(q) ||
      (t.description|| '').toLowerCase().includes(q)
    );

    if (!tools.length) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af;font-size:13px;">No tools match your search.</div>';
      return;
    }

    list.innerHTML = tools.map(t => {
      const name    = t.tool_name;
      const access  = _pending[name] !== undefined ? _pending[name] : false;
      const icon    = t.icon || '🤖';
      const cat     = t.category || '';
      const desc    = t.description || '';

      const iconHtml = typeof _toolIconHtml === 'function'
        ? _toolIconHtml(name, icon, 22)
        : `<span style="font-size:18px;">${_esc(icon)}</span>`;

      return `
      <div class="pz-tool-row${access ? '' : ' pz-no-access'}" data-tool="${_esc(name)}">
        <div class="pz-tool-icon">${iconHtml}</div>
        <div class="pz-tool-info">
          <div class="pz-tool-name">${_esc(name)}</div>
          ${cat  ? `<div class="pz-tool-cat">${_esc(cat)}</div>` : ''}
          ${desc ? `<div class="pz-tool-desc">${_esc(desc.slice(0, 100))}${desc.length > 100 ? '…' : ''}</div>` : ''}
        </div>
        <div class="pz-access-cell">
          <label class="pz-yn-toggle" title="${access ? 'Has access — click to revoke' : 'No access — click to grant'}">
            <input type="checkbox" class="pz-yn-input" data-tool="${_esc(name)}" ${access ? 'checked' : ''} />
            <span class="pz-yn-track">
              <span class="pz-yn-yes">Yes</span>
              <span class="pz-yn-no">No</span>
              <span class="pz-yn-thumb"></span>
            </span>
          </label>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.pz-yn-input').forEach(cb => {
      cb.addEventListener('change', e => {
        const tool = e.target.dataset.tool;
        _pending[tool] = e.target.checked;
        _updateCounts();
        const row = list.querySelector(`.pz-tool-row[data-tool="${CSS.escape(tool)}"]`);
        if (row) row.classList.toggle('pz-no-access', !e.target.checked);
      });
    });
  }

  function _updateCounts() {
    const total  = Object.keys(_pending).length;
    const access = Object.values(_pending).filter(Boolean).length;
    const countEl = _el('pzAccessCount');
    const totalEl = _el('pzTotalCount');
    if (countEl) countEl.textContent = access;
    if (totalEl) totalEl.textContent = total;
  }

  /* ── Populate role selector in General tab ────────────────────── */
  const PRESET_ROLES = [
    'Consultant / Manager', 'Executive / Director', 'Developer / Technical',
    'Business Analyst', 'Sales / BD', 'Marketing / Comms',
    'HR / People Ops', 'Finance / Accounting',
  ];

  function _populateRoleSelector() {
    const sel    = _el('pzDefaultRoleSelect');
    const custom = _el('pzDefaultRoleCustom');
    if (!sel || !custom) return;

    const saved = _defaultRole || '';
    const isPreset = PRESET_ROLES.some(r => r.toLowerCase() === saved.toLowerCase());

    if (!saved) {
      sel.value = '';
      custom.classList.remove('visible');
      custom.value = '';
    } else if (isPreset) {
      // Normalise to the matching preset label's exact casing
      const match = PRESET_ROLES.find(r => r.toLowerCase() === saved.toLowerCase());
      sel.value = match || saved;
      custom.classList.remove('visible');
      custom.value = '';
    } else {
      sel.value = '__custom__';
      custom.classList.add('visible');
      custom.value = saved;
    }
  }

  function _getSelectedRole() {
    const sel    = _el('pzDefaultRoleSelect');
    const custom = _el('pzDefaultRoleCustom');
    if (!sel) return '';
    if (sel.value === '__custom__') return (custom ? custom.value.trim() : '');
    return sel.value;
  }

  /* ── Save ─────────────────────────────────────────────────────── */
  async function _save() {
    const email = _getEmail();
    if (!email) {
      const note = _el('pzSaveNote');
      if (note) { note.style.color = '#ef4444'; note.textContent = 'Not signed in.'; }
      return;
    }

    const saveBtn = _el('pzSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    const preferences = Object.entries(_pending).map(([tool_name, has_access]) => ({
      tool_name,
      has_access,
    }));

    const newRole = _getSelectedRole();

    try {
      // Save tool preferences and default role in parallel
      const [toolRes, roleRes] = await Promise.all([
        fetch('/api/user-ai-tools/preferences', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ user_email: email, preferences }),
        }),
        fetch('/api/user-role', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ user_email: email, default_role: newRole }),
        }),
      ]);

      if (!toolRes.ok) throw new Error('Tool prefs HTTP ' + toolRes.status);
      if (!roleRes.ok) throw new Error('Role save HTTP ' + roleRes.status);

      // Update local caches
      _prefsCache  = new Map(Object.entries(_pending));
      _prefsLoaded = true;
      _allTools    = _allTools.map(t => ({ ...t, has_access: _pending[t.tool_name] ?? false }));
      _defaultRole = newRole;

      // If the AI Tools page is currently visible, re-render it immediately
      // so Open/No-access buttons reflect the new preferences without any page switch.
      if (document.getElementById('page-tools')?.classList.contains('active')) {
        if (typeof loadTools === 'function') loadTools();
      }

      const accessCount = preferences.filter(p => p.has_access).length;
      const roleLabel   = newRole ? `Default role: "${newRole}".` : 'No default role set.';
      const note = _el('pzSaveNote');
      if (note) {
        note.style.color = '#10b981';
        note.textContent = `Saved — ${accessCount} tool${accessCount !== 1 ? 's' : ''} accessible. ${roleLabel}`;
      }
      setTimeout(closeModal, 1400);
    } catch (e) {
      const note = _el('pzSaveNote');
      if (note) { note.style.color = '#ef4444'; note.textContent = 'Save failed. Please try again.'; }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Preferences'; }
    }
  }

  /* ── Wire up DOM ──────────────────────────────────────────────── */
  function _init() {
    // Open from profile dropdown
    _el('dropPersonalization')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('hdrDropdown')?.classList.remove('open');
      openModal();
    });

    // Close
    _el('pzCloseBtn')?.addEventListener('click',  closeModal);
    _el('pzCancelBtn')?.addEventListener('click', closeModal);
    _el('pzOverlay')?.addEventListener('click',   closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // Tabs
    document.querySelectorAll('#pzModal .pz-tab').forEach(btn => {
      btn.addEventListener('click', () => _switchTab(btn.dataset.pztab));
    });

    // Save
    _el('pzSaveBtn')?.addEventListener('click', _save);

    // Grant / Revoke All
    _el('pzGrantAll')?.addEventListener('click', () => {
      for (const k of Object.keys(_pending)) _pending[k] = true;
      _renderTools();
      _updateCounts();
    });
    _el('pzRevokeAll')?.addEventListener('click', () => {
      for (const k of Object.keys(_pending)) _pending[k] = false;
      _renderTools();
      _updateCounts();
    });

    // Search
    _el('pzToolSearch')?.addEventListener('input', e => {
      _searchQuery = e.target.value;
      _renderTools();
    });

    // Show/hide custom role input when "Other" is selected
    _el('pzDefaultRoleSelect')?.addEventListener('change', e => {
      const custom = _el('pzDefaultRoleCustom');
      if (!custom) return;
      if (e.target.value === '__custom__') {
        custom.classList.add('visible');
        custom.focus();
      } else {
        custom.classList.remove('visible');
        custom.value = '';
      }
    });

    // If already logged in on page load, load prefs + default role immediately
    const session = (() => {
      try { return JSON.parse(sessionStorage.getItem('navigator_session')); } catch { return null; }
    })();
    if (session && session.email) {
      Promise.all([loadPrefs(), loadDefaultRole()]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  /* ── Public API ───────────────────────────────────────────────── */
  window._personalization = {
    loadPrefs,
    loadDefaultRole,
    hasToolAccess,
    getDefaultRole,
    openModal,
  };

})();
