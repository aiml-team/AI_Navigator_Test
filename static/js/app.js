/* ══════════════════════════════════════════════════════
   app.js — API config, state, home page / generate,
             render result, refine, feedback, history,
             tools, analytics, policies, sidebar stats
══════════════════════════════════════════════════════ */

window._explIdCounter = 0;


/* ══════════════════════════════════════
   API ENDPOINTS
══════════════════════════════════════ */
const API = {
  run:                '/api/run',
  clarify:            '/api/clarify',
  clarifyMerge:       '/api/clarify-merge',
  refine:             '/api/refine',
  feedback:           '/api/feedback',
  audit:              '/api/audit',
  analytics:          '/api/analytics',
  tools:              '/api/tools',
  toolsRegister:      '/api/tools/register',
  toolsExtract:       '/api/tools/extract-files',
  toolsRegistered:    '/api/tools/registered',
  toolsDelete:        (id) => `/api/tools/registered/${encodeURIComponent(id)}`,
  toolsGetOne:        (name) => `/api/tools/registered/${encodeURIComponent(name)}`,
  toolDocsUpload:     '/api/tool-docs/upload',
  toolDocsUploadFor:  (name) => `/api/tool-docs/upload/${encodeURIComponent(name)}`,
  toolDocsStatus:     '/api/tool-docs/status',
  toolDocsClear:      '/api/tool-docs/clear',
  toolDocsClearTool:  (name) => `/api/tool-docs/clear/${encodeURIComponent(name)}`,
  toolDocDeleteFile:  '/api/tool-docs/file',
  toolChangeLog:      '/api/tool-change-log',
  policies:           '/api/policies',
  uploadPolicy:       '/api/upload-policy',
  deletePolicy:       (f) => `/api/policies/${encodeURIComponent(f)}`,
  promptVersions:     '/api/prompt-versions',
};


/* ══════════════════════════════════════
   AI TOOL LOGO LOOKUP
   Maps recognizable AI-tool brand names → simpleicons.org slug.
   Used to render real brand logos instead of the generic 🤖 emoji.
   Final fallback (no brand match, no admin-set emoji) is the
   Navigator compass logo.
══════════════════════════════════════ */
const TOOL_LOGO_MAP = [
  // [substring matched in tool name (lowercase), simpleicons slug]
  // IMPORTANT: more-specific entries first (substring matching, first match wins).
  // "microsoft copilot studio" must be before "microsoft copilot" before "copilot".
  ['microsoft copilot studio', 'microsoftcopilotstudio'],
  ['copilot studio',           'microsoftcopilotstudio'],
  ['microsoft copilot',        'microsoftcopilot'],
  ['m365 copilot',             'microsoftcopilot'],
  ['microsoft 365 copilot',    'microsoftcopilot'],
  ['github copilot',           'githubcopilot'],
  ['chatgpt',     'openai'],
  ['gpt-4',       'openai'],
  ['gpt-3',       'openai'],
  ['gpt',         'openai'],
  ['openai',      'openai'],
  ['dall-e',      'openai'],
  ['dalle',       'openai'],
  ['claude',      'anthropic'],
  ['anthropic',   'anthropic'],
  ['copilot',     'githubcopilot'],
  ['github',      'github'],
  ['gemini',      'googlegemini'],
  ['bard',        'googlegemini'],
  ['google',      'google'],
  ['midjourney',  'midjourney'],
  ['stable diffusion', 'stabilityai'],
  ['stability',   'stabilityai'],
  ['perplexity',  'perplexity'],
  ['notion',      'notion'],
  ['jasper',      'jasper'],
  ['huggingface', 'huggingface'],
  ['hugging face','huggingface'],
  ['llama',       'meta'],
  ['meta ai',     'meta'],
  ['mistral',     'mistralai'],
  ['cohere',      'cohere'],
  ['runway',      'runway'],
  ['elevenlabs',  'elevenlabs'],
  ['eleven labs', 'elevenlabs'],
  ['stack overflow','stackoverflow'],
  ['microsoft',   'microsoft'],
  ['azure',       'microsoftazure'],
  ['adobe',       'adobe'],
  ['firefly',     'adobefirefly'],
  ['canva',       'canva'],
  ['grammarly',   'grammarly'],
  ['zapier',      'zapier'],
  ['n8n',         'n8n'],
  ['langchain',   'langchain'],
];

const NAVIGATOR_LOGO_URL = '/static/Images/Navigator.svg';

/**
 * PRIMARY icon source: the Excel registry (AI_TOOLS_Roles.xlsx).
 * Each tool row has an `icon` column which can hold:
 *   - A /static/... path  →  rendered as <img>  (e.g. /static/chatgpt.png)
 *   - An emoji             →  rendered inline    (e.g. 🎫)
 *   - A full URL           →  rendered as <img>
 *   - Empty / missing      →  falls through to the chain below
 *
 * To change a tool's icon, update the `icon` column in the Excel and
 * re-upload via Admin → Upload Registry. No code changes needed.
 *
 * The maps below are FALLBACK ONLY — used when the Excel icon is empty
 * (e.g. newly added tools or tools not yet in the registry).
 */

const LOCAL_TOOL_LOGO_MAP = {
  'microsoft copilot':     '/static/Images/microsoft%20copilot.jpeg',
  'm365 copilot':          '/static/Images/microsoft%20copilot.jpeg',
  'microsoft 365 copilot': '/static/Images/microsoft%20copilot.jpeg',
  'chatgpt':               '/static/Images/chatgpt.png',
};

const TOOL_FAVICON_MAP = {
  'cassidy':                  'cassidy.ai',
  'clay':                     'clay.com',
  'hubspot':                  'hubspot.com',
  'jasper':                   'jasper.ai',
  'synthesia':                'synthesia.io',
  'icertis':                  'icertis.com',
  'microsoft copilot studio': 'copilotstudio.microsoft.com',
  'copilot studio':           'copilotstudio.microsoft.com',
};

/** Logo source URLs — clearbit returns actual brand logos (higher quality),
 *  Google favicons is the fallback (smaller but more universally available). */
function _clearbitLogoUrl(domain) {
  return `https://logo.clearbit.com/${domain}`;
}
function _faviconUrl(domain, sz) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${sz || 128}`;
}

/**
 * Convert a tool name into the simpleicons slug convention:
 * lowercase, strip whitespace and any non-alphanumeric except '.'.
 * "Microsoft Teams" → "microsoftteams"
 * "Stack Overflow"  → "stackoverflow"
 * "AI-Powered Chat" → "aipoweredchat"
 */
function _autoSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
}

/**
 * Resolve a tool's icon HTML.
 *  1. Excel-sourced icon (path, URL, or emoji) — set in AI_TOOLS_Roles.xlsx `icon` column.
 *     This is the primary source. Change icons by editing the Excel, no code changes needed.
 *  2. LOCAL_TOOL_LOGO_MAP — fallback for tools whose Excel icon is empty (local /static/ files)
 *  3. TOOL_FAVICON_MAP — clearbit logo → Google favicon chain for known domains
 *  4. TOOL_LOGO_MAP — simpleicons.org brand SVG by name substring
 *  5. Auto-derived simpleicons slug from tool name
 *  6. Navigator compass (/static/Images/Navigator.svg) — final fallback
 *
 * @param {string} toolName   e.g. "ChatGPT (OpenAI)", "Cassidy"
 * @param {string} customIcon icon value from registry (Excel `icon` column or DB override)
 * @param {number} sizePx     desired pixel size of rendered icon
 * @returns {string} HTML string ready to inject
 */
function _toolIconHtml(toolName, customIcon, sizePx) {
  const sz = sizePx || 24;
  const px = `${sz}px`;
  const baseStyle = `width:${px};height:${px};object-fit:contain;display:inline-block;vertical-align:middle;`;

  // 1. Excel-sourced icon (or DB override): URL/path → <img>, emoji/text → inline span
  if (customIcon && customIcon !== '🤖' && customIcon.trim()) {
    if (/^(https?:|\/)/.test(customIcon)) {
      return `<img src="${customIcon}" alt="" style="${baseStyle}" />`;
    }
    return `<span style="font-size:${Math.round(sz*0.85)}px;line-height:1;display:inline-block;">${escapeHtml(customIcon)}</span>`;
  }

  const lc = (toolName || '').toLowerCase();

  // 2. Fallback: local hosted brand logo (used when Excel icon is empty)
  for (const [needle, path] of Object.entries(LOCAL_TOOL_LOGO_MAP)) {
    if (lc.includes(needle)) {
      return `<img src="${path}" alt="${escapeHtml(toolName || '')}"
                   onerror="this.onerror=null;this.src='${NAVIGATOR_LOGO_URL}';"
                   style="${baseStyle}" loading="lazy" />`;
    }
  }

  // 3. Direct logo for tools whose domain is known.
  //    Chain of sources: clearbit (real brand logo) → Google favicon →
  //    Navigator compass. The double `onerror` uses a one-shot
  //    state machine — each fallback runs at most once.
  for (const [needle, domain] of Object.entries(TOOL_FAVICON_MAP)) {
    if (lc.includes(needle)) {
      const primary  = _clearbitLogoUrl(domain);
      const fallback = _faviconUrl(domain, Math.max(64, sz * 2));
      const compass  = NAVIGATOR_LOGO_URL;
      const onerror = `
        if (this.dataset.fb === '0') { this.dataset.fb='1'; this.src='${fallback}'; }
        else if (this.dataset.fb === '1') { this.dataset.fb='2'; this.src='${compass}'; }
        else { this.onerror = null; }
      `.replace(/\s+/g, ' ').trim();
      return `<img src="${primary}" alt="${escapeHtml(toolName || '')}"
                   data-fb="0"
                   onerror="${onerror}"
                   style="${baseStyle}" loading="lazy" />`;
    }
  }

  // 3. Explicit simpleicons map for names that don't match their slug
  let slug = null;
  for (const [needle, mappedSlug] of TOOL_LOGO_MAP) {
    if (lc.includes(needle)) { slug = mappedSlug; break; }
  }

  // 4. Auto-derive slug from the name itself
  if (!slug && toolName) slug = _autoSlug(toolName);

  // 5. No name at all — compass
  if (!slug) {
    return `<img src="${NAVIGATOR_LOGO_URL}" alt="" style="${baseStyle}" />`;
  }

  // 6. simpleicons attempt; onerror falls back to compass once
  return `<img src="https://cdn.simpleicons.org/${slug}" alt="${escapeHtml(toolName || '')}"
               onerror="this.onerror=null;this.src='${NAVIGATOR_LOGO_URL}';"
               style="${baseStyle}" loading="lazy" />`;
}


/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
let currentAuditId     = null;
let currentOutput      = '';   // latest llm output — updated on each refinement too
let currentInput       = '';   // original user question
let currentCorlo       = '';   // CORLO prompt that generated the response
let currentRole        = 'general';
let currentTaskType    = 'general';
let currentIntent      = 'general';
let currentIndustry    = 'general';
let currentTool        = '';
let currentTaskSource  = 'typed';   // 'scenario_library' | 'typed'
let _runAbortController = null;

/* Set by the Scenario Library / Prompt Library / Quick Actions call sites
   right before staging the chat. _runGenerate consumes and resets it so
   subsequent typed prompts default to 'typed'. Exposed on window so
   non-module scripts can flag their flows too. */
window._pendingTaskSource = null;
/* Scenario provenance staged alongside _pendingTaskSource by the Scenario
   Library flow. Cleared on consume / typed input / review-modal abandon —
   same lifetime as _pendingTaskSource. Empty string when unknown. */
window._pendingScenarioId    = null;
window._pendingScenarioTitle = null;

/* Renders a small pill telling the user whether this task came from the
   Scenario Library or was written by them. Used in History, Recent Runs,
   Feedback Dashboard, and the Feedback modal.

   Returns an EMPTY STRING for blank / unknown values so historical rows
   (created before the flag was in place) render no badge at all. Only
   the two explicit values 'scenario_library' and 'typed' produce a pill. */
function _taskSourceBadge(taskSource) {
  const src = (taskSource || '').trim().toLowerCase();
  if (src === 'scenario_library') {
    return `<span class="task-source-badge task-source-lib" title="Task selected from the Scenario Library">From Library</span>`;
  }
  if (src === 'typed') {
    return `<span class="task-source-badge task-source-own" title="Task written by the user">Custom Task</span>`;
  }
  // Blank / unknown → no badge. Historical rows fall here.
  return '';
}
window._taskSourceBadge = _taskSourceBadge;

function _taskSourceLabel(taskSource) {
  const src = (taskSource || '').trim().toLowerCase();
  if (src === 'scenario_library') return 'From Library';
  if (src === 'typed')            return 'Custom Task';
  return '';
}
window._taskSourceLabel = _taskSourceLabel;

function _getSessionEmail() {
  try { return (JSON.parse(sessionStorage.getItem('navigator_session')) || {}).email || ''; }
  catch { return ''; }
}
function _getSessionRole() {
  try { return (JSON.parse(sessionStorage.getItem('navigator_session')) || {}).role || 'user'; }
  catch { return 'user'; }
}


/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSidebar();
  initHomePage();
  initOutputTabs();
  initFeedback();
  initModal();
  initPoliciesPage();
  loadSidebarStats();
  // Toolbar hidden until a prompt is generated
  const t = document.getElementById('promptToolbar');
  if (t) t.style.display = 'none';

  // Init hamburger drawer AFTER everything else so the
  // button clone strips the sidebar-open listener added by initSidebar
  initHamburgerDrawer();

  // Init chat gather panel
  initChatPanel();

  // Recent runs in Home empty state
  initRecentRuns();

  // ── Global "/" shortcut to focus the chat input ──
  // Mirrors the convention used by GitHub, Slack, Discord, Linear etc.
  // Skipped when the user is already typing in any input/textarea/contenteditable
  // or when a modifier key is held (so it doesn't hijack browser shortcuts).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const tag = (t && t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (t && t.isContentEditable) return;
    const chatInput = document.getElementById('chatInput');
    if (!chatInput) return;
    // Only act when the chat panel is actually visible (Home page active).
    if (!chatInput.offsetParent) return;
    e.preventDefault();
    chatInput.focus();
    chatInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  // Auto-refresh when the tab regains visibility.
  // Reuses each surface's existing Refresh button — clicks it programmatically
  // when the user comes back. Throttled so rapid tab-switches don't fire
  // a refresh storm. Manual Refresh buttons stay for explicit control.
  initTabFocusRefresh();
});

const _AUTO_REFRESH_THROTTLE_MS = 30 * 1000;
let _lastAutoRefreshAt = 0;

function initTabFocusRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - _lastAutoRefreshAt < _AUTO_REFRESH_THROTTLE_MS) return;
    _lastAutoRefreshAt = now;
    _autoRefreshActiveSurface();
  });
}

/** Click whichever Refresh button is currently relevant. Order matters:
 *  modals first (they cover whatever page is behind them), then pages. */
function _autoRefreshActiveSurface() {
  const tryClick = (sel, mustHaveOpenAncestor) => {
    const btn = document.querySelector(sel);
    if (!btn) return false;
    if (mustHaveOpenAncestor) {
      const open = btn.closest('.open');
      if (!open) return false;
    } else {
      // For page buttons, the parent <section class="page"> must be active.
      const page = btn.closest('section.page');
      if (page && !page.classList.contains('active')) return false;
    }
    btn.click();
    return true;
  };

  // 1) Modals (anything matching #...Modal.open or #...Overlay.open)
  if (document.querySelector('#anModal.open'))    { tryClick('#anRefreshBtn', true);  return; }
  if (document.querySelector('#fbvModal.open'))   { tryClick('#fbvRefreshBtn', true); return; }
  if (document.querySelector('#tclModal.open'))   { tryClick('#tclRefreshBtn', true); return; }

  // 2) Pages
  if (tryClick('#btnRefreshHistory'))         return;
  if (tryClick('#btnRefreshAnalytics'))       return;
  if (tryClick('#btnRefreshPolicies'))        return;
  if (tryClick('#btnRefreshAdminScenarios'))  return;
}




/* ══════════════════════════════════════
   HOME PAGE — Chat-driven flow
══════════════════════════════════════ */
function initHomePage() {


  document.getElementById('btnRefine')?.addEventListener('click', handleRefine);

  // ── Edit / Copy / Save prompt toolbar ──
  document.getElementById('btnEditPrompt')?.addEventListener('click', enterPromptEditMode);
  document.getElementById('btnCopyPrompt')?.addEventListener('click', copyPromptText);
  document.getElementById('btnSavePrompt')?.addEventListener('click', savePromptToFavorites);
  document.getElementById('btnPromptOk')?.addEventListener('click', applyPromptEdit);
  document.getElementById('btnPromptCancelEdit')?.addEventListener('click', cancelPromptEdit);

  // ── Confidentiality banner — dismiss + re-expand ──
  document.getElementById('confDismissBtn')?.addEventListener('click', () => {
    sessionStorage.setItem('navigator_conf_seen', '1');
    const banner = document.getElementById('confidentialityNotice');
    const chip   = document.getElementById('confidentialityChip');
    if (banner) banner.style.display = 'none';
    if (chip)   chip.style.display   = 'inline-flex';
  });
  document.getElementById('confidentialityChip')?.addEventListener('click', () => {
    const banner = document.getElementById('confidentialityNotice');
    const chip   = document.getElementById('confidentialityChip');
    if (banner) banner.style.display = 'flex';
    if (chip)   chip.style.display   = 'none';
    // Don't clear sessionStorage flag — chip will return on the next result.
  });
}


/* ══════════════════════════════════════
   PROMPT TOOLBAR — Edit / Copy / Save
══════════════════════════════════════ */

function enterPromptEditMode() {
  const display  = document.getElementById('resultPrompt');
  const textarea = document.getElementById('promptEditArea');
  const okBar    = document.getElementById('promptEditOk');
  const editBtn  = document.getElementById('btnEditPrompt');

  textarea.value        = currentCorlo || display.textContent;
  display.style.display = 'none';
  textarea.style.display = 'block';
  okBar.style.display   = 'flex';
  editBtn.textContent   = '✎ Editing…';
  editBtn.disabled      = true;
  textarea.focus();
}

function applyPromptEdit() {
  const display  = document.getElementById('resultPrompt');
  const textarea = document.getElementById('promptEditArea');
  const okBar    = document.getElementById('promptEditOk');
  const editBtn  = document.getElementById('btnEditPrompt');

  currentCorlo           = textarea.value;
  display.innerHTML      = _formatPromptHtml(textarea.value);
  display.style.display  = 'block';
  textarea.style.display = 'none';
  okBar.style.display    = 'none';
  editBtn.textContent    = '✎ Edit';
  editBtn.disabled       = false;

  // Show revised banner
  const banner = document.getElementById('revisedBanner');
  if (banner) {
    banner.textContent   = '✅ Prompt updated manually.';
    banner.style.display = 'block';
  }
  showToast('Prompt updated!', 'success');
}

function cancelPromptEdit() {
  const display  = document.getElementById('resultPrompt');
  const textarea = document.getElementById('promptEditArea');
  const okBar    = document.getElementById('promptEditOk');
  const editBtn  = document.getElementById('btnEditPrompt');

  display.style.display  = 'block';
  textarea.style.display = 'none';
  okBar.style.display    = 'none';
  editBtn.textContent    = '✎ Edit';
  editBtn.disabled       = false;
}

/* ══════════════════════════════════════
   HTTP-SAFE CLIPBOARD HELPERS
   navigator.clipboard requires HTTPS — execCommand fallback for http://localhost
══════════════════════════════════════ */
function _copyToClipboard(text, onSuccess) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(onSuccess)
      .catch(() => _execCommandCopy(text, onSuccess));
  } else {
    _execCommandCopy(text, onSuccess);
  }
}

function _execCommandCopy(text, onSuccess) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    if (onSuccess) onSuccess();
  } catch(e) {
    showToast('Copy failed — please select and copy manually.', 'error');
  }
  document.body.removeChild(ta);
}

/**
 * Flash a "✓ Copied" confirmation on a button for ~1.5s.
 * Preserves the button's full innerHTML (icons, etc.) and restores it after.
 * Adds a transient `.is-copied` class so themes can style the success state.
 */
function _flashCopied(btn, label) {
  if (!btn) return;
  if (btn._copyResetTimer) {
    clearTimeout(btn._copyResetTimer);
    if (btn._copyOriginalHtml != null) btn.innerHTML = btn._copyOriginalHtml;
  }
  btn._copyOriginalHtml = btn.innerHTML;
  btn.classList.add('is-copied');
  btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;">
                     <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                     ${label || 'Copied'}
                   </span>`;
  btn._copyResetTimer = setTimeout(() => {
    if (btn._copyOriginalHtml != null) btn.innerHTML = btn._copyOriginalHtml;
    btn.classList.remove('is-copied');
    btn._copyOriginalHtml = null;
    btn._copyResetTimer = null;
  }, 1500);
}

