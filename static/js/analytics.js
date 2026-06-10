/* ══════════════════════════════════════════════════════════════════
   analytics.js — Analytics Dashboard
   Reads from /api/analytics-dashboard (time + role filtered)
   Supports: Today / This Week / This Month / Custom Date Range
   Drilldown: click any bar, row, or count to see matching logs
══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── State ── */
  let currentPeriod    = 'week';
  let currentRole      = 'all';
  let currentStartDate = '';
  let currentEndDate   = '';
  let currentDashData  = null;
  let chartInstances   = {};
  let isLoading        = false;

  /* ── User Activity pagination state ── */
  let uaPage   = 1;
  const UA_PER = 30;

  /* ── DOM refs ── */
  let anOverlay, anModal, anCloseBtn, anDropTrigger;
  let periodTabs, roleSelect, refreshBtn;
  let dateRangeBox, startDateInput, endDateInput, applyRangeBtn;
  let bodyEl;

  /* ── Drilldown DOM refs ── */
  let drillOverlay, drillPanel, drillClose, drillTitle, drillSub, drillIcon, drillBody;

  /* ── Color palette ── */
  const COLORS = [
    '#1565c0','#0288d1','#00897b','#f57c00','#7b1fa2',
    '#c62828','#2e7d32','#ad1457','#4527a0','#37474f',
  ];

  /* ════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════ */
  function init() {
    anOverlay      = document.getElementById('anOverlay');
    anModal        = document.getElementById('anModal');
    anCloseBtn     = document.getElementById('anCloseBtn');
    anDropTrigger  = document.getElementById('dropAnalytics');
    bodyEl         = document.getElementById('anBody');
    dateRangeBox   = document.getElementById('anDateRangeBox');
    startDateInput = document.getElementById('anStartDate');
    endDateInput   = document.getElementById('anEndDate');
    applyRangeBtn  = document.getElementById('anApplyRange');

    drillOverlay = document.getElementById('anDrillOverlay');
    drillPanel   = document.getElementById('anDrillPanel');
    drillClose   = document.getElementById('anDrillClose');
    drillTitle   = document.getElementById('anDrillTitle');
    drillSub     = document.getElementById('anDrillSub');
    drillIcon    = document.getElementById('anDrillIcon');
    drillBody    = document.getElementById('anDrillBody');

    if (!anOverlay || !anModal) return;

    /* Set default end date = today, start date = 7 days ago */
    const today = new Date();
    const week  = new Date(today); week.setDate(today.getDate() - 7);
    if (startDateInput) startDateInput.value = _fmtDate(week);
    if (endDateInput)   endDateInput.value   = _fmtDate(today);

    /* Open from dropdown / rail */
    anDropTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('menuDrawer')?.classList.remove('open');
      document.getElementById('menuDrawerOverlay')?.classList.remove('open');
      openDashboard();
    });

    /* Close */
    anCloseBtn?.addEventListener('click', closeDashboard);
    anOverlay?.addEventListener('click', closeDashboard);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (drillPanel?.classList.contains('open')) {
          closeDrilldown();
        } else if (anModal?.classList.contains('open')) {
          closeDashboard();
        }
      }
    });

    /* Period tabs */
    periodTabs = document.querySelectorAll('.an-period-tab');
    periodTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        periodTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentPeriod = tab.dataset.period;

        if (currentPeriod === 'custom') {
          if (dateRangeBox) dateRangeBox.style.display = 'flex';
        } else {
          if (dateRangeBox) dateRangeBox.style.display = 'none';
          currentStartDate = '';
          currentEndDate   = '';
          fetchAndRender();
        }
      });
    });

    /* Apply custom range button */
    applyRangeBtn?.addEventListener('click', () => {
      currentStartDate = startDateInput?.value || '';
      currentEndDate   = endDateInput?.value   || '';
      if (!currentStartDate || !currentEndDate) {
        alert('Please select both a start and end date.');
        return;
      }
      if (currentStartDate > currentEndDate) {
        alert('Start date must be before end date.');
        return;
      }
      fetchAndRender();
    });

    /* Role select */
    roleSelect = document.getElementById('anRoleSelect');
    roleSelect?.addEventListener('change', () => {
      currentRole = roleSelect.value;
      fetchAndRender();
    });

    /* Refresh */
    refreshBtn = document.getElementById('anRefreshBtn');
    refreshBtn?.addEventListener('click', fetchAndRender);

    /* Drilldown close */
    drillClose?.addEventListener('click', closeDrilldown);
    drillOverlay?.addEventListener('click', closeDrilldown);
  }

  /* ════════════════════════════════════════════
     OPEN / CLOSE DASHBOARD
  ════════════════════════════════════════════ */
  function openDashboard() {
  currentPeriod = 'week';
  currentStartDate = '';
  currentEndDate = '';

  periodTabs?.forEach(t => t.classList.remove('active'));
  document.querySelector('.an-period-tab[data-period="week"]')?.classList.add('active');

  if (dateRangeBox) dateRangeBox.style.display = 'none';

  anOverlay.classList.add('open');
  anModal.classList.add('open');
  fetchAndRender();
}

  function closeDashboard() {
    anOverlay.classList.remove('open');
    anModal.classList.remove('open');
    destroyCharts();
  }

  function destroyCharts() {
    Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch(e) {} });
    chartInstances = {};
  }

  /* ════════════════════════════════════════════
     DRILLDOWN PANEL
  ════════════════════════════════════════════ */
  function openDrilldown(title, subtitle, icon, params) {
    if (!drillPanel) return;
    drillTitle.textContent = title;
    drillSub.textContent   = subtitle;
    drillIcon.textContent  = icon;
    drillBody.innerHTML    = `<div class="an-loading" style="padding:40px 0;"><div class="an-spinner"></div><span>Loading logs…</span></div>`;

    drillOverlay.classList.add('open');
    drillPanel.classList.add('open');

    fetchDrillLogs(params);
  }

  function closeDrilldown() {
    drillOverlay?.classList.remove('open');
    drillPanel?.classList.remove('open');
  }

  function _drillDateParams() {
    if (currentPeriod === 'all') return {};
    const today = new Date();
    const pad   = n => String(n).padStart(2, '0');
    const fmt   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const todayStr = fmt(today);

    if (currentPeriod === 'day') {
      return { start_date: todayStr, end_date: todayStr };
    }
    if (currentPeriod === 'week') {
      const s = new Date(today); s.setDate(today.getDate() - 7);
      return { start_date: fmt(s), end_date: todayStr };
    }
    if (currentPeriod === 'month') {
      const s = new Date(today); s.setDate(today.getDate() - 30);
      return { start_date: fmt(s), end_date: todayStr };
    }
    if (currentPeriod === 'custom' && currentStartDate && currentEndDate) {
      return { start_date: currentStartDate, end_date: currentEndDate };
    }
    return {};
  }

  async function fetchDrillLogs(params) {
    try {
      const { blocked, ...apiParams } = params;
      const filterQS = new URLSearchParams({ ..._drillDateParams(), ...apiParams });

      // Sync the Download CSV anchor with the same filter as the on-screen
      // logs (sans the `limit=200` cap — export gives admins everything).
      const dl = document.getElementById('anDrillDownload');
      if (dl) dl.href = `/api/export/audit.csv?${filterQS.toString()}`;

      const fetchQS = new URLSearchParams(filterQS);
      fetchQS.set('limit', '200');
      const res = await fetch(`/api/audit?${fetchQS.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let logs = await res.json();
      if (blocked === '1') {
        logs = logs.filter(l => l.policy_blocked == 1 || l.policy_blocked === true);
      }
      renderDrillLogs(logs);
    } catch (err) {
      drillBody.innerHTML = `<div class="an-drill-empty"><div class="an-drill-empty-icon">⚠️</div><div class="an-drill-empty-text">Could not load logs: ${escapeHtml(err.message)}</div></div>`;
    }
  }

  function renderDrillLogs(logs) {
    if (!logs.length) {
      drillBody.innerHTML = `<div class="an-drill-empty"><div class="an-drill-empty-icon">📭</div><div class="an-drill-empty-text">No logs found for this selection</div></div>`;
      return;
    }

    drillBody.innerHTML = logs.map((log, i) => {
      const input   = log.raw_input        || '—';
      const tool    = log.recommended_tool || '—';
      const intent  = log.intent           || '—';
      const role    = log.role             || '—';
      const email   = log.user_email       || '—';
      const blocked = log.policy_blocked == 1 || log.policy_blocked === true;
      const time    = log.created_at ? log.created_at.slice(0, 16).replace('T', ' ') : '—';
      const isLong  = input.length > 120;

      return `
        <div class="an-drill-card">
          <div class="an-drill-card-top">
            <div style="flex:1;min-width:0;overflow:hidden;">
              <div style="display:flex;align-items:flex-start;gap:10px;">
              <div id="an-task-text-${i}" style="
                flex:1;min-width:0;
                font-size:13.5px;font-weight:600;color:#0f1e2d;line-height:1.45;
                display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
                overflow:hidden;word-break:break-word;
              ">${escapeHtml(input)}</div>
            </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
            <div class="an-drill-card-time">🕐 ${escapeHtml(time)}</div>
            ${isLong ? `<button data-idx="${i}" data-expanded="false" style="
              font-size:11.5px;font-weight:600;color:#2563eb;
              background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
              padding:3px 10px;cursor:pointer;white-space:nowrap;font-family:inherit;
            ">▶ Open</button>` : ''}
          </div>
          </div>
          <div class="an-drill-card-meta">
            <span class="an-drill-tag">🎯 ${escapeHtml(intent)}</span>
            <span class="an-drill-tag tool">🛠 ${escapeHtml(tool)}</span>
            <span class="an-drill-tag role">👤 ${escapeHtml(role)}</span>
            <span class="an-drill-tag email">✉️ ${escapeHtml(email)}</span>
            ${blocked ? `<span class="an-drill-tag blocked">🚫 Blocked</span>` : ''}
          </div>
        </div>`;
    }).join('');

    drillBody.querySelectorAll('[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx      = btn.dataset.idx;
        const expanded = btn.dataset.expanded === 'true';
        const textEl   = document.getElementById(`an-task-text-${idx}`);
        if (expanded) {
          textEl.style.display        = '-webkit-box';
          textEl.style.webkitLineClamp = '2';
          textEl.style.overflow       = 'hidden';
          btn.textContent             = '▶ Open';
          btn.dataset.expanded        = 'false';
        } else {
          textEl.style.display        = 'block';
          textEl.style.webkitLineClamp = 'unset';
          textEl.style.overflow       = 'visible';
          btn.textContent             = '▼ Close';
          btn.dataset.expanded        = 'true';
        }
      });
    });
  }

  /* ════════════════════════════════════════════
     FETCH DATA
  ════════════════════════════════════════════ */
  async function fetchAndRender() {
    if (isLoading) return;
    isLoading = true;
    uaPage = 1;

    showLoading();
    destroyCharts();

    try {
      const params = new URLSearchParams({ period: currentPeriod, role: currentRole });

      if (currentPeriod === 'custom') {
        if (!currentStartDate || !currentEndDate) {
          showError('Please select a start and end date, then click Apply.');
          isLoading = false;
          return;
        }
        params.set('start_date', currentStartDate);
        params.set('end_date',   currentEndDate);
      }

      const res  = await fetch(`/api/analytics-dashboard?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      currentDashData = data;
      populateRoleFilter(data.by_role || []);
      renderDashboard(data);
    } catch (err) {
      showError(err.message);
    } finally {
      isLoading = false;
    }
  }

  async function fetchUserActivity(page) {
    try {
      const qs = new URLSearchParams({
        page: String(page),
        per_page: String(UA_PER),
        ..._drillDateParams(),  // honor current period (day / week / month / custom)
      });
      const res = await fetch(`/api/analytics/user-activity?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      return null;
    }
  }

  /* ════════════════════════════════════════════
     POPULATE ROLE FILTER FROM LIVE DATA
  ════════════════════════════════════════════ */
  function populateRoleFilter(byRole) {
    const sel = document.getElementById('anRoleSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="all">All Roles</option>';
    byRole.forEach(r => {
      if (!r.role) return;
      const opt = document.createElement('option');
      opt.value       = r.role;
      opt.textContent = `${r.role} (${r.count})`;
      sel.appendChild(opt);
    });
    sel.value = (prev !== 'all' && [...sel.options].some(o => o.value === prev)) ? prev : 'all';
  }

  /* ════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════ */
  function renderDashboard(d) {
    const total    = d.total_runs   || 0;
    const byRole   = d.by_role      || [];
    const byIntent = d.by_intent    || [];
    const byTool   = d.by_tool      || [];
    const timeline = d.timeline     || [];
    const blocked  = d.blocked_runs || 0;

    bodyEl.innerHTML = `
      <!-- KPI Row -->
      <div class="an-kpi-row">
        ${kpiCard('🚀', 'Total Runs', fmtNum(total), periodLabel(), '#1565c0', '#e8f0fe', trendBadge(d.change_pct), 'total')}
        ${kpiCard('🚫', 'Blocked Runs', fmtNum(blocked), `${total ? Math.round(blocked/total*100) : 0}% of total`, '#c62828', '#fef2f2', '', 'blocked')}
      </div>

      <!-- Timeline + Role Donut -->
      <div class="an-chart-grid">
        <div class="an-card">
          <div class="an-card-header">
            <span class="an-card-title">📈 Runs Over Time</span>
            <span class="an-card-badge">${periodLabel()}</span>
          </div>
          <div class="an-timechart-wrap">
            <canvas id="anTimelineChart"></canvas>
          </div>
        </div>
        <div class="an-card">
          <div class="an-card-header">
            <span class="an-card-title">🎭 By Role</span>
            <span class="an-card-badge">${byRole.length} roles</span>
          </div>
          <div class="an-donut-wrap" id="anRoleDonutWrap" style="min-height:160px;">
            <canvas id="anRoleDonut" width="140" height="140" class="an-donut-canvas"></canvas>
            <div class="an-donut-legend" id="anRoleLegend"></div>
          </div>
        </div>
      </div>

      <!-- Intent Bars + Tool Bars + Role Table -->
      <div class="an-chart-grid-3">
        <div class="an-card">
          <div class="an-card-header">
            <span class="an-card-title">🎯 By Intent</span>
            <span style="font-size:11px;color:#94a3b8;">Click a row to view logs</span>
          </div>
          <div class="an-bar-list" id="anIntentBars"></div>
        </div>
        <div class="an-card">
          <div class="an-card-header">
            <span class="an-card-title">🛠 Top AI Tools</span>
            <span style="font-size:11px;color:#94a3b8;">Click a row to view logs</span>
          </div>
          <div class="an-bar-list" id="anToolBars"></div>
        </div>
        <div class="an-card">
          <div class="an-card-header">
            <span class="an-card-title">📊 Role Activity</span>
            <span style="font-size:11px;color:#94a3b8;">Click a row to view logs</span>
          </div>
          <div id="anRoleTableWrap"></div>
        </div>
      </div>

      <!-- User Activity KPI -->
      <div class="an-card" style="margin-top:18px;">
        <div class="an-card-header">
          <span class="an-card-title">👥 User Activity</span>
          <span class="an-card-badge" id="uaBadge">Loading…</span>
        </div>
        <div id="uaTableWrap" style="min-height:80px;"></div>
        <div class="ua-pagination" id="uaPagination" style="display:none;">
          <button class="ua-pg-btn" id="uaPrevBtn">← Prev</button>
          <span class="ua-pg-info" id="uaPageInfo"></span>
          <button class="ua-pg-btn" id="uaNextBtn">Next →</button>
        </div>
      </div>
    `;

    bodyEl.querySelector('[data-drill="total"]')?.addEventListener('click', () => {
      if (!total) return;
      openDrilldown('Total Runs', `${total} run${total !== 1 ? 's' : ''} — ${periodLabel()}`, '🚀', {});
    });
    bodyEl.querySelector('[data-drill="blocked"]')?.addEventListener('click', () => {
      if (!blocked) return;
      openDrilldown('Blocked Runs', `${blocked} blocked run${blocked !== 1 ? 's' : ''} — ${periodLabel()}`, '🚫', { blocked: '1' });
    });

    drawTimeline(timeline);
    drawRoleDonut(byRole, total);
    drawBarList('anIntentBars', byIntent, 'blue', 'intent');
    drawBarList('anToolBars',   byTool,   'green', 'tool');
    drawRoleTable(byRole, total);
    loadUserActivity(1);
  }

  /* ── KPI card ── */
  function kpiCard(icon, label, value, sub, color, pale, extra, drillId) {
    const clickable = drillId ? `data-drill="${drillId}" style="cursor:pointer;"` : '';
    const hint      = drillId ? `<span style="font-size:10px;color:#94a3b8;margin-top:4px;display:block;">Click to view logs</span>` : '';
    return `
      <div class="an-kpi" ${clickable} style="--kpi-color:${color};--kpi-pale:${pale};${drillId ? 'cursor:pointer;' : ''}">
        <div class="an-kpi-icon">${icon}</div>
        <div class="an-kpi-body">
          <div class="an-kpi-label">${label}</div>
          <div class="an-kpi-value">${value}</div>
          <div class="an-kpi-sub">${sub}</div>
          ${extra}
          ${hint}
        </div>
      </div>`;
  }

  function trendBadge(pct) {
    if (pct == null) return '';
    const cls   = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neu';
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
    return `<span class="an-kpi-trend ${cls}">${arrow} ${Math.abs(pct)}% vs prev</span>`;
  }

  /* ── Timeline Chart ── */
  function drawTimeline(timeline) {
    const canvas = document.getElementById('anTimelineChart');
    if (!canvas || !timeline.length) {
      const wrap = canvas?.closest('.an-timechart-wrap');
      if (wrap) wrap.innerHTML = emptyState('No timeline data yet');
      return;
    }
    loadChartJs(() => {
      const labels = timeline.map(t => t.label);
      const values = timeline.map(t => t.count);
      chartInstances.timeline = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets: [{
          data: values, borderColor: '#1565c0',
          backgroundColor: 'rgba(21,101,192,0.08)',
          borderWidth: 2.5, pointBackgroundColor: '#1565c0',
          pointRadius: values.length > 48 ? 1 : 4, pointHoverRadius: 6,
          tension: 0.4, fill: true,
        }]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: {
            callbacks: { label: ctx => ` ${ctx.raw} run${ctx.raw !== 1 ? 's' : ''}` }
          }},
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#8a9bb0', maxTicksLimit: 10 } },
            y: { beginAtZero: true, grid: { color: '#f0f4f9' }, ticks: { font: { size: 11 }, color: '#8a9bb0', precision: 0 } },
          },
        },
      });
    });
  }

  /* ── Role Donut ── */
  function drawRoleDonut(byRole, total) {
    const canvas = document.getElementById('anRoleDonut');
    const legend = document.getElementById('anRoleLegend');
    if (!canvas || !byRole.length) {
      const wrap = document.getElementById('anRoleDonutWrap');
      if (wrap) wrap.innerHTML = emptyState('No role data');
      return;
    }
    const labels = byRole.slice(0,8).map(r => r.role || 'unknown');
    const values = byRole.slice(0,8).map(r => r.count);
    const colors = labels.map((_, i) => COLORS[i % COLORS.length]);

    legend.innerHTML = labels.map((l, i) => `
      <div class="an-legend-item clickable" data-role="${escapeHtml(l)}" title="Click to view logs for ${escapeHtml(l)}">
        <div class="an-legend-dot" style="background:${colors[i]};"></div>
        <span class="an-legend-label">${escapeHtml(l)}</span>
        <span class="an-legend-count">${values[i]}</span>
      </div>`).join('');

    legend.querySelectorAll('.an-legend-item.clickable').forEach(item => {
      item.addEventListener('click', () => {
        const role = item.dataset.role;
        openDrilldown(
          `Role: ${role}`,
          `${values[labels.indexOf(role)]} run${values[labels.indexOf(role)] !== 1 ? 's' : ''} by this role`,
          '🎭',
          { role }
        );
      });
    });

    loadChartJs(() => {
      chartInstances.donut = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]},
        options: {
          responsive: false, cutout: '65%',
          plugins: { legend: { display: false }, tooltip: { callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} (${total ? Math.round(ctx.raw/total*100) : 0}%)`
          }}},
          onClick: (evt, elements) => {
            if (!elements.length) return;
            const idx  = elements[0].index;
            const role = labels[idx];
            openDrilldown(
              `Role: ${role}`,
              `${values[idx]} run${values[idx] !== 1 ? 's' : ''} by this role`,
              '🎭',
              { role }
            );
          },
        },
      });
    });
  }

  /* ── Bar Lists ── */
  function drawBarList(containerId, items, colorClass, filterType) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!items.length) { el.innerHTML = emptyState('No data'); return; }
    const max = items[0].count || 1;
    el.innerHTML = items.slice(0, 8).map(item => {
      const pct      = Math.round((item.count / max) * 100);
      const totalPct = item.total_pct ? `${item.total_pct}%` : '';
      const label    = item.label || '—';
      return `
        <div class="an-bar-row clickable" data-filter-type="${filterType}" data-filter-value="${escapeHtml(label)}" data-count="${item.count}" title="Click to view logs for: ${escapeHtml(label)}">
          <div class="an-bar-name" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
          <div class="an-bar-track"><div class="an-bar-fill ${colorClass}" style="width:${pct}%"></div></div>
          <div class="an-bar-count">${item.count}</div>
          ${totalPct ? `<div class="an-bar-pct">${totalPct}</div>` : ''}
        </div>`;
    }).join('');

    el.querySelectorAll('.an-bar-row.clickable').forEach(row => {
      row.addEventListener('click', () => {
        const type  = row.dataset.filterType;
        const value = row.dataset.filterValue;
        const count = row.dataset.count;
        const isIntent = type === 'intent';
        openDrilldown(
          isIntent ? `Intent: ${value}` : `Tool: ${value}`,
          `${count} run${count !== '1' ? 's' : ''} matching this ${type}`,
          isIntent ? '🎯' : '🛠',
          isIntent ? { intent: value } : { tool: value }
        );
      });
    });
  }

  /* ── Role Table ── */
  function drawRoleTable(byRole, total) {
    const el = document.getElementById('anRoleTableWrap');
    if (!el) return;
    if (!byRole.length) { el.innerHTML = emptyState('No role data'); return; }
    const max = byRole[0]?.count || 1;
    el.innerHTML = `
      <table class="an-role-table">
        <thead><tr><th>Role</th><th>Runs</th><th>Share</th></tr></thead>
        <tbody>
          ${byRole.slice(0,8).map((r, i) => {
            const roleLower = (r.role || 'general').toLowerCase().split('/')[0].trim().split(' ')[0];
            const pct    = total ? Math.round(r.count / total * 100) : 0;
            const barPct = Math.round(r.count / max * 100);
            return `<tr class="clickable" data-role="${escapeHtml(r.role || '')}" data-count="${r.count}" title="Click to view logs for: ${escapeHtml(r.role || '')}">
              <td><span class="an-role-pill role-${roleLower}">${escapeHtml(r.role || 'Unknown')}</span></td>
              <td style="font-weight:700;color:#0f1e2d;">${r.count}</td>
              <td>
                <div class="an-role-bar-inline">
                  <div class="an-role-bar-track"><div class="an-role-bar-fill" style="width:${barPct}%;background:${COLORS[i % COLORS.length]};"></div></div>
                  <span style="font-size:11px;color:#8a9bb0;width:28px;text-align:right;">${pct}%</span>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    el.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => {
        const role  = row.dataset.role;
        const count = row.dataset.count;
        openDrilldown(
          `Role: ${role}`,
          `${count} run${count !== '1' ? 's' : ''} by this role`,
          '📊',
          { role }
        );
      });
    });
  }

  /* ── User Activity table ── */
  async function loadUserActivity(page) {
    uaPage = page;
    const wrap       = document.getElementById('uaTableWrap');
    const badge      = document.getElementById('uaBadge');
    const pagination = document.getElementById('uaPagination');
    if (!wrap) return;

    wrap.innerHTML = `<div class="an-loading" style="padding:20px 0;"><div class="an-spinner"></div><span>Loading users…</span></div>`;

    const data = await fetchUserActivity(page);
    if (!data) { wrap.innerHTML = emptyState('Could not load user data'); return; }

    if (badge) badge.textContent = `${data.total} user${data.total !== 1 ? 's' : ''}`;

    if (!data.items.length) {
      wrap.innerHTML = emptyState('No users yet');
      if (pagination) pagination.style.display = 'none';
      return;
    }

    wrap.innerHTML = `
      <table class="ua-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th style="text-align:center;">Runs</th>
            <th>Last Login</th>
            <th>Last Run</th>
          </tr>
        </thead>
        <tbody>
          ${data.items.map(u => {
            const initials    = _initials(u.email);
            const displayName = _displayName(u.email);
            const roleCls     = u.role === 'admin' ? 'ua-role-admin' : 'ua-role-user';
            const runsBadge   = u.run_count > 0
              ? `<span class="ua-runs-badge" style="cursor:pointer;" title="Click to view logs">${u.run_count}</span>`
              : `<span class="ua-runs-zero">0</span>`;
            return `
              <tr class="${u.run_count > 0 ? 'clickable' : ''}" data-email="${escapeHtml(u.email)}" data-runs="${u.run_count}" data-name="${escapeHtml(displayName)}" title="${u.run_count > 0 ? 'Click to view this user\'s logs' : ''}">
                <td>
                  <div class="ua-user-cell">
                    <div class="ua-avatar">${escapeHtml(initials)}</div>
                    <div class="ua-user-info">
                      <div class="ua-user-name">${escapeHtml(displayName)}</div>
                      <div class="ua-user-email">${escapeHtml(u.email)}</div>
                    </div>
                  </div>
                </td>
                <td><span class="ua-role-pill ${roleCls}">${escapeHtml(u.role)}</span></td>
                <td style="text-align:center;">${runsBadge}</td>
                <td class="ua-date">${escapeHtml(u.last_seen)}</td>
                <td class="ua-date">${escapeHtml(u.last_run)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => {
        const email = row.dataset.email;
        const name  = row.dataset.name;
        const runs  = row.dataset.runs;
        openDrilldown(
          `User: ${name}`,
          `${runs} run${runs !== '1' ? 's' : ''} by ${email}`,
          '👤',
          { user_email: email }
        );
      });
    });

    if (pagination) {
      const prevBtn  = document.getElementById('uaPrevBtn');
      const nextBtn  = document.getElementById('uaNextBtn');
      const pageInfo = document.getElementById('uaPageInfo');

      pagination.style.display = data.pages > 1 ? 'flex' : 'none';
      if (pageInfo) pageInfo.textContent = `Page ${data.page} of ${data.pages}`;
      if (prevBtn) { prevBtn.disabled = data.page <= 1; prevBtn.onclick = () => loadUserActivity(data.page - 1); }
      if (nextBtn) { nextBtn.disabled = data.page >= data.pages; nextBtn.onclick = () => loadUserActivity(data.page + 1); }
    }
  }

  /* ── Helpers ── */
  function _initials(email) {
    const local = (email || '').split('@')[0] || '';
    const parts = local.split(/[^a-zA-Z]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function _displayName(email) {
    const local = (email || '').split('@')[0] || '';
    return local.split(/[._-]+/).filter(Boolean)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }

  function _fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function fmtNum(n) {
    if (n == null) return '—';
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }

  function periodLabel() {
    if (currentPeriod === 'custom') {
      return currentStartDate && currentEndDate
        ? `${currentStartDate} → ${currentEndDate}`
        : 'Custom Range';
    }
    return { all: 'All Time', day: 'Today', week: 'This Week', month: 'This Month' }[currentPeriod] || 'All Time';
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Loading / Error states ── */
  function showLoading() {
    bodyEl.innerHTML = `
      <div class="an-loading">
        <div class="an-spinner"></div>
        <span>Loading analytics…</span>
      </div>`;
  }

  function showError(msg) {
    bodyEl.innerHTML = `
      <div class="an-empty" style="padding:80px 20px;">
        <div class="an-empty-icon">⚠️</div>
        <div style="font-size:16px;font-weight:700;color:#dc2626;margin-bottom:8px;">Could not load analytics</div>
        <div style="font-size:13px;color:#8a9bb0;">${escapeHtml(msg)}</div>
        <button onclick="window._anRefetch&&window._anRefetch()" style="margin-top:16px;padding:8px 20px;background:#1565c0;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Retry</button>
      </div>`;
    window._anRefetch = fetchAndRender;
  }

  function emptyState(msg) {
    return `<div class="an-empty"><div class="an-empty-icon">📭</div>${msg}</div>`;
  }

  /* ── Lazy-load Chart.js ── */
  let chartJsLoaded     = false;
  let chartJsCallbacks  = [];

  function loadChartJs(cb) {
    if (chartJsLoaded) { cb(); return; }
    chartJsCallbacks.push(cb);
    if (document.getElementById('chartjsScript')) return;
    const s = document.createElement('script');
    s.id    = 'chartjsScript';
    s.src   = '/static/js/chart.umd.min.js';
    s.onload = () => {
      chartJsLoaded = true;
      chartJsCallbacks.forEach(fn => fn());
      chartJsCallbacks = [];
    };
    document.head.appendChild(s);
  }

  /* ── Boot ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();