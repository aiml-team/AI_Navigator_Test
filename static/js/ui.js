/* ══════════════════════════════════════════════════════
   ui.js — Navigation, sidebar, hamburger drawer,
           output tabs, step logic, processing animation,
           modal, toast, shared utils
══════════════════════════════════════════════════════ */


/* ══════════════════════════════════════
   NAVIGATION
══════════════════════════════════════ */
function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
  document.querySelectorAll('.sidebar-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { navigateTo(btn.dataset.page); closeSidebar(); });
  });
  // Profile-dropdown items that navigate to a page (e.g. "My activity").
  document.querySelectorAll('#hdrDropdown [data-page]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(btn.dataset.page);
      document.getElementById('hdrDropdown')?.classList.remove('open');
    });
  });
  // Mobile drawer items that navigate to a page — close drawer after navigating
  document.querySelectorAll('#menuDrawer [data-page]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(btn.dataset.page);
      document.getElementById('menuDrawer')?.classList.remove('open');
      document.getElementById('menuDrawerOverlay')?.classList.remove('open');
    });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.sidebar-item[data-page]').forEach(t =>
    t.classList.toggle('active', t.dataset.page === page));

  if (page === 'history')          loadHistory();
  if (page === 'tools')          { if (typeof initToolsPage === 'function') { initToolsPage(); } loadTools(); }
  if (page === 'analytics')        loadAnalytics();
  if (page === 'policies')         loadPolicies();
  if (page === 'admin-scenarios') { if (typeof adminScenariosNavigate === 'function') adminScenariosNavigate(); }
}


/* ══════════════════════════════════════
   SIDEBAR
══════════════════════════════════════ */
function initSidebar() {
  // Both elements are optional — the hamburger was removed when the drawer
  // was retired in favour of the admin left rail + profile-dropdown Help
  // submenu. Without these guards, a missing element threw a TypeError on
  // .addEventListener and halted the entire DOMContentLoaded init chain
  // (so initChatPanel, initHomePage, initOutputTabs etc. never ran).
  document.getElementById('hamburgerBtn')
    ?.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  document.getElementById('sidebarOverlay')
    ?.addEventListener('click', closeSidebar);
}
function closeSidebar() { document.body.classList.remove('sidebar-open'); }


/* ══════════════════════════════════════
   HAMBURGER DRAWER
   Replaces the sidebar-toggle behaviour with a
   slide-in drawer.  Runs after DOMContentLoaded so
   it can clone the button and strip existing listeners.
══════════════════════════════════════ */
function initHamburgerDrawer() {
  const btn     = document.getElementById('hamburgerBtn');
  const drawer  = document.getElementById('menuDrawer');
  const overlay = document.getElementById('menuDrawerOverlay');
  if (!btn || !drawer) return;

  // Clone → removes all existing listeners (e.g. from initSidebar)
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', e => {
    e.stopPropagation();
    drawer.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  overlay.addEventListener('click', () => {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
    }
  });
}


/* ══════════════════════════════════════
   OUTPUT TABS
══════════════════════════════════════ */
function initOutputTabs() {
  document.querySelectorAll('.output-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.out;
      document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.output-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`out-${key}`)?.classList.add('active');
    });
  });
}


/* ══════════════════════════════════════
   STEP INDICATORS
══════════════════════════════════════ */
function goToStep(n) {
  document.querySelectorAll('.step-panel').forEach((p, i) =>
    p.classList.toggle('active', i + 1 === n));

  for (let i = 1; i <= 3; i++) {
    const ind = document.getElementById(`step-ind-${i}`);
    if (!ind) continue;
    ind.classList.remove('active', 'done');
    if (i === n)    ind.classList.add('active');
    else if (i < n) ind.classList.add('done');
  }
}


/* ══════════════════════════════════════
   PROCESSING ANIMATION
══════════════════════════════════════ */
function startProcessingAnimation() {
  for (let i = 1; i <= 5; i++) {
    const step = document.getElementById(`proc-${i}`);
    if (step) step.className = 'proc-step';
  }
}

