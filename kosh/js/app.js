// app.js — UI layer: hash routing, rendering and events.
// All money logic lives in core.js; this file only turns state into HTML.
import {
  CATEGORIES, EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryById,
  formatINR, formatDate, escapeHTML, cycleFor, inRange, summarize, safeToSpend,
  budgetStatus, goalPlan, calcEMI, validateTxn, toCSV, filterTxns, sortByDateDesc,
  toISODate, parseISODate, diffDays, uid,
} from './core.js';
import { loadState, saveState, seedState } from './store.js';
import { getRates } from './api.js';

const VIEWS = ['overview', 'transactions', 'budgets', 'goals', 'tools'];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let state = loadState();
const filters = { q: '', cat: 'all', type: 'all' };
let rates = null;

/* ---------- State + routing ---------- */

function commit(message, undo) {
  saveState(state);
  render();
  if (message) toast(message, undo);
}

const currentView = () => {
  const v = location.hash.slice(1);
  return VIEWS.includes(v) ? v : 'overview';
};

function render() {
  const view = currentView();
  const activeId = document.activeElement?.id; // keep focus stable across re-renders
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== view; });
  $$('[data-nav]').forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  RENDERERS[view]();
  if (activeId && document.getElementById(activeId)) document.getElementById(activeId).focus();
}

window.addEventListener('hashchange', () => {
  render();
  $(`#h-${currentView()}`)?.focus(); // move screen-reader focus to the new page title
  window.scrollTo(0, 0);
});

/** Shared numbers for the current pay cycle. */
function cycleContext() {
  const today = new Date();
  const { salary, payday, savingsRate } = state.settings;
  const cycle = cycleFor(today, payday);
  const summary = summarize(inRange(state.txns, cycle.start, cycle.end));
  const plan = safeToSpend({ salary, savingsRate, spent: summary.expense, daysLeft: cycle.daysLeft });
  return { today, cycle, summary, plan };
}

/* ---------- Shared templates ---------- */

function txnRow(t, { deletable = false } = {}) {
  const cat = categoryById(t.category);
  const title = escapeHTML(t.note || cat.label);
  const sign = t.type === 'income' ? '+' : '−';
  return `<li class="txn">
    <span class="dot" style="--dot:${cat.color}" aria-hidden="true"></span>
    <span class="txn-main">
      <span class="txn-note">${title}</span>
      <span class="txn-meta">${escapeHTML(cat.label)}${deletable ? '' : `, ${formatDate(t.date)}`}</span>
    </span>
    <span class="txn-amt ${t.type === 'income' ? 'income' : ''}">${sign}${formatINR(t.amount)}</span>
    ${deletable ? `<button class="icon-btn" type="button" data-delete="${escapeHTML(t.id)}" aria-label="Delete ${title}">×</button>` : ''}
  </li>`;
}

function bar(pct, label) {
  const shown = Math.min(100, Math.round(pct * 100));
  return `<div class="bar" role="progressbar" aria-label="${escapeHTML(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${shown}"><span style="width:${shown}%"></span></div>`;
}