function copyPromptText() {
  const text = currentCorlo || document.getElementById('resultPrompt').textContent;
  if (!text || text.startsWith('(')) { showToast('Generate a prompt first.', 'error'); return; }
  _copyToClipboard(text, () => {
    _flashCopied(document.getElementById('btnCopyPrompt'));
    showToast('Prompt copied!', 'success');
  });
}

function savePromptToFavorites() {
  if (!currentInput) { showToast('Generate a task first.', 'error'); return; }

  const email = _getSessionEmail();
  if (!email) { showToast('Please sign in to save favorites.', 'error'); return; }

  const favKey = `sl_favorites__${email}`;

  const title = currentInput.substring(0, 50).trim()
              + (currentInput.length > 50 ? '…' : '');

  let favs = [];
  try { favs = JSON.parse(localStorage.getItem(favKey) || '[]'); } catch {}

  if (favs.some(f => f.title === title)) {
    showToast('Already in favourites', 'info'); return;
  }

  favs.push({ title, scenario: currentInput });
  localStorage.setItem(favKey, JSON.stringify(favs));

  if (typeof window.slLoadFavorites === 'function') window.slLoadFavorites();
  if (typeof window.slRenderFavorites === 'function') window.slRenderFavorites();

  _switchScenarioLibraryToFavorites();

  const confirm = document.getElementById('saveConfirm');
  if (confirm) { confirm.style.display = 'inline'; setTimeout(() => { confirm.style.display = 'none'; }, 2500); }
  showToast('Saved to favourites', 'success');
}

function _switchScenarioLibraryToFavorites() {
  const favBtn = document.querySelector('.sl-subtab-btn[data-sltab="favorites"]');
  if (!favBtn) return;
  document.querySelectorAll('.sl-subtab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sl-subtab-panel').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
  favBtn.classList.add('active');
  const panel = document.getElementById('sl-panel-favorites');
  if (panel) { panel.classList.add('active'); panel.style.display = ''; }
}


/* ══════════════════════════════════════
   COMBOBOX CUSTOM VALUE HIGHLIGHT
   — marks the input when user types a value not in the datalist
══════════════════════════════════════ */
function initComboboxHighlight() {
  const ROLE_OPTIONS = [
    'consultant / manager','executive / director','developer / technical',
    'business analyst','sales / bd','marketing / comms','hr / people ops','finance / accounting'
  ];
  const TASK_OPTIONS = [
    'research & analysis','writing & docs','strategy & planning','data analysis',
    'code & dev','creative content','communication','learning & training',
    'process automation','decision support'
  ];

  function bindComboHighlight(inputId, knownValues) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = el.value.trim().toLowerCase();
      if (!v) { el.classList.remove('custom-value'); return; }
      // Case-insensitive match — preset values chosen from the datalist won't be flagged
      const isKnown = knownValues.some(opt => opt.toLowerCase() === v);
      el.classList.toggle('custom-value', !isKnown);
    });
    // Also fire once on blur so pasted values are caught
    el.addEventListener('blur', () => el.dispatchEvent(new Event('input')));
  }

  bindComboHighlight('selRole',     ROLE_OPTIONS);
  bindComboHighlight('selTaskType', TASK_OPTIONS);
}

/* ══════════════════════════════════════
   CLARIFICATION MODAL STATE
══════════════════════════════════════ */
let _clarQuestions     = [];
let _clarInput         = '';
let _clarRole          = 'general';
let _clarTaskType      = 'general';
let _clarEnrichedInput = '';   // filled after /api/clarify-merge

function _openClarModal(questions, input, role, taskType) {
  _clarQuestions     = questions;
  _clarInput         = input;
  _clarRole          = role;
  _clarTaskType      = taskType;
  _clarEnrichedInput = '';

  const body = document.getElementById('clarBody');
  body.innerHTML = questions.map((q, i) => `
    <div class="clar-question-block" id="clar-qblock-${i}">
      <label class="clar-question-label" for="clar-ans-${i}">
        <span class="clar-q-num">${i + 1}</span>${escapeHtml(q)}
      </label>
      <input
        class="clar-answer-input"
        id="clar-ans-${i}"
        type="text"
        placeholder="Your answer… (leave blank to skip)"
        autocomplete="off"
        maxlength="120"
      />
    </div>
  `).join('');

  document.getElementById('clarOverlay').classList.add('open');

  const first = document.getElementById('clar-ans-0');
  if (first) setTimeout(() => first.focus(), 80);

  document.getElementById('clarSubmitBtn').onclick  = _handleClarSubmit;
  document.getElementById('clarSkipBtn').onclick    = _handleClarSkip;
  document.getElementById('clarSkipBtn2').onclick   = _handleClarSkip;

  document.getElementById('clarOverlay').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _handleClarSubmit(); }
    if (e.key === 'Escape') _handleClarSkip();
  };
}

function _closeClarModal() {
  document.getElementById('clarOverlay').classList.remove('open');
}

async function _handleClarSubmit() {
  const answers = _clarQuestions.map((_, i) =>
    (document.getElementById(`clar-ans-${i}`)?.value || '').trim()
  );

  _closeClarModal();

  const hasAnyAnswer = answers.some(a => a.length > 0);
  if (!hasAnyAnswer) {
    _runGenerate(_clarInput, _clarRole, _clarTaskType);
    return;
  }

  try {
    const mergeRes = await fetch(API.clarifyMerge, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        user_input: _clarInput,
        role:       _clarRole,
        task_type:  _clarTaskType,
        questions:  _clarQuestions,
        answers:    answers,
      }),
    });
    const mergeData = await mergeRes.json();
    _clarEnrichedInput = (mergeData.enriched_input || _clarInput).trim();
  } catch {
    _clarEnrichedInput = _clarInput;
  }

  // Auto-apply enriched task — no decision modal. The clarifier already
  // gathered context; second-guessing the user with another picker is
  // decision fatigue. If the enrichment feels wrong, the refine box
  // under the result lets them iterate.
  const finalText = (_clarEnrichedInput || _clarInput).trim();
  const textarea  = document.getElementById('userInput');
  const charCount = document.getElementById('charCount');
  if (textarea)  textarea.value = finalText;
  if (charCount) charCount.textContent = finalText.length;
  _runGenerate(finalText, _clarRole, _clarTaskType);
}

function _handleClarSkip() {
  _closeClarModal();
}

/* ── Enriched suggestion modal shown after clarification answers ── */
function _showEnrichedSuggestion(enriched, role, taskType) {
  const overlay   = document.getElementById('enrichedOverlay');
  const textarea  = document.getElementById('userInput');
  const charCount = document.getElementById('charCount');
  const descDisplay = document.getElementById('enrichedDescDisplay');
  const descTextarea = document.getElementById('enrichedDescText');
  const editBtn   = document.getElementById('enrichedEditBtn');

  descDisplay.textContent = enriched;
  descDisplay.style.display = '';
  descTextarea.value = enriched;
  descTextarea.style.display = 'none';
  editBtn.innerHTML = '&#9998; Edit';

  document.getElementById('enrichedOrigText').textContent = _clarInput;

  editBtn.onclick = () => {
    const isEditing = descTextarea.style.display !== 'none';
    if (isEditing) {
      const updated = descTextarea.value.trim() || enriched;
      descDisplay.textContent = updated;
      descDisplay.style.display = '';
      descTextarea.style.display = 'none';
      editBtn.innerHTML = '&#9998; Edit';
    } else {
      descTextarea.value = descDisplay.textContent;
      descDisplay.style.display = 'none';
      descTextarea.style.display = '';
      descTextarea.focus();
      editBtn.innerHTML = '&#10003; Done';
    }
  };

  overlay.classList.add('open');

  document.getElementById('enrichedBannerUse').onclick = () => {
    const finalText = (descTextarea.style.display !== 'none'
      ? descTextarea.value
      : descDisplay.textContent
    ).trim() || enriched;
    overlay.classList.remove('open');
    textarea.value = finalText;
    if (charCount) charCount.textContent = finalText.length;
    _runGenerate(finalText, role, taskType);
  };

  document.getElementById('enrichedBannerOriginal').onclick = () => {
    overlay.classList.remove('open');
    _runGenerate(_clarInput, role, taskType);
  };

  document.getElementById('enrichedBannerClose').onclick = () => {
    overlay.classList.remove('open');
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  };
}

// NOTE: handleGenerate() is dead — its trigger button (#btnGenerate) was
// removed when the chat flow replaced the legacy form. Kept here to avoid
// breaking any external reference until a future cleanup pass removes it.
async function handleGenerate() {
  const input    = (document.getElementById('userInput')?.value     || '').trim();
  const role     = (document.getElementById('selRole')?.value       || '').trim() || 'general';
  const taskType = (document.getElementById('selTaskType')?.value   || '').trim() || 'general';

  if (!input) { showToast('Please describe your task first.', 'error'); return; }

  const existingBanner = document.getElementById('enrichedSuggestionBanner');
  if (existingBanner) existingBanner.remove();

  const btnGenerate = document.getElementById('btnGenerate');
  btnGenerate.disabled = true;
  btnGenerate.textContent = 'Checking…';

  const _resetBtn = () => {
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Generate`;
  };

  let needsClar = false;
  try {
    const clarRes = await fetch(API.clarify, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_input: input, role, task_type: taskType }),
    });

    if (clarRes.ok) {
      const clarData = await clarRes.json();
      if (clarData.needs_clarification && clarData.questions && clarData.questions.length > 0) {
        needsClar = true;
        _resetBtn();
        _openClarModal(clarData.questions, input, role, taskType);
      }
    }
  } catch {
    /* network error — skip clarification and generate directly */
  }

  if (needsClar) return;

  _resetBtn();
  await _runGenerate(input, role, taskType);
}

async function _runGenerate(input, role, taskType) {
  clearHomeResponseOnly();
  if (_runAbortController) {
    _runAbortController.abort();
  }
  _runAbortController = new AbortController();
  const signal = _runAbortController.signal;

  goToStep(2);
  startProcessingAnimation();

  // Consume the pending task source (set by Scenario Library flows).
  // Default to 'typed' when nothing was staged.
  const _taskSource = (window._pendingTaskSource === 'scenario_library')
    ? 'scenario_library'
    : 'typed';
  // Grab scenario id/title staged alongside _pendingTaskSource. Only
  // forwarded when the run actually came from the Scenario Library — for
  // typed runs we send empty strings so the backend blanks the columns.
  const _scenarioId    = (_taskSource === 'scenario_library')
    ? (window._pendingScenarioId    || '')
    : '';
  const _scenarioTitle = (_taskSource === 'scenario_library')
    ? (window._pendingScenarioTitle || '')
    : '';
  window._pendingTaskSource    = null;
  window._pendingScenarioId    = null;
  window._pendingScenarioTitle = null;

  try {
    const res = await fetch(API.run, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  signal,
      body:    JSON.stringify({
        user_input:               input,
        role:                     role,
        task_type:                taskType,
        data_sensitivity:         'general',
        user_email:               _getSessionEmail(),
        skip_tool_recommendation: !_toolRecEnabled,
        task_source:              _taskSource,
        scenario_id:              _scenarioId,
        scenario_title:           _scenarioTitle,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error ${res.status}`);
    }

    const data = await res.json();

    currentAuditId  = data.audit_id;
    window.currentAuditId = currentAuditId;  // expose for feedback FAB context
    currentOutput   = data.output           || '';
    currentCorlo    = data.corlo_prompt     || '';
    currentInput    = input;
    currentRole     = role;
    currentTaskType = taskType;
    currentIntent   = data.intent           || 'general';
    currentIndustry = data.industry         || 'general';
    currentTool     = data.recommended_tool || '';
    currentTaskSource = data.task_source    || _taskSource;
    window.currentTaskSource = currentTaskSource;  // for feedback modal badge

    await finishProcessingAnimation();
    renderResult(data);
    goToStep(3);
    loadSidebarStats();

  } catch (err) {
    if (err.name === 'AbortError') return;
    goToStep(1);
    showToast(`Error: ${err.message}`, 'error');
  }
}


