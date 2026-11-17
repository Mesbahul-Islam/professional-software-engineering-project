// PQC Migration Dashboard v2.0
// Every number shown is calculated here from the records in pqc-data.json.
// Structure: 1) helpers  2) calculations (compute)  3) team view  4) customer view  5) start-up.
'use strict';

let D = null; // the loaded data
const state = { view: 'team', scope: 'customer', proposed: false };

// ============ 1. Helpers ============

// Create an element: h('div', {class: 'x'}, 'text', childElement, ...)
function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

const $ = (id) => document.getElementById(id);
const sum = (list, key) => list.reduce((a, x) => a + x[key], 0);
const round0 = (n) => String(Math.round(n));
const round1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const gb = (n) => n.toFixed(2);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_WORD = { green: 'GREEN', amber: 'AMBER', red: 'RED' };
const DEADLINE_WORD = { on: 'On track', risk: 'At risk', off: 'Off track' };
const DEADLINE_TONE = { on: 'green', risk: 'amber', off: 'red' };

function toDate(s) { return new Date(s.slice(0, 10) + 'T00:00:00'); }
function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function fmtDate(s) { return toDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtLife(y) { return y < 0.1 ? 'days' : y < 1 ? 'months' : plural(y, 'year'); }
function service(id) { return D.services.find(s => s.id === id); }
function pill(level, text) { return h('span', { class: 'pill ' + level }, text || level.toUpperCase()); }

// ============ 2. Calculations ============

// HNDL rating of one fallback connection (rule text is in pqc-data.json -> rules.hndl_text).
function hndlRating(c) {
  if (c.sensitivity === 'high' && c.lifetime_years >= 5) return 'high';
  if (c.sensitivity === 'high' || (c.sensitivity === 'medium' && c.lifetime_years >= 1)) return 'medium';
  return 'low';
}

// Services covered by the customer agreement (optionally with the proposed change).
function agreementIds(proposed) {
  const ids = [...D.contract.covered_services];
  if (proposed) D.contract.proposed_change.adds_services.forEach(id => { if (!ids.includes(id)) ids.push(id); });
  return ids;
}

// Build the whole model for one scope ('customer' or 'org').
function compute(scope, proposed) {
  const agreement = agreementIds(proposed);
  const ids = scope === 'org' ? D.services.map(s => s.id) : agreement;
  const inScope = (svc) => ids.includes(svc);
  const services = D.services.filter(s => inScope(s.id));
  const target = D.contract.required_readiness;

  // Readiness: services weighted by connection volume.
  const totalWeight = sum(services, 'weight');
  const series = D.readiness_months.map((m, i) =>
    services.reduce((a, s) => a + s.weight * s.readiness[i], 0) / totalWeight);
  const now = series[series.length - 1];
  const change = now - series[series.length - 2];
  const k = D.rules.forecast_months;
  const monthlyGain = (now - series[series.length - 1 - k]) / k;
  const daysLeft = daysBetween(D.meta.as_of, D.contract.deadline);
  const monthsLeft = daysLeft / 30.44;
  const forecast = Math.min(100, now + monthlyGain * monthsLeft);
  const deadline = forecast >= target ? 'on' : forecast >= target - D.rules.at_risk_margin ? 'risk' : 'off';

  // Fallback connections and HNDL exposure.
  const deviceCovered = (id) => D.fallback_connections.some(c => c.device === id && agreement.includes(c.service));
  const conns = D.fallback_connections.filter(c => inScope(c.service)).map(c => ({
    ...c,
    rating: hndlRating(c),
    exception: D.exceptions.find(x => x.device === c.device) || null,
  })).sort((a, b) => SEVERITY_RANK[a.rating] - SEVERITY_RANK[b.rating] || b.gb_week - a.gb_week);
  const exposed = conns.filter(c => c.rating !== 'low');
  const exposureGB = sum(exposed, 'gb_week');

  // Devices on fallback in scope, grouped by blocker.
  const deviceIds = [...new Set(conns.map(c => c.device))];
  const devices = D.devices.filter(d => deviceIds.includes(d.id)).map(d => ({ ...d, covered: deviceCovered(d.id) }));
  const blockers = Object.entries(D.blockers).map(([code, b]) => ({
    code, ...b, devices: devices.filter(d => d.blocker === code),
  })).filter(b => b.devices.length).sort((a, b) => b.devices.length - a.devices.length);

  // Exceptions: agreement devices first (Sprint 2 priority), then soonest expiry.
  const exceptions = D.exceptions.filter(x => deviceIds.includes(x.device)).map(x => {
    const days = daysBetween(D.meta.as_of, x.expires);
    return { ...x, days, covered: deviceCovered(x.device) };
  }).sort((a, b) => (b.covered - a.covered) || (a.days - b.days));

  // Downgrade alerts.
  const alerts = D.alerts.filter(a => inScope(a.service))
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const openAlerts = alerts.filter(a => a.status === 'open');
  const openHigh = openAlerts.filter(a => a.severity === 'high');

  // Overall status (rule text: rules.status_text).
  const checks = [
    forecast >= target
      ? { ok: true, text: `Forecast ${round1(forecast)} reaches the contract target of ${target}` }
      : { ok: false, text: `Forecast ${round1(forecast)} is below the contract target of ${target}` },
    exposureGB === 0
      ? { ok: true, text: 'No sensitive, long-lived data on classical fallback' }
      : { ok: false, text: `${gb(exposureGB)} GB/week of sensitive, long-lived data still on classical fallback (accepted exceptions included)` },
    openHigh.length === 0
      ? { ok: true, text: 'No open high-severity downgrade alert' }
      : { ok: false, text: `${plural(openHigh.length, 'open high-severity downgrade alert')}` },
  ];
  const status = (deadline === 'off' || openHigh.length) ? 'red' : checks.every(c => c.ok) ? 'green' : 'amber';

  // Fallback trade-off: what each option would protect and cost.
  const total = D.meta.monitoring_points_total;
  function option(label, offIds) {
    const off = new Set(offIds);
    const lost = devices.filter(d => off.has(d.id)).reduce((a, d) => a + d.monitoring_points, 0);
    const hit = [...new Set(conns.filter(c => off.has(c.device)).map(c => c.service))]
      .map(service).filter(s => s.customer_facing).map(s => s.name);
    return {
      label,
      exposureGB: sum(exposed.filter(c => !off.has(c.device)), 'gb_week'),
      devicesOff: off.size,
      coverage: 100 * (total - lost) / total,
      customerServices: hit,
    };
  }
  const highDevices = [...new Set(conns.filter(c => c.rating === 'high').map(c => c.device))];
  const options = [
    option('Keep fallback as it is', []),
    option('Switch off only where data is rated HIGH', highDevices),
    option('Switch off everywhere', deviceIds),
  ];

  // Risks, notifications and planned steps.
  const risks = D.risks.filter(r => r.scopes.includes(scope))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 3);
  const notifications = D.notifications.map(n => ({
    ...n,
    affectsAgreement: n.services.some(s => agreement.includes(s)),
    ageDays: daysBetween(n.sent, D.meta.as_of),
  }));
  const steps = D.planned_steps.filter(p => p.services.some(inScope))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Per-service rows (customer view).
  const perService = services.map(s => ({
    ...s,
    now: s.readiness[s.readiness.length - 1],
    gain: s.readiness[s.readiness.length - 1] - s.readiness[s.readiness.length - 1 - k],
    fallback: conns.filter(c => c.service === s.id).length,
    exposureGB: sum(exposed.filter(c => c.service === s.id), 'gb_week'),
  }));

  return {
    scope, proposed, ids, target, series, now, change, monthlyGain, forecast, deadline, daysLeft, monthsLeft,
    conns, exposed, exposureGB, devices, blockers, exceptions, alerts, openAlerts, openHigh,
    checks, status, options, risks, notifications, steps, perService,
    scopeLabel: scope === 'org' ? 'Whole organisation' : `${D.contract.short_name} agreement` + (proposed ? ' (with proposed change)' : ''),
  };
}

