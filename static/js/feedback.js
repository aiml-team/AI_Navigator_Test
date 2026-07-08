/* ══════════════════════════════════════════════════════════════════
   feedback.js — Feedback Form Modal + Feedback Viewer Modal
   Storage: Azure Blob Storage (metadata.json + attachments per folder)
══════════════════════════════════════════════════════════════════ */

function getLoggedInEmail() {
  try {
    return (JSON.parse(sessionStorage.getItem('navigator_session')) || {}).email || '';
  } catch {
    return '';
  }
}



(function () {
  'use strict';

  /* ═══════════════════════════════════════
     FEEDBACK FORM MODAL
  ═══════════════════════════════════════ */
  const ISSUE_TYPES = [
    'Worked Well', 'Helpful Output', 'Time Saved', 'Good Tool Recommendation', 'Wrong Tool', 'Poor Output', 'Missing Feature',
    'Slow Response', 'UI Issue', 'Other'
  ];

  const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

  let formOverlay, formModal, formBody, formSuccess;
  let selectedRating  = 0;
  let selectedIssues  = [];
  let currentAuditId  = '';
  let currentTaskSource = '';   // 'scenario_library' | 'typed' | '' — used for the badge in the modal
  let selectedFiles   = [];
  let currentScope    = 'general';  // 'general' | 'response'
  let scopeLocked     = false;       // true → dropdown disabled, response-only mode
  let generalLocked   = false;       // true → dropdown disabled, general-only mode

  function initForm() {
    formOverlay = document.getElementById('fbOverlay');
    formModal   = document.getElementById('fbFormModal');
    formBody    = document.getElementById('fbFormBody');
    formSuccess = document.getElementById('fbFormSuccess');

    if (!formModal) return;

    document.getElementById('fbCloseBtn')?.addEventListener('click', closeForm);
    formOverlay?.addEventListener('click', closeForm);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && formModal.classList.contains('open')) closeForm();
    });

    buildFormBody();
  }

  function buildFormBody(existingFeedback) {
    if (!formBody) return;
    selectedFiles  = [];
    selectedRating = existingFeedback?.rating || 0;
    selectedIssues = existingFeedback?.issue_type
      ? existingFeedback.issue_type.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Has an active response context (set by openForm before this runs)?
    const hasResponseCtx = !!currentAuditId;
    const initialScope   = currentScope || 'general';
    const existingComment = existingFeedback?.comment || '';
    const isEdit          = !!existingFeedback;
    const submitLabel     = isEdit ? 'Update Feedback' : 'Submit Feedback';

    // Three toggle-button modes:
    //   1. lockedView      — opened from a per-response button (History row,
    //                        response panel). Toggle disabled, response active.
    //   2. generalLockedView — opened from the FAB on a page with NO response
    //                        on screen. Toggle disabled, general active.
    //   3. editable        — opened from the FAB on a page WITH a response on
    //                        screen. Both buttons active, user can switch.
    const lockedView        = scopeLocked   && hasResponseCtx;
    const generalLockedView = generalLocked && !hasResponseCtx;

    // Effective active scope for the toggle (respects locks).
    let activeScope;
    if (lockedView)              activeScope = 'response';
    else if (generalLockedView)  activeScope = 'general';
    else if (hasResponseCtx)     activeScope = (initialScope === 'general') ? 'general' : 'response';
    else                         activeScope = 'general';
    // Keep the module-level currentScope in sync with what the toggle shows.
    currentScope = activeScope;

    const toggleDisabled = (lockedView || generalLockedView);
    // Show both buttons when the toggle is editable (has response ctx and no lock).
    // In locked modes we only render the one active button so the intent is unambiguous.
    const showResponseBtn = lockedView || hasResponseCtx;
    const showGeneralBtn  = generalLockedView || (!scopeLocked && hasResponseCtx) || (!hasResponseCtx && !scopeLocked);

    const scopeToggleHtml = `
      <div id="fbScopeToggle" class="fb-scope-toggle${toggleDisabled ? ' is-locked' : ''}" role="tablist" aria-label="Feedback scope">
        ${showResponseBtn ? `
          <button type="button"
                  class="fb-scope-toggle-btn${activeScope === 'response' ? ' active' : ''}"
                  data-scope="response"
                  role="tab"
                  aria-selected="${activeScope === 'response' ? 'true' : 'false'}"
                  ${toggleDisabled ? 'disabled' : ''}>
            <span class="fb-scope-toggle-label">Current Response</span>
          </button>` : ''}
        ${showGeneralBtn ? `
          <button type="button"
                  class="fb-scope-toggle-btn${activeScope === 'general' ? ' active' : ''}"
                  data-scope="general"
                  role="tab"
                  aria-selected="${activeScope === 'general' ? 'true' : 'false'}"
                  ${toggleDisabled ? 'disabled' : ''}>
            <span class="fb-scope-toggle-label">General Feedback</span>
          </button>` : ''}
      </div>
      <!-- Hidden input keeps the previous DOM contract (#fbScopeSelect) alive
           so any external code that reads the current scope from the form keeps
           working. Not used for submit — submitFeedback() reads currentScope. -->
      <input type="hidden" id="fbScopeSelect" value="${activeScope}"/>
    `;

    // Render the task-source badge for response-scope feedback so the user
    // knows whether they're reviewing a Scenario Library task or their own
    // typed task. Uses the shared helper from app.js when available.
    // NOTE: The chip row and scope-hint containers are always rendered — we
    // toggle their *visibility* (not display) when switching scopes so the
    // modal keeps a constant height and doesn't visually "jump" between
    // scope selections. See index.html .fb-scope-slot / .fb-hint-slot rules.
    const _taskSourceChipHtml = (hasResponseCtx && currentTaskSource)
      ? (typeof window._taskSourceBadge === 'function'
          ? window._taskSourceBadge(currentTaskSource)
          : `<span class="task-source-badge">${(currentTaskSource === 'scenario_library') ? 'From Library' : 'Custom Task'}</span>`)
      : '';

    // Scope-hint copy — one line per scope. Keeps the banner visible on both
    // scopes so the modal height is stable regardless of the active toggle.
    const responseHintHtml = lockedView
      ? `🔒 You're giving feedback on a specific response. To leave general feedback about the app, close this and use the floating <strong>Feedback</strong> button at the bottom-right of any page.`
      : `📌 This feedback will be attached to the response you're viewing and will appear in its history entry.`;
    const generalHintHtml = generalLockedView
      ? `🔒 You're sharing overall feedback about the app. To leave feedback on a specific response, generate or open one first, then click the <strong>Feedback</strong> button again.`
      : `🌐 This feedback is about the app overall and won't be tied to a specific response.`;

    // The chip row is only meaningful for response-scope feedback with a
    // known task_source. When it wouldn't show anything (general scope, or
    // no task_source), we still render the slot with visibility:hidden so
    // the modal height doesn't change.
    const chipRowVisible = (activeScope === 'response' && _taskSourceChipHtml);

    formBody.innerHTML = `
      <div class="fb-field">
        <label>Feedback Scope</label>
        ${scopeToggleHtml}
        <div id="fbTaskSourceChipRow" class="fb-scope-slot" style="visibility:${chipRowVisible ? 'visible' : 'hidden'};">
          <span class="fb-scope-slot-label">Task origin:</span>
          <span id="fbTaskSourceChip">${_taskSourceChipHtml || '<span class="task-source-badge task-source-own">placeholder</span>'}</span>
        </div>
        <div id="fbScopeHint" class="fb-scope-hint">
          <span id="fbScopeHintResponse" style="display:${activeScope === 'response' ? 'inline' : 'none'};">${responseHintHtml}</span>
          <span id="fbScopeHintGeneral"  style="display:${activeScope === 'general'  ? 'inline' : 'none'};">${generalHintHtml}</span>
        </div>
      </div>

      <div class="fb-field">
        <label>Email Address</label>
        <input type="email" id="fbEmail" value="${escFb(getLoggedInEmail())}" readonly/>
      </div>

      <div class="fb-field">
        <label>Rating <span style="color:#ef4444">*</span></label>
        <div class="fb-stars-row" id="fbStarsRow">
          ${[1,2,3,4,5].map(n => `<span class="fb-star${n <= selectedRating ? ' active' : ''}" data-val="${n}" role="button" aria-label="${n} star">★</span>`).join('')}
          <span class="fb-star-label" id="fbStarLabel" style="${selectedRating ? 'color:#f59e0b;' : ''}">${selectedRating ? STAR_LABELS[selectedRating] : 'Select a rating'}</span>
        </div>
      </div>

      <div class="fb-field">
        <label>Feedback Type</label>
        <div class="fb-issue-pills" id="fbIssuePills">
          ${ISSUE_TYPES.map(t => `<button class="fb-pill${selectedIssues.includes(t) ? ' selected' : ''}" data-issue="${escFb(t)}">${escFb(t)}</button>`).join('')}
        </div>
      </div>

      <div class="fb-field">
        <label>Comments</label>
        <textarea id="fbComment" placeholder="Tell us what you think — any detail helps…" maxlength="1000">${escFb(existingComment)}</textarea>
      </div>

      <div class="fb-field">
        <label>Attachments <span style="color:#64748b;font-weight:400;font-size:11px;">(screenshots, logs, any files)</span></label>
        <div class="fb-dropzone" id="fbDropzone">
          <div class="fb-dropzone-icon">📎</div>
          <div class="fb-dropzone-text">Drop files here or <span class="fb-dropzone-browse">browse</span></div>
          <div class="fb-dropzone-hint">Multiple files supported · PNG, JPG, PDF, DOCX, TXT, ZIP…</div>
          <input type="file" id="fbFileInput" multiple accept="image/*,.pdf,.doc,.docx,.txt,.log,.zip,.xlsx,.csv" style="display:none"/>
        </div>
        <div class="fb-file-preview" id="fbFilePreview"></div>
      </div>

      <div class="fb-submit-row">
        <button type="button" class="fb-btn-cancel" id="fbCancelBtn2">Cancel</button>
        <button type="button" class="fb-btn-submit" id="fbSubmitBtn" ${selectedRating ? '' : 'disabled'}>${submitLabel}</button>
      </div>
    `;

    /* Scope toggle buttons — toggles audit_id + source on submit.
       Replaces the old <select id="fbScopeSelect"> dropdown; a hidden input
       with the same id is kept in the DOM as a legacy read-only mirror. */
    const scopeHint      = formBody.querySelector('#fbScopeHint');
    const scopeHidden    = formBody.querySelector('#fbScopeSelect');
    const scopeToggleEl  = formBody.querySelector('#fbScopeToggle');
    const scopeBtns      = scopeToggleEl ? scopeToggleEl.querySelectorAll('.fb-scope-toggle-btn') : [];

    scopeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const newScope = btn.dataset.scope;
        if (!newScope || newScope === currentScope) return;
        currentScope = newScope;
        // Update visual state for both buttons.
        scopeBtns.forEach(b => {
          const isActive = b.dataset.scope === newScope;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        // Keep hidden input in sync for any legacy readers.
        if (scopeHidden) scopeHidden.value = newScope;

        // Swap the hint copy between response / general (both containers stay
        // mounted; the outer banner is always visible so the modal height is
        // stable). visibility: not display, for the same reason.
        const hintR = formBody.querySelector('#fbScopeHintResponse');
        const hintG = formBody.querySelector('#fbScopeHintGeneral');
        if (hintR) hintR.style.display = (newScope === 'response') ? 'inline' : 'none';
        if (hintG) hintG.style.display = (newScope === 'general')  ? 'inline' : 'none';

        // Toggle the task-source chip row alongside the scope switch — keep
        // the slot present via visibility:hidden so height stays constant.
        const chipRow = formBody.querySelector('#fbTaskSourceChipRow');
        if (chipRow) {
          chipRow.style.visibility = (newScope === 'response' && currentTaskSource) ? 'visible' : 'hidden';
        }

        // When switching to "response", try to pre-fill from existing feedback for this audit.
        if (newScope === 'response' && currentAuditId) {
          _prefillFromAudit(currentAuditId);
        }
      });
    });

    /* Stars */
    const stars = formBody.querySelectorAll('.fb-star');
    const label = formBody.querySelector('#fbStarLabel');
    stars.forEach(star => {
      star.addEventListener('mouseenter', () => highlightStars(stars, +star.dataset.val));
      star.addEventListener('mouseleave', () => highlightStars(stars, selectedRating));
      star.addEventListener('click', () => {
        selectedRating = +star.dataset.val;
        highlightStars(stars, selectedRating);
        label.textContent = STAR_LABELS[selectedRating];
        label.style.color = '#f59e0b';
        updateSubmitBtn();
      });
    });

    /* Feedback type pills — multi-select */
    formBody.querySelectorAll('.fb-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const val = pill.dataset.issue;
        const idx = selectedIssues.indexOf(val);
        if (idx === -1) {
          selectedIssues.push(val);
          pill.classList.add('selected');
        } else {
          selectedIssues.splice(idx, 1);
          pill.classList.remove('selected');
        }
      });
    });

    /* File upload — dropzone */
    const dropzone  = formBody.querySelector('#fbDropzone');
    const fileInput = formBody.querySelector('#fbFileInput');

    dropzone.addEventListener('click', e => {
      if (e.target === fileInput) return;
      fileInput.click();
    });

    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      addFiles(Array.from(e.dataTransfer.files));
    });

    fileInput.addEventListener('change', () => {
      addFiles(Array.from(fileInput.files));
      fileInput.value = '';
    });

    /* Cancel */
    formBody.querySelector('#fbCancelBtn2')?.addEventListener('click', closeForm);

    /* Submit */
    formBody.querySelector('#fbSubmitBtn').addEventListener('click', submitFeedback);
  }

  function addFiles(newFiles) {
    newFiles.forEach(f => {
      if (!selectedFiles.find(x => x.name === f.name && x.size === f.size)) {
        selectedFiles.push(f);
      }
    });
    renderFilePreviews();
  }

  function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFilePreviews();
  }

  function renderFilePreviews() {
    const preview = formBody?.querySelector('#fbFilePreview');
    if (!preview) return;
    if (!selectedFiles.length) { preview.innerHTML = ''; return; }

    preview.innerHTML = selectedFiles.map((f, i) => {
      const isImage = f.type.startsWith('image/');
      const icon    = isImage ? '🖼️' : fileIcon(f.name);
      const size    = formatBytes(f.size);
      return `
        <div class="fb-file-chip" data-index="${i}">
          <span class="fb-file-chip-icon">${icon}</span>
          <span class="fb-file-chip-name" title="${escFb(f.name)}">${escFb(f.name)}</span>
          <span class="fb-file-chip-size">${size}</span>
          <button class="fb-file-chip-remove" data-idx="${i}" aria-label="Remove">✕</button>
        </div>`;
    }).join('');

    preview.querySelectorAll('.fb-file-chip-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeFile(+btn.dataset.idx);
      });
    });
  }

  function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { pdf: '📄', doc: '📝', docx: '📝', txt: '📃', log: '📃', zip: '🗜️', xlsx: '📊', csv: '📊' };
    return map[ext] || '📎';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function highlightStars(stars, val) {
    stars.forEach(s => s.classList.toggle('active', +s.dataset.val <= val));
  }

  function updateSubmitBtn() {
    const btn = formBody?.querySelector('#fbSubmitBtn');
    if (btn) btn.disabled = selectedRating === 0;
  }

  function openForm(auditId, initialRating, opts) {
    // opts: { scope, existingFeedback, locked, generalLocked }
    //   scope         = 'general' | 'response'  — initial dropdown selection
    //   locked        = true → dropdown disabled, response-only mode.
    //                          Used by per-response buttons (History row, etc.).
    //   generalLocked = true → dropdown disabled, general-only mode.
    //                          Used by the FAB when no response is on screen.
    opts = opts || {};
    currentAuditId = auditId || '';
    // Seed task_source from the caller's context (typically the current
    // response on screen). The chip is refreshed once the server round-trip
    // to /api/feedback/by-audit completes with the authoritative value.
    currentTaskSource = (opts.taskSource
      || (typeof window !== 'undefined' ? (window.currentTaskSource || '') : '')
      || '').toString().toLowerCase();
    if (!formModal) return;

    // Lock the scope when explicitly requested AND we have a response to attach to.
    scopeLocked   = !!(opts.locked && currentAuditId);
    // Lock to general when explicitly requested AND we have NO response.
    generalLocked = !!(opts.generalLocked && !currentAuditId);

    // Decide initial scope:
    //   - locked → always 'response'
    //   - explicit opts.scope wins
    //   - else 'response' when we have an auditId (called from response button or history)
    //   - else 'general'
    if (scopeLocked) {
      currentScope = 'response';
    } else if (opts.scope === 'general' || opts.scope === 'response') {
      currentScope = opts.scope;
    } else {
      currentScope = currentAuditId ? 'response' : 'general';
    }

    buildFormBody(opts.existingFeedback || null);

    if (initialRating && initialRating >= 1 && initialRating <= 5) {
      selectedRating = initialRating;
      const stars = formBody.querySelectorAll('.fb-star');
      const label = formBody.querySelector('#fbStarLabel');
      highlightStars(stars, selectedRating);
      if (label) {
        label.textContent = STAR_LABELS[selectedRating];
        label.style.color = '#f59e0b';
      }
      updateSubmitBtn();
    }
    formSuccess.classList.remove('show');
    formBody.style.display = '';
    formOverlay.classList.add('open');
    formModal.classList.add('open');
    // Focus the active toggle button so keyboard users land on the scope
    // control (the old <select> used to hold focus here).
    setTimeout(() => {
      const activeBtn = formModal.querySelector('.fb-scope-toggle-btn.active:not([disabled])')
                     || formModal.querySelector('.fb-scope-toggle-btn:not([disabled])');
      activeBtn?.focus();
    }, 120);

    // If we opened in response scope and no prefill was provided, pull from server.
    if (currentScope === 'response' && currentAuditId && !opts.existingFeedback) {
      _prefillFromAudit(currentAuditId);
    }
  }

  /* Fetch any saved feedback for this audit and re-render the form pre-filled.
     Also updates the task-source chip from the authoritative audit_log value. */
  async function _prefillFromAudit(auditId) {
    try {
      const res  = await fetch(`/api/feedback/by-audit/${encodeURIComponent(auditId)}`);
      if (!res.ok) return;
      const data = await res.json();

      // Server always returns task_source (top-level) — refresh our copy.
      if (data && typeof data.task_source === 'string') {
        currentTaskSource = data.task_source.toLowerCase();
      }

      if (data?.feedback) {
        buildFormBody(data.feedback);
      } else if (currentTaskSource) {
        // No prior feedback but we did learn task_source — refresh the chip
        // by re-rendering the form (cheap; preserves current field state).
        buildFormBody(null);
      }
    } catch { /* silent */ }
  }

  function closeForm() {
    formOverlay?.classList.remove('open');
    formModal?.classList.remove('open');
    // Reset both lock flags so the next open starts from a clean slate.
    scopeLocked   = false;
    generalLocked = false;
    currentTaskSource = '';
  }

  async function submitFeedback() {
    const btn     = formBody.querySelector('#fbSubmitBtn');
    const email   = getLoggedInEmail();
    const comment = formBody.querySelector('#fbComment')?.value.trim() || '';

    if (!selectedRating) return;

    // Decide audit_id + source based on current scope.
    const auditIdToSend = currentScope === 'response' ? currentAuditId : '';
    const sourceToSend  = currentScope === 'response' ? 'response'      : 'form';

    btn.disabled    = true;
    btn.textContent = 'Submitting…';

    try {
      const fd = new FormData();
      fd.append('email',      email);
      fd.append('rating',     selectedRating);
      fd.append('comment',    comment);
      fd.append('issue_type', selectedIssues.join(', '));
      fd.append('audit_id',   auditIdToSend);
      fd.append('source',     sourceToSend);
      selectedFiles.forEach(f => fd.append('files', f, f.name));

      const res = await fetch('/api/feedback', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Server error');
      const result = await res.json();

      const _isTechnical = !!(result && result.triage && result.triage.is_technical);

      if (_isTechnical) {
        // Technical feedback needs the branching triage UI ("Same problem" /
        // "Different problem" buttons) because the user must tell us whether
        // this ties into an existing issue. Keep the existing overlay flow.
        formBody.style.display = 'none';

        // Re-submit callback — invoked when user selects "Different problem".
        const onForceNew = async () => {
          const fd2 = new FormData();
          fd2.append('email',      email);
          fd2.append('rating',     selectedRating);
          fd2.append('comment',    comment);
          fd2.append('issue_type', selectedIssues.join(', '));
          fd2.append('audit_id',   auditIdToSend);
          fd2.append('source',     sourceToSend);
          fd2.append('force_new',  'true');
          selectedFiles.forEach(f => fd2.append('files', f, f.name));
          const res2 = await fetch('/api/feedback', { method: 'POST', body: fd2 });
          if (!res2.ok) throw new Error('Server error');
          const result2 = await res2.json();
          _applyTriageMessage(formSuccess, result2.triage);
        };

        _applyTriageMessage(formSuccess, result.triage, onForceNew);
        formSuccess.classList.add('show');
        return;
      }

      // Non-technical (the common case): swap the Submit button in place with
      // a green "✓ Submitted successfully" confirmation. Keep the form on
      // screen — no overlay, no auto-close. The user closes the modal
      // manually via Cancel or the ✕ close button.
      btn.classList.add('fb-btn-submit-success');
      btn.disabled    = true;
      btn.textContent = '✓ Submitted successfully';
      // Prevent accidental re-submission: unbind the click handler by
      // cloning + swapping the node (safe idempotent).
      const _fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(_fresh, btn);
    } catch (err) {
      btn.disabled    = false;
      btn.textContent = 'Submit Feedback';
      alert('Could not submit feedback. Please try again.');
    }
  }

  function escFb(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  window.openFeedbackForm = openForm;

  /* Unified entry point: open the feedback form with optional response context.
     - auditId: when provided, the dropdown defaults to "Current Response"
     - existingFeedback: optional pre-fill (e.g. fetched from /api/feedback/by-audit)
     - locked: when true (and auditId is set), the dropdown is locked to
               "Feedback on This Response" — the user cannot switch to General.
               Use this from per-response buttons (History row, response panel).
     Falls back to "General Feedback" when no audit context is available. */
  window.openUnifiedFeedback = function (auditId, existingFeedback, locked, taskSource) {
    openForm(auditId || '', null, {
      scope: auditId ? 'response' : 'general',
      existingFeedback: existingFeedback || null,
      locked: !!locked,
      taskSource: taskSource || (existingFeedback && existingFeedback.task_source) || '',
    });
  };

  /* ── Triage success message helper (shared by both forms) ──
     onForceNew: optional async callback — called when the user chooses
     "Different problem" so the form can re-submit with force_new=true. */
  window._applyTriageMessage = function _applyTriageMessage(successEl, triage, onForceNew) {
    if (!successEl) return;
    if (!triage || !triage.is_technical) {
      // Default non-technical message
      successEl.innerHTML = `
        <div class="fb-success-icon">🎉</div>
        <div class="fb-success-title">Thank you for your feedback!</div>
        <div class="fb-success-sub">Your response has been recorded and will help us improve.</div>`;
      return;
    }

    if (triage.is_known) {
      // Ask the user whether this is the same problem or a new one.
      const isActive    = triage.status === 'in_progress';
      const statusLabel = isActive
        ? 'currently being investigated by our team'
        : 'already queued for investigation';

      successEl.innerHTML = `
        <div class="fb-success-icon">🔍</div>
        <div class="fb-success-title">Similar issue already on record</div>
        <div class="fb-success-sub" style="margin-bottom:4px;">
          The issue <strong>${escFb(triage.title)}</strong> was previously reported and is
          ${statusLabel}.<br>
          Is this the <strong>same problem</strong> you're facing, or a <strong>different one</strong>?
        </div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap;">
          <button id="fbSameProblemBtn" style="padding:9px 20px;background:#f3f4f6;color:#374151;
            border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
            ${isActive ? '🔧' : '📋'}&nbsp; Same problem — it's already tracked
          </button>
          <button id="fbDiffProblemBtn" style="padding:9px 20px;background:#2563eb;color:#fff;
            border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
            ➕&nbsp; Different problem — log separately
          </button>
        </div>`;

      // "Same problem" → show the appropriate status message, no re-submit needed.
      document.getElementById('fbSameProblemBtn')?.addEventListener('click', () => {
        if (isActive) {
          successEl.innerHTML = `
            <div class="fb-success-icon">🔧</div>
            <div class="fb-success-title">Already being investigated!</div>
            <div class="fb-success-sub">
              This issue (<strong>${escFb(triage.title)}</strong>) has already been reported and our
              team is actively working on it. We'll update you once it's resolved — no further
              action needed from you.
            </div>`;
        } else {
          successEl.innerHTML = `
            <div class="fb-success-icon">📋</div>
            <div class="fb-success-title">Got it — we've noted your report!</div>
            <div class="fb-success-sub">
              This issue (<strong>${escFb(triage.title)}</strong>) is already in our queue.
              We've recorded your report and will notify you when it's resolved.
            </div>`;
        }
      });

      // "Different problem" → re-submit as a brand-new issue.
      document.getElementById('fbDiffProblemBtn')?.addEventListener('click', async () => {
        const diffBtn = document.getElementById('fbDiffProblemBtn');
        const sameBtn = document.getElementById('fbSameProblemBtn');
        if (diffBtn) { diffBtn.disabled = true; diffBtn.textContent = 'Submitting…'; }
        if (sameBtn) sameBtn.disabled = true;
        if (onForceNew) {
          try {
            await onForceNew();
          } catch {
            if (diffBtn) { diffBtn.disabled = false; diffBtn.innerHTML = '➕&nbsp; Different problem — log separately'; }
            if (sameBtn) sameBtn.disabled = false;
          }
        }
      });
      return;
    }

    // New technical issue
    successEl.innerHTML = `
      <div class="fb-success-icon">⚠️</div>
      <div class="fb-success-title">Technical issue logged!</div>
      <div class="fb-success-sub">
        Your feedback has been flagged as a technical issue
        (<strong>${escFb(triage.category)}</strong>) and our team has been notified immediately.
        We'll investigate and keep you updated.
      </div>`;
  };


  /* ═══════════════════════════════════════
     RESPONSE FEEDBACK MODAL
     Lightweight, response-specific form:
     comment + feedback type, no star rating.
  ═══════════════════════════════════════ */
  let rfOverlay, rfModal, rfBody, rfSuccess;
  let rfSelectedIssues = [];
  let rfAuditId        = '';

  function initResponseForm() {
    rfOverlay = document.getElementById('rfOverlay');
    rfModal   = document.getElementById('rfModal');
    rfBody    = document.getElementById('rfFormBody');
    rfSuccess = document.getElementById('rfFormSuccess');

    if (!rfModal) return;

    document.getElementById('rfCloseBtn')?.addEventListener('click', closeResponseForm);
    rfOverlay?.addEventListener('click', closeResponseForm);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && rfModal?.classList.contains('open')) closeResponseForm();
    });
  }

  function buildResponseFormBody(existingFeedback) {
    if (!rfBody) return;
    rfSelectedIssues = existingFeedback?.issue_type
      ? existingFeedback.issue_type.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const existingComment = existingFeedback?.comment || '';
    const isEdit          = !!existingFeedback;

    rfBody.innerHTML = `
      <div class="fb-field">
        <label>Feedback Type</label>
        <div class="fb-issue-pills" id="rfIssuePills">
          ${ISSUE_TYPES.map(t => `<button class="fb-pill${rfSelectedIssues.includes(t) ? ' selected' : ''}" data-issue="${escFb(t)}">${escFb(t)}</button>`).join('')}
        </div>
      </div>

      <div class="fb-field">
        <label>Comments</label>
        <textarea id="rfComment" placeholder="Tell us about this specific response…" maxlength="1000">${escFb(existingComment)}</textarea>
      </div>

      <div class="fb-submit-row">
        <button class="fb-btn-cancel" id="rfCancelBtn">Cancel</button>
        <button class="fb-btn-submit" id="rfSubmitBtn">${isEdit ? 'Update Feedback' : 'Submit Feedback'}</button>
      </div>
    `;

    rfBody.querySelectorAll('.fb-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const val = pill.dataset.issue;
        const idx = rfSelectedIssues.indexOf(val);
        if (idx === -1) {
          rfSelectedIssues.push(val);
          pill.classList.add('selected');
        } else {
          rfSelectedIssues.splice(idx, 1);
          pill.classList.remove('selected');
        }
      });
    });

    rfBody.querySelector('#rfCancelBtn')?.addEventListener('click', closeResponseForm);
    rfBody.querySelector('#rfSubmitBtn').addEventListener('click', submitResponseFeedback);
  }

  function openResponseForm(auditId, existingFeedback) {
    rfAuditId = auditId || '';
    if (!rfModal) return;
    buildResponseFormBody(existingFeedback || null);
    rfSuccess.classList.remove('show');
    rfBody.style.display = '';
    rfOverlay.classList.add('open');
    rfModal.classList.add('open');
    setTimeout(() => rfModal.querySelector('#rfComment')?.focus(), 120);
  }

  function closeResponseForm() {
    rfOverlay?.classList.remove('open');
    rfModal?.classList.remove('open');
  }

  async function submitResponseFeedback() {
    const btn     = rfBody.querySelector('#rfSubmitBtn');
    const email   = getLoggedInEmail();
    const comment = rfBody.querySelector('#rfComment')?.value.trim() || '';

    btn.disabled    = true;
    btn.textContent = 'Submitting…';

    try {
      const fd = new FormData();
      fd.append('email',      email);
      fd.append('rating',     0);
      fd.append('comment',    comment);
      fd.append('issue_type', rfSelectedIssues.join(', '));
      fd.append('audit_id',   rfAuditId);
      fd.append('source',     'response');

      const res = await fetch('/api/feedback', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Server error');
      const result = await res.json();

      rfBody.style.display = 'none';
      _applyTriageMessage(rfSuccess, result.triage);
      rfSuccess.classList.add('show');
    } catch (err) {
      btn.disabled    = false;
      btn.textContent = 'Submit Feedback';
      alert('Could not submit feedback. Please try again.');
    }
  }

  window.openResponseFeedbackForm = openResponseForm;


  /* ═══════════════════════════════════════
     FEEDBACK VIEWER MODAL
  ═══════════════════════════════════════ */
  let viewerOverlay, viewerModal, viewerBody;
  // 30 rows per page — mirrors the History view's HISTORY_PER_PAGE constant
  // (defined in app.js) so both dashboards page at the same rate.
  let vPage = 1, vPerPage = 30, vTotal = 0;
  let vRating = 0, vSearch = '', vLoading = false;
  let vPeriod = 'week', vStartDate = '', vEndDate = '';

  function _fbvFmtDate(d) { return d.toISOString().slice(0, 10); }

  function _fbvDateRange() {
    const now   = new Date();
    const today = _fbvFmtDate(now);
    if (vPeriod === 'day')   return { start: today, end: today };
    if (vPeriod === 'week')  { const d = new Date(now); d.setDate(d.getDate() - 7);  return { start: _fbvFmtDate(d), end: today }; }
    if (vPeriod === 'month') { const d = new Date(now); d.setDate(d.getDate() - 30); return { start: _fbvFmtDate(d), end: today }; }
    if (vPeriod === 'custom') return { start: vStartDate, end: vEndDate };
    return { start: '', end: '' };
  }

  function initViewer() {
    viewerOverlay = document.getElementById('fbvOverlay');
    viewerModal   = document.getElementById('fbvModal');
    viewerBody    = document.getElementById('fbvBody');

    if (!viewerModal) return;

    /* Set default custom date range inputs */
    const today = new Date();
    const week  = new Date(today); week.setDate(today.getDate() - 7);
    const sd = document.getElementById('fbvStartDate');
    const ed = document.getElementById('fbvEndDate');
    if (sd) sd.value = _fbvFmtDate(week);
    if (ed) ed.value = _fbvFmtDate(today);

    document.getElementById('fbvCloseBtn')?.addEventListener('click', closeViewer);
    viewerOverlay?.addEventListener('click', closeViewer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && viewerModal.classList.contains('open')) closeViewer();
    });

    /* Period tabs */
    document.querySelectorAll('.fbv-period-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.fbv-period-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        vPeriod = tab.dataset.period;
        const box = document.getElementById('fbvDateRangeBox');
        if (box) box.style.display = vPeriod === 'custom' ? 'flex' : 'none';
        if (vPeriod !== 'custom') { vPage = 1; fetchFeedbacks(); }
      });
    });

    /* Apply custom range */
    document.getElementById('fbvApplyRange')?.addEventListener('click', () => {
      vStartDate = document.getElementById('fbvStartDate')?.value || '';
      vEndDate   = document.getElementById('fbvEndDate')?.value   || '';
      if (!vStartDate || !vEndDate) { alert('Please select both a start and end date.'); return; }
      if (vStartDate > vEndDate)    { alert('Start date must be before end date.');       return; }
      vPage = 1; fetchFeedbacks();
    });

    document.getElementById('fbvRefreshBtn')?.addEventListener('click', () => {
      vPage = 1; fetchFeedbacks();
    });
    document.getElementById('fbvRatingFilter')?.addEventListener('change', e => {
      vRating = +e.target.value; vPage = 1; fetchFeedbacks();
    });

    let searchTimer;
    document.getElementById('fbvSearch')?.addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { vSearch = e.target.value; vPage = 1; fetchFeedbacks(); }, 350);
    });

    document.getElementById('dropFeedbackView')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('menuDrawer')?.classList.remove('open');
      document.getElementById('menuDrawerOverlay')?.classList.remove('open');
      openViewer();
    });

    document.getElementById('sidebarFeedbackView')?.addEventListener('click', openViewer);
  }

