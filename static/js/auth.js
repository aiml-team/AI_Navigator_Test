/* ═══════════════════════════════════════════════════════════════
   auth.js
   ─ Authentication for AI Navigator. Okta SSO is ENABLED.
   ─ Flow:
        "Sign in with Okta" → /saml/login → Okta → /saml/acs →
        /?sso=1 redirect → /api/auth/me → render app shell.
   ─ Logout: clears local + server session via /saml/logout.

   BOTH admin and user see:
     • Profile icon (hdrMenuWrap) with Sign Out only

   ADMIN only sees (hidden for regular users):
     • Admin section in hamburger drawer (#drawerAdminSection)
     • Register Scenario button  (#slRegisterScenarioBtn)
     • Register tool button      (#btnRegisterTool)
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const SESSION_KEY = 'navigator_session';

  /* ── selectors that are ADMIN-ONLY (hidden for regular users) ── */
  const ADMIN_ONLY = [
    '#drawerAdminSection',    // admin options block in hamburger drawer (now hidden for everyone — replaced by left rail)
    '#adminRail',             // persistent admin left rail
    '#slRegisterScenarioBtn', // Add Scenario button in Scenario Library
    '#btnRegisterTool',       // Register tool button in AI Tools
  ];

  /* ── selectors that are USER-ONLY (hidden for admins) ── */
  const USER_ONLY = [
    '#slSuggestScenarioBtn',  // "Suggest a scenario" — admins use "Add scenario" instead
  ];

  /* ── apply role to the UI ─────────────────────────────────── */
  function applyRole(role) {
    if (role === 'admin') {
      // Admin sees the left rail; main content shifts right via CSS.
      document.body.classList.add('has-admin-rail');
      // Drawer admin section stays VISIBLE so mobile admins (rail is hidden
      // below 900px) can still reach Analytics / Policies / Scenarios / etc.
      // via the hamburger menu. On desktop the rail and drawer are both
      // present, but the drawer is closed by default — no visual conflict.
      const drawerAdmin = document.getElementById('drawerAdminSection');
      if (drawerAdmin) drawerAdmin.style.display = '';
      // Hide user-only items (admin gets the equivalent admin variants).
      // setProperty(..., 'important') so the hide wins over any CSS rule
      // with !important on display (e.g., mobile-responsive button overrides).
      USER_ONLY.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          el.style.setProperty('display', 'none', 'important');
        });
      });
      _wireAdminRail();
      return;
    }
    document.body.classList.remove('has-admin-rail');
document.body.classList.remove('admin-rail-collapsed');

const adminRail = document.getElementById('adminRail');
if (adminRail) {
  adminRail.style.setProperty('display', 'none', 'important');
}

const main = document.getElementById('mainContent');
if (main) {
  main.style.paddingLeft = '0px';
}