// ============ 3. Team view ============

// Put the given sections into <main>, skipping empty ones.
function show(...sections) {
  $('app').replaceChildren(...sections.filter(Boolean));
}

function renderTeam(M) {
  show(
    statusBanner(M),
    h('section', { class: 'lanes' }, cioLane(M), pmLane(M), secLane(M)),
    tradeOff(M),
  );
}

function statusBanner(M) {
  const failing = M.checks.filter(c => !c.ok).map(c => c.text);
  const text = failing.length ? failing.join(' · ') : 'All checks pass.';
  return h('section', { class: 'banner ' + M.status },
    h('div', { class: 'banner-main' },
      h('span', { class: 'badge ' + M.status }, STATUS_WORD[M.status]),
      h('div', null,
        h('div', { class: 'banner-title' }, `Overall status · ${M.scopeLabel}`),
        h('div', { class: 'banner-text' }, text))),
    h('details', { class: 'explain' },
      h('summary', null, 'How is this status decided?'),
      h('ul', { class: 'checks' }, M.checks.map(c => h('li', { class: c.ok ? 'ok' : 'fail' }, (c.ok ? '✓ ' : '✗ ') + c.text))),
      h('p', { class: 'small muted' }, D.rules.status_text),
      infoBlock('status')));
}

function infoBlock(key) {
  const i = D.indicators[key];
  return h('div', null, h('p', null, h('b', null, 'Can tell: '), i.can), h('p', null, h('b', null, 'Cannot tell: '), i.cannot));
}

