/* ══════════════════════════════════════════════════════
   fileupload.js — Header dropdown toggle + File Upload modal
══════════════════════════════════════════════════════ */

(function () {

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('hdrDropdown')?.classList.remove('open');
  });

})();

/* ══════════════════════════════════════════════════════
   Policy Upload Modal — triggered from header dropdown
══════════════════════════════════════════════════════ */
(function () {
  const dropPolicyUpload = document.getElementById('dropPolicyUpload');
  const dropdown         = document.getElementById('hdrDropdown');

  const puOverlay   = document.getElementById('puOverlay');
  const puModal     = document.getElementById('puModal');
  const puCloseBtn  = document.getElementById('puCloseBtn');
  const puCancelBtn = document.getElementById('puCancelBtn');
  const puDropZone  = document.getElementById('puDropZone');
  const puFileInput = document.getElementById('puFileInput');
  const puFileInfo  = document.getElementById('puFileInfo');
  const puFileName  = document.getElementById('puFileName');
  const puClearBtn  = document.getElementById('puClearBtn');
  const puUploadBtn = document.getElementById('puUploadBtn');
  const puStatus    = document.getElementById('puStatus');

  let selectedPolicyFile = null;
  let puUploading        = false;
  let puAbortCtrl        = null;

  function openPuModal() {
    puOverlay.classList.add('open');
    puModal.classList.add('open');
  }

  function closePuModal() {
    if (puUploading && puAbortCtrl) {
      puAbortCtrl.abort();
      puUploading = false;
    }
    puOverlay.classList.remove('open');
    puModal.classList.remove('open');
    resetPuModal();
  }

  function resetPuModal() {
    selectedPolicyFile        = null;
    puUploading               = false;
    puAbortCtrl               = null;
    puFileInput.value         = '';
    puFileInfo.style.display  = 'none';
    puDropZone.style.display  = '';
    puUploadBtn.disabled      = true;
    puUploadBtn.textContent   = 'Upload & Index';
    puCancelBtn.textContent   = 'Cancel';
    puStatus.style.display    = 'none';
    puStatus.className        = 'fu-status';
    puStatus.textContent      = '';
    const viewBtn = document.getElementById('puViewFilesBtn');
    if (viewBtn) viewBtn.remove();
  }

  function setPolicyFile(file) {
    const allowed = ['.pdf', '.docx'];
    const ext     = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) {
      showPuStatus('Please select a .pdf or .docx file.', 'error');
      return;
    }
    selectedPolicyFile           = file;
    puFileName.textContent       = file.name;
    puFileInfo.style.display     = 'flex';
    puDropZone.style.display     = 'none';
    puUploadBtn.disabled         = false;
    puStatus.style.display       = 'none';
  }

  function showPuStatus(msg, type) {
    puStatus.textContent   = msg;
    puStatus.className     = `fu-status ${type}`;
    puStatus.style.display = 'block';
  }

  // Open from dropdown
  if (dropPolicyUpload) {
    dropPolicyUpload.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('menuDrawer')?.classList.remove('open');
      document.getElementById('menuDrawerOverlay')?.classList.remove('open');
      openPuModal();
    });
  }

  puCloseBtn?.addEventListener('click',  closePuModal);
  puCancelBtn?.addEventListener('click', closePuModal);
  puOverlay?.addEventListener('click',   closePuModal);

  puDropZone?.addEventListener('click', () => puFileInput.click());
  puFileInput?.addEventListener('change', e => {
    if (e.target.files[0]) setPolicyFile(e.target.files[0]);
  });

  puClearBtn?.addEventListener('click', () => {
    resetPuModal();
    puDropZone.style.display = '';
  });

  puDropZone?.addEventListener('dragover', e => {
    e.preventDefault();
    puDropZone.classList.add('dragover');
  });
  puDropZone?.addEventListener('dragleave', () => puDropZone.classList.remove('dragover'));
  puDropZone?.addEventListener('drop', e => {
    e.preventDefault();
    puDropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) setPolicyFile(e.dataTransfer.files[0]);
  });

  /* ── Upload ── */
  puUploadBtn?.addEventListener('click', async () => {
    if (!selectedPolicyFile) return;

    puUploading             = true;
    puAbortCtrl             = new AbortController();
    puUploadBtn.disabled    = true;
    puUploadBtn.textContent = 'Uploading…';
    puCancelBtn.textContent = 'Stop Upload';
    puStatus.style.display  = 'none';

    const formData = new FormData();
    formData.append('file', selectedPolicyFile);

    try {
      const res  = await fetch('/api/upload-policy', {
        method: 'POST',
        body:   formData,
        signal: puAbortCtrl.signal,
      });
      const data = await res.json();

      puUploading             = false;
      puCancelBtn.textContent = 'Cancel';

      if (res.ok && data.status === 'ok') {
        showPuStatus(
          `✅ "${data.filename}" indexed successfully (${data.chunks_indexed} chunks).`,
          'success'
        );
        puUploadBtn.textContent = 'Upload & Index';
        if (typeof loadPolicies === 'function') loadPolicies();
        if (typeof loadSidebarStats === 'function') loadSidebarStats();

        const footer = puModal.querySelector('.fu-modal-footer');
        if (footer && !document.getElementById('puViewFilesBtn')) {
          const viewBtn = document.createElement('button');
          viewBtn.id = 'puViewFilesBtn';
          viewBtn.className = 'fu-upload-btn';
          viewBtn.style.background = '#10B981';
          viewBtn.textContent = '👁 View Policies';
          viewBtn.addEventListener('click', () => {
            closePuModal();
            if (typeof navigateTo === 'function') navigateTo('policies');
          });
          footer.insertBefore(viewBtn, footer.querySelector('.fu-upload-btn'));
        }

        setTimeout(() => { closePuModal(); }, 1800);
      } else {
        throw new Error(data.detail || 'Upload failed');
      }
    } catch (err) {
      puUploading             = false;
      puCancelBtn.textContent = 'Cancel';
      if (err.name === 'AbortError') {
        showPuStatus('⛔ Upload cancelled.', 'error');
        puUploadBtn.disabled    = false;
        puUploadBtn.textContent = 'Upload & Index';
      } else {
        showPuStatus(`❌ ${err.message}`, 'error');
        puUploadBtn.disabled    = false;
        puUploadBtn.textContent = 'Upload & Index';
      }
    }
  });

})();