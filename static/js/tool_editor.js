/* ══════════════════════════════════════════════════════
   tool_editor.js
   Full-detail Tool Editor modal:
     • Three-dots (⋮) menu on every tool card (rendered here,
       card HTML still built in app.js loadTools())
     • View tab  — all fields + raw_data
     • Edit tab  — form with all editable fields + file upload
     • Save / Delete actions
══════════════════════════════════════════════════════ */

(function initToolEditor() {

  /* ── helpers ── */
  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(String(s ?? ''));
  const splitCsv = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);

  /* ── modal elements (resolved lazily after DOM is ready) ── */
  function overlay()  { return $('teOverlay');  }
  function modal()    { return $('teModal');     }

  /* ── state ── */
  let _currentTool = null;   // { name, info }  — info = full registry/db data

  /* ══════════════════════════════
     OPEN / CLOSE
  ══════════════════════════════ */
  function _open() {
    overlay()?.classList.add('open');
    modal()?.classList.add('open');
  }

  function _close() {
    overlay()?.classList.remove('open');
    modal()?.classList.remove('open');
    _currentTool = null;
  }

  /* ══════════════════════════════
     MAIN ENTRY — openToolEditor(toolName)
     Called from tool-card three-dots "Edit Tool"
  ══════════════════════════════ */
  window.openToolEditor = async function(toolName) {
    _currentTool = { name: toolName, info: {} };

    _setHeader(toolName, {});
    _activateTab('view');
    _renderViewLoading();
    _open();

    let info = {};

    // 1. Try DB first
    try {
      const res = await fetch(API.toolsGetOne(toolName));
      if (res.ok) {
        const row = await res.json();
        let bf = [], nf = [], ss = [], ws = [], ro = [];
        try { bf = JSON.parse(row.best_for       || '[]'); } catch {}
        try { nf = JSON.parse(row.not_for        || '[]'); } catch {}
        try { ss = JSON.parse(row.strong_signals || '[]'); } catch {}
        try { ws = JSON.parse(row.weak_signals   || '[]'); } catch {}
        try { ro = JSON.parse(row.roles          || '[]'); } catch {}
        let rd = {};
        try { rd = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : (row.raw_data || {}); } catch {}
        info = {
          _source:        'db',
          _db_id:         row.id,
          tool_name:      row.tool_name,
          description:    row.description    || '',
          category:       row.category       || '',
          url:            row.url            || '',
          icon:           row.icon           || '🤖',
          best_for:       bf,
          not_for:        nf,
          strong_signals: ss,
          weak_signals:   ws,
          roles:          ro,
          output_type:    row.output_type    || '',
          is_internal:    !!row.is_internal,
          raw_data:       rd,
          created_at:     row.created_at,
          updated_at:     row.updated_at,
        };
      }
    } catch {}

    // 2. Fallback to in-memory registry
    if (!info.tool_name && typeof _toolsData === 'object' && _toolsData) {
      const key = Object.keys(_toolsData).find(k => k === toolName) || toolName;
      const reg = _toolsData[key] || {};
      info = {
        _source:        reg._source || 'registry',
        tool_name:      key,
        description:    reg.description    || '',
        category:       reg.category       || '',
        url:            reg.url            || '',
        icon:           reg.icon           || '🤖',
        best_for:       Array.isArray(reg.best_for)       ? reg.best_for       : [],
        not_for:        Array.isArray(reg.not_for)        ? reg.not_for        : [],
        strong_signals: Array.isArray(reg.strong_signals) ? reg.strong_signals : [],
        weak_signals:   Array.isArray(reg.weak_signals)   ? reg.weak_signals   : [],
        roles:          Array.isArray(reg.roles)          ? reg.roles          : [],
        output_type:    reg.output_type    || '',
        is_internal:    !!reg.is_internal,
        raw_data:       reg.raw_data       || {},
      };
    }

    _currentTool = { name: toolName, info };
    _setHeader(toolName, info);
    _renderView(info);
    _populateEditForm(info);
    _loadToolFiles(toolName);
  };

  /* ══════════════════════════════
     HEADER
  ══════════════════════════════ */
  function _setHeader(name, info) {
    const iconEl = $('teHeaderIcon');
    const nameEl = $('teHeaderName');
    const catEl  = $('teHeaderCat');
    const badgeEl = $('teHeaderBadge');

    if (iconEl) {
      // Use brand-aware logo (helper from app.js); innerHTML to allow <img>
      iconEl.innerHTML = (typeof _toolIconHtml === 'function')
        ? _toolIconHtml(name, info.icon, 32)
        : (info.icon || '🤖');
    }
    if (nameEl) nameEl.textContent = name;
    if (catEl)  catEl.textContent  = info.category || '';
    if (badgeEl) {
      badgeEl.style.display = 'none';
    }
  }

  /* ══════════════════════════════
     TABS
  ══════════════════════════════ */
  function _activateTab(tabName) {
    modal()?.querySelectorAll('.te-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    modal()?.querySelectorAll('.te-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === tabName);
    });
  }

  /* ══════════════════════════════
     VIEW TAB — render all fields
  ══════════════════════════════ */
  function _renderViewLoading() {
    const el = $('teViewPanel');
    if (el) el.innerHTML = `<div style="padding:40px;text-align:center;color:#6b7280;font-size:13px;">Loading…</div>`;
  }

  function _renderView(info) {
    const el = $('teViewPanel');
    if (!el) return;

    const rd = info.raw_data || {};

    const kvRow = (label, val, wide) => {
      const isEmpty = val === null || val === undefined || val === '' ||
                      (Array.isArray(val) && val.length === 0);
      let content;
      if (Array.isArray(val) && val.length) {
        content = `<div class="te-tags">${val.map(v => `<span class="te-tag">${esc(v)}</span>`).join('')}</div>`;
      } else if (typeof val === 'string' && /^https?:\/\//.test(val)) {
        content = `<a href="${esc(val)}" target="_blank" rel="noopener">${esc(val)}</a>`;
      } else if (isEmpty) {
        content = `<span class="empty">—</span>`;
      } else {
        content = esc(String(val));
      }
      return `
        <div class="te-kv${wide ? ' te-kv-wide' : ''}">
          <div class="te-kv-label">${esc(label)}</div>
          <div class="te-kv-val${isEmpty ? ' empty' : ''}">${content}</div>
        </div>`;
    };

    const tagsSection = (label, arr, tagClass) => {
      if (!arr || !arr.length) return '';
      return `
        <div class="te-kv">
          <div class="te-kv-label">${esc(label)}</div>
          <div class="te-tags">
            ${arr.map(v => `<span class="te-tag ${tagClass || ''}">${esc(v)}</span>`).join('')}
          </div>
        </div>`;
    };

    const coreFields = `
      <div class="te-section">
        <div class="te-section-title">Core Info</div>
        <div class="te-kv-grid">
          ${kvRow('Tool Name',   info.tool_name)}
          ${kvRow('Category',    info.category)}
          ${kvRow('Icon',        info.icon)}
          ${kvRow('URL',         info.url)}
          ${kvRow('Output Type', info.output_type)}
          ${kvRow('Internal?',   info.is_internal ? 'Yes' : 'No')}
          ${info.created_at ? kvRow('Registered', new Date(info.created_at + 'Z').toLocaleString()) : ''}
          ${info.updated_at  ? kvRow('Last Updated', new Date(info.updated_at  + 'Z').toLocaleString()) : ''}
        </div>
      </div>`;

    const descSection = info.description ? `
      <div class="te-section">
        <div class="te-section-title">Description</div>
        <div class="te-text-block">${esc(info.description)}</div>
      </div>` : '';

    const signalSection = `
      <div class="te-section">
        <div class="te-section-title">Usage Signals &amp; Roles</div>
        <div class="te-kv-grid">
          ${tagsSection('Best For',        info.best_for,       'green')}
          ${tagsSection('Not For',         info.not_for,        'red')}
          ${tagsSection('Strong Signals',  info.strong_signals, '')}
          ${tagsSection('Weak Signals',    info.weak_signals,   'gray')}
          ${tagsSection('Roles',           info.roles,          'gray')}
        </div>
      </div>`;

    const rdKeys = Object.keys(rd);
    let rawSection = '';
    if (rdKeys.length) {
      const rows = rdKeys.map(k => {
        const v = rd[k];
        const display = v === null || v === undefined || v === '' ? '—' : esc(String(v));
        return `<tr>
          <td class="key-col">${esc(k)}</td>
          <td>${display}</td>
        </tr>`;
      }).join('');
      rawSection = `
        <div class="te-section">
          <div class="te-section-title">Full Registry Data (raw_data)</div>
          <table class="te-raw-table">
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    el.innerHTML = `
      <div class="te-view-body">
        ${coreFields}
        ${descSection}
        ${signalSection}
        ${rawSection}
      </div>`;
  }

  /* ══════════════════════════════
     EDIT TAB — populate form
     Fixed fields + every raw_data key as its own editable row
  ══════════════════════════════ */
  function _populateEditForm(info) {
    const panel = $('teEditPanel');
    if (!panel) return;

    const rd = info.raw_data || {};

    // Fixed fields HTML (always shown)
    const fixedHtml = `
      <div class="te-edit-note">
        ✏️ <strong>Edit mode</strong> — all fields will be saved as-is when you click Save changes.
      </div>
      <div class="te-form-grid">
        <div>
          <label class="te-label" for="teToolName">Tool Name <span class="te-hint">(required)</span></label>
          <input class="te-input" id="teToolName" type="text" value="${esc(info.tool_name || '')}" autocomplete="off"/>
        </div>
        <div>
          <label class="te-label" for="teCategory">Category</label>
          <input class="te-input" id="teCategory" type="text" value="${esc(info.category || '')}"/>
        </div>
        <div>
          <label class="te-label" for="teUrl">URL</label>
          <input class="te-input" id="teUrl" type="url" value="${esc(info.url || '')}"/>
        </div>
        <div>
          <label class="te-label" for="teIcon">Icon <span class="te-hint">(emoji)</span></label>
          <input class="te-input" id="teIcon" type="text" value="${esc(info.icon || '🤖')}" maxlength="8"/>
        </div>
        <div>
          <label class="te-label" for="teOutputType">Output Type</label>
          <input class="te-input" id="teOutputType" type="text" value="${esc(info.output_type || '')}"/>
        </div>
      </div>
      <div class="te-form-full">
        <label class="te-label" for="teDescription">Description</label>
        <textarea class="te-textarea" id="teDescription" rows="3">${esc(info.description || '')}</textarea>
      </div>
      <div class="te-form-grid">
        <div>
          <label class="te-label" for="teBestFor">Best For <span class="te-hint">(comma-separated)</span></label>
          <textarea class="te-textarea" id="teBestFor" rows="2">${esc((info.best_for || []).join(', '))}</textarea>
        </div>
        <div>
          <label class="te-label" for="teNotFor">Not For <span class="te-hint">(comma-separated)</span></label>
          <textarea class="te-textarea" id="teNotFor" rows="2">${esc((info.not_for || []).join(', '))}</textarea>
        </div>
        <div>
          <label class="te-label" for="teStrongSignals">Strong Signals <span class="te-hint">(comma-separated)</span></label>
          <textarea class="te-textarea" id="teStrongSignals" rows="2">${esc((info.strong_signals || []).join(', '))}</textarea>
        </div>
        <div>
          <label class="te-label" for="teWeakSignals">Weak Signals <span class="te-hint">(comma-separated)</span></label>
          <textarea class="te-textarea" id="teWeakSignals" rows="2">${esc((info.weak_signals || []).join(', '))}</textarea>
        </div>
      </div>
      <div class="te-form-full">
        <label class="te-label" for="teRoles">Roles <span class="te-hint">(comma-separated)</span></label>
        <input class="te-input" id="teRoles" type="text" value="${esc((info.roles || []).join(', '))}"/>
      </div>
      <div class="te-checkbox-row">
        <input type="checkbox" id="teIsInternal" ${info.is_internal ? 'checked' : ''}/>
        <label for="teIsInternal">Internal tool (not publicly accessible)</label>
      </div>`;

    // Dynamic raw_data fields — one editable input per key
    const rdKeys = Object.keys(rd);
    let rawHtml = '';
    if (rdKeys.length) {
      const rows = rdKeys.map(k => {
        const val = rd[k] === null || rd[k] === undefined ? '' : String(rd[k]);
        const safeKey = k.replace(/"/g, '&quot;');
        const isLong  = val.length > 80;
        return `
          <div class="te-form-full">
            <label class="te-label">${esc(k)}</label>
            ${isLong
              ? `<textarea class="te-textarea" data-rd-key="${safeKey}" rows="2">${esc(val)}</textarea>`
              : `<input class="te-input" type="text" data-rd-key="${safeKey}" value="${esc(val)}"/>`
            }
          </div>`;
      }).join('');
      rawHtml = `
        <div class="te-section-title" style="margin-top:18px;margin-bottom:12px;">All Registry Columns</div>
        <div id="teRawFields">${rows}</div>`;
    }

    // Upload section (always at the bottom)
    const uploadHtml = `
      <div class="te-section-title" style="margin-top:18px;margin-bottom:10px;">Uploaded Knowledge Files</div>
      <div id="teUploadedFiles" style="margin-bottom:16px;">
        <div style="font-size:12px;color:#9ca3af;font-style:italic;">Loading…</div>
      </div>
      <div class="te-section-title" style="margin-top:4px;margin-bottom:12px;">Upload New Document</div>
      <div class="te-file-zone" id="teFileZone">
        <div class="te-file-zone-icon">📄</div>
        <div class="te-file-zone-title">Drop files here or <button type="button" id="teBrowseBtn" style="background:none;border:none;color:#2563eb;cursor:pointer;font-weight:700;font-family:inherit;font-size:inherit;padding:0;">browse</button></div>
        <div class="te-file-zone-sub">PDF, DOCX, PPTX, TXT — stored in knowledge base for smarter recommendations</div>
      </div>
      <div id="teUploadStatus" style="display:none;margin-top:8px;font-size:12px;"></div>
      <input type="file" id="teFileInput" multiple accept=".pdf,.docx,.pptx,.txt,.md" style="display:none;"/>`;

    // Replace inner content of the edit panel body
    const body = panel.querySelector('.te-edit-body');
    if (body) {
      body.innerHTML = fixedHtml + rawHtml + uploadHtml;
    }

    // Re-wire file zone events (since we just rebuilt the DOM)
    const zone = $('teFileZone');
    zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone?.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) _handleFiles(e.dataTransfer.files);
    });
    $('teBrowseBtn')?.addEventListener('click', () => $('teFileInput')?.click());
    $('teFileInput')?.addEventListener('change', e => {
      if (e.target.files.length) _handleFiles(e.target.files);
    });
  }

  /* ══════════════════════════════
     SAVE — reads fixed fields + all dynamic raw_data inputs
  ══════════════════════════════ */
  async function _save() {
    const toolName = ($('teToolName')?.value || '').trim();
    if (!toolName) { showToast('Tool name is required.', 'error'); return; }

    const btn = $('teSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // Collect raw_data from dynamic fields scoped to the edit panel only
    const rawData = {};
    document.querySelectorAll('#teEditPanel [data-rd-key]').forEach(el => {
      rawData[el.dataset.rdKey] = el.value;
    });

    const payload = {
      tool_name:      toolName,
      description:    $('teDescription')?.value.trim()    || '',
      category:       $('teCategory')?.value.trim()       || '',
      url:            $('teUrl')?.value.trim()            || '',
      icon:           $('teIcon')?.value.trim()           || '🤖',
      best_for:       splitCsv($('teBestFor')?.value),
      not_for:        splitCsv($('teNotFor')?.value),
      strong_signals: splitCsv($('teStrongSignals')?.value),
      weak_signals:   splitCsv($('teWeakSignals')?.value),
      roles:          splitCsv($('teRoles')?.value),
      output_type:    $('teOutputType')?.value.trim()     || '',
      is_internal:    !!$('teIsInternal')?.checked,
      explicit_edit:  true,
      raw_data:       rawData,
    };

    try {
      const res  = await fetch(API.toolsRegister, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        showToast(`"${toolName}" saved successfully!`, 'success');
        _toolsData = null;
        _close();
        if (typeof loadTools === 'function') loadTools();
      } else {
        throw new Error(data.detail || 'Save failed');
      }
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save changes`;
      }
    }
  }

  /* ══════════════════════════════
     DELETE
  ══════════════════════════════ */
  async function _delete() {
    const info = _currentTool?.info;
    if (!info || info._source !== 'db') {
      showToast('Only registered (DB) tools can be deleted.', 'error'); return;
    }
    const name = _currentTool.name;
    if (!confirm(`Delete "${name}" from the registry? This cannot be undone.`)) return;

    try {
      const id = info._db_id;
      if (!id) {
        const listRes = await fetch(API.toolsRegistered);
        const list    = await listRes.json();
        const item    = list.find(t => t.tool_name === name);
        if (!item) { showToast('Tool not found in DB.', 'error'); return; }
        await fetch(API.toolsDelete(item.id), { method: 'DELETE' });
      } else {
        await fetch(API.toolsDelete(id), { method: 'DELETE' });
      }
      showToast(`"${name}" deleted.`, 'success');
      _toolsData = null;
      _close();
      if (typeof loadTools === 'function') loadTools();
    } catch {
      showToast('Delete failed.', 'error');
    }
  }

  /* ══════════════════════════════
     UPLOADED FILES LIST
     Fetches /api/tool-docs/status, filters by tool name,
     renders chips with ✕ delete buttons
  ══════════════════════════════ */
  async function _loadToolFiles(toolName) {
    const container = $('teUploadedFiles');
    if (!container) return;
    container.innerHTML = `<div style="font-size:12px;color:#9ca3af;font-style:italic;">Loading…</div>`;

    try {
      const res  = await fetch(API.toolDocsStatus);
      const data = await res.json();
      const rows = (data.status || []);
      const row  = rows.find(r => r.tool_name.toLowerCase() === (toolName || '').toLowerCase());
      const files = row ? (row.source_files || []) : [];

      if (!files.length) {
        container.innerHTML = `<div style="font-size:12px;color:#9ca3af;font-style:italic;">No files uploaded yet for this tool.</div>`;
        return;
      }

      container.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${files.map(f => `
            <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px 4px 12px;
                         background:#f3f4f6;border:1px solid #e5e7eb;border-radius:20px;font-size:12px;color:#374151;">
              📄 ${esc(f)}
              <button
                data-filename="${esc(f)}"
                title="Remove this file from knowledge base"
                style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:13px;
                       padding:0 2px;line-height:1;display:flex;align-items:center;"
                onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color='#9ca3af'">✕</button>
            </span>`).join('')}
        </div>`;

      container.querySelectorAll('button[data-filename]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const filename = btn.dataset.filename;
          if (!confirm(`Remove "${filename}" from the knowledge base?`)) return;
          btn.disabled = true;
          btn.textContent = '…';
          try {
            const delUrl = `${API.toolDocDeleteFile}?filename=${encodeURIComponent(filename)}${toolName ? '&tool_name=' + encodeURIComponent(toolName) : ''}`;
            await fetch(delUrl, { method: 'DELETE' });
            _loadToolFiles(toolName);
          } catch {
            showToast('Failed to remove file.', 'error');
          }
        });
      });
    } catch {
      container.innerHTML = `<div style="font-size:12px;color:#9ca3af;font-style:italic;">Could not load file list.</div>`;
    }
  }

  /* ══════════════════════════════
     FILE UPLOAD in Edit tab
     Uploads to vector DB only — never touches form fields
  ══════════════════════════════ */
  async function _handleFiles(files) {
    if (!files || !files.length) return;
    const toolName = _currentTool?.name;
    const statusEl = $('teUploadStatus');

    if (statusEl) {
      statusEl.style.display = '';
      statusEl.style.color   = 'var(--text2, #6b7280)';
      statusEl.textContent   = 'Uploading…';
    }

    try {
      const form = new FormData();
      Array.from(files).forEach(f => form.append('files', f));
      const endpoint = toolName ? API.toolDocsUploadFor(toolName) : API.toolDocsUpload;
      const res  = await fetch(endpoint, { method: 'POST', body: form });
      const data = await res.json();
      const total = data.total_chunks ?? (data.files || []).reduce((s, f) => s + (f.chunks || 0), 0);
      if (statusEl) {
        statusEl.style.color = 'var(--success, #16a34a)';
        statusEl.textContent = `✅ ${Array.from(files).length} file(s) uploaded — ${total} chunks stored.`;
      }
      const fi = $('teFileInput');
      if (fi) fi.value = '';
      if (toolName) _loadToolFiles(toolName);
    } catch {
      if (statusEl) {
        statusEl.style.color = 'var(--danger, #dc2626)';
        statusEl.textContent = '❌ Upload failed. Please try again.';
      }
    }
  }

  /* ══════════════════════════════
     WIRE UP CONTROLS (after DOM ready)
  ══════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {

    // Close buttons
    $('teCloseBtn')?.addEventListener('click', _close);
    $('teCancelBtn')?.addEventListener('click', _close);
    overlay()?.addEventListener('click', e => { if (e.target === overlay()) _close(); });

    // Tabs
    modal()?.querySelectorAll('.te-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        _activateTab(name);
        if (name === 'edit' && _currentTool) {
          _populateEditForm(_currentTool.info);
          _loadToolFiles(_currentTool.name);
        }
      });
    });

    // Save button
    $('teSaveBtn')?.addEventListener('click', _save);

    // Delete button
    $('teDeleteBtn')?.addEventListener('click', _delete);

    // Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal()?.classList.contains('open')) _close();
    });
  });

})();


/* ══════════════════════════════════════════════════════
   TOOL CARD THREE-DOTS — replaces inline code in loadTools()
   Called AFTER loadTools() renders cards into #toolsGrid
══════════════════════════════════════════════════════ */
function attachToolCardDots(grid) {
  if (!grid) return;

  grid.querySelectorAll('.te-dots-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dd = btn.nextElementSibling;
      const isOpen = dd.classList.contains('open');
      document.querySelectorAll('.te-dots-dropdown').forEach(d => d.classList.remove('open'));
      if (!isOpen) dd.classList.add('open');
    });
  });

  grid.querySelectorAll('.te-edit-item').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      document.querySelectorAll('.te-dots-dropdown').forEach(d => d.classList.remove('open'));
      await openToolEditor(btn.dataset.toolName);
    });
  });

  grid.querySelectorAll('.te-delete-item').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      document.querySelectorAll('.te-dots-dropdown').forEach(d => d.classList.remove('open'));
      const name = btn.dataset.toolName;
      if (!confirm(`Delete "${name}" from the registry?`)) return;
      try {
        const listRes = await fetch(API.toolsRegistered);
        const list    = await listRes.json();
        const item    = list.find(t => t.tool_name === name);
        if (!item) { showToast('Tool not found in DB.', 'error'); return; }
        await fetch(API.toolsDelete(item.id), { method: 'DELETE' });
        showToast(`"${name}" deleted.`, 'success');
        _toolsData = null;
        loadTools();
      } catch {
        showToast('Delete failed.', 'error');
      }
    });
  });

  /* outside-click guard */
  if (!window._teDotsOutsideAdded) {
    window._teDotsOutsideAdded = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.te-dots-dropdown').forEach(d => d.classList.remove('open'));
    });
  }
}