async function finishProcessingAnimation() {
  for (let i = 1; i <= 5; i++) {
    await delay(350);
    const step = document.getElementById(`proc-${i}`);
    if (step) step.classList.add('active');
    await delay(150);
    if (step) { step.classList.remove('active'); step.classList.add('done'); }
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }


/* ══════════════════════════════════════
   LOG MODAL
══════════════════════════════════════ */
function initModal() {
  document.getElementById('btnCloseModal')
    .addEventListener('click', closeLogModal);
  document.getElementById('logModal')
    .addEventListener('click', e => { if (e.target === e.currentTarget) closeLogModal(); });
}

let _currentLogRow = null;

async function openLogModal(auditId) {
  const modal = document.getElementById('logModal');
  const body  = document.getElementById('logModalBody');
  _currentLogRow = null;
  // Hide any stale scenario-title chip from a previous open — the new row's
  // provenance is applied below once the audit_log fetch resolves.
  const _scenarioChipEl = document.getElementById('logModalScenarioChip');
  if (_scenarioChipEl) {
    _scenarioChipEl.style.display = 'none';
    _scenarioChipEl.textContent   = '';
    _scenarioChipEl.title         = '';
  }
  modal.classList.add('open');
  body.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    // Fetch audit row and any saved feedback in parallel
    const [auditRes, fbRes] = await Promise.all([
      fetch(`${API.audit}?limit=200`),
      fetch(`/api/feedback/by-audit/${encodeURIComponent(auditId)}`).catch(() => null),
    ]);

    const data = await auditRes.json();
    const row  = data.find(r => r.id === auditId);
    if (!row) { body.innerHTML = '<p style="color:var(--text2)">Log not found.</p>'; return; }

    // apply local edits if any (frontend-only persistence)
    const localEdits = getLocalAuditEdits(auditId);
    const mergedRow  = { ...row, ...localEdits };
    // Always keep policy_blocked and policy_summary from the original server row
    // so local text edits never accidentally override block status
    mergedRow.policy_blocked = row.policy_blocked;
    mergedRow.policy_summary = localEdits.policy_summary ?? row.policy_summary ?? '';

    // parse json fields
    let policyFlags = [], policies = [];
    try { policyFlags = JSON.parse(mergedRow.policy_flags       || '[]'); } catch {}
    try { policies    = JSON.parse(mergedRow.retrieved_policies || '[]'); } catch {}

    _currentLogRow = mergedRow;

    // Scenario provenance chip in the modal header — only shown for runs
    // that originated from the Scenario Library AND that have a persisted
    // scenario_title (i.e. runs created after the scenario_title column was
    // added). Placed to the left of the "Provide Feedback on this Response"
    // button so it's visible when cross-checking which scenario produced the
    // response. See templates/index.html #logModalScenarioChip.
    if (_scenarioChipEl) {
      const _ts    = (mergedRow.task_source    || '').toString().toLowerCase();
      const _title = (mergedRow.scenario_title || '').toString().trim();
      if (_ts === 'scenario_library' && _title) {
        _scenarioChipEl.textContent   = _title;
        _scenarioChipEl.title         = 'Scenario: ' + _title;
        _scenarioChipEl.style.display = 'inline-flex';
      } else {
        _scenarioChipEl.style.display = 'none';
        _scenarioChipEl.textContent   = '';
        _scenarioChipEl.title         = '';
      }
    }

    body.innerHTML = renderAuditLog(mergedRow, policyFlags, policies);
    wireEditActions(auditId, mergedRow, policyFlags, policies);

    // Show saved feedback below the log if it exists
    let savedFeedback = null;
    if (fbRes?.ok) {
      const fbData = await fbRes.json().catch(() => null);
      savedFeedback = fbData?.feedback || null;
    }
    if (savedFeedback && (savedFeedback.comment || savedFeedback.issue_type)) {
      const fbSection = document.createElement('div');
      fbSection.className = 'log-section';
      const issueLabel = savedFeedback.issue_type
        ? `<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:5px;">${
            savedFeedback.issue_type.split(',').map(s => s.trim()).filter(Boolean)
              .map(t => `<span style="display:inline-block;padding:2px 8px;background:var(--primary-pale);color:var(--primary);border-radius:10px;font-size:11px;font-weight:600;">${escapeHtml(t)}</span>`)
              .join('')
          }</div>` : '';
      const commentHtml = savedFeedback.comment
        ? `<div style="white-space:pre-wrap;font-size:13px;color:var(--text1);line-height:1.6;">${escapeHtml(savedFeedback.comment)}</div>`
        : '';
      fbSection.innerHTML = `
        <div class="log-section-title">Saved Feedback</div>
        <div class="log-value">${issueLabel}${commentHtml || '<span style="color:var(--text3);font-style:italic;">No comment added.</span>'}</div>`;
      body.appendChild(fbSection);
    }
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`;
  }

  // Wire "Provide Feedback on this Response" button in modal header
  document.getElementById('btnFeedbackLog').onclick = () => {
    if (typeof openResponseFeedback === 'function') openResponseFeedback(auditId);
  };

  document.getElementById('btnRegenerateLog').onclick = () => {
    if (!_currentLogRow) return;
    const input    = _currentLogRow.raw_input  || '';
    const role     = _currentLogRow.role       || 'general';
    const taskType = _currentLogRow.task_type  || 'general';

    closeLogModal();
    if (typeof navigateTo === 'function') navigateTo('home');
    if (typeof resetToStep1 === 'function') resetToStep1();

    setTimeout(() => {
      /* 1. Pre-populate the extracted state so the chat panel mirrors
            what the normal generate flow would have collected */
      if (typeof _chatExtracted !== 'undefined') {
        _chatExtracted.role             = role;
        _chatExtracted.task_type        = taskType;
        _chatExtracted.task_description = input;
      }

      /* 2. Show the same summary bubble the agent shows after collecting info */
      if (typeof _chatAddMessage === 'function') {
        _chatAddMessage('agent',
          'Here\'s what I\'m regenerating based on your previous task:\n' +
          `• Role: ${typeof capitalize === 'function' ? capitalize(role) : role}\n` +
          `• Task Type: ${typeof capitalize === 'function' ? capitalize(taskType) : taskType}\n` +
          `• Task Description: ${input}\n\n` +
          'Click Generate below to regenerate, or type in the chat to refine.'
        );
      }

      /* 3. Show the summary bar tags (Role / Task Type chips) */
      if (typeof _chatUpdateSummary === 'function') _chatUpdateSummary();

      /* 4. Mark chat as ready + show the ready banner + enable Generate button */
      if (typeof _chatReady !== 'undefined') _chatReady = true;
      document.getElementById('chatReadyBanner')?.classList.add('visible');
      const genBtn = document.getElementById('chatGenerateBtn');
      if (genBtn) genBtn.disabled = false;
    }, 150);
  };
}

function closeLogModal() {
  const el = document.getElementById('logModal');
  el.classList.remove('open');
  // Clear the elevation flag set when opened from the Feedback Dashboard
  // (see static/js/feedback.js — fbv-open-log-btn handler). This way the
  // next regular openLogModal() call from History/Audit goes back to the
  // default z-index without leaving stale styling behind.
  el.classList.remove('fbv-log-elevated');
  // Hide the scenario-title chip on close so it doesn't flash stale text
  // for a frame when the next audit row is opened.
  const chip = document.getElementById('logModalScenarioChip');
  if (chip) {
    chip.style.display = 'none';
    chip.textContent   = '';
    chip.title         = '';
  }
}


/* ══════════════════════════════════════
   TOAST
══════════════════════════════════════ */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons     = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s, transform .3s';
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateX(20px)';
    setTimeout(() => toast.remove(), 320);
  }, 3200);
}


/* ══════════════════════════════════════
   SHARED UTILS
   (used by both app.js and ui.js)
══════════════════════════════════════ */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
         + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function updateStat(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}










function renderAuditLog(row, policyFlags, policies, editMode = false) {
  const rawInput      = row.raw_input      || '';
  const finalPrompt   = row.final_prompt   || '';
  const policySummary = row.policy_summary || '';
  const isBlocked     = row.policy_blocked === true || row.policy_blocked === 1 || row.policy_blocked === 'true';

  const viewBlock = (title, value, extraClass = '') => `
    <div class="log-section">
      <div class="log-section-title">${title}</div>
      <div class="log-value ${extraClass}">${escapeHtml(value)}</div>
    </div>
  `;

  const editBlock = (title, id, value, extraClass = '') => `
    <div class="log-section">
      <div class="log-section-title">${title}</div>
      <textarea class="log-edit-area ${extraClass}" id="${id}">${escapeHtml(value)}</textarea>
    </div>
  `;

  /* ── BLOCKED layout: just user input + block reason + metadata ── */
  if (isBlocked) {
    const blockMessage = policySummary
      || 'This request was blocked because it conflicts with one or more company policies. Please review your company\'s policy documents for guidance on what is permitted, or consult your compliance team before proceeding.';

    return `
      
      ${viewBlock('User Input', rawInput)}

      ${viewBlock('Classification', `Intent: ${capitalize(row.intent)}  |  Industry: ${capitalize(row.industry)}`)}

      <div class="log-section">
        <div class="log-section-title">Policy Status</div>
        <div style="border:1.5px solid #FCA5A5;border-radius:10px;overflow:hidden;">

          <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;background:#FEF2F2;">
            <span style="font-size:20px;flex-shrink:0;">🚫</span>
            <div>
              <div style="font-size:13px;font-weight:800;color:#991B1B;margin-bottom:2px;">Task blocked by company policy</div>
              <div style="font-size:11px;color:#B91C1C;">This request could not be completed due to a policy violation.</div>
            </div>
          </div>

          <div style="padding:14px 16px;background:#fff;border-top:1px solid #FCA5A5;">
            <div style="font-size:12px;color:#374151;line-height:1.7;">${escapeHtml(blockMessage)}</div>
          </div>

          ${policyFlags.length ? `
          <div style="padding:10px 16px 14px;background:#fff;border-top:1px solid #FEE2E2;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#9CA3AF;margin-bottom:8px;">Flags Triggered</div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${policyFlags.map(f => `
                <div style="display:flex;align-items:flex-start;gap:7px;font-size:12px;color:#991B1B;">
                  <span style="flex-shrink:0;margin-top:1px;">⚑</span>
                  <span>${escapeHtml(f)}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

        </div>
      </div>

      ${viewBlock('Metadata', `Audit ID: ${row.id}\nTimestamp: ${formatDate(row.created_at)}\nSystem Version: ${row.system_version || '—'}`)}
    `;
  }

  /* ── ALLOWED layout ── */
  return `
    
    ${editMode ? editBlock('User Input', 'editRawInput', rawInput) : viewBlock('User Input', rawInput)}

    ${viewBlock('Classification', `Intent: ${capitalize(row.intent)}  |  Industry: ${capitalize(row.industry)}`)}

    ${policyFlags.length ? viewBlock('Policy Flags', policyFlags.map(f => `⚠ ${f}`).join('\n')) : viewBlock('Recommended Tool',
      `${row.recommended_tool || '—'} (${row.tool_confidence || '—'} confidence)\n${row.tool_reason || ''}`
    )}

    ${!policyFlags.length
      ? (editMode
          ? editBlock(`CORLO Prompt (v${row.prompt_version})`, 'editFinalPrompt', finalPrompt, 'log-edit-area-lg')
          : viewBlock(`CORLO Prompt (v${row.prompt_version})`, finalPrompt, 'code'))
      : ''
    }

    ${viewBlock('Metadata', `Audit ID: ${row.id}\nTimestamp: ${formatDate(row.created_at)}\nSystem Version: ${row.system_version || '—'}`)}
  `;
}

function wireEditActions(auditId, row, policyFlags, policies) {
  const body = document.getElementById('logModalBody');
  let editMode = false;

  const rerender = () => {
    body.innerHTML = renderAuditLog(row, policyFlags, policies, editMode);
    attach();
  };

  const attach = () => {
    const btnConfirm = document.getElementById('btnLogConfirm');

    btnConfirm?.addEventListener('click', async () => {
      const newRawInput    = document.getElementById('editRawInput')?.value ?? (row.raw_input || '');
      const newFinalPrompt = document.getElementById('editFinalPrompt')?.value ?? (row.final_prompt || '');
      const newOutput      = document.getElementById('editOutput')?.value ?? (row.output || '');

      const payload = {
        raw_input: newRawInput,
        final_prompt: newFinalPrompt,
        output: newOutput,
      };

      // 1) Save locally (works even without backend changes)
      setLocalAuditEdits(auditId, payload);

      // 2) Try backend PATCH (optional; implement in routes.py)
      try {
        const r = await fetch(`${API.audit}/${auditId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        showToast('Saved successfully.', 'success');
      } catch (e) {
        showToast('Saved locally. Backend edit API not available.', 'info');
      }

      // update UI model + exit edit
      row.raw_input = newRawInput;
      row.final_prompt = newFinalPrompt;
      row.output = newOutput;

      editMode = false;
      rerender();
    });
  };

  attach();
}

