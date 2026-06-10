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
    'Worked Well', 'Helpful Output', 'Saved Time', 'Good Tool Recommendation', 'Wrong Tool', 'Poor Output', 'Missing Feature',
    'Slow Response', 'UI Issue', 'Other'
  ];

  const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

  let formOverlay, formModal, formBody, formSuccess;
  let selectedRating  = 0;
  let selectedIssues  = [];
  let currentAuditId  = '';
  let selectedFiles   = [];

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

  function buildFormBody() {
    if (!formBody) return;
    selectedFiles  = [];
    selectedRating = 0;
    selectedIssues = [];

    formBody.innerHTML = `
      <div class="fb-field">
        <label>Email Address</label>
        <input type="email" id="fbEmail" value="${escFb(getLoggedInEmail())}" readonly/>
      </div>

      <div class="fb-field">
        <label>Rating <span style="color:#ef4444">*</span></label>
        <div class="fb-stars-row" id="fbStarsRow">
          ${[1,2,3,4,5].map(n => `<span class="fb-star" data-val="${n}" role="button" aria-label="${n} star">★</span>`).join('')}
          <span class="fb-star-label" id="fbStarLabel">Select a rating</span>
        </div>
      </div>

      <div class="fb-field">
        <label>Feedback Type</label>
        <div class="fb-issue-pills" id="fbIssuePills">
          ${ISSUE_TYPES.map(t => `<button class="fb-pill" data-issue="${escFb(t)}">${escFb(t)}</button>`).join('')}
        </div>
      </div>

      <div class="fb-field">
        <label>Comments</label>
        <textarea id="fbComment" placeholder="Tell us what you think — any detail helps…" maxlength="1000"></textarea>
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
        <button class="fb-btn-cancel" id="fbCancelBtn2">Cancel</button>
        <button class="fb-btn-submit" id="fbSubmitBtn" disabled>Submit Feedback</button>
      </div>
    `;

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

  function openForm(auditId, initialRating) {
    currentAuditId = auditId || '';
    if (!formModal) return;
    buildFormBody();
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
    setTimeout(() => formModal.querySelector('#fbEmail')?.focus(), 120);
  }

  function closeForm() {
    formOverlay?.classList.remove('open');
    formModal?.classList.remove('open');
  }

  async function submitFeedback() {
    const btn     = formBody.querySelector('#fbSubmitBtn');
    const email   = getLoggedInEmail();
    const comment = formBody.querySelector('#fbComment')?.value.trim() || '';

    if (!selectedRating) return;

    btn.disabled    = true;
    btn.textContent = 'Submitting…';

    try {
      const fd = new FormData();
      fd.append('email',      email);
      fd.append('rating',     selectedRating);
      fd.append('comment',    comment);
      fd.append('issue_type', selectedIssues.join(', '));
      fd.append('audit_id',   currentAuditId);
      fd.append('source',     'form');
      selectedFiles.forEach(f => fd.append('files', f, f.name));

      const res = await fetch('/api/feedback', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Server error');

      formBody.style.display = 'none';
      formSuccess.classList.add('show');
      setTimeout(closeForm, 2200);
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

      rfBody.style.display = 'none';
      rfSuccess.classList.add('show');
      setTimeout(closeResponseForm, 2200);
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
  let vPage = 1, vPerPage = 5, vTotal = 0;
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
      viewerBody.innerHTML = `<div class="fbv-empty"><div class="fbv-empty-icon">⚠️</div>Could not load feedbacks: ${escFbv(err.message)}</div>`;
    } finally {
      vLoading = false;
    }
  }

  function showViewerLoading() {
    if (!viewerBody) return;
    viewerBody.innerHTML = `
      <div class="fbv-loading">
        <div class="fbv-spinner"></div>
        <span>Loading feedbacks…</span>
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
          <div class="fbv-kpi-label">Total Feedbacks</div>
          <div class="fbv-kpi-value">${total}</div>
          <div class="fbv-kpi-sub">all time</div>
        </div>
        <div class="fbv-kpi">
          <div class="fbv-kpi-label">Avg Rating</div>
          <div class="fbv-kpi-value" style="color:#f59e0b;">${avg ? avg.toFixed(1) : '—'}</div>
          <div class="fbv-kpi-sub">out of 5 ★</div>
        </div>
        <div class="fbv-kpi">
          <div class="fbv-kpi-label">5-Star Reviews</div>
          <div class="fbv-kpi-value" style="color:#10b981;">${dist.find(d => d.rating === 5)?.count || 0}</div>
          <div class="fbv-kpi-sub">excellent ratings</div>
        </div>
        <div class="fbv-kpi">
          <div class="fbv-kpi-label">Low Ratings (≤2)</div>
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
      tableHtml = `<div class="fbv-table-card"><div class="fbv-empty"><div class="fbv-empty-icon">📭</div>No feedbacks found for ${escFbv(periodLabel)}</div></div>`;
    } else {
      tableHtml = `
        <div class="fbv-table-card">
          <div class="fbv-table-header">
            <span class="fbv-table-title">Feedbacks — ${escFbv(periodLabel)}</span>
            <span class="fbv-table-count">Showing ${((vPage - 1) * vPerPage) + 1}–${Math.min(vPage * vPerPage, total)} of ${total}</span>
          </div>
          <div style="overflow-x:auto;">
            <table class="fbv-table">
              <thead>
                <tr>
                  <th>Rating</th>
                  <th>Email</th>
                  <th>Issue Type</th>
                  <th>Comment</th>
                  <th>Files</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td><span class="fbv-stars-display">${renderStars(r.rating)}</span></td>
                    <td style="font-size:12.5px;color:#374151;">${escFbv(r.email || '—')}</td>
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
                  </tr>`).join('')}
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
      el.addEventListener('click', e => { e.preventDefault(); openForm(''); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
