/* ══════════════════════════════════════════════════════
   scenario_library.js — Scenario Library page
   Layout: horizontal mega-group tabs (like AI Tools)
           → category filter dropdown below tabs
           → scenario cards grid
══════════════════════════════════════════════════════ */

(function () {

  /* ── State ── */
  let SL_DATA         = [];
  let SL_ACTIVE_MEGA  = 'all';
  let SL_ACTIVE_CAT   = '';
  let SL_ACTIVE_ROLE  = '';
  let SL_ACTIVE_PHASE = '';
  let SL_SEARCH       = '';
  // Intent search — applied only on Enter / Apply click (NOT on keystroke).
  // Matches against task_type / category / mega_group / phase so users can
  // discover whether a scenario already exists for a given intent.
  let SL_INTENT_SEARCH = '';
  let SL_FAVORITES    = [];

  function _sessionEmail() {
    try { return (JSON.parse(sessionStorage.getItem('navigator_session')) || {}).email || ''; }
    catch { return ''; }
  }
  function _favKey() {
    const email = _sessionEmail();
    return email ? `sl_favorites__${email}` : 'sl_favorites__guest';
  }

  const DELIVER_MEGA  = 'Deliver Projects';
  const DELIVER_PHASES = ['Discover', 'Prepare', 'Explore', 'Realize', 'Deploy', 'Run'];

  /* ── Mega-group visual system: single neutral + primary accent
        All mega-groups share the same dot/heading colors. Identity comes
        from the icon and label, not the color. Accent (--primary) is
        reserved for the active/selected state. ── */
  const NEUTRAL_DOT = '#94A3B8';   // slate-400 — uniform neutral dots
  const SECTION_BG     = '#F1F5F9'; // slate-100 — heading background
  const SECTION_BORDER = '#CBD5E1'; // slate-300 — heading left-border + count pill
  const SECTION_TEXT   = '#0F172A'; // slate-900 — heading text

  function _megaProxy(value) {
    return new Proxy({}, { get: () => value });
  }
  const MEGA_DOT_COLORS = _megaProxy(NEUTRAL_DOT);
  const MEGA_SECTION_COLORS = _megaProxy({
    bg: SECTION_BG, border: SECTION_BORDER, text: SECTION_TEXT
  });

  /* ── Helpers ── */
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _loadFavorites() {
    try { SL_FAVORITES = JSON.parse(localStorage.getItem(_favKey()) || '[]'); } catch { SL_FAVORITES = []; }
  }
  function _saveFavorites() { localStorage.setItem(_favKey(), JSON.stringify(SL_FAVORITES)); }
  function _isFav(title)    { return SL_FAVORITES.some(f => f.title === title); }
  function _updateFavoritesTabVisibility() {
    const tab = document.getElementById('slFavoritesTab');
    if (!tab) return;
    tab.style.display = '';
    if (!SL_FAVORITES.length && tab.classList.contains('active')) {
      const scenariosBtn = document.querySelector('.sl-subtab-btn[data-sltab="scenarios"]');
      if (scenariosBtn) scenariosBtn.click();
    }
  }

  function _copyText(text, btn) {
    const done = () => {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      btn.classList.add('sl-copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('sl-copied'); }, 1800);
    };
    if (typeof _copyToClipboard === 'function') { _copyToClipboard(text, done); return; }
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done); return; }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function _megaGroups() {
    const seen = [];
    SL_DATA.forEach(s => { if (s.mega_group && !seen.includes(s.mega_group)) seen.push(s.mega_group); });
    return seen;
  }

  function _categoriesFor(mega) {
    const seen = [];
    SL_DATA.forEach(s => {
      if ((mega === 'all' || s.mega_group === mega) && s.category && !seen.includes(s.category))
        seen.push(s.category);
    });
    return seen;
  }

  function _rolesFor(mega) {
    const seen = new Set();
    SL_DATA.forEach(s => {
      if (mega === 'all' || s.mega_group === mega) {
        (s.persona || '').split(/[,\/]/).forEach(r => {
          const t = r.trim();
          if (t) seen.add(t);
        });
      }
    });
    return [...seen].sort();
  }

  /* ── Intent-search tokenizer ──
     Splits a natural-language query into "meaningful" tokens by lower-casing,
     splitting on non-word chars, and dropping very short tokens + a small
     stop-word list. We deliberately KEEP short technical acronyms like
     "ai", "ui", "qa" by allowing length-2 tokens that aren't stop words.
     Returns a unique list of tokens. */
  const _STOP_WORDS = new Set([
    'a','an','the','and','or','but','of','in','on','at','to','for','with',
    'from','by','as','is','are','was','were','be','been','being','it','its',
    'this','that','these','those','i','my','me','we','our','you','your',
    'can','could','should','would','will','may','might','do','does','did',
    'have','has','had','if','then','than','so','into','onto','via','using',
    'use','used','about','any','some','all','each','also','just','only',
    'how','what','when','where','which','who','why','need','want','help',
  ]);
  function _tokenize(q) {
    if (!q) return [];
    const raw = String(q).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const t of raw) {
      if (t.length < 2) continue;            // drop single chars
      if (_STOP_WORDS.has(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  /* ── Intent score for one scenario against pre-tokenized query ──
     Concatenates all searchable fields into one haystack, then counts how
     many of the query tokens appear as substrings. Title hits get a small
     boost so an exact title-match floats to the top, but the threshold
     itself uses the raw token-hit count. */
  function _intentScore(s, tokens) {
    if (!tokens.length) return 0;
    const hay = [
      s.title, s.scenario, s.task_type, s.category,
      s.mega_group, s.phase, s.persona,
    ].map(v => (v || '').toLowerCase()).join(' \u0001 ');
    const titleLower = (s.title || '').toLowerCase();
    let hits = 0, boost = 0;
    for (const t of tokens) {
      if (hay.includes(t)) {
        hits++;
        if (titleLower.includes(t)) boost += 0.5;   // title-match floats to top
      }
    }
    return hits === 0 ? 0 : hits + boost;
  }

  /* Adaptive minimum-hit threshold — short queries are strict, long queries
     stay permissive so users can paste a whole sentence and still see what
     loosely matches. NEVER shown to the user. */
  function _minHitsFor(tokenCount) {
    if (tokenCount <= 1) return 1;
    if (tokenCount <= 3) return 1;
    if (tokenCount <= 6) return 2;
    return Math.max(2, Math.floor(tokenCount * 0.3));
  }

  function _filteredScenarios() {
    // ── 1. Hard filters (sidebar, role, category, phase) ──
    let items = SL_DATA.filter(s => {
      if (SL_ACTIVE_MEGA !== 'all' && s.mega_group !== SL_ACTIVE_MEGA) return false;
      if (SL_ACTIVE_PHASE && s.phase !== SL_ACTIVE_PHASE) return false;
      if (SL_ACTIVE_CAT  && s.category !== SL_ACTIVE_CAT)  return false;
      if (SL_ACTIVE_ROLE) {
        const roles = (s.persona || '').split(/[,\/]/).map(r => r.trim().toLowerCase());
        if (!roles.includes(SL_ACTIVE_ROLE.toLowerCase())) return false;
      }
      // Keyword search — live substring across title/scenario/persona/category.
      if (SL_SEARCH) {
        const q = SL_SEARCH.toLowerCase();
        return (s.title    || '').toLowerCase().includes(q) ||
               (s.scenario || '').toLowerCase().includes(q) ||
               (s.persona  || '').toLowerCase().includes(q) ||
               (s.category || '').toLowerCase().includes(q);
      }
      return true;
    });

    // ── 2. Intent fuzzy/token search — applied last so its sort wins. ──
    if (SL_INTENT_SEARCH) {
      const tokens  = _tokenize(SL_INTENT_SEARCH);
      const minHits = _minHitsFor(tokens.length);
      if (!tokens.length) return items;     // query was all stop-words → no-op
      const scored = [];
      for (const s of items) {
        const score = _intentScore(s, tokens);
        // Compare integer hit-count against threshold (boost only affects sort).
        if (Math.floor(score) >= minHits) scored.push({ s, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.map(x => x.s);
    }

    return items;
  }

  /* ══════════════════════════════════════
     RENDER — Sidebar mega-group nav
  ══════════════════════════════════════ */
  function renderSidebarNav() {
    const navAll    = document.getElementById('slMegaNav');
    const navGroups = document.getElementById('slMegaNavGroups');
    const navSection= document.getElementById('slMegaNavSection');
    if (!navAll) return;

    const groups     = _megaGroups();
    const totalCount = SL_DATA.length;

    // Hide the "What are you trying to do?" section entirely when there are
    // no mega-groups — avoids a header floating over empty space.
    if (navSection) navSection.style.display = groups.length ? '' : 'none';

    navAll.innerHTML = `
      <div class="sl-nav-item${SL_ACTIVE_MEGA === 'all' ? ' active' : ''}" data-mega="all">
        <span class="sl-nav-dot" style="background:#3498db"></span>
        <span class="sl-nav-label">All Scenarios</span>
        <span class="sl-nav-count" id="slCountBadge">${totalCount}</span>
      </div>`;

    if (navGroups) {
      navGroups.innerHTML = groups.map(mg => {
        const dot   = MEGA_DOT_COLORS[mg] || '#adb5bd';
        const count = SL_DATA.filter(s => s.mega_group === mg).length;
        const isDeliver = mg === DELIVER_MEGA;
        const isDeliverActive = SL_ACTIVE_MEGA === mg;

        let phaseChips = '';
        if (isDeliver) {
          const chips = DELIVER_PHASES.map(ph => {
            const phCount = SL_DATA.filter(s => s.mega_group === DELIVER_MEGA && s.phase === ph).length;
            if (!phCount) return '';
            return `<span class="sl-phase-chip${SL_ACTIVE_PHASE === ph && isDeliverActive ? ' active' : ''}" data-phase="${_esc(ph)}">${_esc(ph)}<span class="sl-phase-count">${phCount}</span></span>`;
          }).join('');
          phaseChips = `<div class="sl-phase-chips${isDeliverActive ? ' visible' : ''}" id="slPhaseChips">${chips}</div>`;
        }

        return `
          <div class="sl-nav-item${isDeliverActive ? ' active' : ''}" data-mega="${_esc(mg)}">
            <span class="sl-nav-dot" style="background:${dot}"></span>
            <span class="sl-nav-label">${_esc(mg)}</span>
            <span class="sl-nav-count">${count}</span>
          </div>${phaseChips}`;
      }).join('');
    }

    document.querySelectorAll('#slMegaNav .sl-nav-item, #slMegaNavGroups .sl-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        SL_ACTIVE_MEGA  = item.dataset.mega;
        SL_ACTIVE_CAT   = '';
        SL_ACTIVE_ROLE  = '';
        SL_ACTIVE_PHASE = '';
        SL_SEARCH       = '';
        SL_INTENT_SEARCH = '';
        const searchEl = document.getElementById('slSearch');
        if (searchEl) searchEl.value = '';
        const intentEl = document.getElementById('slIntentSearch');
        if (intentEl) intentEl.value = '';
        const roleEl = document.getElementById('slRoleFilter');
        if (roleEl) roleEl.value = '';
        renderAll();
      });
    });

    // ── Mobile mega-group select — populate + wire change handler ──
    const megaSel = document.getElementById('slMegaSelectMobile');
    if (megaSel) {
      const totalCount = SL_DATA.length;
      megaSel.innerHTML =
        `<option value="all">All scenarios${totalCount ? ' (' + totalCount + ')' : ''}</option>` +
        groups.map(mg => {
          const c = SL_DATA.filter(s => s.mega_group === mg).length;
          return `<option value="${_esc(mg)}">${_esc(mg)} (${c})</option>`;
        }).join('');
      megaSel.value = SL_ACTIVE_MEGA || 'all';
      if (!megaSel._wired) {
        megaSel._wired = true;
        megaSel.addEventListener('change', () => {
          SL_ACTIVE_MEGA  = megaSel.value;
          SL_ACTIVE_CAT   = '';
          SL_ACTIVE_PHASE = '';
          renderAll();
        });
      }
    }

    document.querySelectorAll('#slMegaNavGroups .sl-phase-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation();
        SL_ACTIVE_MEGA  = DELIVER_MEGA;
        SL_ACTIVE_PHASE = SL_ACTIVE_PHASE === chip.dataset.phase ? '' : chip.dataset.phase;
        SL_ACTIVE_CAT   = '';
        SL_ACTIVE_ROLE  = '';
        SL_SEARCH       = '';
        SL_INTENT_SEARCH = '';
        const searchEl = document.getElementById('slSearch');
        if (searchEl) searchEl.value = '';
        const intentEl = document.getElementById('slIntentSearch');
        if (intentEl) intentEl.value = '';
        const roleEl = document.getElementById('slRoleFilter');
        if (roleEl) roleEl.value = '';
        renderAll();
      });
    });
  }

  /* ══════════════════════════════════════
     RENDER — Role filter dropdown
  ══════════════════════════════════════ */
  function renderRoleFilter() {
    const sel = document.getElementById('slRoleFilter');
    if (!sel) return;
    const roles = _rolesFor(SL_ACTIVE_MEGA);
    sel.innerHTML = '<option value="">All Roles</option>' +
      roles.map(r => `<option value="${_esc(r)}"${SL_ACTIVE_ROLE === r ? ' selected' : ''}>${_esc(r)}</option>`).join('');
  }

  /* ══════════════════════════════════════
     RENDER — Scenario Cards
  ══════════════════════════════════════ */
  function renderScenarioGrid() {
    const grid    = document.getElementById('slScenarioGrid');
    const empty   = document.getElementById('slScenarioEmpty');
    const heading = document.getElementById('slGridHeading');
    if (!grid) return;

    const items = _filteredScenarios();

    if (heading) {
      const roleTag   = SL_ACTIVE_ROLE   ? ` · <em>${_esc(SL_ACTIVE_ROLE)}</em>`   : '';
      const phaseTag  = SL_ACTIVE_PHASE  ? ` · <em>${_esc(SL_ACTIVE_PHASE)}</em>`  : '';
      const intentTag = SL_INTENT_SEARCH ? ` · intent: <em>"${_esc(SL_INTENT_SEARCH)}"</em>` : '';
      if (SL_SEARCH) {
        heading.innerHTML = `Search: <em>"${_esc(SL_SEARCH)}"</em>${intentTag} <span class="sl-heading-count">${items.length} result${items.length !== 1 ? 's' : ''}</span>`;
      } else if (SL_INTENT_SEARCH) {
        heading.innerHTML = `Intent: <em>"${_esc(SL_INTENT_SEARCH)}"</em> <span class="sl-heading-count">${items.length} result${items.length !== 1 ? 's' : ''}</span>`;
      } else if (SL_ACTIVE_MEGA !== 'all') {
        heading.innerHTML = `${_esc(SL_ACTIVE_MEGA)}${phaseTag}${roleTag} <span class="sl-heading-count">${items.length} scenario${items.length !== 1 ? 's' : ''}</span>`;
      } else {
        heading.innerHTML = `All Scenarios${roleTag} <span class="sl-heading-count">${items.length}</span>`;
      }
    }

    if (!items.length) {
      grid.innerHTML = '';
      if (empty) {
        // Distinguish "filtered to nothing" vs. "library is genuinely empty"
        const isFiltering = !!(SL_SEARCH || SL_INTENT_SEARCH || SL_ACTIVE_ROLE || SL_ACTIVE_CAT || SL_ACTIVE_PHASE || SL_ACTIVE_MEGA !== 'all');
        const totalScenarios = SL_DATA.length;
        const role = (typeof _getSessionRole === 'function') ? _getSessionRole() : '';
        const isAdmin = role === 'admin';
        if (totalScenarios === 0) {
          empty.innerHTML = isAdmin
            ? `<div class="sl-empty-icon">📚</div>
               <h3>No scenarios in the library yet</h3>
               <p>Upload your scenario library Excel via the <strong>Add scenario</strong> button at the top, or add one entry manually.</p>`
            : `<div class="sl-empty-icon">📚</div>
               <h3>No scenarios available yet</h3>
               <p>An administrator hasn't published the scenario library. You can still describe your task on the Home page for guidance.</p>`;
        } else if (isFiltering) {
          empty.innerHTML = `
            <div class="sl-empty-icon">🔎</div>
            <h3>No scenarios match your filters</h3>
            <p>Try clearing the search box, picking a different role, or selecting <em>All Scenarios</em>.</p>`;
        } else {
          empty.innerHTML = `<div class="sl-empty-icon">🔎</div><h3>No scenarios found</h3>`;
        }
        empty.classList.remove('hidden');
      }
      return;
    }
    if (empty) empty.classList.add('hidden');

    if (SL_ACTIVE_MEGA === 'all' && !SL_ACTIVE_CAT && !SL_SEARCH) {
      const megaOrder = _megaGroups();
      const byMega = {};
      items.forEach(s => {
        const mg  = s.mega_group || 'General';
        const cat = s.category   || 'General';
        if (!byMega[mg]) byMega[mg] = {};
        if (!byMega[mg][cat]) byMega[mg][cat] = [];
        byMega[mg][cat].push(s);
      });
      grid.innerHTML = megaOrder.filter(mg => byMega[mg]).map(mg => {
        const col  = MEGA_SECTION_COLORS[mg] || { bg: 'rgba(127,140,141,0.07)', border: '#7f8c8d', text: '#2c3e50' };
        const dot  = MEGA_DOT_COLORS[mg] || '#adb5bd';
        const catSections = Object.entries(byMega[mg]).map(([cat, scenarios]) => `
          <div class="sl-cat-section">
            <div class="sl-cat-section-title">
              ${_esc(cat)}
              <span class="sl-cat-count">${scenarios.length}</span>
            </div>
            <div class="sl-cards-row">${scenarios.map(s => _buildCard(s)).join('')}</div>
          </div>`).join('');
        const totalCount = Object.values(byMega[mg]).reduce((a, b) => a + b.length, 0);
        return `
          <div class="sl-mega-section">
            <div class="sl-mega-section-heading" style="background:${col.bg};border-left:4px solid ${col.border};color:${col.text};">
              <span class="sl-nav-dot" style="background:${dot};width:10px;height:10px;border-radius:50%;flex-shrink:0;display:inline-block;"></span>
              <span class="sl-mega-section-name">${_esc(mg)}</span>
              <span class="sl-mega-section-count" style="background:${col.border};">${totalCount}</span>
            </div>
            <div class="sl-mega-section-body">${catSections}</div>
          </div>`;
      }).join('');

    } else if (SL_ACTIVE_MEGA !== 'all' && !SL_ACTIVE_CAT && !SL_SEARCH) {
      const byCategory = {};
      items.forEach(s => {
        const key = s.category || 'General';
        if (!byCategory[key]) byCategory[key] = [];
        byCategory[key].push(s);
      });
      const dot = MEGA_DOT_COLORS[SL_ACTIVE_MEGA] || '#3498db';
      grid.innerHTML = Object.entries(byCategory).map(([cat, scenarios]) => `
        <div class="sl-cat-section">
          <div class="sl-cat-section-title" style="border-bottom-color:${dot};">
            ${_esc(cat)}
            <span class="sl-cat-count">${scenarios.length}</span>
          </div>
          <div class="sl-cards-row">${scenarios.map(s => _buildCard(s)).join('')}</div>
        </div>`).join('');

    } else {
      grid.innerHTML = `<div class="sl-cards-row">${items.map(s => _buildCard(s)).join('')}</div>`;
    }

    _bindCardActions(grid);
  }

  /* ── Build card HTML ── */
  function _buildCard(s) {
    const fav     = _isFav(s.title);
    const preview = (s.scenario || '').length > 130
      ? (s.scenario || '').substring(0, 130) + '…'
      : (s.scenario || '');
    return `
      <div class="sl-card"
        data-title="${encodeURIComponent(s.title || '')}"
        data-scenario="${encodeURIComponent(s.scenario || '')}"
        data-mega="${_esc(s.mega_group || '')}"
        data-cat="${_esc(s.category || '')}"
        data-persona="${_esc(s.persona || '')}"
        data-task-type="${_esc(s.task_type || '')}">
        <div class="sl-card-meta">
          ${s.task_type ? `<span class="sl-card-persona">🏷 ${_esc(s.task_type)}</span>` : ''}
        </div>
        <div class="sl-card-title">${_esc(s.title || '')}</div>
        <div class="sl-card-body">${_esc(preview)}</div>
        <div class="sl-card-actions">
          <button class="sl-btn-generate">&#9889; Generate</button>
          <button class="sl-btn-copy">&#128203; Copy</button>
          <button class="sl-btn-fav ${fav ? 'sl-fav-saved' : ''}">
            ${fav ? '&#9733; Saved' : '&#9734; Save'}
          </button>
        </div>
      </div>`;
  }

  /* ── Bind card buttons ── */
  function _bindCardActions(container) {
    container.querySelectorAll('.sl-btn-generate').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const card     = btn.closest('.sl-card');
        const scenario = decodeURIComponent(card.dataset.scenario);
        const persona  = card.dataset.persona || '';
        const taskType = card.dataset.taskType || '';
        _openGenModal({ scenario, persona, taskType });
      });
    });

    container.querySelectorAll('.sl-btn-copy').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const scenario = decodeURIComponent(btn.closest('.sl-card').dataset.scenario);
        _copyText(scenario, btn);
      });
    });

    container.querySelectorAll('.sl-btn-fav').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const card     = btn.closest('.sl-card');
        const title    = decodeURIComponent(card.dataset.title);
        const scenario = decodeURIComponent(card.dataset.scenario);
        const persona  = card.dataset.persona || '';
        const mega     = card.dataset.mega || '';
        const cat      = card.dataset.cat || '';
        const idx      = SL_FAVORITES.findIndex(f => f.title === title);
        if (idx >= 0) {
          SL_FAVORITES.splice(idx, 1);
          btn.innerHTML = '&#9734; Save';
          btn.classList.remove('sl-fav-saved');
        } else {
          SL_FAVORITES.push({ title, scenario, persona, mega_group: mega, category: cat });
          btn.innerHTML = '&#9733; Saved';
          btn.classList.add('sl-fav-saved');
        }
        _saveFavorites();
      });
    });
  }

  /* ══════════════════════════════════════
     RENDER — Favorites tab
  ══════════════════════════════════════ */
  function renderFavorites() {
    const grid  = document.getElementById('slFavGrid');
    const empty = document.getElementById('slFavEmpty');
    if (!grid) return;
    _loadFavorites();

    if (!SL_FAVORITES.length) {
      grid.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    grid.innerHTML = `<div class="sl-cards-row">${
      SL_FAVORITES.map(f => _buildCard({
        title: f.title,
        scenario: f.scenario,
        mega_group: f.mega_group || '',
        category: f.category || '',
        persona: f.persona || ''
      })).join('')
    }</div>`;
    _bindCardActions(grid);
  }

  /* ── Count badge (updates the "All" nav item count) ── */
  function _updateCountBadge() {
    const badge = document.getElementById('slCountBadge');
    if (badge) badge.textContent = SL_DATA.length;
  }

  /* ── Generate modal ── */
  function _openGenModal({ scenario, persona, taskType }) {
    if (typeof plOpenScenarioGenModal === 'function') {
      plOpenScenarioGenModal({ body: scenario, activeRole: persona || null, activeTaskType: taskType || null });
      return;
    }
    if (typeof navigateTo === 'function') navigateTo('home');
    const textarea  = document.getElementById('userInput');
    const charCount = document.getElementById('charCount');
    if (textarea) {
      textarea.value = scenario;
      if (charCount) charCount.textContent = scenario.length;
      textarea.dispatchEvent(new Event('input'));
    }
    window.scrollTo(0, 0);
  }

  function _personaToRole(persona) {
    if (!persona) return null;
    const p = persona.toLowerCase();
    if (p.includes('consult') || p.includes('manager'))  return 'consultant';
    if (p.includes('exec')    || p.includes('director')) return 'executive';
    if (p.includes('dev')     || p.includes('tech'))     return 'developer';
    if (p.includes('analyst') || p.includes('ba'))       return 'analyst';
    if (p.includes('sales')   || p.includes('bd'))       return 'sales';
    if (p.includes('market'))                            return 'marketing';
    if (p.includes('hr')      || p.includes('people'))   return 'hr';
    if (p.includes('financ')  || p.includes('account'))  return 'finance';
    return null;
  }

  /* ══════════════════════════════════════
     RENDER ALL
  ══════════════════════════════════════ */
  function renderAll() {
    renderSidebarNav();
    renderRoleFilter();
    renderScenarioGrid();
    _updateCountBadge();
  }

  /* ══════════════════════════════════════
     LOAD DATA
  ══════════════════════════════════════ */
  async function loadScenarios() {
    const loadingEl = document.getElementById('slLoading');
    const mainEl    = document.getElementById('slMainArea');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (mainEl)    mainEl.style.display    = 'none';

    try {
      const res  = await fetch('/api/scenarios');
      const data = await res.json();
      SL_DATA = data.scenarios || [];
    } catch (e) {
      SL_DATA = [];
    }
    if (typeof window.plClearRolesCache === 'function') window.plClearRolesCache();

    if (loadingEl) loadingEl.style.display = 'none';
    if (mainEl)    mainEl.style.display    = '';

    renderAll();
  }

   /* ══════════════════════════════════════
     SUB-TABS (Scenarios / Favorites)
  ══════════════════════════════════════ */
  function initSubTabs() {
    document.querySelectorAll('.sl-subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sl-subtab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.sl-subtab-panel').forEach(p => {
          p.classList.remove('active');
          p.style.display = 'none';
        });
        btn.classList.add('active');
        const panel = document.getElementById(`sl-panel-${btn.dataset.sltab}`);
        if (panel) { panel.classList.add('active'); panel.style.display = ''; }
        if (btn.dataset.sltab === 'favorites') renderFavorites();
      });
    });
  }

  /* ══════════════════════════════════════
     SEARCH
  ══════════════════════════════════════ */
  function initSearch() {
    const inp = document.getElementById('slSearch');
    if (inp) {
      inp.addEventListener('input', () => {
        SL_SEARCH = inp.value.trim();
        if (SL_SEARCH) { SL_ACTIVE_MEGA = 'all'; SL_ACTIVE_CAT = ''; SL_ACTIVE_ROLE = ''; SL_ACTIVE_PHASE = ''; }
        renderAll();
      });
    }

    /* ── Intent search ── applies ONLY on Enter or Apply-button click.
       Typing alone does NOT re-render, so the user can finish composing
       a multi-word intent before the filter runs. Empty value clears
       the intent filter. */
    const intentInp = document.getElementById('slIntentSearch');
    const intentBtn = document.getElementById('slIntentSearchBtn');
    const applyIntent = () => {
      const v = (intentInp?.value || '').trim();
      SL_INTENT_SEARCH = v;
      // Reset sidebar/category filters so the intent search sees the
      // full library — same behaviour as the keyword search above.
      if (v) { SL_ACTIVE_MEGA = 'all'; SL_ACTIVE_CAT = ''; SL_ACTIVE_ROLE = ''; SL_ACTIVE_PHASE = ''; }
      renderAll();
    };
    if (intentInp) {
      intentInp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); applyIntent(); }
      });
      // Clearing the box (e.g. clicking the native 'x') should drop the
      // filter immediately so users aren't stuck with stale results.
      intentInp.addEventListener('search', () => {
        if (!intentInp.value.trim()) applyIntent();
      });
    }
    if (intentBtn) intentBtn.addEventListener('click', applyIntent);
  }

  /* ══════════════════════════════════════
     ROLE FILTER
  ══════════════════════════════════════ */
  function initRoleFilter() {
    const sel = document.getElementById('slRoleFilter');
    if (!sel) return;
    sel.addEventListener('change', () => {
      SL_ACTIVE_ROLE = sel.value;
      renderScenarioGrid();
      _updateCountBadge();
    });
  }

  /* ══════════════════════════════════════
     REGISTER SCENARIO MODAL
  ══════════════════════════════════════ */
  function initRegisterScenarioModal() {
    const openBtn   = document.getElementById('slRegisterScenarioBtn');
    const overlay   = document.getElementById('registerScenarioOverlay');
    const closeBtn  = document.getElementById('btnCloseRegisterScenario');
    const cancelBtn = document.getElementById('btnCancelRegisterScenario');
    const saveBtn   = document.getElementById('btnSaveRegisterScenario');
    const status    = document.getElementById('rsStatus');

    const fields = {
      title:         () => document.getElementById('rsTitle'),
      megaGroup:     () => document.getElementById('rsMegaGroup'),
      category:      () => document.getElementById('rsCategory'),
      persona:       () => document.getElementById('rsPersona'),
      scenario:      () => document.getElementById('rsScenario'),
      activatePhase: () => document.getElementById('rsActivatePhase'),
    };

    let _activeTab        = 'manual';
    let _bulkSelectedFile = null;
    let _bulkUploading    = false;
    let _bulkAbortCtrl    = null;

    function _activateTab(tabName) {
      _activeTab = tabName;
      overlay?.querySelectorAll('.te-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.rstab === tabName);
      });
      overlay?.querySelectorAll('.te-panel').forEach(p => {
        const isActive = p.dataset.rspanel === tabName;
        p.classList.toggle('active', isActive);
        p.style.display = isActive ? '' : 'none';
      });
      if (saveBtn) saveBtn.style.display = tabName === 'fileupload' ? 'none' : '';
      const bulkBtn = document.getElementById('rsBulkUploadBtn');
      if (bulkBtn) bulkBtn.style.display = tabName === 'fileupload' ? '' : 'none';
    }

    function _populateDataLists() {
      const megaSet = new Set(), catSet = new Set(), personaSet = new Set();
      SL_DATA.forEach(s => {
        if (s.mega_group) megaSet.add(s.mega_group);
        if (s.category)   catSet.add(s.category);
        if (s.persona)    personaSet.add(s.persona);
      });
      const mgSel      = document.getElementById('rsMegaGroup');
      const catSel     = document.getElementById('rsCategory');
      const personaSel = document.getElementById('rsPersona');
      if (mgSel) {
        mgSel.innerHTML = '<option value="">— Select Group —</option>' +
          [...megaSet].map(v => `<option value="${_esc(v)}">${_esc(v)}</option>`).join('');
      }
      if (catSel) {
        catSel.innerHTML = '<option value="">— Select Category —</option>' +
          [...catSet].map(v => `<option value="${_esc(v)}">${_esc(v)}</option>`).join('');
      }
      if (personaSel) {
        personaSel.innerHTML = '<option value="">— Select Persona / Role —</option>' +
          [...personaSet].map(v => `<option value="${_esc(v)}">${_esc(v)}</option>`).join('');
      }
    }

    function _toggleActivatePhase() {
      const mg  = fields.megaGroup();
      const row = document.getElementById('rsActivatePhaseRow');
      const ph  = fields.activatePhase();
      if (!row) return;
      const show = mg && mg.value === DELIVER_MEGA;
      row.style.display = show ? '' : 'none';
      if (!show && ph) ph.value = '';
    }

    function openModal() {
      _populateDataLists();
      overlay?.classList.add('open');
      if (status) status.style.display = 'none';
      _activateTab('manual');
      _resetBulk();
    }

    function closeModal() {
      if (_bulkUploading && _bulkAbortCtrl) { _bulkAbortCtrl.abort(); _bulkUploading = false; }
      overlay?.classList.remove('open');
      Object.values(fields).forEach(fn => { const el = fn(); if (el) el.value = ''; });
      const phRow = document.getElementById('rsActivatePhaseRow');
      if (phRow) phRow.style.display = 'none';
      if (status) status.style.display = 'none';
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save';
      }
      _resetBulk();
    }

    function _resetBulk() {
      _bulkSelectedFile = null;
      _bulkUploading    = false;
      _bulkAbortCtrl    = null;
      const fi = document.getElementById('rsBulkFileInput');
      if (fi) fi.value = '';
      const info = document.getElementById('rsBulkFileInfo');
      if (info) info.style.display = 'none';
      const dz = document.getElementById('rsBulkDropZone');
      if (dz) dz.style.display = '';
      const st = document.getElementById('rsBulkStatus');
      if (st) { st.style.display = 'none'; st.textContent = ''; }
      const bulkBtn = document.getElementById('rsBulkUploadBtn');
      if (bulkBtn) { bulkBtn.disabled = true; bulkBtn.textContent = 'Upload & Apply'; }
    }

    function showStatus(msg, type) {
      if (!status) return;
      status.textContent = msg;
      status.style.display = 'block';
      status.style.background = type === 'error' ? 'var(--danger-pale,#fef2f2)' : 'var(--success-pale,#f0fdf4)';
      status.style.border = `1px solid ${type === 'error' ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'}`;
      status.style.color = type === 'error' ? '#991b1b' : '#065f46';
    }

    function showBulkStatus(msg, type) {
      const el = document.getElementById('rsBulkStatus');
      if (!el) return;
      el.textContent = msg;
      el.style.display = 'block';
      el.style.background = type === 'error' ? 'var(--danger-pale,#fef2f2)' : 'var(--success-pale,#f0fdf4)';
      el.style.border = `1px solid ${type === 'error' ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'}`;
      el.style.color = type === 'error' ? '#991b1b' : '#065f46';
    }

    function _setBulkFile(file) {
      if (!file || !file.name.match(/\.(xlsx|xlsm|xls)$/i)) { showBulkStatus('Please select a valid .xlsx file.', 'error'); return; }
      _bulkSelectedFile = file;
      const nameEl = document.getElementById('rsBulkFileName');
      if (nameEl) nameEl.textContent = file.name;
      const info = document.getElementById('rsBulkFileInfo');
      if (info) info.style.display = 'flex';
      const dz = document.getElementById('rsBulkDropZone');
      if (dz) dz.style.display = 'none';
      const bulkBtn = document.getElementById('rsBulkUploadBtn');
      if (bulkBtn) bulkBtn.disabled = false;
      const st = document.getElementById('rsBulkStatus');
      if (st) st.style.display = 'none';
    }

    openBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    overlay?.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    document.getElementById('rsMegaGroup')?.addEventListener('change', _toggleActivatePhase);

    overlay?.querySelectorAll('.te-tab').forEach(tab => {
      tab.addEventListener('click', () => { if (tab.dataset.rstab) _activateTab(tab.dataset.rstab); });
    });

    const bulkDz = document.getElementById('rsBulkDropZone');
    bulkDz?.addEventListener('click', () => document.getElementById('rsBulkFileInput')?.click());
    bulkDz?.addEventListener('dragover', e => { e.preventDefault(); bulkDz.classList.add('dragover'); });
    bulkDz?.addEventListener('dragleave', () => bulkDz.classList.remove('dragover'));
    bulkDz?.addEventListener('drop', e => {
      e.preventDefault();
      bulkDz.classList.remove('dragover');
      if (e.dataTransfer.files[0]) _setBulkFile(e.dataTransfer.files[0]);
    });

    document.getElementById('btnBrowseBulkScenarios')?.addEventListener('click', () => {
      document.getElementById('rsBulkFileInput')?.click();
    });
    document.getElementById('rsBulkFileInput')?.addEventListener('change', e => {
      if (e.target.files[0]) _setBulkFile(e.target.files[0]);
    });
    document.getElementById('rsBulkClearBtn')?.addEventListener('click', () => {
      _bulkSelectedFile = null;
      const fi = document.getElementById('rsBulkFileInput');
      if (fi) fi.value = '';
      const info = document.getElementById('rsBulkFileInfo');
      if (info) info.style.display = 'none';
      const dz = document.getElementById('rsBulkDropZone');
      if (dz) dz.style.display = '';
      const bulkBtn = document.getElementById('rsBulkUploadBtn');
      if (bulkBtn) bulkBtn.disabled = true;
    });

    const footerRight = document.getElementById('rsFooterRight');
    if (footerRight && !document.getElementById('rsBulkUploadBtn')) {
      const bulkBtn = document.createElement('button');
      bulkBtn.id = 'rsBulkUploadBtn';
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
          const res  = await fetch('/api/upload-scenario-library', { method: 'POST', body: formData, signal: _bulkAbortCtrl.signal });
          const data = await res.json();
          _bulkUploading = false;
          if (res.ok) {
            showBulkStatus(`✅ ${data.scenarios_loaded} scenarios loaded from "${_bulkSelectedFile.name}".`, 'success');
            bulkBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload & Apply';
            await loadScenarios();
            setTimeout(closeModal, 1800);
          } else {
            throw new Error(data.detail || 'Upload failed');
          }
        } catch (err) {
          _bulkUploading = false;
          if (err.name === 'AbortError') {
            showBulkStatus('⛔ Upload cancelled.', 'error');
          } else {
            showBulkStatus(`❌ ${err.message}`, 'error');
          }
          bulkBtn.disabled = false;
          bulkBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload & Apply';
        }
      });
    }

    saveBtn?.addEventListener('click', async () => {
      const title     = fields.title().value.trim();
      const megaGroup = fields.megaGroup().value.trim();
      const category  = fields.category().value.trim();
      const persona   = fields.persona().value.trim();
      const scenario  = fields.scenario().value.trim();

      if (!title)     { showStatus('Scenario Title is required.', 'error'); return; }
      if (!megaGroup) { showStatus('Group is required.', 'error'); return; }
      if (!category)  { showStatus('Category is required.', 'error'); return; }
      if (!persona)   { showStatus('Persona / Role is required.', 'error'); return; }
      if (!scenario)  { showStatus('Scenario body is required.', 'error'); return; }

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';

      try {
        const res = await fetch('/api/scenarios/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            mega_group:      megaGroup,
            category:        category,
            persona:         persona,
            activate_phase:  fields.activatePhase().value,
            scenario,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Save failed');
        showStatus('✅ Scenario registered successfully!', 'success');
        await loadScenarios();
        setTimeout(closeModal, 900);
      } catch (err) {
        showStatus(`❌ ${err.message}`, 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save';
      }
    });
  }

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    _loadFavorites();
    _updateFavoritesTabVisibility();
    initSubTabs();
    initSearch();
    initRoleFilter();
    initRegisterScenarioModal();

    document.querySelectorAll('.nav-tab[data-page="promptlibrary"]').forEach(btn => {
      btn.addEventListener('click', () => { if (!SL_DATA.length) loadScenarios(); });
    });

    const page = document.getElementById('page-promptlibrary');
    if (page && page.classList.contains('active')) loadScenarios();
  });

  window.slLoadScenarios   = loadScenarios;
  window.slRenderFavorites = renderFavorites;
  window.slLoadFavorites   = _loadFavorites;
  window.slGetAllRoles     = () => {
    const seen = new Set();
    SL_DATA.forEach(s => {
      (s.persona || '').split(/[,\/]/).forEach(r => {
        const t = r.trim();
        if (t) seen.add(t);
      });
    });
    return [...seen].sort();
  };
  window.slGetActiveRole   = () => SL_ACTIVE_ROLE;

})();