function getLocalAuditEdits(auditId) {
  try {
    const all = JSON.parse(localStorage.getItem('audit_edits') || '{}');
    return all[auditId] || {};
  } catch {
    return {};
  }
}

function setLocalAuditEdits(auditId, patch) {
  try {
    const all = JSON.parse(localStorage.getItem('audit_edits') || '{}');
    all[auditId] = { ...(all[auditId] || {}), ...patch };
    localStorage.setItem('audit_edits', JSON.stringify(all));
  } catch {}
}



// ─── ADMIN RAIL HIDE / SHOW ───
function initAdminRailCollapse() {
  const rail = document.getElementById('adminRail');
  const content = document.getElementById('adminRailContent');
  const btn = document.getElementById('adminRailCollapseBtn');

  if (!rail || !content || !btn) return;

  const applyState = (hidden) => {
  document.body.classList.toggle('admin-rail-collapsed', hidden);

  content.style.display = hidden ? 'none' : '';
  rail.style.width = hidden ? '24px' : '220px';

  // ✅ ADD THIS BLOCK
  const main = document.getElementById('mainContent');
  if (main) {
    main.style.paddingLeft = hidden ? '0px' : '220px';
  }

  btn.textContent = hidden ? '»' : '‹';
  btn.title = hidden ? 'Show admin menu' : 'Hide admin menu';

  localStorage.setItem('adminRailCollapsed', hidden ? 'true' : 'false');
};

  const saved = localStorage.getItem('adminRailCollapsed') === 'true';
  applyState(saved);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const hidden = !document.body.classList.contains('admin-rail-collapsed');
    applyState(hidden);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminRailCollapse);
} else {
  initAdminRailCollapse();
}