function infoToggle(key) {
  return h('details', { class: 'info' }, h('summary', null, 'What this can and cannot tell'), infoBlock(key));
}

function lane(role, headline, sub, extra, infoKey, drops) {
  const r = D.roles[role];
  return h('article', { class: 'lane ' + role },
    h('div', { class: 'lane-head' },
      h('div', { class: 'role' }, r.label),
      h('div', { class: 'question' }, r.question),
      headline,
      h('div', { class: 'sub' }, sub),
      extra,
      infoToggle(infoKey)),
    drops);
}

function drop(title, count, ...body) {
  return h('details', { class: 'drop' },
    h('summary', null, h('span', null, title), count !== null ? h('span', { class: 'count' }, count) : null),
    h('div', { class: 'drop-body' }, body));
}

// ---- CIO ----
function cioLane(M) {
  const tone = DEADLINE_TONE[M.deadline];
  const recentHigh = M.notifications.filter(n => n.severity === 'high' && n.ageDays <= 7);
  const forCustomer = M.scope === 'customer';
  return lane('cio',
    h('div', { class: 'big t-' + tone }, DEADLINE_WORD[M.deadline]),
    `Contract deadline ${fmtDate(D.contract.deadline)}: forecast ${round1(M.forecast)} vs target ${M.target} · ${M.daysLeft} days left`,
    recentHigh.length ? h('div', { class: 'attention' }, `● ${plural(recentHigh.length, 'high-severity notification')} sent to you this week`) : null,
    'deadline',
    [
      drop(forCustomer ? 'Top 3 risks to the contract' : 'Top 3 risks', null, risksList(M)),
      drop('Notifications sent to you', M.notifications.length, notificationsBlock(M)),
      drop('Planned steps that could affect customers', M.steps.length, stepsList(M.steps, false)),
      forCustomer ? drop('Proposed contract change', D.contract.proposed_change.status, proposedChangeBlock()) : null,
    ]);
}

function risksList(M) {
  return h('ol', { class: 'items' }, M.risks.map(r => h('li', null,
    h('div', { class: 'item-head' }, h('span', null, r.title), pill(r.severity)),
    h('div', { class: 'item-text' }, r.plain),
    h('div', { class: 'item-text' }, h('b', null, 'Decision: '), r.decision))));
}