function clearHomeResponseOnly() {
  // Abort any previous running generation
  if (_runAbortController) {
    _runAbortController.abort();
    _runAbortController = null;
  }

  // Clear result state
  currentAuditId = null;
  window.currentAuditId = null;
  currentOutput = '';
  currentCorlo = '';
  currentInput = '';
  currentTool = '';

  // Clear visible response UI
  [
    'policyBlockedBox',
    'resultMeta',
    'toolRecBox',
    'policyFlagsBox',
    'alternativesBox',
    'resultPrompt',
    'resultPolicies'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  const revisedBanner = document.getElementById('revisedBanner');
  if (revisedBanner) {
    revisedBanner.style.display = 'none';
    revisedBanner.textContent = '';
  }

  const refinementInput = document.getElementById('refinementInput');
  if (refinementInput) refinementInput.value = '';

  const toolbar = document.getElementById('promptToolbar');
  if (toolbar) toolbar.style.display = 'none';

  // Show clean waiting state on the right side
  goToStep(1);
}

function resetToStep1() {
  if (_runAbortController) {
    _runAbortController.abort();
    _runAbortController = null;
  }
  goToStep(1);
  const banner = document.getElementById('revisedBanner');
  if (banner) { banner.style.display = 'none'; banner.textContent = ''; }
  const ri = document.getElementById('refinementInput');
  if (ri) ri.value = '';
  const toolbar = document.getElementById('promptToolbar');
  if (toolbar) toolbar.style.display = 'none';
  document.getElementById('enrichedOverlay')?.classList.remove('open');
  _closeClarModal();
  cancelPromptEdit();
  currentAuditId     = null;
  window.currentAuditId = null;
  currentOutput      = '';
  currentCorlo       = '';
  currentInput       = '';
  currentRole        = 'general';
  currentTaskType    = 'general';
  currentIntent      = 'general';
  currentIndustry    = 'general';
  currentTool        = '';
  _chatReset();
}


/* ══════════════════════════════════════
   PROMPT BADGE HELPER
   Reads is_prompt_required from registry raw_data and returns a badge span.
   Values: "yes"/"required"/"true"/"1" → Required
           "no"/"not required"/"false"/"0" → No Prompt
           "optional" → Optional
══════════════════════════════════════ */
function buildPromptBadge(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const val = String(raw).trim().toLowerCase();
  if (val === 'yes' || val === 'true' || val === '1' || val === 'required')
    return `<span class="tool-badge-prompt-req">✍️ Prompt Required</span>`;
  if (val === 'no' || val === 'false' || val === '0' || val === 'not required')
    return `<span class="tool-badge-prompt-no">⚡ No Prompt</span>`;
  if (val === 'optional')
    return `<span class="tool-badge-prompt-opt">💡 Prompt Optional</span>`;
  return '';
}


/* ── Convert CORLO prompt text to readable HTML (bullets, bold, line breaks) ── */
function _formatPromptHtml(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const isBullet = /^[\s]*[-•*]\s/.test(line);
    const isNumbered = /^[\s]*\d+\.\s/.test(line);

    if (isBullet || isNumbered) {
      if (!inList) { html += '<ul style="margin:6px 0 6px 18px;padding:0;list-style:disc;">'; inList = true; }
      const content = line.replace(/^[\s]*[-•*]\s/, '').replace(/^[\s]*\d+\.\s/, '');
      html += `<li style="margin:3px 0;">${_applyInlineMarkdown(content)}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') {
        html += '<br>';
      } else {
        html += `<div>${_applyInlineMarkdown(line)}</div>`;
      }
    }
  }
  if (inList) html += '</ul>';
  return html.replace(/(<br>)+$/, '');
}

function _applyInlineMarkdown(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`(.+?)`/g, '<code style="background:var(--bg-secondary);padding:1px 4px;border-radius:3px;font-size:0.9em;">$1</code>');
  return s;
}


/* ══════════════════════════════════════
   RENDER RESULT
══════════════════════════════════════ */
function renderResult(data) {
  // Show or hide the partial-info reminder note
  const partialNote = document.getElementById('partialInfoNote');
  if (partialNote) partialNote.style.display = _chatPartialInfo ? '' : 'none';

  // ── Meta badges ──
  const confClass   = data.tool_confidence === 'high'   ? 'conf-high'
                    : data.tool_confidence === 'medium' ? 'conf-med' : 'conf-low';
  const role        = data.role      || '';
  const taskType    = data.task_type || '';

  // Primary badges users actually need: tool + confidence.
  // Everything else (intent / industry / role / task type) is metadata —
  // tucked behind a "Details" expander to stop competing with the prompt.
  const primary = `
    ${data.recommended_tool ? `<span class="meta-badge tool" style="display:inline-flex;align-items:center;gap:6px;">${_toolIconHtml(data.recommended_tool, data.tool_icon, 14)} ${escapeHtml(data.recommended_tool)}</span>` : ''}
    ${data.tool_confidence ? `<span class="meta-badge ${confClass}">${capitalize(data.tool_confidence)} confidence</span>` : ''}
  `;
  const detailItems = [
    data.intent   ? `<span class="meta-badge intent">Intent: ${capitalize(data.intent)}</span>`   : '',
    data.industry ? `<span class="meta-badge intent">Industry: ${capitalize(data.industry)}</span>` : '',
    role     ? `<span class="meta-badge role">👤 ${capitalize(role)}</span>`     : '',
    taskType ? `<span class="meta-badge role">📌 ${capitalize(taskType)}</span>` : '',
  ].filter(Boolean).join('');
  const detailsBlock = detailItems
    ? `<details class="ml-2 inline-block align-middle group">
         <summary class="cursor-pointer list-none inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--text2)] hover:text-[var(--primary)] transition-colors select-none">
           Details
           <svg class="w-3 h-3 transition-transform duration-150 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
         </summary>
         <div class="flex flex-wrap gap-1.5 mt-2">${detailItems}</div>
       </details>`
    : '';
  document.getElementById('resultMeta').innerHTML = primary + detailsBlock;

  // ── Policy blocked banner — shown prominently above everything if blocked ──
  const blockedBox = document.getElementById('policyBlockedBox');
  if (data.policy_blocked) {
    blockedBox.style.display = 'block';
    blockedBox.innerHTML = `
      <div class="safety-banner bad" style="margin-bottom:12px">
        <span>🚫</span>
        <div>
          <strong>Task blocked by company policy</strong>
          <span>${escapeHtml(data.policy_summary || 'This request conflicts with one or more company policies.')}</span>
        </div>
      </div>`;
  } else {
    blockedBox.style.display = 'none';
    blockedBox.innerHTML = '';
  }

  // ── Tool recommendation box ──
  const toolBox = document.getElementById('toolRecBox');
  if (data.recommended_tool && !data.policy_blocked) {
    const _confPct    = typeof data.tool_confidence_pct === 'number' && data.tool_confidence_pct > 0 ? data.tool_confidence_pct : null;
    const _confExpl   = data.tool_confidence_explanation || '';
    const _confLabel  = !_confPct ? '' : _confPct >= 85 ? 'Excellent fit' : _confPct >= 75 ? 'Strong fit' : _confPct >= 55 ? 'Good fit' : _confPct >= 35 ? 'Partial fit' : 'Weak fit';
    const _confColor  = !_confPct ? 'var(--primary)' : _confPct >= 85 ? '#10B981' : _confPct >= 75 ? '#00A3E0' : _confPct >= 55 ? '#3B82F6' : _confPct >= 35 ? '#F59E0B' : '#EF4444';
    const _confBg     = !_confPct ? 'var(--primary-pale)' : _confPct >= 85 ? '#ECFDF5' : _confPct >= 75 ? '#E8F7FD' : _confPct >= 55 ? '#EFF6FF' : _confPct >= 35 ? '#FFFBEB' : '#FEF2F2';
    const _confBorder = !_confPct ? 'var(--primary)' : _confPct >= 85 ? '#6EE7B7' : _confPct >= 75 ? '#BAE6FD' : _confPct >= 55 ? '#BFDBFE' : _confPct >= 35 ? '#FCD34D' : '#FCA5A5';

    toolBox.innerHTML = `
      <div class="tool-rec-box" style="padding:14px 16px;">

        <!-- Row 1: Icon + Name | Confidence block | Open button -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${_confExpl ? '10px' : '4px'};">
          <!-- Icon + name -->
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;min-width:0;">
            <div class="tool-rec-icon" style="font-size:20px;">${_toolIconHtml(data.recommended_tool, data.tool_icon, 26)}</div>
            <div style="min-width:0;">
              <div class="tool-rec-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;">${escapeHtml(data.recommended_tool)}</div>
              ${data.tool_category ? `<div class="tool-rec-category">${escapeHtml(data.tool_category)}</div>` : ''}
            </div>
          </div>

          <div style="flex:1;"></div>

          <!-- Confidence badge -->
          ${_confPct ? `<span style="flex-shrink:0;white-space:nowrap;font-size:12px;font-weight:700;color:${_confColor};background:${_confBg};border:1px solid ${_confBorder};border-radius:7px;padding:4px 10px;">Match Confidence: ${_confPct}%</span>` : ''}

          <!-- Open button (hidden if user has no access) -->
          ${(window._personalization?.hasToolAccess(data.recommended_tool) ?? true)
            ? `<button class="alt-card-btn" id="toolRecOpenBtn" onclick="openAlternativeTool('${escapeHtml(data.recommended_tool)}')" style="flex-shrink:0;white-space:nowrap;">↗ Open</button>`
            : `<span class="tool-no-access-msg" style="flex-shrink:0;white-space:nowrap;font-size:11.5px;color:#ef4444;font-weight:600;">You don't have access to this Tool</span>`
          }


        </div>

        <!-- Row 2: Explanation (2-line clamp) + More... -->
        ${_confExpl ? (() => {
          const _id = 'trExpl_' + (++window._explIdCounter);
          return `
        <div style="font-size:12.5px;color:var(--text2);line-height:1.55;border-top:1px solid ${_confBorder};padding-top:8px;">
          <div id="${_id}_short">
            <div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(_confExpl)}</div>
            <button onclick="document.getElementById('${_id}_short').style.display='none';document.getElementById('${_id}_full').style.display='block';" style="background:none;border:none;padding:0;color:var(--primary);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">More...</button>
          </div>
          <div id="${_id}_full" style="display:none;">
            ${escapeHtml(_confExpl)}
            <button onclick="document.getElementById('${_id}_full').style.display='none';document.getElementById('${_id}_short').style.display='block';" style="background:none;border:none;padding:0;color:var(--primary);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">Less</button>
          </div>
        </div>`;
        })() : ''}
      </div>`;


  } else {
    toolBox.innerHTML = '';
  }

  // ── Policy flags ──
  const flagsBox = document.getElementById('policyFlagsBox');
  const flags    = data.policy_flags || [];
  if (flags.length) {
    flagsBox.innerHTML = `
      <div class="policy-flag-list">
        ${flags.map(f => `<div class="policy-flag">⚠ ${escapeHtml(f)}</div>`).join('')}
      </div>`;
  } else {
    flagsBox.innerHTML = '';
  }

  const altBox        = document.getElementById('alternativesBox');
  const CONF_THRESHOLD = 60;
  const _altsRaw      = (data.tool_alternatives || []);
  const _altReasons   = data.tool_alternative_reasons || [];
  const _altConfPcts  = data.tool_alternative_confidence_pcts || [];
  const _altUrls      = data.tool_alternative_urls || [];

  // Keep only alternatives at or above the confidence threshold
  const filteredIdxs  = _altsRaw
    .map((a, i) => i)
    .filter(i => _altsRaw[i] && _altsRaw[i].trim() && (typeof _altConfPcts[i] === 'number' ? _altConfPcts[i] >= CONF_THRESHOLD : true));

  const alts        = filteredIdxs.map(i => _altsRaw[i]);
  const altReasons  = filteredIdxs.map(i => _altReasons[i] || '');
  const altConfPcts = filteredIdxs.map(i => _altConfPcts[i]);
  const altUrls     = filteredIdxs.map(i => _altUrls[i] || '');

  const ALT_VISIBLE = 2;

  if (alts.length > 0 && !data.policy_blocked) {
    // Alternatives are tucked behind a <details> disclosure. They dilute the
    // primary recommendation when always-visible; users who want to compare
    // can expand on demand. The native <details>/<summary> pair handles
    // open/close without any extra JS state.
    altBox.innerHTML = `
      <details class="alt-section-disclosure mt-3" style="border-top:1px solid var(--border-soft);padding-top:10px;">
        <summary style="cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;
                        font-size:12.5px;font-weight:600;color:var(--text2);user-select:none;
                        transition:color 0.15s;" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text2)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          See ${alts.length} alternative${alts.length !== 1 ? 's' : ''}
          <svg class="alt-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.15s;"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="alt-cards-row" id="altCardsRow" style="margin-top:10px;">
          ${alts.map(a => `
            <div class="alt-card" id="alt-card-${CSS.escape(a)}" style="padding:12px 14px;">
              <!-- Row 1: icon + name | confidence | open -->
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;min-width:0;">
                  <div class="alt-card-icon" id="alt-icon-${CSS.escape(a)}" style="width:28px;height:28px;font-size:16px;">${_toolIconHtml(a, null, 20)}</div>
                  <div style="min-width:0;">
                    <div class="alt-card-name" style="font-size:12px;">${escapeHtml(a)}</div>
                    <div class="alt-card-cat" id="alt-cat-${CSS.escape(a)}" style="display:none;"></div>
                  </div>
                </div>
                <div style="flex:1;display:flex;justify-content:flex-end;" id="alt-conf-${CSS.escape(a)}"></div>
                ${(window._personalization?.hasToolAccess(a) ?? true)
                  ? `<button class="alt-card-btn" id="alt-btn-${CSS.escape(a)}" onclick="openAlternativeTool('${escapeHtml(a)}')" title="Open ${escapeHtml(a)}" style="flex-shrink:0;">↗ Open</button>`
                  : `<span id="alt-btn-${CSS.escape(a)}" class="tool-no-access-msg" style="flex-shrink:0;font-size:11px;color:#ef4444;font-weight:600;">You don't have access to this Tool</span>`
                }
              </div>
              <!-- Row 2: explanation -->
              <div id="alt-card-content-${CSS.escape(a)}"></div>
            </div>`).join('')}
        </div>
      </details>`;

    // Enrich cards asynchronously — fills icon, category, description, confidence bar, reason, Open URL
    fetch(API.tools).then(r => r.json()).then(registry => {
      alts.forEach((a, i) => {
        const key       = Object.keys(registry).find(k => k.toLowerCase() === a.toLowerCase());
        const info      = key ? registry[key] : null;
        const card      = document.getElementById(`alt-card-${CSS.escape(a)}`);
        if (!card) return;

        const pctVal    = typeof altConfPcts[i] === 'number' ? altConfPcts[i] : null;
        const reason    = altReasons[i] || '';
        const toolUrl   = altUrls[i] || (info ? info.url : '') || '';
        const contentEl = document.getElementById(`alt-card-content-${CSS.escape(a)}`);

        // Icon + category
        const iconEl = document.getElementById(`alt-icon-${CSS.escape(a)}`);
        const catEl  = document.getElementById(`alt-cat-${CSS.escape(a)}`);
        const btnEl  = document.getElementById(`alt-btn-${CSS.escape(a)}`);
        const confEl = document.getElementById(`alt-conf-${CSS.escape(a)}`);

        if (iconEl) iconEl.innerHTML  = _toolIconHtml(a, info ? info.icon : null, 20);

        // Open button URL — enforce access at enrichment time (prefs may load after initial render)
        const _hasAccess = window._personalization?.hasToolAccess(a) ?? true;
        if (btnEl) {
          if (!_hasAccess) {
            // Prefs may have loaded after the initial HTML was stamped — replace the Open button now
            btnEl.outerHTML = `<span class="tool-no-access-msg" style="flex-shrink:0;font-size:11px;color:#ef4444;font-weight:600;">You don't have access to this Tool</span>`;
          } else if (toolUrl) {
            btnEl.onclick = () => window.open(toolUrl, '_blank', 'noopener');
          } else {
            btnEl.style.display = 'none';
          }
        }

        // Confidence block (inline, same row)
        if (confEl && pctVal !== null) {
          const confLabel  = pctVal >= 85 ? 'Excellent fit' : pctVal >= 75 ? 'Strong fit' : pctVal >= 55 ? 'Good fit' : pctVal >= 35 ? 'Partial fit' : 'Weak fit';
          const confColor  = pctVal >= 85 ? '#10B981' : pctVal >= 75 ? '#00A3E0' : pctVal >= 55 ? '#3B82F6' : pctVal >= 35 ? '#F59E0B' : '#EF4444';
          const confBg     = pctVal >= 85 ? '#ECFDF5' : pctVal >= 75 ? '#E8F7FD' : pctVal >= 55 ? '#EFF6FF' : pctVal >= 35 ? '#FFFBEB' : '#FEF2F2';
          const confBorder = pctVal >= 85 ? '#6EE7B7' : pctVal >= 75 ? '#BAE6FD' : pctVal >= 55 ? '#BFDBFE' : pctVal >= 35 ? '#FCD34D' : '#FCA5A5';
          confEl.innerHTML = `<span style="white-space:nowrap;font-size:12px;font-weight:700;color:${confColor};background:${confBg};border:1px solid ${confBorder};border-radius:7px;padding:4px 10px;">Match Confidence: ${pctVal}%</span>`;
        }

        // Explanation (2-line clamp + More...)
        if (contentEl && reason) {
          const confBorder = pctVal >= 85 ? '#6EE7B7' : pctVal >= 75 ? '#BAE6FD' : pctVal >= 55 ? '#BFDBFE' : pctVal >= 35 ? '#FCD34D' : pctVal !== null ? '#FCA5A5' : 'var(--border)';
          const _id = 'altExpl_' + (++window._explIdCounter);
          contentEl.style.marginTop = '8px';
          contentEl.style.borderTop = `1px solid ${confBorder}`;
          contentEl.style.paddingTop = '7px';
          contentEl.innerHTML = `
            <div style="font-size:12.5px;color:var(--text2);line-height:1.55;">
              <div id="${_id}_short">
                <div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(reason)}</div>
                <button onclick="document.getElementById('${_id}_short').style.display='none';document.getElementById('${_id}_full').style.display='block';" style="background:none;border:none;padding:0;color:var(--primary);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">More...</button>
              </div>
              <div id="${_id}_full" style="display:none;">
                ${escapeHtml(reason)}
                <button onclick="document.getElementById('${_id}_full').style.display='none';document.getElementById('${_id}_short').style.display='block';" style="background:none;border:none;padding:0;color:var(--primary);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">Less</button>
              </div>
            </div>`;
        }
      });

      // Enforce access on the main recommendation Open button too
      // (same race condition fix — prefs may load after initial render)
      const recOpenBtn = document.getElementById('toolRecOpenBtn');
      if (recOpenBtn) {
        const recTool = data.recommended_tool;
        const recHasAccess = window._personalization?.hasToolAccess(recTool) ?? true;
        if (!recHasAccess) {
          recOpenBtn.outerHTML = `<span class="tool-no-access-msg" style="flex-shrink:0;white-space:nowrap;font-size:11.5px;color:#ef4444;font-weight:600;">You don't have access to this Tool</span>`;
        }
      }
    }).catch(() => {});
  } else {
    altBox.innerHTML = '';
  }


  // ── Confidentiality Notice ──
  // Full banner is shown only once per session. On dismiss the user sees a
  // compact "🔒 Confidentiality reminder" chip on subsequent results, which
  // re-expands the full banner on click. Banner is suppressed entirely when
  // the request was policy-blocked (the block reason is already prominent).
  const confNoticeBox = document.getElementById('confidentialityNotice');
  const confChip      = document.getElementById('confidentialityChip');
  if (confNoticeBox && confChip) {
    if (data.policy_blocked) {
      confNoticeBox.style.display = 'none';
      confChip.style.display      = 'none';
    } else {
      const dismissed = sessionStorage.getItem('navigator_conf_seen') === '1';
      confNoticeBox.style.display = dismissed ? 'none' : 'flex';
      confChip.style.display      = dismissed ? 'inline-flex' : 'none';
    }
  }

  // ── Output panels ──
  document.getElementById('resultPrompt').innerHTML = data.policy_blocked
    ? '(Prompt not generated — task was blocked by company policy.)'
    : _formatPromptHtml(data.corlo_prompt || '(No prompt generated)');

// Policies Applied tab — rich HTML for both blocked and allowed cases
  const policySummary = data.policy_summary || '';
  const policyFlags   = data.policy_flags   || [];
  const policiesEl    = document.getElementById('resultPolicies');

  if (data.policy_blocked) {
    // ── BLOCKED: show a clear violation breakdown ──
    const flagItems = policyFlags.length
      ? policyFlags.map(f => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
               background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;margin-bottom:8px;">
            <span style="font-size:16px;flex-shrink:0;">🚫</span>
            <span style="font-size:13px;color:#991B1B;font-weight:600;">${escapeHtml(f)}</span>
          </div>`).join('')
      : `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
              background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;margin-bottom:8px;">
           <span style="font-size:16px;flex-shrink:0;">🚫</span>
           <span style="font-size:13px;color:#991B1B;font-weight:600;">Prohibited content detected</span>
         </div>`;

    policiesEl.innerHTML = `
      <div style="padding:4px 2px;">

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <span style="font-size:20px;">🛡️</span>
          <div>
            <div style="font-size:14px;font-weight:800;color:#991B1B;">Request Blocked by Company Policy</div>
            <div style="font-size:12px;color:var(--text3);margin-top:2px;">This task cannot proceed — one or more policy violations were detected.</div>
          </div>
        </div>

        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
             color:var(--text3);margin-bottom:8px;">Policy Violations Detected</div>
        ${flagItems}

        <div style="margin-top:16px;padding:12px 14px;background:#FFF7ED;border:1px solid #FCD34D;
             border-radius:8px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
               color:#92400E;margin-bottom:6px;">📋 Policy Explanation</div>
          <div style="font-size:13px;color:#78350F;line-height:1.6;">
            ${escapeHtml(policySummary || 'This request conflicts with your company\'s acceptable use policy. Prohibited topics include harmful content, dangerous instructions, and restricted subject matter.')}
          </div>
        </div>

        <div style="margin-top:14px;padding:12px 14px;background:#F0F9FF;border:1px solid #BAE6FD;
             border-radius:8px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
               color:#075985;margin-bottom:6px;">💡 What you can do instead</div>
          <div style="font-size:13px;color:#0C4A6E;line-height:1.6;">
            Please rephrase your request to focus on a permitted topic. If you believe this was flagged in error, contact your policy administrator. You can also try a different task type or industry context.
          </div>
        </div>

      </div>`;

  } else {
    // ── ALLOWED: show a green clearance summary ──
    const flagItems = policyFlags.length
      ? `<div style="margin-bottom:14px;">
           <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
                color:var(--text3);margin-bottom:8px;">⚠️ Soft Warnings (non-blocking)</div>
           ${policyFlags.map(f => `
             <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;
                  background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;margin-bottom:6px;">
               <span style="font-size:14px;flex-shrink:0;">⚠️</span>
               <span style="font-size:12px;color:#92400E;">${escapeHtml(f)}</span>
             </div>`).join('')}
         </div>`
      : '';

    policiesEl.innerHTML = `
      <div style="padding:4px 2px;">

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <span style="font-size:20px;">✅</span>
          <div>
            <div style="font-size:14px;font-weight:800;color:#065F46;">Request Cleared — Safe to Proceed</div>
            <div style="font-size:12px;color:var(--text3);margin-top:2px;">No prohibited content was detected. Your request is within policy guidelines.</div>
          </div>
        </div>

        <div style="padding:12px 14px;background:#ECFDF5;border:1px solid #6EE7B7;
             border-radius:8px;margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
               color:#065F46;margin-bottom:6px;">📋 Policy Assessment</div>
          <div style="font-size:13px;color:#064E3B;line-height:1.6;">
            ${escapeHtml(policySummary || 'This request was reviewed against applicable company policies and no violations were found. You may proceed using the generated prompt.')}
          </div>
        </div>

        ${flagItems}

        <div style="padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border);
             border-radius:8px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;
               color:var(--text3);margin-bottom:8px;">🔒 Enterprise Policy Reminders</div>
          <div style="display:flex;flex-direction:column;gap:7px;">
            <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text2);">
              <span style="color:var(--success);font-weight:700;flex-shrink:0;">✓</span>
              Use only approved AI tools listed in your organisation's registry.
            </div>
            <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text2);">
              <span style="color:var(--success);font-weight:700;flex-shrink:0;">✓</span>
              Do not include credentials, passwords, or confidential client data in prompts.
            </div>
            <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text2);">
              <span style="color:var(--success);font-weight:700;flex-shrink:0;">✓</span>
              Review all AI-generated output before sharing externally.
            </div>
            <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text2);">
              <span style="color:var(--success);font-weight:700;flex-shrink:0;">✓</span>
              Sensitive data classifications must follow your data governance framework.
            </div>
          </div>
        </div>

      </div>`;
  }

  // ── Show/hide revised prompt box based on whether task is blocked ──
  const refinementBox = document.getElementById('refinementBox');
  if (refinementBox) {
    refinementBox.style.display = data.policy_blocked ? 'none' : '';
  }

  // Show/hide Edit-Copy-Save toolbar
  const promptToolbar = document.getElementById('promptToolbar');
  if (promptToolbar) {
    promptToolbar.style.display = data.policy_blocked ? 'none' : 'flex';
  }
  // Reset edit mode if re-generating
  cancelPromptEdit();

  // Reset revised banner
  const revisedBanner = document.getElementById('revisedBanner');
  if (revisedBanner) {
    revisedBanner.style.display = 'none';
    revisedBanner.textContent   = '';
  }
  const refinementInput = document.getElementById('refinementInput');
  if (refinementInput) refinementInput.value = '';

  // Reset active tab to CORLO Prompt (first tab)
  document.querySelectorAll('.output-tab').forEach((t, i)  => t.classList.toggle('active', i === 0));
  document.querySelectorAll('.output-panel').forEach((p, i) => p.classList.toggle('active', i === 0));

  // Enforce access badges once prefs are definitely loaded (fixes race condition
  // where render runs before the /api/user-ai-tools/preferences fetch completes)
  const _mainTool = data.recommended_tool;
  (window._personalization?.waitForPrefs?.() || Promise.resolve()).then(() => {
    _enforceToolAccessButtons(_mainTool);
  });
}

/* ── Replace Open buttons with no-access message for tools the user can't access ── */
function _enforceToolAccessButtons(mainTool) {
  if (!window._personalization) return;

  // Main recommendation Open button
  const recBtn = document.getElementById('toolRecOpenBtn');
  if (recBtn && mainTool && !window._personalization.hasToolAccess(mainTool)) {
    recBtn.outerHTML = `<span class="tool-no-access-msg" style="flex-shrink:0;white-space:nowrap;font-size:11.5px;color:#ef4444;font-weight:600;">You don't have access to this Tool</span>`;
  }

  // Alternative tool Open buttons
  document.querySelectorAll('[id^="alt-btn-"]').forEach(el => {
    if (el.tagName !== 'BUTTON') return;  // already a no-access span, skip
    const onclick = el.getAttribute('onclick') || '';
    const match   = onclick.match(/openAlternativeTool\('([^']+)'\)/);
    if (!match) return;
    if (!window._personalization.hasToolAccess(match[1])) {
      el.outerHTML = `<span class="tool-no-access-msg" style="flex-shrink:0;font-size:11px;color:#ef4444;font-weight:600;">You don't have access to this Tool</span>`;
    }
  });
}

