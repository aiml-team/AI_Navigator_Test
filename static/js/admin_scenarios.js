/* ═══════════════════════════════════════════════════════════════
   admin_scenarios.js
   1. Suggest Scenario modal  — hamburger drawer link
   2. Admin Scenarios page    — Review tab + Log tab
   3. Toggle dropdown wiring  — Scenarios group (Review / Log)
   4. window.adminScenariosNavigate(tab) — called by ui.js

   REQUIRED CSS (add to your stylesheet):
   ─────────────────────────────────────
   .as-similarity-box { border:1.5px solid #e2e8f0; border-radius:10px; padding:14px 16px; margin-top:14px; background:#f8fafc; }
   .as-sim-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
   .as-sim-score { font-size:12px; font-weight:700; padding:3px 10px; border-radius:20px; }
   .as-sim-score.high { background:#fee2e2; color:#b91c1c; }
   .as-sim-score.med  { background:#fef3c7; color:#92400e; }
   .as-sim-score.low  { background:#d1fae5; color:#065f46; }
   .as-sim-note { font-size:12.5px; margin:6px 0 10px; color:#475569; }
   .as-sim-list { display:flex; flex-direction:column; gap:10px; margin-bottom:12px; }
   .as-sim-item { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; }
   .as-sim-item-top { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
   .as-sim-rank { font-size:11px; font-weight:700; color:#94a3b8; min-width:24px; }
   .as-sim-pill { font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; margin-left:auto; }
   .as-sim-pill.high { background:#fee2e2; color:#b91c1c; }
   .as-sim-pill.med  { background:#fef3c7; color:#92400e; }
   .as-sim-pill.low  { background:#d1fae5; color:#065f46; }
   .as-sim-meta { font-size:11.5px; color:#64748b; margin-bottom:4px; }
   .as-sim-intent { font-size:11.5px; color:#0369a1; margin-bottom:6px; }
   .as-sim-details summary { font-size:12px; color:#4f46e5; cursor:pointer; }
   .as-sim-scenario-body { font-size:12.5px; color:#334155; margin-top:6px; white-space:pre-wrap; }
   .as-sim-empty { font-size:13px; color:#64748b; padding:8px 0; }
   .as-sim-error { font-size:13px; color:#b91c1c; margin-bottom:8px; }
   .as-sim-loading { display:flex; align-items:center; gap:10px; font-size:13px; color:#64748b; }
   .as-sim-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
   .as-btn-neutral { background:#e2e8f0; color:#334155; border:none; border-radius:6px; padding:6px 14px; font-size:12.5px; font-weight:600; cursor:pointer; }
   .as-btn-neutral:hover { background:#cbd5e1; }
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const DELIVER_MEGA = 'Deliver Projects';

  /* ── tiny helpers ─────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function statusBadge(status) {
    const map = {
      pending:  ['as-badge-pending',  'Pending'],
      approved: ['as-badge-approved', 'Approved'],
      rejected: ['as-badge-rejected', 'Rejected'],
    };
    const [cls, label] = map[status] || ['as-badge-pending', status];
    return `<span class="as-badge ${cls}">${label}</span>`;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  /* ══════════════════════════════════════════════════════════
     1. SUGGEST SCENARIO MODAL
  ══════════════════════════════════════════════════════════ */
  function initSuggestModal() {
    const overlay   = document.getElementById('suggestScenarioOverlay');
    const closeBtn  = document.getElementById('btnCloseSuggestScenario');
    const cancelBtn = document.getElementById('btnCancelSuggestScenario');
    const submitBtn = document.getElementById('btnSubmitSuggestScenario');
    const statusEl  = document.getElementById('ssStatus');

    if (!overlay || !submitBtn) return;

    /* fetch from API — same data the scenario library uses */
    async function _populate() {
      try {
        const res  = await fetch('/api/scenarios');
        const data = await res.json();
        const scenarios = data.scenarios || data || [];

        const megaSet = new Set(), catSet = new Set(), personaSet = new Set();
        scenarios.forEach(s => {
          if (s.mega_group) megaSet.add(s.mega_group);
          if (s.category)   catSet.add(s.category);
          if (s.persona)    personaSet.add(s.persona);
        });

        const mg = document.getElementById('ssMegaGroup');
        const ca = document.getElementById('ssCategory');
        const pe = document.getElementById('ssPersona');

        if (mg) mg.innerHTML = '<option value="">— Select Group —</option>' +
          [...megaSet].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        if (ca) ca.innerHTML = '<option value="">— Select Category —</option>' +
          [...catSet].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        if (pe) pe.innerHTML = '<option value="">— Select Persona / Role —</option>' +
          [...personaSet].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      } catch (e) {
        console.error('Could not load scenario options', e);
      }
    }

    /* show/hide Activate Phase exactly like Add scenario does */
    function _toggleActivatePhase() {
      const mg  = document.getElementById('ssMegaGroup');
      const row = document.getElementById('ssActivatePhaseRow');
      const ph  = document.getElementById('ssActivatePhase');
      if (!row) return;
      const show = mg && mg.value === DELIVER_MEGA;
      row.style.display = show ? '' : 'none';
      if (!show && ph) ph.value = '';
    }

    function _showStatus(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.display = 'block';
      if (type === 'error') {
        statusEl.style.background = '#fef2f2';
        statusEl.style.border     = '1.5px solid #dc2626';
        statusEl.style.color      = '#991b1b';
      } else {
        statusEl.style.background = '#e8f5e9';
        statusEl.style.border     = '1.5px solid #16a34a';
        statusEl.style.color      = '#065f46';
      }
      statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function _reset() {
      ['ssTitle', 'ssScenario'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      ['ssMegaGroup', 'ssCategory', 'ssPersona', 'ssActivatePhase'].forEach(id => {
        const el = document.getElementById(id); if (el) el.selectedIndex = 0;
      });
      const row = document.getElementById('ssActivatePhaseRow');
      if (row) row.style.display = 'none';
      if (statusEl) statusEl.style.display = 'none';
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Suggest a scenario';
    }

    function openModal() {
      _reset();
      overlay.classList.add('open');
      _populate();
    }

    function closeModal() {
      overlay.classList.remove('open');
      _reset();
    }

    document.querySelectorAll('.ss-open-trigger').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('menuDrawer').classList.remove('open');
        document.getElementById('menuDrawerOverlay').classList.remove('open');
        openModal();
      });
    });

    closeBtn.addEventListener('click',  closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('ssMegaGroup').addEventListener('change', _toggleActivatePhase);

    submitBtn.addEventListener('click', async () => {
      const title         = (document.getElementById('ssTitle').value         || '').trim();
      const megaGroup     = (document.getElementById('ssMegaGroup').value     || '').trim();
      const category      = (document.getElementById('ssCategory').value      || '').trim();
      const persona       = (document.getElementById('ssPersona').value       || '').trim();
      const scenario      = (document.getElementById('ssScenario').value      || '').trim();

      if (!title)     { _showStatus('Scenario Title is required.', 'error'); return; }
      if (!megaGroup) { _showStatus('Group is required.', 'error'); return; }
      if (!category)  { _showStatus('Category is required.', 'error'); return; }
      if (!persona)   { _showStatus('Persona / Role is required.', 'error'); return; }
      if (!scenario)  { _showStatus('Scenario body is required.', 'error'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      try {
        const session = (() => { try { return JSON.parse(sessionStorage.getItem('navigator_session')); } catch { return null; } })();
        const submittedBy = (session && session.email) ? session.email : '';
        const res = await fetch(`/api/scenario-suggestions/submit?submitted_by=${encodeURIComponent(submittedBy)}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            mega_group:     megaGroup,
            category:       category,
            persona:        persona,
            activate_phase: document.getElementById('ssActivatePhase').value || '',
            scenario,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Submission failed');
        _showStatus('✅ Scenario submitted! An admin will review it shortly.', 'success');
        setTimeout(closeModal, 1800);
      } catch (err) {
        _showStatus(`❌ ${err.message}`, 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Suggest a scenario';
      }
    });
  }

  /* ══════════════════════════════════════════════════════════
     2. TOGGLE DROPDOWN — Scenarios group
  ══════════════════════════════════════════════════════════ */
  function initDropdownScenarios() {
    document.getElementById('dropScenarios')?.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('menuDrawer')?.classList.remove('open');
      document.getElementById('menuDrawerOverlay')?.classList.remove('open');
      navigateTo('admin-scenarios');
      window.adminScenariosNavigate('review');
    });
  }

  /* ══════════════════════════════════════════════════════════
     3. ADMIN SCENARIOS PAGE
  ══════════════════════════════════════════════════════════ */
  function initAdminScenariosPage() {
    const page = document.getElementById('page-admin-scenarios');
    if (!page) return;

    let _activeTab = 'review';

    function _switchTab(name) {
      _activeTab = name;
      page.querySelectorAll('.as-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.astab === name));
      page.querySelectorAll('.as-panel').forEach(p => {
        const on = p.dataset.aspanel === name;
        p.classList.toggle('active', on);
        p.style.display = on ? '' : 'none';
      });
      if (name === 'review') _loadReview();
      if (name === 'log')    _loadLog();
    }

    page.querySelectorAll('.as-tab').forEach(t =>
      t.addEventListener('click', () => t.dataset.astab && _switchTab(t.dataset.astab)));

    document.getElementById('btnRefreshAdminScenarios')?.addEventListener('click', () =>
      _activeTab === 'review' ? _loadReview() : _loadLog());

    /* ── Review tab ── */
    let _rPage = 1, _rSearch = '', _rTimer = null;

    document.getElementById('asReviewSearch')?.addEventListener('input', e => {
      clearTimeout(_rTimer);
      _rTimer = setTimeout(() => { _rSearch = e.target.value; _rPage = 1; _loadReview(); }, 300);
    });
    document.getElementById('asReviewPrev')?.addEventListener('click', () => {
      if (_rPage > 1) { _rPage--; _loadReview(); }
    });
    document.getElementById('asReviewNext')?.addEventListener('click', () => {
      _rPage++; _loadReview();
    });

    async function _loadReview() {
      const el = document.getElementById('asReviewList');
      if (!el) return;
      el.innerHTML = '<div class="as-loading"><div class="spinner"></div></div>';
      try {
        const p = new URLSearchParams({ status: 'pending', search: _rSearch, page: _rPage, per_page: 10 });
        const r = await fetch(`/api/scenario-suggestions?${p}`);
        const d = await r.json();
        const badge = document.getElementById('asPendingBadge');
        if (badge) badge.textContent = d.total;
        _renderCards(el, d.items);
        _renderPager('asReviewPagination','asReviewPageInfo','asReviewPrev','asReviewNext', d.total, _rPage, 10);
      } catch (err) {
        el.innerHTML = `<div class="as-empty">Error: ${esc(err.message)}</div>`;
      }
    }

    function _renderCards(container, items) {
      if (!items?.length) {
        container.innerHTML = '<div class="as-empty">No pending suggestions. All caught up!</div>';
        return;
      }
      container.innerHTML = items.map(item => `
        <div class="as-review-card" data-id="${esc(item.id)}">

          <div class="as-card-title">${esc(item.title)}</div>

          <div class="as-card-kv">
            <div class="as-kv-row">
              <span class="as-kv-key">Group</span>
              <span class="as-kv-val">${esc(item.mega_group)}</span>
            </div>
            ${item.category ? `<div class="as-kv-row">
              <span class="as-kv-key">Category</span>
              <span class="as-kv-val">${esc(item.category)}</span>
            </div>` : ''}
            ${item.persona ? `<div class="as-kv-row">
              <span class="as-kv-key">Persona / Role</span>
              <span class="as-kv-val">${esc(item.persona)}</span>
            </div>` : ''}
            ${item.activate_phase ? `<div class="as-kv-row">
              <span class="as-kv-key">Activate Phase</span>
              <span class="as-kv-val">${esc(item.activate_phase)}</span>
            </div>` : ''}
            <div class="as-kv-row">
              <span class="as-kv-key">Submitted By</span>
              <span class="as-kv-val">${esc(item.submitted_by || 'Anonymous')} &nbsp;·&nbsp; ${fmtDate(item.submitted_at)}</span>
            </div>
          </div>

          <div class="as-card-scenario-label">Scenario</div>
          <div class="as-card-body">${esc(item.scenario)}</div>

          <div class="as-card-footer">
            <div class="as-card-actions">
              <input class="as-note-input" type="text" placeholder="Optional admin note…" id="note-${esc(item.id)}"/>
              <button class="as-btn-approve" data-action="approve" data-id="${esc(item.id)}">✓ Approve</button>
              <button class="as-btn-reject"  data-action="reject"  data-id="${esc(item.id)}">✕ Reject</button>
            </div>
          </div>

        </div>`).join('');

      container.querySelectorAll('[data-action]').forEach(btn =>
        btn.addEventListener('click', () => {
          if (btn.dataset.action === 'approve') {
            _checkSimilarityBeforeApprove(btn.dataset.id);
          } else {
            _doAction(btn.dataset.action, btn.dataset.id);
          }
        }));
    }

    /* ── Similarity modal — full popup on document.body ── */
    async function _checkSimilarityBeforeApprove(id) {
      /* remove any stale modal */
      document.getElementById('asSimModal')?.remove();

      /* build overlay + modal shell with loading state */
      const overlay = document.createElement('div');
      overlay.id = 'asSimModal';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9999',
        'background:rgba(15,30,45,.5)', 'display:flex',
        'align-items:center', 'justify-content:center', 'padding:20px',
      ].join(';');

      overlay.innerHTML = `
        <div id="asSimBox" style="
          background:#fff; border-radius:14px; width:100%; max-width:600px;
          max-height:88vh; display:flex; flex-direction:column; overflow:hidden;
          box-shadow:0 20px 60px rgba(15,30,45,.22),0 4px 16px rgba(15,30,45,.12);
        ">
          <!-- header -->
          <div style="
            display:flex; align-items:center; justify-content:space-between;
            padding:16px 20px; border-bottom:1.5px solid #e2e8f0; flex-shrink:0;
          ">
            <span style="font-size:15px;font-weight:700;color:#0f1e2d;display:flex;align-items:center;gap:8px;">
              🔍 Intent Similarity Check
            </span>
            <button id="asSimCloseBtn" style="
              width:30px;height:30px;border:none;background:transparent;
              font-size:18px;cursor:pointer;color:#64748b;border-radius:6px;
              display:flex;align-items:center;justify-content:center;
            ">✕</button>
          </div>
          <!-- body -->
          <div id="asSimBody" style="flex:1;overflow-y:auto;padding:24px 20px;">
            <div style="display:flex;align-items:center;gap:10px;color:#64748b;font-size:13px;">
              <div class="spinner"></div> Checking for similar scenarios…
            </div>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      function closeModal() { overlay.remove(); }
      overlay.querySelector('#asSimCloseBtn').addEventListener('click', closeModal);
      overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

      /* fetch similarity data */
      try {
        const r = await fetch(`/api/scenario-suggestions/${id}/similarity`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || 'Similarity check failed');

        const matches = d.matches || [];
        const highest = d.highest_score || 0;
        const sc      = highest >= 70 ? 'high' : highest >= 45 ? 'med' : 'low';

        const bannerBg    = sc === 'high' ? '#fef2f2' : sc === 'med' ? '#fffbeb' : '#f0fdf4';
        const bannerBdr   = sc === 'high' ? '#fecaca' : sc === 'med' ? '#fde68a' : '#bbf7d0';
        const bannerColor = sc === 'high' ? '#991b1b' : sc === 'med' ? '#92400e' : '#166534';
        const pillBg      = sc === 'high' ? '#fee2e2' : sc === 'med' ? '#fef3c7' : '#dcfce7';
        const pillColor   = sc === 'high' ? '#b91c1c' : sc === 'med' ? '#92400e' : '#166534';
        const bannerIcon  = sc === 'high' ? '⚠️' : sc === 'med' ? '🔶' : '✅';
        const bannerMsg   = sc === 'high'
          ? 'A very similar scenario already exists. Review carefully before approving.'
          : sc === 'med'
            ? 'Some overlap detected. Check matches below before approving.'
            : 'No close duplicates found — looks safe to approve.';

        function rowPillStyle(score) {
          const s = score >= 70 ? ['#fee2e2','#b91c1c'] : score >= 45 ? ['#fef3c7','#92400e'] : ['#dcfce7','#166534'];
          return `background:${s[0]};color:${s[1]}`;
        }
        function borderAccent(score) {
          return score >= 70 ? '#ef4444' : score >= 45 ? '#f59e0b' : '#10b981';
        }

        const rowsHtml = matches.length
          ? matches.map((m, i) => `
            <div style="
              display:flex; align-items:flex-start; gap:12px;
              background:#f8fafc; border:1.5px solid #e2e8f0;
              border-left:4px solid ${borderAccent(m.score)};
              border-radius:10px; padding:12px 14px; margin-bottom:8px;
            ">
              <!-- rank -->
              <span style="
                width:22px;height:22px;border-radius:50%;background:#eff6ff;
                color:#1e40af;font-size:11px;font-weight:800;
                display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;
              ">${i + 1}</span>

              <!-- text block -->
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;color:#0f1e2d;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;">
                  ${esc(m.title || 'Untitled scenario')}
                </div>
                <div style="font-size:11.5px;color:#64748b;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;">
                  ${esc(m.mega_group || '—')} &nbsp;·&nbsp; ${esc(m.category || '—')} &nbsp;·&nbsp; ${esc(m.persona || '—')}
                </div>
                <div style="font-size:11px;color:#2563eb;font-weight:500;">
                  ${esc(m.matched_action || 'general')} → ${esc(m.matched_output || 'general')}
                </div>
                <!-- expandable body -->
                <div id="simexp-${i}" style="display:none;margin-top:10px;padding-top:10px;
                  border-top:1px dashed #e2e8f0;font-size:12.5px;color:#4a5f73;
                  line-height:1.6;white-space:pre-wrap;word-break:break-word;">
                  ${esc(m.scenario || '—')}
                </div>
              </div>

              <!-- right: score + open button -->
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
                <span style="
                  font-size:12px;font-weight:800;padding:3px 10px;
                  border-radius:999px;white-space:nowrap;
                  ${rowPillStyle(m.score)}
                ">${m.score}% match</span>
                <button data-expidx="${i}" style="
                  font-size:11.5px;font-weight:600;color:#2563eb;
                  background:#eff6ff;border:1px solid #bfdbfe;
                  border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap;
                ">▶ Open</button>
              </div>
            </div>`).join('')
          : `<div style="text-align:center;padding:28px 0;font-size:13px;color:#64748b;">
               No similar scenarios found in the library.
             </div>`;

        document.getElementById('asSimBody').innerHTML = `
          <!-- score banner -->
          <div style="
            display:flex;align-items:center;gap:10px;
            padding:11px 14px;border-radius:9px;margin-bottom:14px;
            background:${bannerBg};border:1.5px solid ${bannerBdr};color:${bannerColor};
            font-size:13px;font-weight:500;
          ">
            <span style="font-size:16px;flex-shrink:0;">${bannerIcon}</span>
            <span style="flex:1;">${bannerMsg}</span>
            <span style="
              font-size:13px;font-weight:800;padding:3px 11px;border-radius:999px;
              background:${pillBg};color:${pillColor};white-space:nowrap;
            ">Top match: ${highest}%</span>
          </div>

          <!-- match rows -->
          ${rowsHtml}

          <!-- footer actions -->
          <div style="
            display:flex;justify-content:flex-end;gap:8px;
            margin-top:16px;padding-top:14px;border-top:1.5px solid #e2e8f0;
          ">
            
            <button id="asSimReject" style="
              background:#fef2f2;color:#b91c1c;border:1.5px solid #fecaca;
              border-radius:7px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;
            ">✕ Reject</button>
            <button id="asSimApprove" style="
              background:#2563eb;color:#fff;border:none;
              border-radius:7px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;
            ">✓ Approve anyway</button>
          </div>`;

        /* open/close toggle for each row */
        document.getElementById('asSimBody').querySelectorAll('[data-expidx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = btn.dataset.expidx;
            const box = document.getElementById(`simexp-${idx}`);
            const open = box.style.display === 'none';
            box.style.display = open ? 'block' : 'none';
            btn.textContent = open ? '▼ Close' : '▶ Open';
          });
        });

        
        document.getElementById('asSimReject').addEventListener('click', () => { closeModal(); _doAction('reject', id); });
        document.getElementById('asSimApprove').addEventListener('click', () => { closeModal(); _doAction('approve', id); });

      } catch (err) {
        document.getElementById('asSimBody').innerHTML = `
          <div style="text-align:center;padding:20px 0;color:#b91c1c;font-size:13px;">
            ❌ ${esc(err.message)}
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
            <button id="asSimErrCancel" style="
              background:#f0f4f8;color:#4a5f73;border:1.5px solid #cbd5e1;
              border-radius:7px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;
            ">Cancel</button>
            <button id="asSimErrApprove" style="
              background:#2563eb;color:#fff;border:none;
              border-radius:7px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;
            ">✓ Approve anyway</button>
          </div>`;
        document.getElementById('asSimErrCancel').addEventListener('click', closeModal);
        document.getElementById('asSimErrApprove').addEventListener('click', () => { closeModal(); _doAction('approve', id); });
      }
    }

    /* ── Execute approve / reject against the API ── */
    async function _doAction(action, id) {
      const card = document.querySelector(`.as-review-card[data-id="${id}"]`);
      const noteInput = card ? card.querySelector(`#note-${id}`) : null;
      const note = (noteInput ? noteInput.value : '').trim();

      /* disable all buttons in this card while the request is in-flight */
      card?.querySelectorAll('button').forEach(b => b.disabled = true);

      try {
        const url = `/api/scenario-suggestions/${encodeURIComponent(id)}/${action}` +
          (note ? `?admin_note=${encodeURIComponent(note)}` : '');

        const r = await fetch(url, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || `${action} failed`);

        /* visual feedback — replace card content with a status banner */
        if (card) {
          const label = action === 'approve' ? '✅ Approved' : '✕ Rejected';
          const cls   = action === 'approve' ? 'as-badge-approved' : 'as-badge-rejected';
          card.innerHTML = `
            <div style="padding:12px 16px;display:flex;align-items:center;gap:10px;">
              <span class="as-badge ${cls}">${label}</span>
              <span style="font-size:13px;color:var(--text-secondary);">
                ${esc(card.querySelector('.as-card-title')?.textContent || '')}
              </span>
            </div>`;
          /* fade and remove after a short delay to keep the list tidy */
          setTimeout(() => {
            card.style.transition = 'opacity 0.4s';
            card.style.opacity = '0';
            setTimeout(() => card.remove(), 450);
          }, 1200);
        }

        /* refresh the pending badge count */
        const badge = document.getElementById('asPendingBadge');
        if (badge) {
          const current = parseInt(badge.textContent, 10) || 0;
          badge.textContent = Math.max(0, current - 1);
        }

      } catch (err) {
        alert(`❌ ${err.message}`);
        card?.querySelectorAll('button').forEach(b => b.disabled = false);
      }
    }

    /* ── Log tab ── */
    let _lPage = 1, _lSearch = '', _lStatus = 'all', _lTimer = null;

    document.getElementById('asLogStatus')?.addEventListener('change', e => {
      _lStatus = e.target.value; _lPage = 1; _loadLog();
    });
    document.getElementById('asLogSearch')?.addEventListener('input', e => {
      clearTimeout(_lTimer);
      _lTimer = setTimeout(() => { _lSearch = e.target.value; _lPage = 1; _loadLog(); }, 300);
    });
    document.getElementById('asLogPrev')?.addEventListener('click', () => {
      if (_lPage > 1) { _lPage--; _loadLog(); }
    });
    document.getElementById('asLogNext')?.addEventListener('click', () => {
      _lPage++; _loadLog();
    });

    async function _loadLog() {
      const el = document.getElementById('asLogTable');
      if (!el) return;
      el.innerHTML = '<div class="as-loading"><div class="spinner"></div></div>';
      try {
        const p = new URLSearchParams({ status: _lStatus, search: _lSearch, page: _lPage, per_page: 15 });
        const r = await fetch(`/api/scenario-suggestions?${p}`);
        const d = await r.json();
        _renderTable(el, d.items);
        _renderPager('asLogPagination','asLogPageInfo','asLogPrev','asLogNext', d.total, _lPage, 15);
      } catch (err) {
        el.innerHTML = `<div class="as-empty">Error: ${esc(err.message)}</div>`;
      }
    }

    function _renderTable(container, items) {
      if (!items?.length) {
        container.innerHTML = '<div class="as-empty">No scenarios found.</div>';
        return;
      }
      container.innerHTML = `
        <table class="as-table">
          <thead><tr>
            <th>Title</th><th>Group</th><th>Category</th><th>Persona</th>
            <th>Submitted By</th><th>Submitted At</th><th>Status</th>
            <th>Admin Note</th><th>Reviewed At</th>
          </tr></thead>
          <tbody>${items.map(item => `<tr>
            <td class="as-td-title" title="${esc(item.scenario)}">${esc(item.title)}</td>
            <td>${esc(item.mega_group)}</td>
            <td>${esc(item.category || '—')}</td>
            <td>${esc(item.persona  || '—')}</td>
            <td>${esc(item.submitted_by || '—')}</td>
            <td class="as-td-date">${fmtDate(item.submitted_at)}</td>
            <td>${statusBadge(item.status)}</td>
            <td class="as-td-note">${esc(item.admin_note || '—')}</td>
            <td class="as-td-date">${fmtDate(item.reviewed_at)}</td>
          </tr>`).join('')}</tbody>
        </table>`;
    }

    function _renderPager(wrapId, infoId, prevId, nextId, total, page, perPage) {
      const wrap = document.getElementById(wrapId);
      if (!wrap) return;
      const pages = Math.max(1, Math.ceil(total / perPage));
      wrap.style.display = pages > 1 ? 'flex' : 'none';
      const info = document.getElementById(infoId);
      if (info) info.textContent = `Page ${page} of ${pages} (${total} total)`;
      const prev = document.getElementById(prevId);
      const next = document.getElementById(nextId);
      if (prev) prev.disabled = page <= 1;
      if (next) next.disabled = page >= pages;
    }

    /* auto-load when page becomes visible */
    new MutationObserver(() => {
      if (page.classList.contains('active')) _switchTab(_activeTab);
    }).observe(page, { attributes: true, attributeFilter: ['class'] });

    /* expose globally */
    window.adminScenariosNavigate = function (tab) { _switchTab(tab || 'review'); };
  }

  /* ── boot ─────────────────────────────────────────────────── */
  function boot() {
    initSuggestModal();
    initDropdownScenarios();
    initAdminScenariosPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();