function notificationsBlock(M) {
  const boardDays = daysBetween(D.meta.as_of, D.meta.next_board_report);
  return [
    h('p', { class: 'note' }, `Next board report: ${fmtDate(D.meta.next_board_report)} (in ${boardDays} days). Everything below has already been sent to you.`),
    h('ul', { class: 'items' }, M.notifications.map(n => h('li', null,
      h('div', { class: 'item-head' }, h('span', null, n.title), pill(n.severity)),
      h('div', { class: 'item-text' }, n.detail),
      h('div', { class: 'small muted' }, `${fmtDate(n.sent)} · ${n.channel}`,
        n.affectsAgreement ? h('span', null, ' · ', h('span', { class: 'pill neutral' }, `Affects ${D.contract.short_name}`)) : null)))),
    h('h4', null, 'When you are notified'),
    h('ul', { class: 'items small' }, D.notification_rules.map(r => h('li', null, `${r.when} → `, h('b', null, r.channel)))),
  ];
}

function stepsList(steps, customerWording) {
  if (!steps.length) return h('p', { class: 'note' }, 'No planned steps.');
  return h('ul', { class: 'items' }, steps.map(s => h('li', null,
    h('div', { class: 'item-head' }, h('span', null, `${fmtDate(s.date)} · ${s.title}`), pill(s.outage_risk, (customerWording ? 'Impact ' : 'Outage risk ') + s.outage_risk)),
    h('div', { class: 'item-text' }, s.customer_impact))));
}

function proposedChangeBlock() {
  const pc = D.contract.proposed_change;
  const before = compute('customer', false);
  const after = compute('customer', true);
  const row = (label, m) => h('tr', null, h('td', null, label), h('td', { class: 'num' }, round0(m.now)),
    h('td', { class: 'num' }, round1(m.forecast)), h('td', null, h('span', { class: 't-' + DEADLINE_TONE[m.deadline] }, DEADLINE_WORD[m.deadline])));
  return [
    h('p', { class: 'item-text' }, pc.summary),
    h('p', { class: 'small muted' }, `Received ${fmtDate(pc.received)} · ${pc.status}`),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'num' }, 'Today'), h('th', { class: 'num' }, 'Forecast'), h('th', null, 'Deadline'))),
      h('tbody', null, row('Current agreement', before), row('With the change', after)))),
    h('p', { class: 'note' }, 'Tick "Include proposed contract change" above to see the whole dashboard with the change.'),
  ];
}

// ---- Project Manager ----
function pmLane(M) {
  const arrow = M.change >= 0 ? '▲' : '▼';
  const expired = M.exceptions.filter(x => x.days < 0).length;
  const fallbackDevices = M.devices.length;
  return lane('pm',
    h('div', { class: 'big' }, round0(M.now), h('small', null, ' / 100')),
    `Readiness · ${arrow} ${round1(Math.abs(M.change))} this month · target ${M.target}`,
    null,
    'readiness',
    [
      drop('Trend and forecast', null, trendChart(M), h('p', { class: 'note' }, D.rules.readiness_text), h('p', { class: 'note' }, D.rules.forecast_text)),
      drop('What is blocking', plural(fallbackDevices, 'device'), blockersBlock(M)),
      drop('Exceptions', `${M.exceptions.length}` + (expired ? ` · ${expired} expired` : ''), exceptionsBlock(M)),
    ]);
}

function blockersBlock(M) {
  return [
    h('ul', { class: 'items' }, M.blockers.map(b => {
      const dates = [...new Set(b.devices.map(d => d.unblocks).filter(Boolean))];
      const covered = b.devices.filter(d => d.covered).length;
      return h('li', null,
        h('div', { class: 'item-head' }, h('span', null, b.label), h('b', null, b.devices.length)),
        h('div', { class: 'small muted' }, `Owner: ${b.owner} · Unblocks: ${dates.length ? dates.join(', ') : 'unknown'}` +
          ` · ${covered} of ${b.devices.length} serve ${D.contract.short_name}`),
        h('div', { class: 'chips' }, b.devices.map(d => h('span', { class: 'chip' + (d.covered ? ' covered' : ''), title: `${d.type}, ${d.site}` }, d.id))));
    })),
    h('p', { class: 'note' }, `Highlighted devices serve the ${D.contract.short_name} agreement. Focus effort there first.`),
  ];
}