ADMIN_ONLY.forEach(sel => {
  document.querySelectorAll(sel).forEach(el => {
    el.style.setProperty('display', 'none', 'important');
  });
});
  }

  /* Rail buttons delegate to the existing drawer handlers via element.click(). */
  function _wireAdminRail() {
    const map = [
      ['railAnalytics',   'dropAnalytics'],
      ['railScenarios',   'dropScenarios'],
      ['railPolicies',    'dropPolicyUpload'],
      ['railToolsLog',    'dropToolChangeLog'],
      ['railFeedback',    'dropFeedbackView'],
      ['railTechIssues',  null],
    ];
    map.forEach(([railId, drawerId]) => {
      const railBtn   = document.getElementById(railId);
      if (!railBtn || railBtn._wired) return;
      const drawerBtn = drawerId ? document.getElementById(drawerId) : null;
      if (drawerId && !drawerBtn) return;   // expected drawer button is missing
      railBtn._wired = true;
      railBtn.addEventListener('click', () => {
        // Visual active state on the rail
        document.querySelectorAll('#adminRail .rail-item').forEach(i => i.classList.remove('active'));
        railBtn.classList.add('active');
        if (drawerBtn) drawerBtn.click();
      });
    });
  }

  /**
   * Derive 1-2 letter initials from an email address.
   * Examples:
   *   "john.smith@bs.nttdata.com" → "JS"
   *   "jane@bs.nttdata.com"       → "J"
   *   ""                          → ""
   */
  function _initialsFromEmail(email) {
    const local = (email || '').split('@')[0] || '';
    if (!local) return '';
    const parts = local.split(/[^a-zA-Z]+/).filter(Boolean);
    if (!parts.length) return local.slice(0, 1).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* ── session helpers ──────────────────────────────────────── */
  function saveSession(data) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
    catch { return null; }
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    document.getElementById('homeRecentList')?.replaceChildren();
    const recentBlock = document.getElementById('homeRecentBlock');
    if (recentBlock) recentBlock.style.display = 'none';
  }

  /* ── show login / show app ────────────────────────────────── */
  function showLoginScreen() {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appShell').style.display   = 'none';
  }

  function showApp(session) {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appShell').style.display   = '';

    // Populate the dropdown user-info header (replaces the old header pill).
    // Shows initials in a coloured circle + full name + email — the
    // conventional pattern for enterprise apps.
    const email = session.email || '';
    const username = email.includes('@') ? email.split('@')[0] : email;
    // Humanise the username — "john.smith" → "John Smith"
    const displayName = username
      .split(/[._-]+/)
      .filter(Boolean)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
    const initials = _initialsFromEmail(email);

    const dropAvatar = document.getElementById('dropUserAvatar');
    const dropName   = document.getElementById('dropUserName');
    const dropEmail  = document.getElementById('dropUserEmail');
    if (dropAvatar) dropAvatar.textContent = initials || '?';
    if (dropName)   dropName.textContent   = displayName || 'Signed in';
    if (dropEmail)  dropEmail.textContent  = email;

    // Header profile-circle initials (unchanged behaviour).
    const initialsEl = document.querySelector('.hdr-avatar-text');
    const fallbackEl = document.querySelector('.hdr-avatar-fallback');
    if (initialsEl) {
      if (initials) {
        initialsEl.textContent = initials;
        if (fallbackEl) fallbackEl.style.display = 'none';
      } else if (fallbackEl) {
        initialsEl.textContent = '';
        fallbackEl.style.display = '';
      }
    }

    applyRole(session.role);

    /* Profile dropdown toggle — open/close on click */
    const toggleBtn = document.getElementById('hdrToggleBtn');
    const dropdown  = document.getElementById('hdrDropdown');
    if (toggleBtn && dropdown) {
      const freshBtn = toggleBtn.cloneNode(true);
      toggleBtn.parentNode.replaceChild(freshBtn, toggleBtn);
      freshBtn.addEventListener('click', e => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      });
    }
  }

  /* ── reset all visible app state so the next user starts fresh ── */
  function resetAppState() {
    if (typeof resetToStep1 === 'function') resetToStep1();

    const clear = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };
    clear('resultMeta',           'innerHTML',      '');
    clear('toolRecBox',           'innerHTML',      '');
    clear('policyFlagsBox',       'innerHTML',      '');
    clear('alternativesBox',      'innerHTML',      '');
    clear('policyBlockedBox',     'innerHTML',      '');
    clear('resultPrompt',         'textContent',    '');
    clear('policyBlockedBox',     'style.display',  'none');
    clear('confidentialityNotice','style.display',  'none');
    clear('promptToolbar',        'style.display',  'none');
    clear('userInput',            'value',          '');

    if (typeof navigateTo === 'function') navigateTo('home');

    /* Restore admin-only elements so next admin login re-applies correctly.
       Clear both regular display and the !important variant set on login. */
    ADMIN_ONLY.concat(USER_ONLY).forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.removeProperty('display');
      });
    });

    /* Reset dropdown user-info (in case another user logs in afterwards) */
    const dropAvatar = document.getElementById('dropUserAvatar');
    const dropName   = document.getElementById('dropUserName');
    const dropEmail  = document.getElementById('dropUserEmail');
    if (dropAvatar) dropAvatar.textContent = '';
    if (dropName)   dropName.textContent   = '';
    if (dropEmail)  dropEmail.textContent  = '';

    /* Close profile dropdown if open */
    document.getElementById('hdrDropdown')?.classList.remove('open');
  }

  /* ── logout → clear local session → server logout ─────────── */
  function logout() {
    clearSession();
    /* Okta SSO: redirect to server logout endpoint which clears the
       server-side session cookie and bounces back to the login page. */
    window.location.href = '/saml/logout';
  }

  /* ── fetch user from server session (after Okta redirect) ── */
  async function fetchServerSession() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /* ── boot ─────────────────────────────────────────────────── */
  async function boot() {
    /* Sign out — single binding on the static button */
    document.getElementById('authLogoutBtn')?.addEventListener('click', logout);

    /* Close profile dropdown when clicking anywhere else */
    document.addEventListener('click', () => {
      document.getElementById('hdrDropdown')?.classList.remove('open');
    });

    /* Okta SSO boot path — after /saml/acs redirects to /?sso=1, pull
       the authenticated user from the server session and render the app. */
    const params = new URLSearchParams(window.location.search);
    const justLoggedIn = params.get('sso') === '1';

    if (justLoggedIn) {
      const serverUser = await fetchServerSession();
      if (serverUser && serverUser.email) {
        saveSession(serverUser);
        history.replaceState(null, '', '/');
        showApp(serverUser);
        if (typeof initRecentRuns === 'function') initRecentRuns();
        if (typeof loadHistory === 'function') loadHistory();
        window._personalization?.loadPrefs?.();
        return;
      }
    }

    /* Tab-refresh: restore from sessionStorage if present, and re-validate
       against the server session so a logged-out user can't keep using
       a stale local cache. */
    const cached = loadSession();
    if (cached && cached.email && cached.role) {
      const serverUser = await fetchServerSession();
      if (serverUser && serverUser.email) {
        saveSession(serverUser);
        showApp(serverUser);
        if (typeof initRecentRuns === 'function') initRecentRuns();
        if (typeof loadHistory === 'function') loadHistory();
        window._personalization?.loadPrefs?.();
        return;
      }
      /* Server session is gone — wipe the stale local cache. */
      clearSession();
    }

    showLoginScreen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window._navigatorAuth = { logout, loadSession };

})();
