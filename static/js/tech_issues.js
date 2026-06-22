/* ══════════════════════════════════════════════════════════════
   tech_issues.js — Admin panel for AI-triaged technical feedback
   ─────────────────────────────────────────────────────────────
   • Renders /page-tech-issues with a live table
   • Status badge + inline edit (status dropdown + admin note)
   • Badge count on rail button refreshes automatically
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API_LIST    = '/api/admin/technical-feedbacks';
  const API_SUMMARY = '/api/admin/technical-feedbacks/summary';

  let _page     = 1;
  let _perPage  = 15;
  let _status   = 'all';   // all | pending | in_progress | completed
  let _loading  = false;

  /* ── Status helpers ─────────────────────────────────────── */
  const STATUS_META = {
    pending:     { label: 'Pending',     color: '#f59e0b', bg: '#fffbeb', border: '#fcd34d' },
    in_progress: { label: 'In Progress', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    completed:   { label: 'Completed',   color: '#10b981', bg: '#ecfdf5', border: '#6ee7b7' },
  };

  function _statusBadge(status) {
    const m = STATUS_META[status] || STATUS_META.pending;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;
      font-weight:700;background:${m.bg};color:${m.color};border:1px solid ${m.border};
      white-space:nowrap;">${m.label}</span>`;
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _fmtDate(iso) {
    if (!iso) return '—';
    try { return iso.slice(0, 16).replace('T', ' '); } catch { return iso; }
  }

  /* ── Refresh rail badge — no badge shown, kept for summary API call ── */
  async function refreshBadge() { /* badge removed per design */ }

  /* ── Load and render the table ──────────────────────────── */
  async function loadIssues() {
    if (_loading) return;
    _loading = true;

    const container = document.getElementById('techIssuesTable');
    const paginEl   = document.getElementById('techIssuesPagin');
    const totalEl   = document.getElementById('techIssuesTotalCount');
    if (!container) { _loading = false; return; }

    container.innerHTML = '<div style="padding:40px;text-align:center;color:#6b7280;font-size:13px;">Loading…</div>';

    try {
      const params = new URLSearchParams({ page: _page, per_page: _perPage });
      if (_status && _status !== 'all') params.set('status', _status);
      const res  = await fetch(`${API_LIST}?${params}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      if (totalEl) totalEl.textContent = `${data.total} issue${data.total !== 1 ? 's' : ''}`;

      if (!data.items || !data.items.length) {
        container.innerHTML = '<div style="padding:60px;text-align:center;color:#9ca3af;font-size:13px;">No technical issues found.</div>';
        if (paginEl) paginEl.innerHTML = '';
        _loading = false;
        return;
      }

      container.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;width:90px;">Status</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;">Problem</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;width:120px;">Category</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;width:140px;">Last Reported</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;width:150px;">Admin Note</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151;width:80px;">Actions</th>
            </tr>
          </thead>
          <tbody id="techIssuesTbody">
            ${data.items.map(_renderRow).join('')}
          </tbody>
        </table>`;

      /* wire edit buttons */
      container.querySelectorAll('.ti-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => _openEditRow(btn.dataset.id));
      });

      /* pagination */
      if (paginEl) {
        paginEl.innerHTML = '';
        if (data.pages > 1) {
          for (let p = 1; p <= data.pages; p++) {
            const b = document.createElement('button');
            b.textContent  = p;
            b.style.cssText = `margin:0 2px;padding:5px 10px;border-radius:6px;border:1px solid #e5e7eb;
              background:${p === _page ? '#2563eb' : '#fff'};
              color:${p === _page ? '#fff' : '#374151'};cursor:pointer;font-size:12px;font-weight:600;`;
            b.addEventListener('click', () => { _page = p; loadIssues(); });
            paginEl.appendChild(b);
          }
        }
      }
    } catch (e) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;font-size:13px;">Failed to load: ${_esc(e.message)}</div>`;
    } finally {
      _loading = false;
    }
  }

  const AREA_COLORS = {
    chat:             { bg: '#eff6ff', color: '#2563eb' },
    ai_tools:         { bg: '#f0fdf4', color: '#16a34a' },
    personalization:  { bg: '#faf5ff', color: '#7c3aed' },
    feedback:         { bg: '#fff7ed', color: '#ea580c' },
    scenario_library: { bg: '#f0fdf4', color: '#0d9488' },
    admin:            { bg: '#fef2f2', color: '#dc2626' },
    auth:             { bg: '#fefce8', color: '#ca8a04' },
    home:             { bg: '#f8fafc', color: '#475569' },
    general:          { bg: '#f3f4f6', color: '#6b7280' },
  };

  function _areaChip(area) {
    if (!area) return '';
    const label = area.replace(/_/g, ' ');
    const c = AREA_COLORS[area] || AREA_COLORS.general;
    return `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;
      font-weight:700;background:${c.bg};color:${c.color};text-transform:capitalize;
      margin-bottom:3px;">${_esc(label)}</span>`;
  }

  function _renderRow(item) {
    const notePreview = (item.admin_note || '').slice(0, 50) + ((item.admin_note || '').length > 50 ? '…' : '');
    return `
      <tr id="ti-row-${_esc(item.id)}" style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 14px;">${_statusBadge(item.status)}</td>
        <td style="padding:10px 14px;">
          ${_areaChip(item.feature_area)}
          <div style="font-weight:600;color:#111827;margin-bottom:2px;">${_esc(item.problem_title)}</div>
          ${item.problem_desc ? `<div style="font-size:11.5px;color:#6b7280;line-height:1.4;">${_esc(item.problem_desc.slice(0,120))}${item.problem_desc.length>120?'…':''}</div>` : ''}
        </td>
        <td style="padding:10px 14px;color:#6b7280;">${_esc(item.category || '—')}</td>
        <td style="padding:10px 14px;color:#6b7280;white-space:nowrap;">${_fmtDate(item.last_reported)}</td>
        <td style="padding:10px 14px;color:#6b7280;font-size:12px;">${_esc(notePreview) || '<span style="color:#d1d5db;">—</span>'}</td>
        <td style="padding:10px 14px;text-align:center;">
          <button class="ti-edit-btn" data-id="${_esc(item.id)}"
            style="padding:5px 12px;background:#2563eb;color:#fff;border:none;border-radius:6px;
                   font-size:12px;font-weight:600;cursor:pointer;">Edit</button>
        </td>
      </tr>`;
  }

  /* ── Inline edit panel ─────────────────────────────────── */
  function _openEditRow(id) {
    // Remove any existing edit panel
    document.getElementById('ti-edit-panel')?.remove();

    const row = document.getElementById(`ti-row-${id}`);
    if (!row) return;

    const panel = document.createElement('tr');
    panel.id = 'ti-edit-panel';
    panel.innerHTML = `
      <td colspan="7" style="padding:16px 20px;background:#f8fafc;border-bottom:2px solid #2563eb;">
        <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
          <div style="flex:0 0 auto;">
            <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:5px;">STATUS</label>
            <select id="tiEditStatus" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:#fff;min-width:140px;">
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div style="flex:1;min-width:220px;">
            <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:5px;">ADMIN NOTE</label>
            <textarea id="tiEditNote" rows="2" placeholder="Add a note for this issue…"
              style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;
                     font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-end;padding-bottom:1px;">
            <button id="tiSaveBtn" style="padding:7px 18px;background:#2563eb;color:#fff;border:none;
              border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Save</button>
            <button id="tiCancelBtn" style="padding:7px 14px;background:#f3f4f6;color:#374151;border:none;
              border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
          </div>
        </div>
        <div id="tiEditError" style="display:none;margin-top:8px;font-size:12px;color:#ef4444;"></div>
      </td>`;

    row.after(panel);

    // Populate current values from the rendered row badge and note
    const statusBadgeText = (row.querySelector('span')?.textContent || '').trim().toLowerCase().replace(' ', '_');
    const sel = document.getElementById('tiEditStatus');
    if (sel && statusBadgeText) sel.value = statusBadgeText;

    // Fetch current admin_note from API to avoid truncation
    fetch(`${API_LIST}?page=1&per_page=200`).then(r => r.json()).then(d => {
      const item = (d.items || []).find(i => i.id === id);
      if (item) {
        if (sel) sel.value = item.status || 'pending';
        const noteEl = document.getElementById('tiEditNote');
        if (noteEl) noteEl.value = item.admin_note || '';
      }
    }).catch(() => {});

    document.getElementById('tiCancelBtn')?.addEventListener('click', () => {
      panel.remove();
    });

    document.getElementById('tiSaveBtn')?.addEventListener('click', async () => {
      const saveBtn = document.getElementById('tiSaveBtn');
      const errEl   = document.getElementById('tiEditError');
      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';
      errEl.style.display = 'none';

      try {
        const body = {
          status:     document.getElementById('tiEditStatus')?.value,
          admin_note: document.getElementById('tiEditNote')?.value || '',
        };
        const res = await fetch(`${API_LIST}/${encodeURIComponent(id)}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Save failed (HTTP ' + res.status + ')');
        panel.remove();
        await loadIssues();
        await refreshBadge();
      } catch (e) {
        errEl.textContent   = e.message;
        errEl.style.display = 'block';
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save';
      }
    });
  }

  /* ── Page init ──────────────────────────────────────────── */
  function initTechIssuesPage() {
    /* Status filter tabs */
    document.querySelectorAll('.ti-filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.ti-filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _status = tab.dataset.status;
        _page   = 1;
        loadIssues();
      });
    });

    document.getElementById('tiRefreshBtn')?.addEventListener('click', () => {
      _page = 1;
      loadIssues();
      refreshBadge();
    });
  }

  /* ── Open page from admin rail ──────────────────────────── */
  function openTechIssuesPage() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pg = document.getElementById('page-tech-issues');
    if (pg) {
      pg.classList.add('active');
      _page = 1;
      loadIssues();
      refreshBadge();
    }
  }

  /* ── Boot ───────────────────────────────────────────────── */
  function _boot() {
    initTechIssuesPage();
    refreshBadge();

    /* Rail button */
    document.getElementById('railTechIssues')?.addEventListener('click', () => {
      openTechIssuesPage();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  window._techIssues = { open: openTechIssuesPage, refreshBadge };
})();