function exceptionsBlock(M) {
  if (!M.exceptions.length) return h('p', { class: 'note' }, 'No exceptions in this scope.');
  return [
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Exception', 'Reason and owner', 'Expires'].map(t => h('th', null, t)))),
      h('tbody', null, M.exceptions.map(x => h('tr', null,
        h('td', null, h('b', null, x.device), h('div', { class: 'small muted' }, x.id),
          x.covered ? h('div', null, h('span', { class: 'pill neutral' }, D.contract.short_name)) : null),
        h('td', null, D.blockers[x.reason].label, h('div', { class: 'small muted' }, x.owner)),
        h('td', null, fmtDate(x.expires), h('div', null,
          x.days < 0 ? pill('red', 'Expired') : x.days <= 30 ? pill('amber', `In ${x.days} days`) : pill('green', 'Active')))))))),
    h('p', { class: 'note' }, 'Sorted with agreement devices first, then by expiry. An exception is accepted risk, not removed risk. It still counts as exposure. To record a new exception, add it to pqc-data.json.'),
  ];
}

// ---- Security Officer ----
function secLane(M) {
  const high = M.conns.filter(c => c.rating === 'high').length;
  return lane('sec',
    h('div', { class: 'big' }, gb(M.exposureGB), h('small', null, ' GB/week')),
    `Sensitive, long-lived data on classical fallback · ${plural(M.conns.length, 'fallback connection')}, ${high} rated HIGH`,
    null,
    'hndl',
    [
      drop('HNDL exposure: sensitivity × data life', null, hndlMatrix(M)),
      drop('All fallback connections', M.conns.length, connectionsTable(M)),
      drop('Downgrade alerts', `${M.openAlerts.length} open`, alertsList(M)),
    ]);
}

function hndlMatrix(M) {
  const lives = [
    { label: '< 1 yr', test: (y) => y < 1, sample: 0.5 },
    { label: '1–5 yr', test: (y) => y >= 1 && y < 5, sample: 2 },
    { label: '5+ yr', test: (y) => y >= 5, sample: 10 },
  ];
  const rows = ['high', 'medium', 'low'].map(sens => h('tr', null,
    h('td', null, h('b', null, sens[0].toUpperCase() + sens.slice(1))),
    lives.map(l => {
      const list = M.conns.filter(c => c.sensitivity === sens && l.test(c.lifetime_years));
      const rating = hndlRating({ sensitivity: sens, lifetime_years: l.sample });
      if (!list.length) return h('td', { class: 'cell empty' }, '–');
      return h('td', { class: 'cell ' + rating, title: list.map(c => c.id).join(', ') },
        `${gb(sum(list, 'gb_week'))} GB`, h('div', { class: 'small' }, plural(list.length, 'conn.')));
    })));
  return [
    h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
      h('thead', null, h('tr', null, h('th', null, 'Data life →'), lives.map(l => h('th', null, l.label)))),
      h('tbody', null, rows))),
    h('p', { class: 'note' }, `Weekly volume on fallback. Red = HNDL HIGH, amber = MEDIUM, green = LOW. Total on fallback: ${gb(sum(M.conns, 'gb_week'))} GB/week, of which ${gb(M.exposureGB)} GB/week is rated MEDIUM or HIGH.`),
    h('p', { class: 'note' }, D.rules.hndl_text),
  ];
}