/* ══════════════════════════════════════
   REFINEMENT — user adds a comment to revise the CORLO prompt
   The LLM rewrites the prompt based on the user's feedback.
══════════════════════════════════════ */
async function handleRefine() {
  const comment = document.getElementById('refinementInput').value.trim();
  if (!comment)        { showToast('Please enter a comment first.', 'error'); return; }
  if (!currentAuditId) { showToast('No result to refine yet.', 'error');     return; }

  const spinner = document.getElementById('refineSpinner');
  const btn     = document.getElementById('btnRefine');
  btn.disabled  = true;
  if (spinner) spinner.style.display = 'inline';

  try {
    const res = await fetch(API.refine, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        audit_id:         currentAuditId,
        user_input:       currentInput,
        corlo_prompt:     currentCorlo,
        llm_output:       currentOutput,
        comment:          comment,
        role:             currentRole,
        task_type:        currentTaskType,
        data_sensitivity: 'general',
        intent:           currentIntent,
        industry:         currentIndustry,
        recommended_tool: currentTool,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error ${res.status}`);
    }

    const data = await res.json();

    // Update tracked corlo so a second refinement builds on this version
    currentCorlo  = data.revised_output;
    currentOutput = data.revised_output;

    // Show the revised prompt in the CORLO Prompt panel
    const promptPanel = document.getElementById('resultPrompt');
    if (promptPanel) promptPanel.innerHTML = _formatPromptHtml(data.revised_output);

    // Show revised banner
    const banner = document.getElementById('revisedBanner');
    if (banner) {
      banner.textContent     = '✅ Prompt revised based on your feedback.';
      banner.style.display   = 'block';
    }

    // Switch to CORLO Prompt tab to show the revision
    document.querySelectorAll('.output-tab').forEach((t, i)  => t.classList.toggle('active', i === 0));
    document.querySelectorAll('.output-panel').forEach((p, i) => p.classList.toggle('active', i === 0));

    document.getElementById('refinementInput').value = '';
    showToast('Prompt revised successfully.', 'success');

  } catch (err) {
    showToast(`Refinement failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
  }
}


/* ══════════════════════════════════════
   FEEDBACK
══════════════════════════════════════ */
function initFeedback() {
  // Stars-based inline feedback removed — use the Provide Feedback button instead
}

async function openResponseFeedback(auditId) {
  // Per-response entry: opens the Feedback form locked to "This Response".
  // Used by the History row's "Provide Feedback on this Response" button.
  // The user cannot switch to General Feedback from here — they must use the
  // global Feedback FAB for that.
  // Pre-fills if a feedback row already exists for this audit.
  const id = auditId || currentAuditId || '';
  let existing   = null;
  let taskSource = '';
  try {
    if (id) {
      const res  = await fetch(`/api/feedback/by-audit/${encodeURIComponent(id)}`);
      const data = res.ok ? await res.json() : { feedback: null };
      existing   = data.feedback || null;
      // Server always returns the audit's task_source at the top level so we
      // can render the "From Library" / "Own Task" chip even for audits that
      // don't have any feedback yet.
      taskSource = (data.task_source || existing?.task_source || '').toLowerCase();
    }
  } catch { /* silent — open form anyway */ }

  if (typeof window.openUnifiedFeedback === 'function') {
    // locked=true → dropdown is disabled, only "This Response" is offered.
    window.openUnifiedFeedback(id, existing, /* locked */ true, taskSource);
  } else if (typeof window.openFeedbackForm === 'function') {
    // Fallback to old API
    window.openFeedbackForm(id);
  }
}




/* ══════════════════════════════════════
   RECENT RUNS — Home empty-state shortcut
   Pulls the user's last few audit rows so the "Ready to generate" panel
   doubles as a quick history shortcut. Hidden when there are no rows
   yet, and when the user starts a task (Step 1 panel transitions out).
══════════════════════════════════════ */
async function initRecentRuns() {
  const list   = document.getElementById('homeRecentList');
  const block  = document.getElementById('homeRecentBlock');
  const moreBtn = document.getElementById('homeRecentMore');
  if (!list || !block) return;

  list.innerHTML = '';
  block.style.display = 'none';

  // "See all" jumps to the History tab via existing nav handler.
  if (moreBtn && !moreBtn._wired) {
    moreBtn._wired = true;
    moreBtn.addEventListener('click', () => {
      // History no longer lives in top tabs; navigateTo() activates the page directly.
      if (typeof navigateTo === 'function') navigateTo('history');
      else document.getElementById('dropMyHistory')?.click();
    });
  }

  try {
    const sessionRole  = _getSessionRole();
    const sessionEmail = _getSessionEmail();
    const url = sessionRole === 'admin'
      ? `${API.audit}?limit=5`
      : `${API.audit}?limit=5&user_email=${encodeURIComponent(sessionEmail || '')}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return;

    list.innerHTML = rows.slice(0, 5).map(row => {
      const text = (row.raw_input || '—').replace(/\s+/g, ' ').trim();
      const snippet = text.length > 70 ? text.slice(0, 70) + '…' : text;
      const tool = row.recommended_tool || '—';
      const when = formatDate(row.created_at);
      return `
        <button type="button" class="recent-run-row" data-id="${escapeHtml(row.id)}"
                title="${escapeHtml(text)}">
          <div class="recent-run-text">${escapeHtml(snippet)}</div>
          <div class="recent-run-meta">
            ${_taskSourceBadge(row.task_source)}
            <span>${escapeHtml(tool)}</span>
            <span>·</span>
            <span>${escapeHtml(when)}</span>
          </div>
        </button>`;
    }).join('');

    list.querySelectorAll('.recent-run-row').forEach(btn => {
      btn.addEventListener('click', () => openLogModal(btn.dataset.id));
    });

    block.style.display = '';
  } catch {
    // Silent fail — recent runs are a nice-to-have; absence is fine.
  }
}


/* ══════════════════════════════════════
   HISTORY  (paginated + downloadable)
   ──────────────────────────────────────
   • Default: 30 rows per page, sorted newest-first.
   • Admin view shows every user; non-admin view scopes to own email.
   • Prev / Next buttons + "Showing X–Y of Z" count.
   • Download button serialises the SAME filter as the on-screen view
     and links to /api/export/audit.csv → browser downloads CSV.
══════════════════════════════════════ */
const HISTORY_PER_PAGE = 30;
let _historyPage = 1;

/** Build the query-string the History page uses (sans page/per_page),
 *  shared by loadHistory() and the Download href so the CSV always
 *  matches what's on screen. */
function _buildHistoryFilterQS() {
  const isAdmin      = _getSessionRole() === 'admin';
  const sessionEmail = _getSessionEmail();
  const params = new URLSearchParams();
  if (!isAdmin) params.set('user_email', sessionEmail || '');
  return params;
}

async function loadHistory(page = _historyPage) {
  _historyPage = Math.max(1, parseInt(page, 10) || 1);

  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  const sessionRole  = _getSessionRole();
  const isAdmin      = sessionRole === 'admin';

  const titleEl    = document.getElementById('historyPageTitle');
  const subtitleEl = document.getElementById('historyPageSubtitle');
  if (titleEl)    titleEl.textContent    = isAdmin ? 'All activity' : 'My activity';
  if (subtitleEl) subtitleEl.textContent = isAdmin
    ? 'Tasks across all users.'
    : `Tasks from your account.`;

  // Wire/refresh the Download anchor — ADMIN ONLY. Regular users see
  // their own history but cannot bulk-export it. For admins the href
  // mirrors the current page filter (which for admins is unscoped =
  // all users).
  const dl = document.getElementById('btnDownloadHistory');
  if (dl) {
    if (isAdmin) {
      const dlParams = _buildHistoryFilterQS();
      dl.href = `/api/export/audit.csv?${dlParams.toString()}`;
      dl.style.display = '';
    } else {
      dl.style.display = 'none';
    }
  }

  const pageQS = _buildHistoryFilterQS();
  pageQS.set('page',     String(_historyPage));
  pageQS.set('per_page', String(HISTORY_PER_PAGE));

  try {
    const res  = await fetch(`${API.audit}?${pageQS.toString()}`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();

    // Backend pagination shape: { total, page, per_page, pages, items }
    const items = Array.isArray(data) ? data : (data.items || []);
    const total = Array.isArray(data) ? items.length : (data.total || 0);
    const pages = Array.isArray(data) ? 1            : (data.pages || 1);

    if (!items.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>${isAdmin ? 'No tasks recorded yet.' : 'Your tasks will appear here once you generate one.'}</p>
        </div>`;
      _renderHistoryPagination(0, 0, 1);
      return;
    }

    list.innerHTML = items.map(row => `
      <div class="history-item">
        <div class="history-item-icon"><img src="/static/Images/Navigator.svg" alt="AI Navigator" /></div>
        <div class="history-item-body">
          <div class="history-item-input" title="${escapeHtml(row.raw_input || '')}">${escapeHtml(row.raw_input || '—')}</div>
          <div class="history-item-meta">
            ${_taskSourceBadge(row.task_source)}
            ${isAdmin && row.user_email ? `<span class="history-email-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escapeHtml(row.user_email)}</span>` : ''}
            <span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px;opacity:0.65;"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>${capitalize(row.intent || '—')}</span>
            <span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px;opacity:0.65;"><path d="M3 21V8l7-4 7 4v13"/><path d="M14 21h7v-9l-4-2"/><path d="M9 9v.01M9 13v.01M9 17v.01"/></svg>${capitalize(row.industry || '—')}</span>
            <span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px;opacity:0.65;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>${escapeHtml(row.recommended_tool || '—')}</span>
            <span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px;opacity:0.65;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${formatDate(row.created_at)}</span>
          </div>
        </div>
        <div class="history-item-actions">
          <button class="btn btn-secondary btn-sm" onclick="openLogModal('${row.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            View
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openResponseFeedback('${row.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Provide Feedback on this Response
          </button>
          <button class="btn btn-primary btn-sm" onclick="openHistoryRegenerateModal('${encodeURIComponent(row.raw_input || '')}', '${encodeURIComponent(row.role || '')}', '${encodeURIComponent(row.task_type || '')}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            Regenerate
          </button>
        </div>
      </div>
    `).join('');

    _renderHistoryPagination(total, items.length, pages);

  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>Couldn't load your tasks. Try refreshing.</p></div>`;
    _renderHistoryPagination(0, 0, 1);
  }
}

/** Update the footer + header count.
 *  Header (#historyTotalCount): "X logs total" — always visible when data > 0.
 *  Footer (#historyPagination): "Page X of Y" centered between Prev/Next,
 *  hidden when there's only one page so the UI stays clean. */
function _renderHistoryPagination(total, shownCount, totalPages) {
  const wrap       = document.getElementById('historyPagination');
  const info       = document.getElementById('historyPageInfo');
  const prevBtn    = document.getElementById('historyPrevBtn');
  const nextBtn    = document.getElementById('historyNextBtn');
  const totalCount = document.getElementById('historyTotalCount');
  if (!wrap || !info || !prevBtn || !nextBtn) return;

  // Header count — populated whenever we have data, cleared otherwise.
  if (totalCount) {
    totalCount.textContent = total
      ? `${total} log${total === 1 ? '' : 's'} total`
      : '';
  }

  // No data OR single page → hide pagination footer entirely.
  if (!total || totalPages <= 1) {
    wrap.style.display = 'none';
    return;
  }

  info.textContent = `Page ${_historyPage} of ${totalPages}`;
  prevBtn.disabled = _historyPage <= 1;
  nextBtn.disabled = _historyPage >= totalPages;
  wrap.style.display = 'flex';
}

document.getElementById('btnRefreshHistory')?.addEventListener('click', () => loadHistory(_historyPage));
document.getElementById('historyPrevBtn')?.addEventListener('click', () => {
  if (_historyPage > 1) loadHistory(_historyPage - 1);
});
document.getElementById('historyNextBtn')?.addEventListener('click', () => {
  loadHistory(_historyPage + 1);
});


/* ══════════════════════════════════════
   AI TOOLS PAGE
══════════════════════════════════════ */
/* ── Tool role mapping ── */
const TOOL_ROLE_MAP = {
  sales:      ['axet.gaia','cassidy','chatgpt','microsoft copilot','loopio','hubspot','partner copilot','clay','sales research assistant'],
  consulting: ['genai amplifier (poc)','sales research assistant','sherlock ai','strategic insights ai','axet.gaia','axet.wise','axet.talk','cassidy','chatgpt','microsoft copilot','synthesia'],
  hr:         ['hr chatbot','axet.gaia','chatgpt','microsoft copilot','synthesia'],
  finance:    ['icertis','axet.gaia','axet.wise','chatgpt','microsoft copilot'],
  marketing:  ['axet.gaia','chatgpt','microsoft copilot','hubspot','jasper','synthesia'],
  ams:        ['ams process assistant','ai ticket bot','strategic insights ai','axet.talk','genai amplifier (poc)','axet.gaia','cassidy','chatgpt','microsoft copilot'],
  developer:  ['axet.gaia','axet.plugin','axet.oasis','axet.flows','chatgpt','microsoft copilot'],
  operations: ['cassidy','axet.flows','axet.gaia','chatgpt','microsoft copilot','synthesia'],
};

let _toolsData        = null;
let _toolsView        = 'tile';
let _toolsTab         = 'all';
let _toolsSearch      = '';
// Intent search — applied only on Enter / Apply click (NOT on keystroke).
// Token-scored against best_for / strong_signals / output_type / category /
// roles / description / name so users can paste a natural-language intent
// ("Converting meeting transcript into RICEF documents") and get the
// loosely-matching tools sorted best-match first.
let _toolsIntentSearch = '';
let _toolsCategory    = '';

/* ── Intent-search tokenizer (shared shape with scenario library) ──
   Lowercase → split on non-word chars → drop short + stop-words → dedupe. */
const _TOOLS_STOP_WORDS = new Set([
  'a','an','the','and','or','but','of','in','on','at','to','for','with',
  'from','by','as','is','are','was','were','be','been','being','it','its',
  'this','that','these','those','i','my','me','we','our','you','your',
  'can','could','should','would','will','may','might','do','does','did',
  'have','has','had','if','then','than','so','into','onto','via','using',
  'use','used','about','any','some','all','each','also','just','only',
  'how','what','when','where','which','who','why','need','want','help',
]);
function _tokenizeIntent(q) {
  if (!q) return [];
  const raw = String(q).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [], seen = new Set();
  for (const t of raw) {
    if (t.length < 2 || _TOOLS_STOP_WORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
/* IDF weights for the tools corpus. Rare/specific tokens (e.g. "ricef",
   "wricef") get a high weight; generic tokens ("document", "create") get
   a low weight. Formula: log((N+1)/(df+1)) + 1 (smooth IDF). */
function _computeToolsIdfWeights(tokens, allEntries) {
  const N = allEntries.length || 1;
  const weights = {};
  for (const t of tokens) {
    const df = allEntries.reduce((c, [name, info]) => {
      const arrJoin = (a) => Array.isArray(a) ? a.join(' ') : '';
      const hay = [
        name, info.description, info.desc_content, info.category, info.output_type,
        arrJoin(info.best_for), arrJoin(info.strong_signals),
        arrJoin(info.not_for),  arrJoin(info.weak_signals), arrJoin(info.roles),
      ].some(v => String(v || '').toLowerCase().includes(t));
      return c + (hay ? 1 : 0);
    }, 0);
    weights[t] = Math.log((N + 1) / (df + 1)) + 1;
  }
  return weights;
}

/* ── Update sidebar nav counts and active state ── */
function _updateToolsNav() {
  if (!_toolsData) return;
  const allEntries = Object.entries(_toolsData);

  /* update "All Tools" count */
  const countBadge = document.getElementById('toolsCountBadge');
  if (countBadge) countBadge.textContent = allEntries.length;

  /* update per-role counts */
  document.querySelectorAll('#toolsNavRoles .tools-nav-item').forEach(item => {
    const role    = item.dataset.role;
    const allowed = TOOL_ROLE_MAP[role] || [];
    const count   = allEntries.filter(([n]) => allowed.includes(n.toLowerCase())).length;
    const badge   = item.querySelector('.tools-nav-count');
    if (badge) badge.textContent = count;
  });

  /* active state */
  document.querySelectorAll('.tools-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.role === _toolsTab);
  });
}

/* ── Populate category dropdown ── */
function _updateToolsCategoryFilter() {
  const sel = document.getElementById('toolsCategoryFilter');
  if (!sel || !_toolsData) return;
  let entries = Object.entries(_toolsData);
  if (_toolsTab !== 'all') {
    const allowed = TOOL_ROLE_MAP[_toolsTab] || [];
    entries = entries.filter(([n]) => allowed.includes(n.toLowerCase()));
  }
  const cats = [...new Set(entries.map(([, v]) => v.category || '').filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}"${_toolsCategory === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

async function loadTools() {
  const grid = document.getElementById('toolsGrid');
  if (!grid) return;
  if (!_toolsData) {
    grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    try {
      const res  = await fetch(API.tools, { signal: AbortSignal.timeout(10000) });
      _toolsData = await res.json();
    } catch (err) {
      grid.innerHTML = `<div class="empty-state"><p>Failed to load tools. Please try again.</p></div>`;
      return;
    }
  }

  _updateToolsNav();
  _updateToolsCategoryFilter();

  /* role filter */
  let entries = Object.entries(_toolsData);
  if (_toolsTab !== 'all') {
    const allowed = TOOL_ROLE_MAP[_toolsTab] || [];
    entries = entries.filter(([name]) => allowed.includes(name.toLowerCase()));
  }

  /* category filter */
  if (_toolsCategory) {
    entries = entries.filter(([, info]) => (info.category || '') === _toolsCategory);
  }

  /* search filter */
  if (_toolsSearch.trim()) {
    const q = _toolsSearch.toLowerCase();
    entries = entries.filter(([name, info]) =>
      name.toLowerCase().includes(q) ||
      (info.desc_content || info.description || '').toLowerCase().includes(q) ||
      (info.category || '').toLowerCase().includes(q)
    );
  }

   /* intent filter — IDF-weighted scoring so specific/rare terms
     (e.g. "wricef", "ricef") dominate the relevance score and generic
     words ("document", "generate") contribute proportionally less.
     Threshold: a tool must score >= 45% of the max possible weighted
     score to appear, then results are sorted best-match first. */
  if (_toolsIntentSearch.trim()) {
    const tokens = _tokenizeIntent(_toolsIntentSearch);
    if (tokens.length) {
      const allToolEntries = Object.entries(_toolsData || {});
      const idfWeights = _computeToolsIdfWeights(tokens, allToolEntries);
      const maxScore   = tokens.reduce((sum, t) => sum + (idfWeights[t] || 1), 0);
      const threshold  = maxScore * 0.45;
      const scored = [];
      for (const [name, info] of entries) {
        const arrJoin = (a) => Array.isArray(a) ? a.join(' ') : '';
        const hay = [
          name,
          info.description, info.desc_content, info.category, info.output_type,
          arrJoin(info.best_for), arrJoin(info.strong_signals),
          arrJoin(info.not_for),  arrJoin(info.weak_signals),
          arrJoin(info.roles),
        ].map(v => String(v || '').toLowerCase()).join('  ');
        const nameLower = String(name || '').toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (hay.includes(t)) {
            const w = idfWeights[t] || 1;
            score += w;
            if (nameLower.includes(t)) score += w * 0.5;
          }
        }
        if (score >= threshold) scored.push([name, info, score]);
      }
      scored.sort((a, b) => b[2] - a[2]);
      entries = scored.map(([n, i]) => [n, i]);
    }
  }

  if (!entries.length) {
    // Distinguish "filtered to nothing" from "registry is genuinely empty".
    const totalTools  = Object.keys(_toolsData || {}).length;
    const isFiltering = !!(_toolsSearch.trim() || _toolsIntentSearch.trim() || _toolsCategory || _toolsTab !== 'all');
    const isAdmin     = _getSessionRole() === 'admin';
    let emptyHtml;
    if (totalTools === 0) {
      // Genuinely empty registry — role-aware CTA
      emptyHtml = isAdmin
        ? `<div class="empty-state" style="grid-column:1/-1;padding:60px 24px;text-align:center;">
             <div style="font-size:48px;margin-bottom:14px;">🛠</div>
             <h3 style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">No tools registered yet</h3>
             <p style="color:var(--text2);max-width:380px;margin:0 auto 18px;font-size:13.5px;line-height:1.55;">
               Upload your master Excel registry, or add tools individually via <strong>Register tool</strong>.
             </p>
             <button id="emptyToolsRegister" class="btn btn-primary" style="margin:0 auto;">+ Register a Tool</button>
           </div>`
        : `<div class="empty-state" style="grid-column:1/-1;padding:60px 24px;text-align:center;">
             <div style="font-size:48px;margin-bottom:14px;">🛠</div>
             <h3 style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">No tools available yet</h3>
             <p style="color:var(--text2);max-width:380px;margin:0 auto;font-size:13.5px;line-height:1.55;">
               An administrator hasn't added any tools to this workspace.
               In the meantime, you can still describe your task on the Home page for general guidance.
             </p>
           </div>`;
    } else if (isFiltering) {
      emptyHtml = `<div class="empty-state" style="grid-column:1/-1;padding:60px 24px;text-align:center;">
                     <div style="font-size:40px;margin-bottom:12px;">🔎</div>
                     <h3 style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">No tools match your filters</h3>
                     <p style="color:var(--text2);font-size:13px;">Try clearing the search box or selecting a different category.</p>
                   </div>`;
    } else {
      emptyHtml = `<div class="empty-state" style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text3);">No tools found</div>`;
    }
    grid.innerHTML = emptyHtml;
    // Wire the empty-state CTA (admin only)
    document.getElementById('emptyToolsRegister')?.addEventListener('click', () => {
      document.getElementById('btnRegisterTool')?.click();
    });
    return;
  }

  // Admin-only affordances (Edit / Delete) are gated by session role.
  // Non-admin users see clean cards with no clickable controls they can't use.
  const isAdmin = _getSessionRole() === 'admin';

  grid.innerHTML = entries.map(([name, info]) => {
    const isDbTool   = info._source === 'db';
    const deleteItem = isDbTool
      ? `<button class="te-dots-item te-delete-item danger" data-tool-name="${escapeHtml(name)}">🗑 Delete Tool</button>`
      : '';
    const dotsMenu = isAdmin
      ? `<div class="te-dots-wrap">
            <button class="te-dots-btn" data-tool-name="${escapeHtml(name)}" title="Options">&#8942;</button>
            <div class="te-dots-dropdown">
              <button class="te-dots-item te-edit-item" data-tool-name="${escapeHtml(name)}">✏️ Edit Tool</button>
              ${deleteItem}
            </div>
          </div>`
      : '';
    // Native hover tooltip removed — keeping the data here in case we want
    // to surface it elsewhere (e.g. detail modal) later.
    // const _desc = (info.hover_description || '').trim();
    // const _tooltip = _desc ? escapeHtml(_desc) : '';

    return `
      <div class="tool-card" data-tool-name="${escapeHtml(name.toLowerCase())}">
        <div class="tool-card-header" style="display:flex;align-items:flex-start;gap:10px;position:relative;">
          <div class="tool-icon">${_toolIconHtml(name, info.icon, 28)}</div>
          <div style="flex:1;min-width:0;">
            <span class="tool-name">${escapeHtml(name)}</span>
            <div class="tool-category">${escapeHtml(info.category || '')}</div>
          </div>
          ${dotsMenu}
        </div>
        <p class="tool-desc">${escapeHtml(info.desc_content || info.description || '')}</p>
        ${info.url
          ? ((window._personalization?.hasToolAccess(name) ?? true)
              ? `<a href="${escapeHtml(info.url)}" target="_blank" rel="noopener" class="tool-link">Visit</a>`
              : `<span class="tool-no-access-msg" style="font-size:12px;color:#ef4444;font-weight:600;display:block;margin-top:6px;">You don't have access to this Tool</span>`)
          : ''}
      </div>`;
  }).join('');

  if (typeof attachToolCardDots === 'function') attachToolCardDots(grid);
}

function initToolsPage() {
  /* ── sidebar nav clicks ── */
  document.querySelectorAll('.tools-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      _toolsTab      = item.dataset.role;
      _toolsCategory = '';
      const catSel = document.getElementById('toolsCategoryFilter');
      if (catSel) catSel.value = '';
      const roleSelMobile = document.getElementById('toolsRoleSelectMobile');
      if (roleSelMobile) roleSelMobile.value = _toolsTab || 'all';
      loadTools();
    });
  });

  /* ── mobile role dropdown — populate + wire (replaces sidebar pills on phone) ── */
  const roleSelMobile = document.getElementById('toolsRoleSelectMobile');
  if (roleSelMobile && !roleSelMobile._wired) {
    roleSelMobile._wired = true;
    // Populate from the same role list rendered as sidebar pills
    const opts = [['all', 'All tools']];
    document.querySelectorAll('#toolsNavRoles .tools-nav-item').forEach(item => {
      const role  = item.dataset.role;
      const label = item.querySelector('.tools-nav-label')?.textContent?.trim() || role;
      if (role && role !== 'all') opts.push([role, label]);
    });
    roleSelMobile.innerHTML = opts
      .map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
    roleSelMobile.value = _toolsTab || 'all';
    roleSelMobile.addEventListener('change', () => {
      _toolsTab = roleSelMobile.value;
      _toolsCategory = '';
      const catSel = document.getElementById('toolsCategoryFilter');
      if (catSel) catSel.value = '';
      loadTools();
    });
  }

  /* ── unified search ──
     Typing → keyword live filter (instant substring match).
     Apply button or Enter → intent filter (token-scored semantic match). */
  const searchEl  = document.getElementById('toolsSearch');
  const intentBtn = document.getElementById('toolsIntentSearchBtn');
  if (searchEl) {
    const fresh = searchEl.cloneNode(true);
    searchEl.parentNode.replaceChild(fresh, searchEl);
    let t;

    fresh.addEventListener('input', () => {
      clearTimeout(t);
      _toolsIntentSearch = '';
      t = setTimeout(() => { _toolsSearch = fresh.value; loadTools(); }, 250);
    });

    const applyIntent = () => {
      clearTimeout(t);
      _toolsSearch = '';
      _toolsIntentSearch = fresh.value;
      loadTools();
    };

    fresh.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyIntent(); }
    });
    fresh.addEventListener('search', () => {
      if (!fresh.value.trim()) {
        _toolsSearch = '';
        _toolsIntentSearch = '';
        loadTools();
      }
    });

    if (intentBtn) {
      const freshBtn = intentBtn.cloneNode(true);
      intentBtn.parentNode.replaceChild(freshBtn, intentBtn);
      freshBtn.addEventListener('click', applyIntent);
    }
  }

  /* ── category filter ── */
  const catSel = document.getElementById('toolsCategoryFilter');
  if (catSel) {
    catSel.addEventListener('change', () => {
      _toolsCategory = catSel.value;
      loadTools();
    });
  }

  /* ── view toggle ── */
  const tileBtn = document.getElementById('btnTileView');
  const rowBtn  = document.getElementById('btnRowView');
  if (tileBtn) {
    const fresh = tileBtn.cloneNode(true);
    tileBtn.parentNode.replaceChild(fresh, tileBtn);
    fresh.addEventListener('click', () => {
      _toolsView = 'tile';
      document.getElementById('toolsGrid')?.classList.remove('row-view');
      fresh.classList.add('active');
      document.getElementById('btnRowView')?.classList.remove('active');
    });
  }
  if (rowBtn) {
    const fresh = rowBtn.cloneNode(true);
    rowBtn.parentNode.replaceChild(fresh, rowBtn);
    fresh.addEventListener('click', () => {
      _toolsView = 'row';
      document.getElementById('toolsGrid')?.classList.add('row-view');
      fresh.classList.add('active');
      document.getElementById('btnTileView')?.classList.remove('active');
    });
  }
}


/* ══════════════════════════════════════
   OPEN ALTERNATIVE TOOL — looks up URL from registry or navigates to tools page
══════════════════════════════════════ */
async function openAlternativeTool(toolName) {
  try {
    const res  = await fetch(API.tools);
    const data = await res.json();
     const _tn  = toolName.toLowerCase();
     // 1. Exact case-insensitive match
     let key = Object.keys(data).find(k => k.toLowerCase() === _tn);
     // 2. Registry key starts with the tool name (e.g. "ChatGPT (OpenAI)" vs "ChatGPT")
     if (!key) key = Object.keys(data).find(k => k.toLowerCase().startsWith(_tn));
     // 3. Tool name starts with the registry key
     if (!key) key = Object.keys(data).find(k => _tn.startsWith(k.toLowerCase()));
     // 4. Either contains the other
     if (!key) key = Object.keys(data).find(k => k.toLowerCase().includes(_tn) || _tn.includes(k.toLowerCase()));
     if (key && data[key] && data[key].url) {
       window.open(data[key].url, '_blank', 'noopener');
     } else {
      // Fallback: navigate to AI Tools page so user can find it
      showToast(`Opening AI Tools page — search for "${toolName}"`, 'success');
      if (typeof navigateTo === 'function') navigateTo('tools');
      document.querySelectorAll('.nav-tab').forEach(n =>
        n.classList.toggle('active', n.dataset.page === 'tools'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-tools')?.classList.add('active');
      loadTools();
    }
  } catch {
    showToast(`Could not open "${toolName}". Please check AI Tools page.`, 'error');
  }
}


/* ══════════════════════════════════════
   REGISTER TOOL
══════════════════════════════════════ */
(function initRegisterTool() {
  const overlay    = () => document.getElementById('registerToolOverlay');
  const splitCsv   = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);

  let _activeTab = 'manual';
  let _bulkSelectedFile = null;
  let _bulkUploading    = false;
  let _bulkAbortCtrl    = null;

  function _activateTab(tabName) {
    _activeTab = tabName;
    document.querySelectorAll('#registerToolOverlay .te-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.rttab === tabName);
    });
    document.querySelectorAll('#registerToolOverlay .te-panel').forEach(p => {
      const isActive = p.dataset.rtpanel === tabName;
      p.classList.toggle('active', isActive);
      p.style.display = isActive ? '' : 'none';
    });
    const saveBtn = document.getElementById('btnSaveRegisterTool');
    if (saveBtn) {
      if (tabName === 'fileupload') {
        saveBtn.style.display = 'none';
      } else {
        saveBtn.style.display = '';
      }
    }
    const bulkBtn = document.getElementById('rtBulkUploadBtn');
    if (bulkBtn) {
      bulkBtn.style.display = tabName === 'fileupload' ? '' : 'none';
    }
  }

  function _openModal(prefill = {}) {
    const ov = overlay();
    ov._editMode    = false;
    ov._editingName = null;
    document.getElementById('registerToolTitle').textContent = 'Register tool';
    document.getElementById('rtToolName').value      = prefill.tool_name     || '';
    document.getElementById('rtCategory').value      = prefill.category      || '';
    document.getElementById('rtUrl').value           = prefill.url           || '';
    document.getElementById('rtIcon').value          = prefill.icon          || '🤖';
    document.getElementById('rtDescription').value   = prefill.description   || '';
    document.getElementById('rtBestFor').value       = (prefill.best_for     || []).join(', ');
    document.getElementById('rtNotFor').value        = (prefill.not_for      || []).join(', ');
    document.getElementById('rtStrongSignals').value = (prefill.strong_signals|| []).join(', ');
    document.getElementById('rtWeakSignals').value   = (prefill.weak_signals  || []).join(', ');
    document.getElementById('rtRoles').value         = (prefill.roles         || []).join(', ');
    document.getElementById('rtOutputType').value    = prefill.output_type    || '';
    document.getElementById('rtIsInternal').checked  = !!prefill.is_internal;
    document.getElementById('rtExtractStatus').style.display = 'none';
    document.getElementById('rtFileChips').innerHTML = '';
    document.getElementById('rtFileInput').value = '';
    const editNote = document.getElementById('rtEditModeNote');
    if (editNote) editNote.style.display = 'none';
    const rd = prefill.raw_data || {};
    document.querySelectorAll('#registerToolOverlay [data-rd-key]').forEach(el => {
      el.value = rd[el.dataset.rdKey] !== undefined ? String(rd[el.dataset.rdKey]) : '';
    });
    _activateTab('manual');
    _resetBulk();
    ov.classList.add('open');
  }

  function _closeModal() {
    overlay().classList.remove('open');
    document.getElementById('registerToolTitle').textContent = 'Register tool';
    const ov = overlay();
    ov._editMode    = false;
    ov._editingName = null;
    const editNote = document.getElementById('rtEditModeNote');
    if (editNote) editNote.style.display = 'none';
    _resetBulk();
  }

  function _resetBulk() {
    if (_bulkUploading && _bulkAbortCtrl) { _bulkAbortCtrl.abort(); _bulkUploading = false; }
    _bulkSelectedFile = null;
    _bulkUploading    = false;
    _bulkAbortCtrl    = null;
    const fi = document.getElementById('rtBulkFileInput');
    if (fi) fi.value = '';
    const info = document.getElementById('rtBulkFileInfo');
    if (info) info.style.display = 'none';
    const dz = document.getElementById('rtBulkDropZone');
    if (dz) dz.style.display = '';
    const st = document.getElementById('rtBulkStatus');
    if (st) { st.style.display = 'none'; st.textContent = ''; }
    const bulkBtn = document.getElementById('rtBulkUploadBtn');
    if (bulkBtn) { bulkBtn.disabled = true; bulkBtn.textContent = 'Upload & Apply'; }
  }

  document.getElementById('btnRegisterTool')?.addEventListener('click', () => _openModal());
  document.getElementById('btnCloseRegisterTool')?.addEventListener('click', _closeModal);
  document.getElementById('btnCancelRegisterTool')?.addEventListener('click', _closeModal);
  overlay()?.addEventListener('click', e => { if (e.target === overlay()) _closeModal(); });

  document.querySelectorAll('#registerToolOverlay .te-tab').forEach(tab => {
    tab.addEventListener('click', () => { if (tab.dataset.rttab) _activateTab(tab.dataset.rttab); });
  });

  document.getElementById('btnBrowseToolFiles')?.addEventListener('click', () => {
    document.getElementById('rtFileInput')?.click();
  });

  const zone = document.getElementById('rtFileZone');
  zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone?.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) _handleFiles(e.dataTransfer.files);
  });

  document.getElementById('rtFileInput')?.addEventListener('change', e => {
    if (e.target.files.length) _handleFiles(e.target.files);
  });

  async function _handleFiles(files) {
    const statusEl = document.getElementById('rtExtractStatus');
    const chipsEl  = document.getElementById('rtFileChips');
    const ov       = overlay();
    const isEdit   = ov._editMode;
    const editName = ov._editingName;

    chipsEl.innerHTML = Array.from(files).map(f =>
      `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:20px;font-size:12px;">
        📄 ${escapeHtml(f.name)}
      </span>`
    ).join('');

    statusEl.style.display = '';
    statusEl.style.color   = 'var(--text2)';
    statusEl.innerHTML     = '<span style="display:inline-flex;align-items:center;gap:8px;"><div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Extracting tool information from files…</span>';

    const form = new FormData();
    Array.from(files).forEach(f => form.append('files', f));

    if (isEdit && editName) {
      try {
        const kbForm = new FormData();
        Array.from(files).forEach(f => kbForm.append('files', f));
        const kbRes  = await fetch(API.toolDocsUpload, { method: 'POST', body: kbForm });
        const kbData = await kbRes.json();
        const total  = (kbData.files || []).reduce((s, f) => s + (f.chunks || 0), 0);
        statusEl.style.color = 'var(--success)';
        statusEl.innerHTML   = `✅ ${total} chunk(s) added to knowledge base for <strong>${escapeHtml(editName)}</strong>.`;
      } catch {
        statusEl.style.color = 'var(--danger)';
        statusEl.innerHTML   = '❌ Knowledge base upload failed. Fields below will still be extracted.';
      }
    }

    try {
      const res  = await fetch('/api/tools/extract-files', { method: 'POST', body: form });
      const data = await res.json();
      const ext  = data.extracted || {};

      if (Object.keys(ext).length) {
        if (isEdit) {
          const fields = [
            { id: 'rtDescription',   key: 'description',    type: 'text' },
            { id: 'rtCategory',      key: 'category',       type: 'text' },
            { id: 'rtUrl',           key: 'url',            type: 'text' },
            { id: 'rtIcon',          key: 'icon',           type: 'text' },
            { id: 'rtBestFor',       key: 'best_for',       type: 'list' },
            { id: 'rtNotFor',        key: 'not_for',        type: 'list' },
            { id: 'rtStrongSignals', key: 'strong_signals', type: 'list' },
            { id: 'rtWeakSignals',   key: 'weak_signals',   type: 'list' },
            { id: 'rtRoles',         key: 'roles',          type: 'list' },
            { id: 'rtOutputType',    key: 'output_type',    type: 'text' },
          ];
          fields.forEach(({ id, key, type }) => {
            const el = document.getElementById(id);
            if (!el || el.value.trim()) return;
            const val = ext[key];
            if (!val) return;
            el.value = type === 'list' ? (Array.isArray(val) ? val.join(', ') : val) : val;
          });
          statusEl.style.color = 'var(--success)';
          statusEl.innerHTML  += ' ℹ️ Empty fields pre-filled from document — review and save.';
        } else {
          _openModal(ext);
          statusEl.style.display = '';
          statusEl.style.color   = 'var(--success)';
          statusEl.innerHTML     = '✅ Information extracted — review and complete the fields below.';
        }
      } else {
        if (!isEdit) {
          statusEl.style.color = 'var(--text3)';
          statusEl.innerHTML   = 'ℹ️ Could not extract structured info. Please fill in the fields manually.';
        }
      }
    } catch {
      statusEl.style.color = 'var(--danger)';
      statusEl.innerHTML   = '❌ Extraction failed. Please fill in the fields manually.';
    }
  }

  /* ── Bulk (Excel) upload in File Upload tab ── */
  function _setBulkFile(file) {
    if (!file || !file.name.endsWith('.xlsx')) {
      _showBulkStatus('Please select a valid .xlsx file.', 'error'); return;
    }
    _bulkSelectedFile = file;
    const nameEl = document.getElementById('rtBulkFileName');
    if (nameEl) nameEl.textContent = file.name;
    const info = document.getElementById('rtBulkFileInfo');
    if (info) info.style.display = 'flex';
    const dz = document.getElementById('rtBulkDropZone');
    if (dz) dz.style.display = 'none';
    const bulkBtn = document.getElementById('rtBulkUploadBtn');
    if (bulkBtn) bulkBtn.disabled = false;
    const st = document.getElementById('rtBulkStatus');
    if (st) st.style.display = 'none';
  }

  function _showBulkStatus(msg, type) {
    const el = document.getElementById('rtBulkStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = '';
    el.style.display = 'block';
    el.style.background = type === 'error' ? 'var(--danger-pale,#fef2f2)' : 'var(--success-pale,#f0fdf4)';
    el.style.border = `1px solid ${type === 'error' ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'}`;
    el.style.color  = type === 'error' ? '#991b1b' : '#065f46';
  }

  document.getElementById('btnBrowseBulkTools')?.addEventListener('click', () => {
    document.getElementById('rtBulkFileInput')?.click();
  });
  document.getElementById('rtBulkFileInput')?.addEventListener('change', e => {
    if (e.target.files[0]) _setBulkFile(e.target.files[0]);
  });
  document.getElementById('rtBulkClearBtn')?.addEventListener('click', () => {
    _bulkSelectedFile = null;
    const fi = document.getElementById('rtBulkFileInput');
    if (fi) fi.value = '';
    const info = document.getElementById('rtBulkFileInfo');
    if (info) info.style.display = 'none';
    const dz = document.getElementById('rtBulkDropZone');
    if (dz) dz.style.display = '';
    const bulkBtn = document.getElementById('rtBulkUploadBtn');
    if (bulkBtn) bulkBtn.disabled = true;
  });

  const bulkDz = document.getElementById('rtBulkDropZone');
  bulkDz?.addEventListener('dragover', e => { e.preventDefault(); bulkDz.classList.add('dragover'); });
  bulkDz?.addEventListener('dragleave', () => bulkDz.classList.remove('dragover'));
  bulkDz?.addEventListener('drop', e => {
    e.preventDefault();
    bulkDz.classList.remove('dragover');
    if (e.dataTransfer.files[0]) _setBulkFile(e.dataTransfer.files[0]);
  });
  bulkDz?.addEventListener('click', () => document.getElementById('rtBulkFileInput')?.click());

  document.addEventListener('DOMContentLoaded', () => {
    const footerRight = document.getElementById('rtFooterRight');
    if (footerRight && !document.getElementById('rtBulkUploadBtn')) {
      const bulkBtn = document.createElement('button');
      bulkBtn.id = 'rtBulkUploadBtn';
      bulkBtn.className = 'te-btn te-btn-primary';
      bulkBtn.disabled = true;
      bulkBtn.style.display = 'none';
      bulkBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload & Apply';
      footerRight.appendChild(bulkBtn);

      bulkBtn.addEventListener('click', async () => {
        if (!_bulkSelectedFile) return;
        _bulkUploading  = true;
        _bulkAbortCtrl  = new AbortController();
        bulkBtn.disabled    = true;
        bulkBtn.textContent = 'Uploading…';
        const formData = new FormData();
        formData.append('file', _bulkSelectedFile);
        try {
          const res  = await fetch('/api/upload-tools-registry', { method: 'POST', body: formData, signal: _bulkAbortCtrl.signal });
          const data = await res.json();
          _bulkUploading = false;
          if (res.ok) {
            _showBulkStatus(`✅ ${data.tools_loaded} tools loaded from "${_bulkSelectedFile.name}".`, 'success');
            bulkBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload & Apply';
            _toolsData = null;
            if (typeof loadTools === 'function') loadTools();
            setTimeout(() => _closeModal(), 1800);
          } else {
            throw new Error(data.detail || 'Upload failed');
          }
        } catch (err) {
          _bulkUploading = false;
          if (err.name === 'AbortError') {
            _showBulkStatus('⛔ Upload cancelled.', 'error');
          } else {
            _showBulkStatus(`❌ ${err.message}`, 'error');
          }
          bulkBtn.disabled = false;
          bulkBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload & Apply';
        }
      });
    }
  });

  // Save (Manual Input tab)
  document.getElementById('btnSaveRegisterTool')?.addEventListener('click', async () => {
    const toolName = document.getElementById('rtToolName').value.trim();
    if (!toolName) { showToast('Tool name is required.', 'error'); return; }

    const btn    = document.getElementById('btnSaveRegisterTool');
    const isEdit = overlay()._editMode;
    btn.disabled    = true;
    btn.textContent = isEdit ? 'Saving changes…' : 'Saving…';

    const rawData = {};
    document.querySelectorAll('#registerToolOverlay [data-rd-key]').forEach(el => {
      rawData[el.dataset.rdKey] = el.value.trim();
    });

    const payload = {
      tool_name:      toolName,
      description:    document.getElementById('rtDescription').value.trim(),
      category:       document.getElementById('rtCategory').value.trim(),
      url:            document.getElementById('rtUrl').value.trim(),
      icon:           document.getElementById('rtIcon').value.trim() || '🤖',
      best_for:       splitCsv(document.getElementById('rtBestFor').value),
      not_for:        splitCsv(document.getElementById('rtNotFor').value),
      strong_signals: splitCsv(document.getElementById('rtStrongSignals').value),
      weak_signals:   splitCsv(document.getElementById('rtWeakSignals').value),
      roles:          splitCsv(document.getElementById('rtRoles').value),
      output_type:    document.getElementById('rtOutputType').value.trim(),
      is_internal:    document.getElementById('rtIsInternal').checked,
      explicit_edit:  isEdit,
      raw_data:       rawData,
    };

    try {
      const res  = await fetch('/api/tools/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        showToast(isEdit ? `"${toolName}" updated!` : `"${toolName}" registered successfully!`, 'success');
        _closeModal();
        _toolsData = null;
        loadTools();
      } else {
        throw new Error(data.detail || 'Save failed');
      }
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save';
    }
  });
})();


/* ══════════════════════════════════════
   TOOL KNOWLEDGE BASE
══════════════════════════════════════ */
(function initToolKnowledge() {

  async function loadStatus() {
    const tableWrap = document.getElementById('tkStatusTable');
    const body      = document.getElementById('tkStatusBody');
    const empty     = document.getElementById('tkEmptyState');
    if (!body) return;

    try {
      const res  = await fetch(API.toolDocsStatus);
      const data = await res.json();
      const rows = data.status || [];

      if (!rows.length) {
        tableWrap.style.display = 'none';
        empty.style.display     = '';
        return;
      }

      empty.style.display     = 'none';
      tableWrap.style.display = '';
      body.innerHTML = rows.map(r => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 10px;font-weight:600;color:var(--text);">
            ${escapeHtml(r.tool_name === 'unclassified'
              ? '⚠️ Unclassified'
              : r.tool_name)}
          </td>
          <td style="padding:8px 10px;text-align:center;">
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700;background:${r.tool_name === 'unclassified' ? '#FEF3C7' : '#EFF6FF'};color:${r.tool_name === 'unclassified' ? '#92400E' : '#1D4ED8'};">
              ${r.chunk_count}
            </span>
          </td>
          <td style="padding:8px 10px;color:var(--text3);font-size:12px;">
            ${(r.source_files || []).map(f => `
              <span style="display:inline-flex;align-items:center;gap:4px;margin:1px 3px;padding:2px 6px 2px 8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;">
                ${escapeHtml(f)}
                <button onclick="tkDeleteFile('${escapeHtml(f)}')"
                  title="Delete this file's chunks from vector DB"
                  style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:11px;padding:0 2px;line-height:1;"
                  onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--text3)'">✕</button>
              </span>`).join('')}
          </td>
          <td style="padding:8px 10px;text-align:center;">
            ${r.tool_name !== 'unclassified' ? `
              <button onclick="tkClearTool('${escapeHtml(r.tool_name)}')"
                style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:13px;padding:3px 6px;border-radius:4px;"
                title="Clear all knowledge for this tool"
                onmouseover="this.style.color='var(--danger)'"
                onmouseout="this.style.color='var(--text3)'">🗑</button>` : ''}
          </td>
        </tr>
      `).join('');
    } catch {
      body.innerHTML = '<tr><td colspan="4" style="padding:12px;color:var(--text3);text-align:center;">Failed to load status.</td></tr>';
      tableWrap.style.display = '';
    }
  }

  window.tkClearTool = async function(toolName) {
    if (!confirm(`Clear all knowledge chunks for "${toolName}"?`)) return;
    try {
      await fetch(API.toolDocsClearTool(toolName), { method: 'DELETE' });
      showToast(`Knowledge cleared for "${toolName}".`, 'success');
      loadStatus();
    } catch {
      showToast('Failed to clear.', 'error');
    }
  };

  window.tkDeleteFile = async function(filename) {
    if (!confirm(`Remove all chunks from "${filename}" from the vector DB?`)) return;
    try {
      const res  = await fetch(`${API.toolDocDeleteFile}?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      showToast(`Removed ${data.deleted_chunks} chunk(s) from "${filename}".`, 'success');
      loadStatus();
    } catch {
      showToast('Delete failed.', 'error');
    }
  };

  async function handleFiles(files) {
    const statusEl = document.getElementById('tkUploadStatus');
    const chipsEl  = document.getElementById('tkFileChips');

    chipsEl.innerHTML = Array.from(files).map(f =>
      `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:20px;font-size:12px;">
        📄 ${escapeHtml(f.name)}
      </span>`
    ).join('');

    statusEl.style.display     = '';
    statusEl.style.borderColor = 'var(--border)';
    statusEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;">
      <div class="spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0;"></div>
      <span>Processing ${files.length} file${files.length > 1 ? 's' : ''}… The agent is reading and classifying chunks. This may take a moment.</span>
    </span>`;

    const form = new FormData();
    Array.from(files).forEach(f => form.append('files', f));

    try {
      const res  = await fetch(API.toolDocsUpload, { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }
      const data = await res.json();

      const toolLines = Object.entries(data.tool_summary || {})
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `<li><strong>${escapeHtml(t)}</strong>: ${c} chunk${c !== 1 ? 's' : ''}</li>`)
        .join('');

      const unclass = data.unclassified_chunks || 0;

      statusEl.style.borderColor = 'var(--success, #10B981)';
      statusEl.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:18px;flex-shrink:0;">✅</span>
          <div>
            <div style="font-weight:600;margin-bottom:6px;">
              ${data.files_processed} file${data.files_processed !== 1 ? 's' : ''} processed successfully
            </div>
            ${toolLines ? `<ul style="margin:0 0 6px 16px;padding:0;font-size:12px;line-height:1.8;">${toolLines}</ul>` : ''}
            ${unclass ? `<div style="font-size:12px;color:var(--text3);">⚠️ ${unclass} chunk${unclass !== 1 ? 's' : ''} could not be classified — stored as "unclassified"</div>` : ''}
          </div>
        </div>`;

      document.getElementById('tkFileInput').value = '';
      loadStatus();
    } catch(err) {
      statusEl.style.borderColor = 'var(--danger)';
      statusEl.innerHTML = `❌ Upload failed: ${escapeHtml(err.message)}`;
    }
  }

  // Wire drop zone
  const zone = document.getElementById('tkFileZone');
  zone?.addEventListener('dragover', e => {
    e.preventDefault();
    zone.style.borderColor = 'var(--primary)';
    zone.style.background  = 'var(--primary-light, #eff6ff)';
  });
  zone?.addEventListener('dragleave', () => {
    zone.style.borderColor = '';
    zone.style.background  = '';
  });
  zone?.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    zone.style.background  = '';
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  zone?.addEventListener('click', e => {
    if (e.target.id !== 'btnBrowseKnowledgeFiles') return;
    document.getElementById('tkFileInput').click();
  });

  document.getElementById('btnBrowseKnowledgeFiles')?.addEventListener('click', () => {
    document.getElementById('tkFileInput').click();
  });

  document.getElementById('tkFileInput')?.addEventListener('change', e => {
    if (e.target.files.length) handleFiles(e.target.files);
  });

  document.getElementById('btnRefreshKnowledge')?.addEventListener('click', loadStatus);

  document.getElementById('btnClearAllKnowledge')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL tool knowledge chunks from the database? This cannot be undone.')) return;
    try {
      const res  = await fetch(API.toolDocsClear, { method: 'DELETE' });
      const data = await res.json();
      showToast(`Cleared ${data.deleted} chunks.`, 'success');
      document.getElementById('tkFileChips').innerHTML = '';
      document.getElementById('tkUploadStatus').style.display = 'none';
      loadStatus();
    } catch {
      showToast('Failed to clear.', 'error');
    }
  });

  // Load status when tools page is activated
  document.querySelectorAll('.nav-item[data-page="tools"], .nav-tab[data-page="tools"]').forEach(el => {
    el.addEventListener('click', () => setTimeout(loadStatus, 200));
  });

})();


/* ══════════════════════════════════════
   ANALYTICS PAGE
══════════════════════════════════════ */
async function loadAnalytics() {
  const container = document.getElementById('analyticsContent');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res  = await fetch(API.analytics, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const maxIntent = Math.max(...(data.intents || []).map(r => r.c), 1);
    const maxTool   = Math.max(...(data.tools   || []).map(r => r.c), 1);
    const maxUser   = Math.max(...(data.by_user || []).map(r => r.c), 1);

    const recentRunsHTML = (data.recent_runs || []).length ? `
      <div class="analytics-section-title">Recent Runs</div>
      <div class="an-table-wrap">
        <table class="an-table">
          <thead><tr>
            <th>User</th><th>Input</th><th>Tool</th><th>Intent</th><th>Status</th><th>Date</th>
          </tr></thead>
          <tbody>${(data.recent_runs || []).map(r => `<tr>
            <td><span class="an-email-badge">${escapeHtml(r.user_email || '—')}</span></td>
            <td class="an-td-input" title="${escapeHtml(r.raw_input || '')}">${escapeHtml((r.raw_input || '—').substring(0, 60))}${(r.raw_input || '').length > 60 ? '…' : ''}</td>
            <td>${escapeHtml(r.recommended_tool || '—')}</td>
            <td>${capitalize(r.intent || '—')}</td>
            <td>${r.policy_blocked ? '<span class="an-badge-blocked">Blocked</span>' : '<span class="an-badge-ok">OK</span>'}</td>
            <td class="an-td-date">${formatDate(r.created_at)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : '';

    const byUserHTML = (data.by_user || []).length ? `
      <div class="analytics-card">
        <div class="analytics-card-title">Runs by User</div>
        ${(data.by_user || []).map(r => `
          <div class="bar-row">
            <div class="bar-label an-email-label" title="${escapeHtml(r.user_email)}">${escapeHtml(r.user_email)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.c/maxUser*100)}%;background:#0b53b8"></div></div>
            <div class="bar-count">${r.c}</div>
          </div>`).join('')}
      </div>` : '';

    container.innerHTML = `
      <div class="analytics-stats">
        <div class="stat-card"><div class="stat-card-label">Total Runs</div><div class="stat-card-val accent">${data.total_runs ?? 0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Avg Rating</div><div class="stat-card-val accent">${data.avg_rating ?? '—'}</div></div>
        <div class="stat-card"><div class="stat-card-label">Feedback Count</div><div class="stat-card-val">${data.feedback_count ?? 0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Active Users</div><div class="stat-card-val">${(data.by_user || []).length}</div></div>
      </div>
      <div class="analytics-grid">
        <div class="analytics-card">
          <div class="analytics-card-title">Intent Breakdown</div>
          ${(data.intents || []).map(r => `
            <div class="bar-row">
              <div class="bar-label" title="${r.intent}">${capitalize(r.intent)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.c/maxIntent*100)}%"></div></div>
              <div class="bar-count">${r.c}</div>
            </div>`).join('') || '<p style="color:var(--text3);font-size:13px">No data yet.</p>'}
        </div>
        <div class="analytics-card">
          <div class="analytics-card-title">Tool Usage</div>
          ${(data.tools || []).map(r => `
            <div class="bar-row">
              <div class="bar-label" title="${r.recommended_tool}">${escapeHtml(r.recommended_tool)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.c/maxTool*100)}%;background:var(--success)"></div></div>
              <div class="bar-count">${r.c}</div>
            </div>`).join('') || '<p style="color:var(--text3);font-size:13px">No data yet.</p>'}
        </div>
        <div class="analytics-card">
          <div class="analytics-card-title">Top Industries</div>
          ${(data.industries || []).map(r => `
            <div class="bar-row">
              <div class="bar-label">${capitalize(r.industry)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.c/maxIntent*100)}%;background:#8B5CF6"></div></div>
              <div class="bar-count">${r.c}</div>
            </div>`).join('') || '<p style="color:var(--text3);font-size:13px">No data yet.</p>'}
        </div>
        <div class="analytics-card">
          <div class="analytics-card-title">Feedback Issues</div>
          ${(data.issue_types || []).length
            ? (data.issue_types || []).map(r => `
              <div class="bar-row">
                <div class="bar-label">${escapeHtml(r.issue_type || 'Other')}</div>
                <div class="bar-track"><div class="bar-fill" style="background:var(--danger)"></div></div>
                <div class="bar-count">${r.c}</div>
              </div>`).join('')
            : '<p style="color:var(--text3);font-size:13px">No issues reported yet.</p>'}
        </div>
        ${byUserHTML}
      </div>
      ${recentRunsHTML}`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Failed: ${err.message}</p></div>`;
  }
}

document.getElementById('btnRefreshAnalytics')?.addEventListener('click', loadAnalytics);


/* ══════════════════════════════════════
   POLICIES PAGE
══════════════════════════════════════ */
function initPoliciesPage() {
  const zone      = document.getElementById('uploadZone');
  const fileInput = document.getElementById('policyFileInput');
  const btnBrowse = document.getElementById('btnBrowseFile');

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadPolicyFile(fileInput.files[0]);
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) uploadPolicyFile(e.dataTransfer.files[0]);
  });

  document.getElementById('btnRefreshPolicies')?.addEventListener('click', loadPolicies);
}

async function uploadPolicyFile(file) {
  const status = document.getElementById('uploadStatus');
  status.innerHTML = `<div style="color:var(--text2);display:flex;align-items:center;gap:8px">
    <div class="spinner" style="width:16px;height:16px;border-width:2px"></div>
    Uploading ${escapeHtml(file.name)}…
  </div>`;

  const form = new FormData();
  form.append('file', file);
  try {
    const res  = await fetch(API.uploadPolicy, { method: 'POST', body: form });
    const data = await res.json();
    if (data.status === 'ok') {
      status.innerHTML = `<span style="color:var(--success)">✅ Indexed ${data.chunks_indexed} chunks from <strong>${escapeHtml(data.filename)}</strong></span>`;
      loadPolicies();
      showToast('Policy uploaded!', 'success');
    } else { throw new Error(data.detail || 'Upload failed'); }
  } catch (err) {
    status.innerHTML = `<span style="color:var(--danger)">❌ ${err.message}</span>`;
    showToast(`Upload failed: ${err.message}`, 'error');
  }
}

async function loadPolicies() {
  const list = document.getElementById('policiesList');
  list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res  = await fetch(API.policies, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (!data.sources || !data.sources.length) {
      list.innerHTML = '<p style="padding:16px;color:var(--text3);font-size:13px">No policies indexed yet.</p>';
      updateStat('sbPolicies', 0);
      return;
    }
    updateStat('sbPolicies', data.sources.length);
    list.innerHTML = data.sources.map(src => `
      <div class="policy-item">
        <div class="policy-name">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            style="display:inline;vertical-align:middle;color:var(--text3)">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          ${escapeHtml(src)}
        </div>
        <button class="btn-danger" onclick="deletePolicy('${escapeHtml(src)}')">Delete</button>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<p style="padding:16px;color:var(--danger);font-size:13px">Error: ${err.message}</p>`;
  }
}

async function deletePolicy(filename) {
  if (!confirm(`Delete policy "${filename}"?`)) return;
  try {
    await fetch(API.deletePolicy(filename), { method: 'DELETE' });
    showToast('Policy deleted.', 'success');
    loadPolicies();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}


/* ══════════════════════════════════════
   SIDEBAR STATS
══════════════════════════════════════ */
async function loadSidebarStats() {
  try {
    const [ar, pr]   = await Promise.all([fetch(API.analytics), fetch(API.policies)]);
    const analytics  = await ar.json();
    const policies   = await pr.json();
    updateStat('sbTotalRuns', analytics.total_runs ?? 0);
    updateStat('sbAvgRating', analytics.avg_rating ? `${analytics.avg_rating}★` : '—');
    updateStat('sbPolicies',  (policies.sources || []).length);
  } catch {}
}


function openHistoryRegenerateModal(encodedInput, encodedRole, encodedTaskType) {
  const body = decodeURIComponent(encodedInput || '');
  const previousRole = decodeURIComponent(encodedRole || '') || '';
  const previousTaskType = decodeURIComponent(encodedTaskType || '') || '';

  // move to Home first
  if (typeof navigateTo === 'function') navigateTo('home');

  // switch visible nav/page state
  document.querySelectorAll('.nav-tab').forEach(n =>
    n.classList.toggle('active', n.dataset.page === 'home'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-home')?.classList.add('active');

  // open same popup used by Scenario Library Generate button
  if (typeof plOpenScenarioGenModal === 'function') {
    plOpenScenarioGenModal({ body, activeRole: previousRole, activeTaskType: previousTaskType });
  } else {
    // fallback: just populate textarea if modal function is not available
    const textarea  = document.getElementById('userInput');
    const charCount = document.getElementById('charCount');
    if (textarea) {
      textarea.value = body;
      if (charCount) charCount.textContent = body.length;
      textarea.dispatchEvent(new Event('input'));
    }
  }
}


/* ══════════════════════════════════════════════════════
   CHAT GATHER PANEL — conversational task assistant
   State, rendering, drag handle, toggle
══════════════════════════════════════════════════════ */

const CHAT_API = {
  gather:    '/api/chat-gather',
  summarize: '/api/chat-summarize',
};

/* ── Chat State ── */
let _chatMessages       = [];          // [{role:'agent'|'user', content:'...'}]
let _chatReady          = false;       // true when agent has extracted enough info
let _chatExtracted      = { role: 'general', task_type: 'general', task_description: '' };
let _chatInitialInput   = '';
let _chatBusy           = false;
let _chatTurnCount      = 0;
let _chatPendingField   = null;        // 'role' | 'task_type' | null — set during skip flow
let _chatPartialInfo    = false;       // true when user proceeds with incomplete task details
let _chatContinued      = false;       // true when user clicked "Continue Conversation" after generation
let _toolRecEnabled     = true;        // session-level toggle — no DB; resets on page refresh

/* ── Tool recommendation toggle button ──
   Idempotent: re-entry into initChatPanel (e.g. after "New task") must not
   bind the click handler twice — otherwise the toggle flips twice per click
   and looks broken. We track binding state on the element itself. */
function _initToolRecToggle() {
  const btn = document.getElementById('chatToolRecBtn');
  if (!btn) return;
  if (!btn._toolRecWired) {
    btn._toolRecWired = true;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _toolRecEnabled = !_toolRecEnabled;
      _updateToolRecBtn();
    });
  }
  // Always sync the label to the current state — handles first paint
  // and any case where the button was re-rendered.
  _updateToolRecBtn();
}

function _updateToolRecBtn() {
  const btn = document.getElementById('chatToolRecBtn');
  if (!btn) return;
  // Keep the tooltip message symmetric in both states so the user sees a
  // consistent phrasing on first hover and every hover thereafter.
  if (_toolRecEnabled) {
    btn.textContent = 'Recommendations On';
    btn.title       = 'Click to turn off — you will see only the Prompt';
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.textContent = 'Recommendations Off';
    btn.title       = 'Click to turn on — you will see the Recommendations with the Prompt';
    btn.setAttribute('aria-pressed', 'false');
  }
}

/* ── Init ── */
function initChatPanel() {
  _startNewChat();

  document.getElementById('chatSendBtn').addEventListener('click', _chatSend);
  // Keyboard send affordances on the chat input:
  //   • Enter (no modifiers)   → send (ChatGPT-style default)
  //   • Shift+Enter            → newline (multi-line input)
  //   • Cmd/Ctrl+Enter         → also send (power-user expectation)
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;                          // newline
    if (e.metaKey || e.ctrlKey || !e.shiftKey) {     // Cmd+Enter or plain Enter
      e.preventDefault();
      _chatSend();
    }
  });
  document.getElementById('chatInput').addEventListener('input', _chatAutoResize);

  document.getElementById('chatSkipAllBtn').addEventListener('click', _chatSkipAll);
  document.getElementById('chatGenerateBtn').addEventListener('click', _chatTriggerGenerate);
  document.getElementById('chatContinueBtn')?.addEventListener('click', _chatContinueConversation);
  _initToolRecToggle();
  // "New task" wipes the chat + result. Confirm if there's anything to lose
  // (real messages from either side or extracted task context).
  document.getElementById('chatResetBtn').addEventListener('click', () => {
    resetToStep1();
  });

  _initDragHandle();
  _initToggleBtn();
}

/* Auto-resize chat textarea */
function _chatAutoResize() {
  const el = document.getElementById('chatInput');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 90) + 'px';
}

/* ── Render a message bubble.
      Agent messages stream word-by-word for a ChatGPT/Claude-style
      typewriter effect. User messages render instantly.
      Set window._CHAT_INSTANT = true to disable streaming entirely.   ── */
function _chatAddMessage(role, content) {
  _chatMessages.push({ role, content });
  if (role === 'agent' && !window._CHAT_INSTANT) {
    _chatRenderAgentStreaming(content);
  } else {
    _chatRenderMessage(role, content);
    _chatScrollBottom();
  }
}

function _chatRenderMessage(role, content) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const avatarHtml = role === 'agent'
    ? '<img src="/static/Images/Navigator.svg" alt="AI" class="chat-avatar-img"/>'
    : _userInitialsAvatar();
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  const bubbleHtml = role === 'agent' ? _formatAgentMessage(content) : `<span>${escapeHtml(content)}</span>`;
  div.innerHTML = `
    <div class="chat-avatar">${avatarHtml}</div>
    <div class="chat-bubble">${bubbleHtml}</div>
  `;
  container.appendChild(div);
}

/**
 * Build an initials avatar for the current user (matches the header's
 * profile-circle pattern). Lazily reads the initials computed by auth.js
 * from the header's .hdr-avatar-text element so we don't re-derive.
 */
function _userInitialsAvatar() {
  const headerInitials = document.querySelector('.hdr-avatar-text');
  const initials = (headerInitials && headerInitials.textContent.trim()) || _deriveInitialsFromSession();
  return `<span class="chat-avatar-initials">${escapeHtml(initials || '?')}</span>`;
}
function _deriveInitialsFromSession() {
  const email = _getSessionEmail() || '';
  const local = email.split('@')[0] || '';
  if (!local) return '';
  const parts = local.split(/[^a-zA-Z]+/).filter(Boolean);
  if (!parts.length) return local.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── Stream an agent message word-by-word into the chat ──
   1. Append the bubble immediately with an empty body + blinking caret.
   2. Tokenize the content into words+whitespace+newlines.
   3. Reveal one token per tick (~25ms for words, ~8ms for spaces).
   4. After the last token, replace the plain text with the fully
      formatted HTML (bullets, line breaks) so structure renders cleanly.
   The function returns the typing animation handle so callers can
   abort or chain (currently fire-and-forget).                        */
function _chatRenderAgentStreaming(content) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'chat-msg agent';
  div.innerHTML = `
    <div class="chat-avatar">
      <img src="/static/Images/Navigator.svg" alt="AI" class="chat-avatar-img"/>
    </div>
    <div class="chat-bubble">
      <span class="chat-streaming-text"></span><span class="chat-caret">▍</span>
    </div>`;
  container.appendChild(div);
  _chatScrollBottom();

  const target = div.querySelector('.chat-streaming-text');
  const caret  = div.querySelector('.chat-caret');
  const bubble = div.querySelector('.chat-bubble');

  // Split into atoms: each is either a non-whitespace run (word) or whitespace.
  const atoms = content.match(/\S+|\s+/g) || [];
  let i = 0;
  let typed = '';

  // Speed knobs — feel free to tune.
  const WORD_DELAY  = 22;   // ms between words
  const SPACE_DELAY = 6;    // ms for whitespace
  const FAST_AFTER  = 60;   // after this many atoms, accelerate
  const FAST_FACTOR = 0.4;  // multiplier when accelerated

  function tick() {
    if (i >= atoms.length) {
      // Done — replace plain stream with formatted HTML, drop caret.
      bubble.innerHTML = _formatAgentMessage(content);
      _chatScrollBottom();
      return;
    }
    const atom = atoms[i++];
    typed += atom;
    // Render with newlines preserved as <br> for incremental layout.
    target.innerHTML = escapeHtml(typed).replace(/\n/g, '<br/>');
    _chatScrollBottom();

    const isWhitespace = /^\s+$/.test(atom);
    let delay = isWhitespace ? SPACE_DELAY : WORD_DELAY;
    if (i > FAST_AFTER) delay = Math.max(2, Math.round(delay * FAST_FACTOR));
    setTimeout(tick, delay);
  }
  tick();
}

/* ── Format agent message: convert bullet lines into <ul><li> ── */
function _formatAgentMessage(content) {
  const lines = content.split('\n');
  let html = '';
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const isBullet = /^[•\-\*]\s/.test(line.trimStart());

    if (isBullet) {
      if (!inList) { html += '<ul class="chat-bullet-list">'; inList = true; }
      html += `<li>${escapeHtml(line.replace(/^[\s]*[•\-\*]\s/, ''))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') {
        html += '<br/>';
      } else {
        html += `<span class="chat-line">${escapeHtml(line)}</span><br/>`;
      }
    }
  }
  if (inList) html += '</ul>';
  // clean up trailing <br/>
  html = html.replace(/(<br\/>)+$/, '');
  return html;
}