function openViewer() {
  if (!viewerModal) return;
  vPage = 1; vRating = 0; vSearch = ''; vPeriod = 'week'; vStartDate = ''; vEndDate = '';
  document.querySelectorAll('.fbv-period-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.fbv-period-tab[data-period="week"]')?.classList.add('active');
  const box = document.getElementById('fbvDateRangeBox');
  if (box) box.style.display = 'none';
  const rf = document.getElementById('fbvRatingFilter');
  const sr = document.getElementById('fbvSearch');
  if (rf) rf.value = '0';
  if (sr) sr.value = '';
  viewerOverlay.classList.add('open');
  viewerModal.classList.add('open');
  fetchFeedbacks();
}

  function closeViewer() {
    viewerOverlay?.classList.remove('open');
    viewerModal?.classList.remove('open');
    closeAttachmentViewer();
  }

  async function fetchFeedbacks() {
    if (vLoading) return;
    vLoading = true;
    showViewerLoading();
    try {
      const range  = _fbvDateRange();
      const params = new URLSearchParams({
        page: vPage, per_page: vPerPage, rating: vRating, search: vSearch,
        start_date: range.start, end_date: range.end,
      });
      const res  = await fetch(`/api/feedback-list?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      vTotal = data.total;
      renderViewer(data);

      // Sync the Download CSV anchor with the current filter (skip page/per_page
      // — export gives admins the whole filtered set, not a single page).
      const dl = document.getElementById('fbvDownloadBtn');
      if (dl) {
        const dlParams = new URLSearchParams({
          rating: vRating, search: vSearch,
          start_date: range.start, end_date: range.end,
        });
        dl.href = `/api/export/feedback.csv?${dlParams.toString()}`;
      }
    } catch (err) {
      viewerBody.innerHTML = `<div class="fbv-empty"><div class="fbv-empty-icon">⚠️</div>Could not load feedback: ${escFbv(err.message)}</div>`;
    } finally {
      vLoading = false;
    }
  }

  function showViewerLoading() {
    if (!viewerBody) return;
    viewerBody.innerHTML = `
      <div class="fbv-loading">
        <div class="fbv-spinner"></div>
        <span>Loading feedback…</span>
      </div>`;
  }

  function renderViewer(data) {
    if (!viewerBody) return;

    const avg   = data.avg_rating;
    const dist  = data.distribution || [];
    const rows  = data.feedbacks    || [];
    const total = data.total        || 0;
    const maxDistCount = Math.max(...dist.map(d => d.count), 1);

    const kpiHtml = `
      <div class="fbv-kpi-row">
        <div class="fbv-kpi">
          <div class="fbv-kpi-label">Total Feedback Items</div>
          <div class="fbv-kpi-value">${total}</div>
          <div class="fbv-kpi-sub">all time</div>
        </div>
        <div class="fbv-kpi">
          <div class="fbv-kpi-label">Average Rating</div>
          <div class="fbv-kpi-value" style="color:#f59e0b;">${avg ? avg.toFixed(1) : '—'}</div>
          <div class="fbv-kpi-sub">out of 5 Stars</div>
        </div>
        <div class="fbv-kpi">
          <div class="fbv-kpi-label">5-Star Ratings</div>
          <div class="fbv-kpi-value" style="color:#10b981;">${dist.find(d => d.rating === 5)?.count || 0}</div>
          <div class="fbv-kpi-sub">excellent ratings</div>
        </div>
        <div class="fbv-kpi">
          <div class="fbv-kpi-label">Low Ratings (≤2 Stars)</div>
          <div class="fbv-kpi-value" style="color:#ef4444;">${dist.filter(d => d.rating <= 2).reduce((s, d) => s + d.count, 0)}</div>
          <div class="fbv-kpi-sub">need attention</div>
        </div>
      </div>`;

    const distHtml = `
      <div class="fbv-dist-card">
        <div class="fbv-dist-title">Rating Distribution</div>
        ${[5,4,3,2,1].map(r => {
          const item  = dist.find(d => d.rating === r);
          const count = item ? item.count : 0;
          const pct   = Math.round(count / maxDistCount * 100);
          return `
            <div class="fbv-dist-row">
              <span class="fbv-dist-star">${r} ★</span>
              <div class="fbv-dist-track"><div class="fbv-dist-fill" style="width:${pct}%;background:${r >= 4 ? '#10b981' : r === 3 ? '#f59e0b' : '#ef4444'};"></div></div>
              <span class="fbv-dist-count">${count}</span>
            </div>`;
        }).join('')}
      </div>`;

    const totalPages = data.pages || Math.ceil(total / vPerPage) || 1;
    const periodLabel = _fbvPeriodLabel();

    let tableHtml;
    if (!rows.length) {
      tableHtml = `<div class="fbv-table-card"><div class="fbv-empty"><div class="fbv-empty-icon">📭</div>No feedback found for ${escFbv(periodLabel)}</div></div>`;
    } else {
      tableHtml = `
        <div class="fbv-table-card">
          <div class="fbv-table-header">
            <span class="fbv-table-title">Feedback Items — ${escFbv(periodLabel)}</span>
            <span class="fbv-table-count">Showing ${((vPage - 1) * vPerPage) + 1}–${Math.min(vPage * vPerPage, total)} of ${total}</span>
          </div>
          <div style="overflow-x:auto;">
            <table class="fbv-table">
              <thead>
                <tr>
                  <th>Rating</th>
                  <th>Email</th>
                  <th>Task Source</th>
                  <th>Issue Type</th>
                  <th>Comment</th>
                  <th>Files</th>
                  <th>Date</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => {
                  // Response-specific feedbacks have an audit_id linking them
                  // to a generation in the audit_log table. General/overall
                  // app feedback has no audit_id — we leave the Response cell
                  // empty for those rows (per requirement).
                  const auditId = r.audit_id || '';
                  const openCell = auditId
                    ? `<button class="fbv-open-log-btn" data-audit="${escFbv(auditId)}" title="View the response this feedback was given on">Open</button>`
                    : '<span style="color:#d1d5db;">—</span>';

                  // Task source cell — only meaningful for response-specific
                  // feedback (has an audit_id) AND when task_source was
                  // captured at run time. Historical rows have an empty
                  // task_source; those (and general feedback) show an em-dash.
                  const taskSrc = (r.task_source || '').toLowerCase();
                  const _badgeHtml = (auditId && typeof window._taskSourceBadge === 'function')
                    ? window._taskSourceBadge(taskSrc)
                    : '';
                  const taskSourceCell = _badgeHtml
                    ? _badgeHtml
                    : '<span style="color:#d1d5db;">—</span>';

                  return `
                  <tr>
                    <td><span class="fbv-stars-display">${renderStars(r.rating)}</span></td>
                    <td style="font-size:12.5px;color:#374151;">${escFbv(r.email || '—')}</td>
                    <td>${taskSourceCell}</td>
                    <td>${r.issue_type ? `<span class="fbv-issue-pill">${escFbv(r.issue_type)}</span>` : '<span style="color:#d1d5db;">—</span>'}</td>
                    <td><div class="fbv-comment-text">${escFbv(r.comment || '—')}</div></td>
                    <td>
                      ${r.files && r.files.length
                        ? `<button class="fbv-view-files-btn" data-id="${escFbv(r.id)}" data-count="${r.files.length}">
                             📎 ${r.files.length} file${r.files.length > 1 ? 's' : ''}
                           </button>`
                        : '<span style="color:#d1d5db;">—</span>'}
                    </td>
                    <td class="fbv-date-cell">${fmtDate(r.created_at)}</td>
                    <td>${openCell}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          <div class="fbv-pagination">
            <button class="fbv-page-btn" id="fbvPrevBtn" ${vPage <= 1 ? 'disabled' : ''}>← Prev</button>
            <span class="fbv-page-info">Page ${vPage} of ${totalPages}</span>
            <button class="fbv-page-btn" id="fbvNextBtn" ${vPage >= totalPages ? 'disabled' : ''}>Next →</button>
          </div>
        </div>`;
    }

    viewerBody.innerHTML = kpiHtml + distHtml + tableHtml;

    const prevBtn = viewerBody.querySelector('#fbvPrevBtn');
    const nextBtn = viewerBody.querySelector('#fbvNextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => { vPage--; fetchFeedbacks(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { vPage++; fetchFeedbacks(); });

    viewerBody.querySelectorAll('.fbv-view-files-btn').forEach(btn => {
      btn.addEventListener('click', () => openAttachmentViewer(btn.dataset.id));
    });

    /* "Open" button — only present on response-specific feedback rows.
       Reuses the same openLogModal() the History "View" button uses, so
       the admin sees the exact same audit log + saved feedback panel.
       The Feedback Dashboard is intentionally LEFT OPEN behind the log
       modal so the admin returns to it when they close the log — they
       were browsing feedback rows, not navigating away from the page.
       We lift the log modal above the dashboard via a CSS class so it
       isn't hidden underneath (the dashboard sits at a very high z-index). */
    viewerBody.querySelectorAll('.fbv-open-log-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const auditId = btn.dataset.audit;
        if (!auditId) return;
        const logModalEl = document.getElementById('logModal');
        if (logModalEl) logModalEl.classList.add('fbv-log-elevated');
        if (typeof window.openLogModal === 'function') {
          window.openLogModal(auditId);
        } else if (typeof openLogModal === 'function') {
          openLogModal(auditId);
        }
      });
    });
  }

  function _fbvPeriodLabel() {
    if (vPeriod === 'day')    return 'Today';
    if (vPeriod === 'week')   return 'This Week';
    if (vPeriod === 'month')  return 'This Month';
    if (vPeriod === 'custom' && vStartDate && vEndDate) return `${vStartDate} → ${vEndDate}`;
    return 'All Time';
  }

  /* ── Attachment Viewer ── */
  function openAttachmentViewer(feedbackId) {
    let panel = document.getElementById('fbvAttachPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'fbvAttachPanel';
      panel.className = 'fbv-attach-panel';
      panel.innerHTML = `
        <div class="fbv-attach-header">
          <span class="fbv-attach-title">📎 Attachments</span>
          <button class="fbv-attach-close" id="fbvAttachClose">✕</button>
        </div>
        <div class="fbv-attach-body" id="fbvAttachBody">
          <div class="fbv-loading"><div class="fbv-spinner"></div><span>Loading…</span></div>
        </div>`;
      document.getElementById('fbvModal')?.appendChild(panel);
      document.getElementById('fbvAttachClose')?.addEventListener('click', closeAttachmentViewer);
    }
    panel.classList.add('open');

    fetch(`/api/feedback-attachments/${encodeURIComponent(feedbackId)}`)
      .then(r => r.json())
      .then(data => {
        const body = document.getElementById('fbvAttachBody');
        if (!body) return;
        const files = data.files || [];
        if (!files.length) {
          body.innerHTML = `<div class="fbv-attach-empty">No attachments found</div>`;
          return;
        }
        body.innerHTML = files.map(f => {
          const isImage = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(f.name);
          if (isImage) {
            return `
              <div class="fbv-attach-item">
                <a href="${escFbv(f.url)}" target="_blank" rel="noopener">
                  <img src="${escFbv(f.url)}" alt="${escFbv(f.name)}" class="fbv-attach-img" loading="lazy"/>
                </a>
                <div class="fbv-attach-name">${escFbv(f.name)}</div>
              </div>`;
          }
          return `
            <div class="fbv-attach-item fbv-attach-file">
              <a href="${escFbv(f.url)}" target="_blank" rel="noopener" class="fbv-attach-dl">
                <span class="fbv-attach-file-icon">${fileIconFromName(f.name)}</span>
                <span class="fbv-attach-file-name">${escFbv(f.name)}</span>
                <span class="fbv-attach-dl-arrow">↓ Download</span>
              </a>
            </div>`;
        }).join('');
      })
      .catch(() => {
        const body = document.getElementById('fbvAttachBody');
        if (body) body.innerHTML = `<div class="fbv-attach-empty">Failed to load attachments</div>`;
      });
  }

  function closeAttachmentViewer() {
    document.getElementById('fbvAttachPanel')?.classList.remove('open');
  }

  function fileIconFromName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = { pdf: '📄', doc: '📝', docx: '📝', txt: '📃', log: '📃', zip: '🗜️', xlsx: '📊', csv: '📊' };
    return map[ext] || '📎';
  }

  function renderStars(rating) {
    return [1,2,3,4,5].map(i =>
      `<span class="${i <= rating ? '' : 'empty'}">★</span>`
    ).join('');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
             + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }

  function escFbv(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  window.openFeedbackViewer = openViewer;


  /* ── Boot ── */
  function boot() {
    initForm();
    initResponseForm();
    initViewer();

    document.querySelectorAll('.fb-open-form-trigger').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        // Smart default + locking rules for the FAB:
        //   • Response on screen → default to "Current Response", with
        //     "General Feedback" as the secondary option. Dropdown EDITABLE
        //     so the user can switch to General if they want to.
        //   • No response       → default to "General Feedback".
        //     Dropdown LOCKED — there's no response to attach to, so the
        //     user shouldn't see a switchable choice.
        const ctxAudit = (typeof window !== 'undefined' && window.currentAuditId) || '';
        if (ctxAudit) {
          openForm(ctxAudit, null, { scope: 'response' });
        } else {
          openForm('', null, { scope: 'general', generalLocked: true });
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