function connectionsTable(M) {
  const wrap = h('div');
  let filter = 'all';
  function draw() {
    const list = filter === 'all' ? M.conns : M.conns.filter(c => c.rating === filter);
    const btn = (key, label, n) => h('button', { type: 'button', class: filter === key ? 'active' : '', onclick: () => { filter = key; draw(); } }, `${label} (${n})`);
    const count = (r) => M.conns.filter(c => c.rating === r).length;
    wrap.replaceChildren(
      h('div', { class: 'filters' }, btn('all', 'All', M.conns.length), btn('high', 'HNDL high', count('high')),
        btn('medium', 'Medium', count('medium')), btn('low', 'Low', count('low'))),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Connection'), h('th', null, 'Data'), h('th', { class: 'num' }, 'GB/wk'), h('th', null, 'HNDL'))),
        h('tbody', null, list.map(c => h('tr', null,
          h('td', null, h('b', null, c.device), ` → ${c.peer}`,
            h('div', { class: 'small muted' }, `${service(c.service).name} · ${c.kex}` + (c.exception ? ` · exception ${c.exception.id}` : ''))),
          h('td', null, c.data, h('div', { class: 'small muted' }, `${c.sensitivity} · ${fmtLife(c.lifetime_years)}`)),
          h('td', { class: 'num' }, gb(c.gb_week)),
          h('td', null, pill(c.rating))))))));
  }
  draw();
  return wrap;
}

function alertsList(M) {
  if (!M.alerts.length) return h('p', { class: 'note' }, 'No downgrade alerts in this scope.');
  return h('ul', { class: 'items' }, M.alerts.map(a => h('li', null,
    h('div', { class: 'item-head' }, h('span', null, `${a.device} ↔ ${a.peer}`),
      a.status === 'open' ? pill(a.severity) : pill('closed', 'Closed')),
    h('dl', { class: 'facts' },
      h('dt', null, 'Detected'), h('dd', null, `${a.detected} · ${a.id}`),
      h('dt', null, 'Service'), h('dd', null, service(a.service).name),
      h('dt', null, 'Negotiated'), h('dd', null, a.negotiated),
      h('dt', null, 'Normally'), h('dd', null, a.normally),
      h('dt', null, 'What changed'), h('dd', null, a.changed),
      h('dt', null, 'Next step'), h('dd', null, a.action)))));
}

// ---- Shared trade-off ----
function tradeOff(M) {
  return h('details', { class: 'shared' },
    h('summary', null, 'Where the roles disagree: should classical fallback be switched off?'),
    h('div', { class: 'shared-body' },
      h('div', { class: 'stances' }, ['cio', 'pm', 'sec'].map(r => h('div', { class: 'stance ' + r },
        h('b', null, D.roles[r].label), h('div', null, D.roles[r].stance)))),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Option'), h('th', { class: 'num' }, 'Sensitive data still exposed'),
          h('th', { class: 'num' }, 'Devices disconnected'), h('th', { class: 'num' }, 'Monitoring coverage'), h('th', null, 'Customer services affected'))),
        h('tbody', null, M.options.map(o => h('tr', null,
          h('td', null, h('b', null, o.label)),
          h('td', { class: 'num' }, `${gb(o.exposureGB)} GB/week`),
          h('td', { class: 'num' }, o.devicesOff),
          h('td', { class: 'num' }, `${round0(o.coverage)} %`),
          h('td', null, o.customerServices.length ? o.customerServices.join(', ') : 'None')))))),
      h('p', { class: 'note' }, `Calculated for: ${M.scopeLabel}. The dashboard shows what each option protects and costs. It does not pick a side.`)));
}