function _chatScrollBottom() {
  const el = document.getElementById('chatMessages');
  if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

/* ── Typing indicator ── */
function _chatShowTyping(visible) {
  document.getElementById('chatTyping')?.classList.toggle('visible', visible);
  _chatScrollBottom();
}

/* ── Update summary bar ── */
function _chatUpdateSummary() {
  const bar  = document.getElementById('chatSummaryBar');
  const tags = document.getElementById('chatSummaryTags');
  if (!bar || !tags) return;

  // Small inline Lucide icons (11×11) — consistent with the rest of the
  // app's icon language. Match emoji-style positioning with a 4px right gap.
  const ICON_USER = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:5px;opacity:0.8;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const ICON_TAG  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:5px;opacity:0.8;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
  const ICON_CHK  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:5px;opacity:0.8;"><polyline points="20 6 9 17 4 12"/></svg>';

  const parts = [];
  if (_chatExtracted.role && _chatExtracted.role !== 'general')
    parts.push({ icon: ICON_USER, text: _chatExtracted.role });
  if (_chatExtracted.task_type && _chatExtracted.task_type !== 'general')
    parts.push({ icon: ICON_TAG,  text: _chatExtracted.task_type });
  if (_chatExtracted.task_description)
    parts.push({ icon: ICON_CHK,  text: 'Task captured' });

  if (parts.length) {
    tags.innerHTML = parts.map(p =>
      `<span class="chat-summary-tag">${p.icon}${escapeHtml(p.text)}</span>`
    ).join('');
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
}

/* ── Show task summary bubble in chat so user can see what was understood ── */
function _chatShowTaskSummary() {
  const role     = _chatExtracted.role             || 'general';
  const taskType = _chatExtracted.task_type        || 'general';
  const taskDesc = _chatExtracted.task_description || '';

  // Break task description into readable bullet points at '; ' or '. '
  const descParts = taskDesc
    .split(/;\s+/)
    .flatMap(s => s.split(/\.\s+(?=[A-Z])/))
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(Boolean);

  const descBlock = descParts.length > 1
    ? '\n' + descParts.map(p => `  - ${p}`).join('\n')
    : (taskDesc ? ' ' + taskDesc : ' (not specified)');

  const summary =
    'Here\'s what I understood from our conversation:\n\n' +
    `• Role: ${capitalize(role)}\n` +
    `• Task Type: ${capitalize(taskType)}\n` +
    `• Task Details:${descBlock}\n\n` +
    'Click Generate below if this looks right, or keep chatting to refine.';

  _chatAddMessage('agent', summary);
}

/* ── Mark chat as ready (agent has enough info) ── */
function _chatMarkReady(extracted) {
  _chatReady    = true;
  _chatExtracted = {
    role:             extracted.role             || 'general',
    task_type:        extracted.task_type        || 'general',
    task_description: extracted.task_description || '',
  };
  _chatUpdateSummary();
  document.getElementById('chatReadyBanner')?.classList.add('visible');
  document.getElementById('chatGenerateBtn').disabled = false;
}

/* ── Send user message → intercept pending field OR call /api/chat-gather ── */
async function _chatSend() {
  if (_chatBusy) return;
  const inputEl = document.getElementById('chatInput');
  const text = inputEl.value.trim();
  if (!text) return;

  // Any typed chat interaction means the user is creating their OWN task,
  // so a stale "scenario_library" flag (and its scenario id/title) from an
  // abandoned card click must not leak into this run. Clearing here
  // guarantees typed = Own Task with no scenario provenance.
  window._pendingTaskSource    = null;
  window._pendingScenarioId    = null;
  window._pendingScenarioTitle = null;

  // Remove any pending partial-choice buttons when user types an answer instead
  document.getElementById('chatPartialChoices')?.remove();

  inputEl.value = '';
  inputEl.style.height = 'auto';
  inputEl.dispatchEvent(new Event('input'));

  _chatAddMessage('user', text);

  // If we're collecting a specific missing field (role or task_type after Skip)
  if (_chatPendingField === 'role') {
    _chatExtracted.role = text;
    _chatPendingField = null;
    _chatUpdateSummary();
    await _chatAskMissingThenGenerate();
    return;
  }
  if (_chatPendingField === 'task_type') {
    _chatExtracted.task_type = text;
    _chatPendingField = null;
    _chatUpdateSummary();
    await _chatAskMissingThenGenerate();
    return;
  }

  _chatBusy = true;
  _chatShowTyping(true);
  document.getElementById('chatSendBtn').disabled = true;
  _chatTurnCount++;

  try {
    const res = await fetch(CHAT_API.gather, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages:     _chatMessages,
        user_input:   _chatInitialInput,
        role:         _chatExtracted.role,
        task_type:    _chatExtracted.task_type,
        default_role: _getSavedDefaultRole(),
      }),
    });
    const data = await res.json();

    _chatShowTyping(false);

    if (data.action === 'ready') {
      if (data.partial_info) _chatPartialInfo = true;
      _chatMarkReady(data);
      _chatShowTaskSummary();
    } else if (data.action === 'partial') {
      _chatShowPartialChoices(data.unanswered_questions || []);
    } else {
      if (data.message) _chatAddMessage('agent', data.message);
    }
  } catch {
    _chatShowTyping(false);
    _chatAddMessage('agent', 'Sorry, I had trouble connecting. Please try again or type your task directly in the form.');
  } finally {
    _chatBusy = false;
    document.getElementById('chatSendBtn').disabled = false;
  }
}