function dayLabel(iso, today) {
  const diff = diffDays(parseISODate(iso), today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ---------- Overview ---------- */

function payRing(cycle) {
  const r = 68;
  const c = 2 * Math.PI * r;
  const done = cycle.daysTotal ? cycle.elapsed / cycle.daysTotal : 0;
  const days = cycle.daysLeft === 1 ? 'day' : 'days';
  return `<svg class="ring" viewBox="0 0 160 160" role="img" aria-label="${cycle.daysLeft} ${days} until payday">
    <circle class="ring-track" cx="80" cy="80" r="${r}"/>
    <circle class="ring-fill" cx="80" cy="80" r="${r}" transform="rotate(-90 80 80)"
      style="--c:${c.toFixed(1)}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - done)).toFixed(1)}"/>
    <text class="ring-num" x="80" y="88">${cycle.daysLeft}</text>
    <text class="ring-label" x="80" y="110">${days} to payday</text>
  </svg>`;
}

function donut(byCategory, total) {
  if (!total) return '<p class="empty">No spending yet this cycle. Add an expense to see where your money goes.</p>';
  const r = 50;
  const c = 2 * Math.PI * r;
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  let offset = 0;
  const arcs = entries.map(([id, amt]) => {
    const len = (amt / total) * c;
    const arc = `<circle cx="64" cy="64" r="${r}" fill="none" stroke="${categoryById(id).color}" stroke-width="18"
      stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 64 64)"/>`;
    offset += len;
    return arc;
  }).join('');
  const legend = entries.map(([id, amt]) => {
    const cat = categoryById(id);
    return `<li><span class="dot" style="--dot:${cat.color}"></span><span>${cat.label}</span><span class="amt">${formatINR(amt)}</span></li>`;
  }).join('');
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 128 128" role="img" aria-label="Spending by category, ${formatINR(total)} in total">
      ${arcs}
      <text class="donut-total" x="64" y="66">${formatINR(total)}</text>
      <text class="donut-cap" x="64" y="80">spent</text>
    </svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

function renderOverview() {
  const { today, cycle, summary, plan } = cycleContext();
  const { savingsRate } = state.settings;
  const lastDay = new Date(cycle.end); lastDay.setDate(lastDay.getDate() - 1);
  $('#cycle-label').textContent = `Pay cycle ${formatDate(toISODate(cycle.start))} to ${formatDate(toISODate(lastDay))}. Next salary on ${formatDate(toISODate(cycle.end), { day: 'numeric', month: 'long' })}.`;

  const usedPct = plan.planned > 0 ? summary.expense / plan.planned : 0;
  const note = plan.overspent
    ? `You're <strong>${formatINR(-plan.remaining)}</strong> past this cycle's plan. Hold off on non-essentials until payday.`
    : `You've spent <strong>${formatINR(summary.expense)}</strong> of the <strong>${formatINR(plan.planned)}</strong> you planned for this cycle, with ${savingsRate}% of your salary kept aside for savings.`;

  const atRisk = EXPENSE_CATEGORIES
    .map((cat) => ({ cat, spent: summary.byCategory[cat.id] ?? 0, limit: state.budgets[cat.id] ?? 0 }))
    .map((b) => ({ ...b, status: budgetStatus(b.limit, b.spent) }))
    .filter((b) => b.status.state === 'warn' || b.status.state === 'over')
    .sort((a, b) => b.status.pct - a.status.pct)
    .slice(0, 4);

  const recent = sortByDateDesc(state.txns).slice(0, 5);

  $('#overview').innerHTML = `
    <section class="hero ${plan.overspent ? 'overspent' : ''}" aria-label="Safe to spend">
      ${payRing(cycle)}
      <div>
        <p class="hero-label">Safe to spend each day until payday</p>
        <p class="hero-amount">${formatINR(plan.perDay)}<small>a day</small></p>
        <p class="hero-note">${note}</p>
        <div class="hero-meter" aria-hidden="true"><span style="width:${Math.min(100, usedPct * 100)}%"></span></div>
        <a class="hero-edit" href="#tools">Change salary or savings</a>
      </div>
    </section>

    <div class="overview-grid">
      <section class="panel" aria-labelledby="h-spend">
        <div class="panel-head"><h2 id="h-spend">Where it went</h2></div>
        ${donut(summary.byCategory, summary.expense)}
      </section>

      <section class="panel" aria-labelledby="h-risk">
        <div class="panel-head"><h2 id="h-risk">Budgets to watch</h2><a href="#budgets">All budgets</a></div>
        ${atRisk.length ? `<ul class="risk-list">${atRisk.map(({ cat, spent, limit, status }) => `
          <li class="${status.state}">
            <div class="risk-row"><span>${cat.label}</span><span>${formatINR(spent)} of ${formatINR(limit)}</span></div>
            ${bar(status.pct, `${cat.label} budget used`)}
          </li>`).join('')}</ul>`
        : '<p class="empty">Every category is under 80% of its limit. Nothing to worry about yet.</p>'}
      </section>

      <section class="panel wide" aria-labelledby="h-recent">
        <div class="panel-head"><h2 id="h-recent">Recent transactions</h2><a href="#transactions">See all</a></div>
        ${recent.length ? `<ul class="txn-list">${recent.map((t) => txnRow(t)).join('')}</ul>`
        : '<p class="empty">No transactions yet. Add your salary to get started.</p>'}
      </section>
    </div>`;
}

/* ---------- Transactions ---------- */

function renderTransactions() {
  const today = new Date();
  const list = sortByDateDesc(filterTxns(state.txns, filters));
  const totals = summarize(list);
  $('#txn-summary').textContent = `${list.length} ${list.length === 1 ? 'transaction' : 'transactions'}: ${formatINR(totals.expense)} out, ${formatINR(totals.income)} in.`;

  if (!list.length) {
    $('#txn-list').innerHTML = state.txns.length
      ? '<p class="empty">No transactions match. Try a different search or clear the filters.</p>'
      : '<p class="empty">No transactions yet. Use “Add transaction” to log your first one.</p>';
    return;
  }
  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  $('#txn-list').innerHTML = [...groups].map(([date, items]) => `
    <section class="txn-group" aria-label="${dayLabel(date, today)}">
      <h3 class="txn-day">${dayLabel(date, today)}</h3>
      <ul class="txn-list">${items.map((t) => txnRow(t, { deletable: true })).join('')}</ul>
    </section>`).join('');
}

function setupTransactions() {
  $('#txn-cat').innerHTML = '<option value="all">All categories</option>' +
    CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');

  $('#txn-search').addEventListener('input', (e) => { filters.q = e.target.value; renderTransactions(); });
  $('#txn-type').addEventListener('change', (e) => { filters.type = e.target.value; renderTransactions(); });
  $('#txn-cat').addEventListener('change', (e) => { filters.cat = e.target.value; renderTransactions(); });

  $('#txn-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const index = state.txns.findIndex((t) => t.id === btn.dataset.delete);
    if (index === -1) return;
    const [removed] = state.txns.splice(index, 1);
    commit('Transaction deleted', () => {
      state.txns.splice(index, 0, removed);
      commit('Transaction restored');
    });
  });

  $('#export-csv').addEventListener('click', () => {
    const blob = new Blob([toCSV(state.txns)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `kosh-transactions-${toISODate(new Date())}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('CSV exported');
  });
}

/* ---------- Add transaction dialog ---------- */

function setupDialog() {
  const dialog = $('#txn-dialog');
  const form = $('#txn-form');

  const fillCategories = () => {
    const type = form.elements.type.value;
    const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    form.elements.category.innerHTML = cats.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  };
  const clearErrors = () => {
    $$('.field-error', form).forEach((el) => { el.textContent = ''; });
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  };

  $$('[data-open-add]').forEach((btn) => btn.addEventListener('click', () => {
    form.reset();
    clearErrors();
    fillCategories();
    form.elements.date.value = toISODate(new Date());
    form.elements.date.max = toISODate(new Date());
    dialog.showModal();
    form.elements.amount.focus();
  }));
  $$('[data-close]', dialog).forEach((btn) => btn.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // backdrop click
  $$('input[name="type"]', form).forEach((r) => r.addEventListener('change', fillCategories));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    const input = Object.fromEntries(new FormData(form));
    const { ok, errors, value } = validateTxn(input);
    if (!ok) {
      for (const [field, msg] of Object.entries(errors)) {
        const err = $(`#err-${field}`);
        if (err) err.textContent = msg;
        form.elements[field]?.setAttribute?.('aria-invalid', 'true');
      }
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    state.txns.push({ id: uid(), createdAt: Date.now(), ...value });
    dialog.close();
    commit(value.type === 'income' ? 'Income added' : 'Expense added');
  });
}

/* ---------- Budgets ---------- */

function budgetView(cat, spent) {
  const limit = state.budgets[cat.id] ?? 0;
  const s = budgetStatus(limit, spent);
  const msg = s.state === 'none'
    ? `${formatINR(spent)} spent this cycle. No limit set.`
    : s.state === 'over'
      ? `${formatINR(-s.remaining)} over the ${formatINR(limit)} limit.`
      : `${formatINR(spent)} spent, ${formatINR(s.remaining)} left of ${formatINR(limit)}.`;
  return { limit, s, msg };
}

function renderBudgets() {
  const { summary } = cycleContext();
  $('#budget-list').innerHTML = EXPENSE_CATEGORIES.map((cat) => {
    const { limit, s, msg } = budgetView(cat, summary.byCategory[cat.id] ?? 0);
    return `<li class="budget ${s.state}" data-row="${cat.id}">
      <div class="budget-head">
        <span class="dot" style="--dot:${cat.color}" aria-hidden="true"></span>
        <label for="budget-${cat.id}">${cat.label}</label>
        <span class="budget-input"><span aria-hidden="true">₹</span>
          <input id="budget-${cat.id}" type="number" min="0" step="500" inputmode="numeric" placeholder="No limit"
            value="${limit || ''}" data-budget="${cat.id}" aria-describedby="budget-msg-${cat.id}"></span>
      </div>
      ${bar(s.pct, `${cat.label} budget used`)}
      <p class="budget-msg" id="budget-msg-${cat.id}">${msg}</p>
    </li>`;
  }).join('');
}

function setupBudgets() {
  // Update the edited row in place rather than re-rendering the list,
  // so keyboard focus isn't yanked back while tabbing through limits.
  $('#budget-list').addEventListener('change', (e) => {
    const input = e.target.closest('[data-budget]');
    if (!input) return;
    const cat = categoryById(input.dataset.budget);
    const value = Math.max(0, Math.round(Number(input.value) || 0));
    state.budgets[cat.id] = value;
    saveState(state);

    const { summary } = cycleContext();
    const { s, msg } = budgetView(cat, summary.byCategory[cat.id] ?? 0);
    const row = input.closest('[data-row]');
    row.className = `budget ${s.state}`;
    const shown = Math.min(100, Math.round(s.pct * 100));
    $('.bar', row).setAttribute('aria-valuenow', shown);
    $('.bar > span', row).style.width = `${shown}%`;
    $('.budget-msg', row).textContent = msg;
    input.value = value || '';
    toast(`${cat.label} limit ${value ? 'set to ' + formatINR(value) : 'removed'}`);
  });
}

/* ---------- Goals ---------- */

function renderGoals() {
  const today = new Date();
  const list = $('#goal-list');
  if (!state.goals.length) {
    list.innerHTML = '<li class="goal"><p class="empty">No goals yet. Create one to see how much to save each month.</p></li>';
    return;
  }
  list.innerHTML = state.goals.map((g) => {
    const p = goalPlan(g, today);
    const id = escapeHTML(g.id);
    const name = escapeHTML(g.name);
    const by = formatDate(g.deadline, { month: 'short', year: 'numeric' });
    const planText = p.done
      ? 'Goal reached. Well done.'
      : p.overdue
        ? `The deadline has passed with ${formatINR(p.remaining)} still to go. Create the goal again with a new date to replan.`
        : `Save ${formatINR(p.perMonth)} a month to reach it by ${by}.`;
    return `<li class="goal">
      <div class="goal-head"><h3>${name}</h3>
        <button class="icon-btn" type="button" data-goal-delete="${id}" aria-label="Delete goal ${name}">×</button></div>
      <p class="goal-amt"><strong>${formatINR(g.saved)}</strong> of ${formatINR(g.target)}</p>
      ${bar(p.pct, `${g.name} progress`)}
      <p class="goal-plan ${p.overdue ? 'overdue' : ''}">${planText}</p>
      ${p.done ? '' : `<form class="goal-add" data-goal-add="${id}" novalidate>
        <label class="sr-only" for="goal-add-${id}">Amount to add to ${name}</label>
        <input id="goal-add-${id}" name="amount" type="number" min="1" inputmode="numeric" placeholder="₹ amount">
        <button class="btn-quiet" type="submit">Add money</button>
      </form>`}
    </li>`;
  }).join('');
}

function setupGoals() {
  const form = $('#goal-form');
  const min = toISODate(new Date());
  form.elements.deadline.min = min;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    const target = Number(form.elements.target.value);
    const saved = Number(form.elements.saved.value || 0);
    const deadline = form.elements.deadline.value;
    let error = '';
    if (!name) error = 'Give the goal a name.';
    else if (!(target > 0)) error = 'Enter a target amount above ₹0.';
    else if (saved < 0) error = "Already saved can't be negative.";
    else if (!deadline || deadline < min) error = 'Pick a date from today onwards.';
    $('#goal-error').textContent = error;
    if (error) return;
    state.goals.push({ id: uid(), name, target, saved, deadline });
    form.reset();
    form.elements.saved.value = 0;
    commit('Goal created');
  });

  $('#goal-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goal-delete]');
    if (!btn) return;
    const index = state.goals.findIndex((g) => g.id === btn.dataset.goalDelete);
    if (index === -1) return;
    const [removed] = state.goals.splice(index, 1);
    commit('Goal deleted', () => { state.goals.splice(index, 0, removed); commit('Goal restored'); });
  });

  $('#goal-list').addEventListener('submit', (e) => {
    const f = e.target.closest('[data-goal-add]');
    if (!f) return;
    e.preventDefault();
    const amount = Number(f.elements.amount.value);
    if (!(amount > 0)) { f.elements.amount.setAttribute('aria-invalid', 'true'); f.elements.amount.focus(); return; }
    const goal = state.goals.find((g) => g.id === f.dataset.goalAdd);
    goal.saved += amount;
    commit(`${formatINR(amount)} added to ${goal.name}`);
  });
}