// ---- Trend chart (inline SVG) ----
function trendChart(M) {
  const W = 560, H = 210, L = 30, R = 30, T = 14, B = 26;
  const n = M.series.length;
  const span = (n - 1) + M.monthsLeft;
  const x = (i) => L + (i / span) * (W - L - R);
  const y = (v) => T + (1 - (v - 30) / 70) * (H - T - B);
  const pts = M.series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const xEnd = x(span), xNow = x(n - 1);
  const grid = [40, 60, 80, 100].map(v =>
    `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const months = D.readiness_months.map((m, i) => `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${m}</text>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Readiness ${round0(M.now)} today, forecast ${round1(M.forecast)} at the deadline, target ${M.target}">
    ${grid}
    <line class="target" x1="${L}" x2="${W - R}" y1="${y(M.target)}" y2="${y(M.target)}"/>
    <text class="label" x="${L + 4}" y="${y(M.target) - 5}">Contract target ${M.target}</text>
    <polyline class="history" points="${pts}"/>
    <line class="forecast" x1="${xNow}" y1="${y(M.now)}" x2="${xEnd}" y2="${y(M.forecast)}"/>
    <circle class="dot" cx="${xNow}" cy="${y(M.now)}" r="4"/>
    <circle class="dot" cx="${xEnd}" cy="${y(M.forecast)}" r="4"/>
    <text class="label" x="${xEnd - 8}" y="${M.forecast >= M.target ? y(M.forecast) - 9 : y(M.forecast) + 17}" text-anchor="end">Forecast ${round1(M.forecast)}</text>
    <text class="label" x="${xNow}" y="${y(M.now) + 18}" text-anchor="middle">Today ${round0(M.now)}</text>
    ${months}
    <text class="axis" x="${xEnd}" y="${H - 8}" text-anchor="middle">Deadline</text>
  </svg>`;
  const box = h('div', { class: 'chart' });
  box.innerHTML = svg; // numbers and month names from our own data file only
  return box;
}

// ============ 4. Customer view ============

function renderCustomer() {
  const M = compute('customer', state.proposed);
  const c = D.contract;
  const tone = DEADLINE_TONE[M.deadline];
  const visibleSteps = M.steps.filter(s => s.customer_visible !== false);
  // Plain, customer-facing summary of the same checks as the team view.
  const summary = [
    M.forecast >= M.target
      ? `On track for the contract deadline (forecast ${round1(M.forecast)}, target ${M.target}).`
      : `Not yet on track for the contract deadline (forecast ${round1(M.forecast)}, target ${M.target}).`,
    M.exposureGB > 0
      ? `${gb(M.exposureGB)} GB/week of sensitive data on your services still uses classical encryption.`
      : 'No sensitive long-lived data on your services uses classical encryption.',
    M.openHigh.length ? `${plural(M.openHigh.length, 'security alert')} on your services is under investigation.` : null,
  ].filter(Boolean).join(' ');

  show(
    h('div', { class: 'cust-head' },
      h('div', null,
        h('h2', null, `Post-quantum readiness for ${c.short_name}`),
        h('div', { class: 'muted' }, `Services covered by agreement ${c.id} · status as of ${fmtDate(D.meta.as_of)} · ${D.meta.organisation}`)),
      h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'Print / save as PDF')),
    state.proposed ? h('div', { class: 'proposed-note' }, `Includes the proposed change (${D.contract.proposed_change.summary}) This change is not yet agreed.`) : null,

    h('section', { class: 'banner ' + M.status },
      h('div', { class: 'banner-main' },
        h('span', { class: 'badge ' + M.status }, STATUS_WORD[M.status]),
        h('div', null,
          h('div', { class: 'banner-title' }, 'Overall status for your services'),
          h('div', { class: 'banner-text' }, summary))),
      h('p', { class: 'small muted' }, 'This status cannot be green while sensitive data still travels over classical encryption, even when the deadline is on track.')),

    h('section', { class: 'kpis' },
      h('div', { class: 'card' },
        h('div', { class: 'kpi-label' }, 'Readiness today'),
        h('div', { class: 'big' }, round0(M.now), h('small', null, ` / 100, target ${M.target}`)),
        h('div', { class: 'small muted' }, `${M.change >= 0 ? '▲' : '▼'} ${round1(Math.abs(M.change))} points this month`)),
      h('div', { class: 'card' },
        h('div', { class: 'kpi-label' }, `Forecast at the deadline (${fmtDate(c.deadline)})`),
        h('div', { class: 'big t-' + tone }, round1(M.forecast)),
        h('div', { class: 'small' }, h('b', { class: 't-' + tone }, DEADLINE_WORD[M.deadline]), ` · ${M.daysLeft} days left`)),
      h('div', { class: 'card' },
        h('div', { class: 'kpi-label' }, 'Sensitive data still on classical encryption'),
        h('div', { class: 'big' }, gb(M.exposureGB), h('small', null, ' GB/week')),
        h('div', { class: 'small muted' }, 'Data that stays valuable for a year or more and could be recorded now and decrypted later.'))),

    h('section', { class: 'grid-2' },
      h('div', { class: 'card' }, h('h3', null, 'Readiness trend and forecast'), trendChart(M)),
      h('div', { class: 'card' }, h('h3', null, 'Your services'),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Service'), h('th', null, 'Readiness'), h('th', { class: 'num' }, '3-month gain'), h('th', { class: 'num' }, 'Sensitive GB/wk'))),
          h('tbody', null, M.perService.map(s => h('tr', null,
            h('td', null, s.name),
            h('td', null, h('div', null, s.now), h('div', { class: 'bar', title: `Target ${M.target}` },
              h('span', { style: `width:${s.now}%` }), h('i', { style: `left:${M.target}%` }))),
            h('td', { class: 'num' }, `+${s.gain}`),
            h('td', { class: 'num' }, gb(s.exposureGB))))))),
        h('p', { class: 'note' }, 'The black mark on each bar is the contract target.'))),

    h('section', { class: 'grid-2' },
      h('div', { class: 'card' }, h('h3', null, 'Upcoming work that touches your services'), stepsList(visibleSteps, true)),
      h('div', { class: 'card' }, h('h3', null, 'What these numbers can and cannot tell'),
        ['status', 'readiness', 'hndl'].map(k => h('div', null, h('h4', null, k === 'hndl' ? 'Data on classical encryption' : k), infoBlock(k))))),
    h('p', { class: 'note' }, 'All data on this page is synthetic and was produced for a course project.'),
  );
}

// ============ 5. Start-up and state ============

function readUrl() {
  const p = new URLSearchParams(location.search);
  if (['team', 'customer'].includes(p.get('view'))) state.view = p.get('view');
  if (['customer', 'org'].includes(p.get('scope'))) state.scope = p.get('scope');
  state.proposed = p.get('proposed') === '1';
}

function writeUrl() {
  const p = new URLSearchParams({ view: state.view, scope: state.scope });
  if (state.proposed) p.set('proposed', '1');
  history.replaceState(null, '', '?' + p.toString());
}

function setState(patch) {
  Object.assign(state, patch);
  writeUrl();
  render();
}

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  document.querySelectorAll('#scope button').forEach(b => b.classList.toggle('active', b.dataset.scope === state.scope));
  $('scope').hidden = state.view === 'customer'; // the customer view is always scoped to the agreement
  $('proposed').checked = state.proposed;
  $('expand').hidden = state.view === 'customer';
  $('expand').textContent = 'Expand all';
  $('meta').textContent = `${D.meta.organisation} · data as of ${fmtDate(D.meta.as_of)}`;
  if (state.view === 'customer') renderCustomer();
  else renderTeam(compute(state.scope, state.proposed));
}

async function start() {
  try {
    const res = await fetch('pqc-data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    D = await res.json();
  } catch (err) {
    $('meta').textContent = 'Data not loaded';
    $('app').replaceChildren(h('div', { class: 'error' },
      h('b', null, 'Could not load pqc-data.json. '), `(${err.message}) `,
      'Browsers block reading files when the page is opened directly. Start a local server in the dashboard folder with ',
      h('code', null, 'python3 -m http.server 8000'), ' and open ', h('code', null, 'http://localhost:8000/'), '.'));
    return;
  }
  document.querySelector('#scope [data-scope="customer"]').textContent = `${D.contract.short_name} agreement`;
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setState({ view: b.dataset.view })));
  document.querySelectorAll('#scope button').forEach(b => b.addEventListener('click', () => setState({ scope: b.dataset.scope })));
  $('proposed').addEventListener('change', (e) => setState({ proposed: e.target.checked }));
  $('expand').addEventListener('click', () => {
    const all = [...document.querySelectorAll('#app details')];
    const open = !all.every(d => d.open);
    all.forEach(d => { d.open = open; });
    $('expand').textContent = open ? 'Collapse all' : 'Expand all';
  });
  readUrl();
  render();
  if (new URLSearchParams(location.search).get('expand') === '1') $('expand').click(); // e.g. for printing
}

start();