/* ── Skip All: summarize conversation then ask missing role/task_type in-chat ── */
async function _chatSkipAll() {
  if (_chatBusy) return;
  _chatBusy = true;

  const skipBtn = document.getElementById('chatSkipAllBtn');
  skipBtn.disabled = true;
  skipBtn.textContent = '⏳ Summarizing…';

  try {
    const res = await fetch(CHAT_API.summarize, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages:     _chatMessages,
        user_input:   _chatInitialInput,
        role:         _chatExtracted.role,
        task_type:    _chatExtracted.task_type,
        default_role: _getSavedDefaultRole(),
      }),
    });
    const data = await res.json();
    _chatExtracted.role             = data.role             || _chatExtracted.role;
    _chatExtracted.task_type        = data.task_type        || _chatExtracted.task_type;
    _chatExtracted.task_description = data.task_description || _chatExtracted.task_description;
  } catch {
    /* keep whatever was already extracted */
  } finally {
    _chatBusy = false;
    skipBtn.disabled = false;
    skipBtn.textContent = '⏭ Skip questions';
  }

  // Ask missing role/task_type through chat, then show task summary — user clicks Generate
  await _chatAskMissingThenGenerate();
}

/* ── Ask role and/or task_type in-chat if still missing, then show summary ── */
async function _chatAskMissingThenGenerate() {
  const roleMissing     = !_chatExtracted.role     || _chatExtracted.role     === 'general';
  const taskTypeMissing = !_chatExtracted.task_type || _chatExtracted.task_type === 'general';

  if (roleMissing) {
    // Auto-fill from saved default role — skip the question entirely
    const savedRole = _getSavedDefaultRole();
    if (savedRole && savedRole.toLowerCase() !== 'general') {
      _chatExtracted.role = savedRole;
      _chatUpdateSummary();
      // Fall through to check task_type
    } else {
      _chatAddMessage('agent',
        'Almost there! Just a couple of quick details:\n' +
        '• What is your role?\n' +
        '  e.g. Consultant / Manager, Developer / Technical, Business Analyst, Sales / BD, HR / People Ops…'
      );
      _chatPendingField = 'role';
      return;
    }
  }

  const taskTypeMissingNow = !_chatExtracted.task_type || _chatExtracted.task_type === 'general';
  if (taskTypeMissingNow) {
    _chatAddMessage('agent',
      'One more thing:\n' +
      '• What type of task is this?\n' +
      '  e.g. Research & Analysis, Writing & Docs, Strategy & Planning, Data Analysis, Code & Dev…'
    );
    _chatPendingField = 'task_type';
    return;
  }

  // All collected — show summary and let user click Generate
  _chatPendingField = null;
  _chatShowTaskSummary();
  _chatMarkReady(_chatExtracted);
}