/* ---------- Tools ---------- */

function renderEMI() {
  const f = $('#emi-form').elements;
  const r = calcEMI(f.principal.value, f.rate.value, f.months.value);
  if (!r) { $('#emi-out').innerHTML = '<p class="hint">Enter a loan amount, an interest rate and a tenure to see your EMI.</p>'; return; }
  const p = Number(f.principal.value);
  const share = (p / r.totalPayment) * 100;
  $('#emi-out').innerHTML = `
    <p class="hint">Monthly EMI</p>
    <p class="result-big">${formatINR(r.emi)}</p>
    <div class="split" aria-hidden="true"><span class="p" style="width:${share}%"></span><span class="i" style="width:${100 - share}%"></span></div>
    <div class="result-rows">
      <div><span>Principal</span><strong>${formatINR(p)}</strong></div>
      <div><span>Total interest</span><strong>${formatINR(r.totalInterest)}</strong></div>
      <div><span>Total you pay</span><strong>${formatINR(r.totalPayment)}</strong></div>
    </div>`;
}

function renderFX() {
  const f = $('#fx-form').elements;
  if (!rates) { $('#fx-out').innerHTML = '<p class="hint">Loading exchange rates…</p>'; return; }
  const code = f.currency.value;
  const amount = Number(f.amount.value) || 0;
  const value = amount * (rates.rates[code] ?? 0);
  const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: code === 'JPY' ? 0 : 2 });
  $('#fx-out').innerHTML = `<p class="hint">${formatINR(amount)} is about</p><p class="result-big">${fmt.format(value)}</p>`;
  const when = rates.updated ? new Date(rates.updated).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  $('#fx-status').textContent = {
    live: `Live rates, updated ${when}.`,
    cache: `Rates from ${when}. Refreshed every 12 hours.`,
    stale: `Couldn't reach the rates service. Showing saved rates from ${when}.`,
    offline: "Couldn't reach the rates service. Showing approximate built-in rates.",
  }[rates.source];
}