/* ── Show partial-answer choices when some questions were unanswered ── */
function _chatShowPartialChoices(unansweredQuestions) {
  const questionLines = unansweredQuestions.length
    ? '\n\n' + unansweredQuestions.map(q => `• ${q}`).join('\n')
    : '';

  const msg = 'I noticed a couple of my questions weren\'t fully answered. Here\'s what\'s still missing:' +
    questionLines +
    '\n\nWould you like to answer the remaining questions, or proceed with the information you\'ve already provided?';

  _chatAddMessage('agent', msg);

  // Append choice buttons below the message
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const choicesDiv = document.createElement('div');
  choicesDiv.id = 'chatPartialChoices';
  choicesDiv.style.cssText = 'display:flex;gap:8px;padding:4px 12px 12px 52px;';

  const answerBtn = document.createElement('button');
  answerBtn.className = 'btn btn-secondary btn-sm';
  answerBtn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;';
  answerBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Answer Remaining';

  const proceedBtn = document.createElement('button');
  proceedBtn.className = 'btn btn-primary btn-sm';
  proceedBtn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;';
  proceedBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Proceed with Available Info';

  choicesDiv.appendChild(answerBtn);
  choicesDiv.appendChild(proceedBtn);
  container.appendChild(choicesDiv);
  _chatScrollBottom();

  answerBtn.addEventListener('click', () => {
    choicesDiv.remove();
    _chatAddMessage('agent', 'Of course! Please type your answers and I\'ll incorporate them into the recommendation.');
  });

  proceedBtn.addEventListener('click', async () => {
    choicesDiv.remove();
    await _chatProceedWithPartialInfo();
  });
}

/* ── Proceed with partial info: summarize → show what was understood → generate ── */
async function _chatProceedWithPartialInfo() {
  if (_chatBusy) return;
  _chatBusy = true;
  _chatPartialInfo = true;

  _chatLockInput();
  document.getElementById('chatReadyBanner')?.classList.remove('visible');

  // Summarize first to extract the best available data from the conversation
  try {
    const res = await fetch(CHAT_API.summarize, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages:     _chatMessages,
        user_input:   _chatInitialInput,
        role:         _chatExtracted.role,
        task_type:    _chatExtracted.task_type,
        default_role: _getSavedDefaultRole(),
      }),
    });
    const data = await res.json();
    _chatExtracted.role             = data.role             || _chatExtracted.role;
    _chatExtracted.task_type        = data.task_type        || _chatExtracted.task_type;
    _chatExtracted.task_description = data.task_description || _chatExtracted.task_description;
  } catch {
    /* keep whatever was extracted */
  } finally {
    _chatBusy = false;
  }

  const role     = _chatExtracted.role     || _getSavedDefaultRole() || 'general';
  const taskType = _chatExtracted.task_type || 'general';
  const taskDesc = _chatExtracted.task_description || _chatInitialInput || '';

  if (!taskDesc) { showToast('Please describe your task first.', 'error'); return; }

  // Show a summary of what was understood before generating
  _chatShowPartialProceedSummary(role, taskType, taskDesc);
  _chatAddMessage('agent', '⚡ Generating your prompt with the available information…');

  const roleEl     = document.getElementById('selRole');
  const taskTypeEl = document.getElementById('selTaskType');
  const inputEl    = document.getElementById('userInput');
  const charCount  = document.getElementById('charCount');
  if (roleEl)     roleEl.value     = role;
  if (taskTypeEl) taskTypeEl.value = taskType;
  if (inputEl)    { inputEl.value = taskDesc; if (charCount) charCount.textContent = taskDesc.length; }

  await _runGenerate(taskDesc, role, taskType);
}

/* ── Task summary shown when proceeding with partial info ── */
function _chatShowPartialProceedSummary(role, taskType, taskDesc) {
  const descParts = taskDesc
    .split(/;\s+/)
    .flatMap(s => s.split(/\.\s+(?=[A-Z])/))
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(Boolean);

  const descBlock = descParts.length > 1
    ? '\n' + descParts.map(p => `  - ${p}`).join('\n')
    : (taskDesc ? ' ' + taskDesc : ' (not specified)');

  _chatAddMessage('agent',
    'Here\'s what I understood from our conversation:\n\n' +
    `• Role: ${capitalize(role)}\n` +
    `• Task Type: ${capitalize(taskType)}\n` +
    `• Task Details:${descBlock}\n\n` +
    'Proceeding to generate your result with the available information.'
  );
}

/* ══════════════════════════════════════
   TOOL CHANGE LOG MODAL
══════════════════════════════════════ */
(function initToolChangeLog() {
  let _tclPage    = 1;
  let _tclTotal   = 0;
  let _tclSearch  = '';
  const PER_PAGE  = 20;

  function _open() {
    document.getElementById('tclOverlay').classList.add('open');
    document.getElementById('tclModal').classList.add('open');
    _tclPage   = 1;
    _tclSearch = '';
    document.getElementById('tclSearch').value = '';
    _load();
  }

  function _close() {
    document.getElementById('tclOverlay').classList.remove('open');
    document.getElementById('tclModal').classList.remove('open');
  }

  async function _load() {
    const body = document.getElementById('tclBody');
    body.innerHTML = `<div class="tcl-loading"><div class="tcl-spinner"></div><span>Loading…</span></div>`;

    const params = new URLSearchParams({ page: _tclPage, per_page: PER_PAGE });
    if (_tclSearch.trim()) params.set('tool_name', _tclSearch.trim());

    try {
      const res  = await fetch(`${API.toolChangeLog}?${params}`);
      const data = await res.json();
      _tclTotal  = data.total || 0;
      const logs = data.logs  || [];

      if (!logs.length) {
        body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px;">No change log entries yet.</div>`;
        document.getElementById('tclFooter').style.display = 'none';
        return;
      }

      const ACTION_STYLE = {
        registered:   { bg: '#EFF6FF', color: '#1D4ED8', label: 'Tool Added'    },
        updated:      { bg: '#F5F3FF', color: '#5B21B6', label: 'Edited'        },
        deleted:      { bg: '#FEF2F2', color: '#991B1B', label: 'Tool Removed'  },
        file_deleted: { bg: '#FFF7ED', color: '#9A3412', label: 'File Removed'  },
      };

      body.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="text-align:left;padding:10px 12px;color:var(--text3);font-weight:600;white-space:nowrap;">Date / Time</th>
              <th style="text-align:left;padding:10px 12px;color:var(--text3);font-weight:600;">Tool</th>
              <th style="text-align:center;padding:10px 12px;color:var(--text3);font-weight:600;">Action</th>
              <th style="text-align:left;padding:10px 12px;color:var(--text3);font-weight:600;">Changes</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(log => {
              let cf = {};
              try { cf = JSON.parse(log.changed_fields || '{}'); } catch {}
              const keys = Object.keys(cf);

              /* Determine action label — file events reuse action=updated */
              let actionStyle = ACTION_STYLE[log.action] || { bg: '#F9FAFB', color: '#374151', label: log.action };
              if (log.action === 'updated' && keys.includes('file_removed')) {
                actionStyle = { bg: '#FFF7ED', color: '#9A3412', label: 'Remove File' };
              } else if (log.action === 'updated' && keys.includes('files_uploaded')) {
                actionStyle = { bg: '#F0FDF4', color: '#166534', label: 'Upload File' };
              }

              /* Render changes */
              let changesHtml = '—';
              if (keys.length) {
                changesHtml = keys.map(k => {
                  const v = cf[k];
                  if (v && typeof v === 'object' && 'from' in v) {
                    return `<div style="font-size:11.5px;line-height:1.5;"><strong>${escapeHtml(k)}</strong>: <span style="color:var(--text3)">${escapeHtml(String(v.from).slice(0,60))}</span> → <span style="color:var(--text)">${escapeHtml(String(v.to).slice(0,60))}</span></div>`;
                  }
                  return `<div style="font-size:12px;line-height:1.7;"><strong>${escapeHtml(k)}</strong>: ${escapeHtml(String(v).slice(0,120))}</div>`;
                }).join('');
              }
              const ts = log.created_at ? new Date(log.created_at + 'Z').toLocaleString() : '—';
              return `
                <tr style="border-bottom:1px solid var(--border);">
                  <td style="padding:10px 12px;color:var(--text3);white-space:nowrap;font-size:12px;">${escapeHtml(ts)}</td>
                  <td style="padding:10px 12px;font-weight:600;color:var(--text);">${escapeHtml(log.tool_name)}</td>
                  <td style="padding:10px 12px;text-align:center;">
                    <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${actionStyle.bg};color:${actionStyle.color};">${actionStyle.label}</span>
                  </td>
                  <td style="padding:10px 12px;">${changesHtml}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`;

      const totalPages = Math.ceil(_tclTotal / PER_PAGE);
      const footer = document.getElementById('tclFooter');
      const info   = document.getElementById('tclPageInfo');
      footer.style.display = totalPages > 1 ? '' : 'none';
      info.textContent = `Page ${_tclPage} of ${totalPages} (${_tclTotal} entries)`;
      document.getElementById('tclPrevBtn').disabled = _tclPage <= 1;
      document.getElementById('tclNextBtn').disabled = _tclPage >= totalPages;

    } catch (err) {
      body.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px;">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Wire controls
  document.getElementById('dropToolChangeLog')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('menuDrawer')?.classList.remove('open');
    document.getElementById('menuDrawerOverlay')?.classList.remove('open');
    _open();
  });


  document.getElementById('tclCloseBtn')?.addEventListener('click', _close);
  document.getElementById('tclOverlay')?.addEventListener('click', _close);
  document.getElementById('tclRefreshBtn')?.addEventListener('click', () => { _tclPage = 1; _load(); });

  let _tclSearchTimer;
  document.getElementById('tclSearch')?.addEventListener('input', (e) => {
    clearTimeout(_tclSearchTimer);
    _tclSearchTimer = setTimeout(() => { _tclSearch = e.target.value; _tclPage = 1; _load(); }, 300);
  });

  document.getElementById('tclPrevBtn')?.addEventListener('click', () => { if (_tclPage > 1) { _tclPage--; _load(); } });
  document.getElementById('tclNextBtn')?.addEventListener('click', () => { _tclPage++; _load(); });
})();

/* ── Show task summary as a chat message — does NOT auto-generate ── */
function _chatShowSummaryAndGenerate() {
  const role     = _chatExtracted.role             || 'general';
  const taskType = _chatExtracted.task_type        || 'general';
  const taskDesc = _chatExtracted.task_description || '';

  const descParts = taskDesc
    .split(/;\s+/)
    .flatMap(s => s.split(/\.\s+(?=[A-Z])/))
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(Boolean);

  const descBlock = descParts.length > 1
    ? '\n' + descParts.map(p => `  - ${p}`).join('\n')
    : (taskDesc ? ' ' + taskDesc : ' (not specified)');

  _chatAddMessage('agent',
    'Here\'s what I understood from our conversation:\n\n' +
    `• Role: ${capitalize(role)}\n` +
    `• Task Type: ${capitalize(taskType)}\n` +
    `• Task Details:${descBlock}\n\n` +
    'You can add more details below, or click Generate when ready.'
  );
}

/* ── Lock the entire chat input area — called once Generate is clicked ── */
function _chatLockInput() {
  const chatInput       = document.getElementById('chatInput');
  const chatSendBtn     = document.getElementById('chatSendBtn');
  const chatGenerateBtn = document.getElementById('chatGenerateBtn');
  const chatSkipAllBtn  = document.getElementById('chatSkipAllBtn');

  if (chatInput) {
    chatInput.disabled    = true;
    chatInput.placeholder = 'Task concluded — start a new chat to change your task.';
  }
  if (chatSendBtn)     { chatSendBtn.disabled     = true; }
  if (chatGenerateBtn) { chatGenerateBtn.disabled  = true; }
  if (chatSkipAllBtn)  { chatSkipAllBtn.disabled   = true; }

  const chatContinueBtn = document.getElementById('chatContinueBtn');
  if (chatContinueBtn) chatContinueBtn.style.display = '';
}

/* ── Re-enable chat after generation so user can add more details ── */
function _chatContinueConversation() {
  _chatContinued = true;

  const btn = document.getElementById('chatContinueBtn');
  if (btn) btn.style.display = 'none';

  const chatInput       = document.getElementById('chatInput');
  const chatSendBtn     = document.getElementById('chatSendBtn');
  const chatGenerateBtn = document.getElementById('chatGenerateBtn');
  const chatSkipAllBtn  = document.getElementById('chatSkipAllBtn');

  if (chatInput) {
    chatInput.disabled    = false;
    chatInput.placeholder = 'Add more details to refine your result…';
  }
  if (chatSendBtn)     chatSendBtn.disabled     = false;
  if (chatGenerateBtn) chatGenerateBtn.disabled  = false;
  if (chatSkipAllBtn)  chatSkipAllBtn.disabled   = false;

  _chatAddMessage('agent', 'Sure! Feel free to add any additional details below. When you\'re ready, click Generate again to update your result.');
}

/* ── Task summary shown right before generating (used on continuation) ── */
function _chatShowGenerateSummary() {
  const role     = _chatExtracted.role             || 'general';
  const taskType = _chatExtracted.task_type        || 'general';
  const taskDesc = _chatExtracted.task_description || '';

  const descParts = taskDesc
    .split(/;\s+/)
    .flatMap(s => s.split(/\.\s+(?=[A-Z])/))
    .map(s => s.trim().replace(/\.$/, ''))
    .filter(Boolean);

  const descBlock = descParts.length > 1
    ? '\n' + descParts.map(p => `  - ${p}`).join('\n')
    : (taskDesc ? ' ' + taskDesc : ' (not specified)');

  _chatAddMessage('agent',
    'Here\'s what I understood from our conversation:\n\n' +
    `• Role: ${capitalize(role)}\n` +
    `• Task Type: ${capitalize(taskType)}\n` +
    `• Task Details:${descBlock}\n\n` +
    'Generating your updated result now.'
  );
}

/* ── Generate: fill hidden fields + run ── */
async function _chatTriggerGenerate() {
  if (!_chatReady && _chatMessages.filter(m => m.role === 'user').length === 0) {
    showToast('Please describe your task in the chat first.', 'error');
    return;
  }

  let role        = _chatExtracted.role             || 'general';
  let taskType    = _chatExtracted.task_type        || 'general';
  let taskDesc    = _chatExtracted.task_description || '';

  if (!taskDesc) { showToast('Please describe your task first.', 'error'); return; }

  const roleEl     = document.getElementById('selRole');
  const taskTypeEl = document.getElementById('selTaskType');
  const inputEl    = document.getElementById('userInput');
  const charCount  = document.getElementById('charCount');
  if (roleEl)     { roleEl.value = role; roleEl.dispatchEvent(new Event('input')); }
  if (taskTypeEl) { taskTypeEl.value = taskType; taskTypeEl.dispatchEvent(new Event('input')); }
  if (inputEl)    { inputEl.value = taskDesc; if (charCount) charCount.textContent = taskDesc.length; }

  _chatLockInput();
  document.getElementById('chatReadyBanner')?.classList.remove('visible');

  // When re-generating after "Continue Conversation", recap what was understood
  if (_chatContinued) {
    _chatContinued = false;
    _chatShowGenerateSummary();
  }

  _chatAddMessage('agent', '⚡ Generating your prompt now…');

  await _runGenerate(taskDesc, role, taskType);
}

/* ── Reset chat — re-enables all locked controls ── */
function _chatReset() {
  _chatMessages     = [];
  _chatReady        = false;
  // Pre-seed role from saved default so every new task starts role-aware
  const savedRole   = _getSavedDefaultRole();
  _chatExtracted    = {
    role:             (savedRole && savedRole.toLowerCase() !== 'general') ? savedRole : 'general',
    task_type:        'general',
    task_description: '',
  };
  _chatInitialInput = '';
  _chatBusy         = false;
  _chatTurnCount    = 0;
  _chatPendingField = null;
  _chatPartialInfo  = false;
  _chatContinued    = false;

  const container = document.getElementById('chatMessages');
  const chatContinueBtn = document.getElementById('chatContinueBtn');
  if (chatContinueBtn) chatContinueBtn.style.display = 'none';
  if (container) container.innerHTML = '';
  document.getElementById('chatSummaryBar')?.classList.remove('visible');
  document.getElementById('chatReadyBanner')?.classList.remove('visible');

  const chatInput       = document.getElementById('chatInput');
  const chatSendBtn     = document.getElementById('chatSendBtn');
  const chatGenerateBtn = document.getElementById('chatGenerateBtn');
  const chatSkipAllBtn  = document.getElementById('chatSkipAllBtn');

  if (chatInput) {
    chatInput.disabled    = false;
    chatInput.value       = '';
    chatInput.style.height = 'auto';
    chatInput.placeholder = 'Type your task here…';
  }
  if (chatSendBtn)     { chatSendBtn.disabled     = false; }
  if (chatGenerateBtn) { chatGenerateBtn.disabled  = true; }
  if (chatSkipAllBtn)  { chatSkipAllBtn.disabled   = false; }

  _startNewChat();
}

/* ── Get the saved default role (falls back to '' if not loaded yet) ── */
function _getSavedDefaultRole() {
  try {
    return (window._personalization && window._personalization.getDefaultRole)
      ? window._personalization.getDefaultRole()
      : '';
  } catch { return ''; }
}

/* ── Start a fresh conversation ── */
function _startNewChat() {
  // Pre-fill role from saved default so the LLM never needs to ask
  const savedRole = _getSavedDefaultRole();
  if (savedRole && savedRole.toLowerCase() !== 'general') {
    _chatExtracted.role = savedRole;
  }
  const greeting = `Hi! What would you like to do today?`;
  _chatAddMessage('agent', greeting);
}

/* ══════════════════════════════════════
   DRAG HANDLE — resize chat panel.
   Pointer events (work for mouse, touch, pen, trackpad) +
   setPointerCapture so the drag stays attached even if the cursor
   briefly leaves the handle. Uses setProperty(..., 'important') so
   no CSS rule can block the inline-style flex change.
══════════════════════════════════════ */
function _initDragHandle() {
  const handle    = document.getElementById('homeDragHandle');
  const chatPanel = document.getElementById('chatPanel');
  const outer     = document.getElementById('homeOuter');
  if (!handle || !chatPanel || !outer) return;
  if (handle._dragInit) return;        // idempotent
  handle._dragInit = true;

  const SNAP = [25, 40, 55, 60];
  const SNAP_THRESHOLD = 2.5;          // % within which to snap

  function applyPct(pct) {
    const clamped = Math.max(15, Math.min(82, pct));
    chatPanel.style.setProperty('flex', `0 0 ${clamped.toFixed(2)}%`, 'important');
  }

  function onPointerMove(e) {
    if (!handle._dragging) return;
    const outerW = outer.getBoundingClientRect().width;
    if (outerW <= 0) return;
    const delta  = e.clientX - handle._startX;
    const newW   = Math.min(Math.max(handle._startW + delta, 220), outerW * 0.82);
    const pct    = (newW / outerW) * 100;
    // Snap if close to a preset
    const closest = SNAP.reduce((a, b) => Math.abs(b - pct) < Math.abs(a - pct) ? b : a);
    applyPct(Math.abs(pct - closest) < SNAP_THRESHOLD ? closest : pct);
  }

  function onPointerUp(e) {
    if (!handle._dragging) return;
    handle._dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    try { handle.releasePointerCapture(e.pointerId); } catch {}
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup',   onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
  }

  handle.addEventListener('pointerdown', (e) => {
    // Don't intercept clicks on the toggle button — it has its own handler.
    if (e.target.closest('#chatToggleBtn')) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;  // left button only
    e.preventDefault();
    handle._dragging = true;
    handle._startX   = e.clientX;
    handle._startW   = chatPanel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    try { handle.setPointerCapture(e.pointerId); } catch {}
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup',   onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  });
}

/* ══════════════════════════════════════
   TOGGLE BUTTON >> / << 
   Default: chat=40%, click >> → 60%, click << → 25%
══════════════════════════════════════ */
function _initToggleBtn() {
  const btn       = document.getElementById('chatToggleBtn');
  const chatPanel = document.getElementById('chatPanel');
  const outer     = document.getElementById('homeOuter');
  if (!btn || !chatPanel || !outer) return;

  let _state = 'normal'; // 'normal' (40%) | 'expanded' (60%) | 'collapsed' (25%)
  // Use setProperty(..., 'important') so legacy .chat-panel `flex: 0 0 40%`
  // can't beat the click handler — same precaution as the drag handler.
  const setFlex = pct => chatPanel.style.setProperty('flex', `0 0 ${pct}%`, 'important');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_state === 'normal') {
      _state = 'expanded';
      setFlex(60);
      btn.textContent = '«';
      btn.title = 'Shrink chat panel';
      outer.classList.add('chat-expanded');
    } else if (_state === 'expanded') {
      _state = 'collapsed';
      setFlex(25);
      btn.textContent = '»';
      btn.title = 'Expand chat panel';
      outer.classList.remove('chat-expanded');
    } else {
      _state = 'normal';
      setFlex(40);
      btn.textContent = '»';
      btn.title = 'Expand chat panel';
      outer.classList.remove('chat-expanded');
    }
  });
}