function renderTools() {
  const f = $('#settings-form').elements;
  if (!f.salary.matches(':focus')) {
    f.salary.value = state.settings.salary;
    f.payday.value = state.settings.payday;
    f.savingsRate.value = state.settings.savingsRate;
  }
  renderEMI();
  renderFX();
  if (!rates) getRates().then((r) => { rates = r; renderFX(); });
}

function setupTools() {
  $('#emi-form').addEventListener('input', renderEMI);
  $('#emi-form').addEventListener('submit', (e) => e.preventDefault());
  $('#fx-form').addEventListener('input', renderFX);
  $('#fx-form').addEventListener('submit', (e) => e.preventDefault());

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const salary = Number(f.salary.value);
    const payday = Number(f.payday.value);
    const savingsRate = Number(f.savingsRate.value);
    let error = '';
    if (!(salary > 0)) error = 'Enter a salary above ₹0.';
    else if (!Number.isInteger(payday) || payday < 1 || payday > 31) error = 'Payday must be a whole number from 1 to 31.';
    else if (!(savingsRate >= 0 && savingsRate <= 90)) error = 'Savings must be between 0% and 90%.';
    $('#settings-error').textContent = error;
    if (error) return;
    state.settings = { salary, payday, savingsRate };
    commit('Settings saved');
  });

  $('#reset-data').addEventListener('click', () => {
    const previous = state;
    state = seedState();
    commit('Demo data restored', () => { state = previous; commit('Your data is back'); });
  });
}

/* ---------- Theme + toast ---------- */

function setupTheme() {
  const btn = $('#theme-toggle');
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const sync = () => {
    const label = isDark() ? 'Light theme' : 'Dark theme';
    $('#theme-label').textContent = label;
    btn.setAttribute('aria-label', `Switch to ${label.toLowerCase()}`);
  };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('kosh-theme', next); } catch { /* ignore */ }
    sync();
  });
  sync();
}

let toastTimer;
function toast(message, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${escapeHTML(message)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  el.classList.add('show');
  const hide = () => el.classList.remove('show');
  if (undo) $('button', el).addEventListener('click', () => { hide(); undo(); }, { once: true });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, undo ? 6000 : 3000);
}

/* ---------- Boot ---------- */

const RENDERERS = {
  overview: renderOverview,
  transactions: renderTransactions,
  budgets: renderBudgets,
  goals: renderGoals,
  tools: renderTools,
};

setupTransactions();
setupDialog();
setupBudgets();
setupGoals();
setupTools();
setupTheme();
render();
