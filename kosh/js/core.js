// core.js — pure business logic.
// No DOM, no storage, no network: every function here takes plain data and
// returns plain data, which is what makes it easy to unit test (see tests/).

export const CATEGORIES = [
  { id: 'rent', label: 'Rent & bills', color: '#5B7FDB' },
  { id: 'food', label: 'Food & groceries', color: '#E3A008' },
  { id: 'transport', label: 'Transport', color: '#2E9C8F' },
  { id: 'shopping', label: 'Shopping', color: '#C2577F' },
  { id: 'health', label: 'Health', color: '#6BAA4E' },
  { id: 'fun', label: 'Entertainment', color: '#8E6CCF' },
  { id: 'other', label: 'Other spending', color: '#8A9893' },
  { id: 'salary', label: 'Salary', color: '#2E7D57', income: true },
  { id: 'extra', label: 'Other income', color: '#3F9C6E', income: true },
];

export const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => !c.income);
export const INCOME_CATEGORIES = CATEGORIES.filter((c) => c.income);

const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryById(id) {
  return CATEGORY_MAP.get(id) ?? CATEGORY_MAP.get('other');
}

/* ---------- Formatting ---------- */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** 100000 -> "₹1,00,000" (Indian digit grouping) */
export function formatINR(n) {
  return inr.format(Math.round(Number(n) || 0));
}

/** "2026-11-05" -> "5 Nov" */
export function formatDate(iso, opts = { day: 'numeric', month: 'short' }) {
  return parseISODate(iso).toLocaleDateString('en-IN', opts);
}

/** Escape user text before it goes into innerHTML (prevents stored XSS). */
export function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ---------- Dates (always local time, never UTC) ---------- */

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

export function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, days) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function diffDays(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** Payday on the 31st becomes the 30th, 29th or 28th in shorter months. */
function paydayIn(year, month, payday) {
  const first = new Date(year, month, 1); // normalises month -1 / 12
  const y = first.getFullYear();
  const m = first.getMonth();
  return new Date(y, m, Math.min(payday, daysInMonth(y, m)));
}

/**
 * A salaried person's money runs payday-to-payday, not 1st-to-31st.
 * Returns the current cycle: start = last payday, end = next payday.
 */
export function cycleFor(today, payday) {
  const t = startOfDay(today);
  let start = paydayIn(t.getFullYear(), t.getMonth(), payday);
  if (start > t) start = paydayIn(t.getFullYear(), t.getMonth() - 1, payday);
  const end = paydayIn(start.getFullYear(), start.getMonth() + 1, payday);
  const daysTotal = diffDays(start, end);
  const daysLeft = diffDays(t, end);
  return { start, end, daysTotal, daysLeft, elapsed: daysTotal - daysLeft };
}

/* ---------- Transactions ---------- */

/** Transactions with start <= date < end */
export function inRange(txns, start, end) {
  return txns.filter((t) => {
    const d = parseISODate(t.date);
    return d >= start && d < end;
  });
}

export function summarize(txns) {
  const out = { income: 0, expense: 0, net: 0, byCategory: {} };
  for (const t of txns) {
    if (t.type === 'income') {
      out.income += t.amount;
    } else {
      out.expense += t.amount;
      out.byCategory[t.category] = (out.byCategory[t.category] ?? 0) + t.amount;
    }
  }
  out.net = out.income - out.expense;
  return out;
}

export function sortByDateDesc(txns) {
  return [...txns].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function filterTxns(txns, { q = '', cat = 'all', type = 'all' } = {}) {
  const needle = q.trim().toLowerCase();
  return txns.filter((t) => {
    if (type !== 'all' && t.type !== type) return false;
    if (cat !== 'all' && t.category !== cat) return false;
    if (!needle) return true;
    const haystack = `${t.note} ${categoryById(t.category).label}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Validates raw form input. Returns { ok, errors, value } so the UI can show
 * a message next to each field instead of one vague alert.
 */
export function validateTxn(input, today = new Date()) {
  const errors = {};
  const type = input.type === 'income' ? 'income' : input.type === 'expense' ? 'expense' : null;
  if (!type) errors.type = 'Choose expense or income.';

  const amount = Number(input.amount);
  if (input.amount === '' || input.amount == null || Number.isNaN(amount)) {
    errors.amount = 'Enter an amount.';
  } else if (amount <= 0) {
    errors.amount = 'Amount must be more than ₹0.';
  } else if (amount > 10_000_000) {
    errors.amount = 'Amount must be ₹1 crore or less.';
  }

  const cat = CATEGORY_MAP.get(input.category);
  if (!cat) errors.category = 'Choose a category.';
  else if (type && Boolean(cat.income) !== (type === 'income')) {
    errors.category = `That category isn't used for ${type}.`;
  }

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') && toISODate(parseISODate(input.date)) === input.date;
  if (!dateOk) errors.date = 'Enter a valid date.';
  else if (parseISODate(input.date) > startOfDay(today)) errors.date = "Date can't be in the future.";

  const note = String(input.note ?? '').trim();
  if (note.length > 60) errors.note = 'Keep the note under 60 characters.';

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok
      ? { type, amount: Math.round(amount * 100) / 100, category: cat.id, note, date: input.date }
      : null,
  };
}

/* ---------- Money planning ---------- */

/**
 * How much can be spent per day until payday without eating into savings.
 * planned = salary minus the savings share; perDay spreads what's left.
 */
export function safeToSpend({ salary, savingsRate, spent, daysLeft }) {
  const planned = salary * (1 - savingsRate / 100);
  const remaining = planned - spent;
  const perDay = daysLeft > 0 ? Math.max(0, remaining) / daysLeft : 0;
  return { planned, remaining, perDay, overspent: remaining < 0 };
}

export function budgetStatus(limit, spent) {
  if (!limit || limit <= 0) return { pct: 0, remaining: 0, state: 'none' };
  const pct = spent / limit;
  const state = pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
  return { pct, remaining: limit - spent, state };
}

function monthsBetween(from, to) {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}

export function goalPlan(goal, today = new Date()) {
  const remaining = Math.max(0, goal.target - goal.saved);
  const pct = goal.target > 0 ? Math.min(1, goal.saved / goal.target) : 0;
  if (remaining === 0) return { remaining, pct, done: true, overdue: false, perMonth: 0, monthsLeft: 0 };
  const deadline = parseISODate(goal.deadline);
  const overdue = deadline < startOfDay(today);
  const monthsLeft = Math.max(1, monthsBetween(startOfDay(today), deadline));
  return { remaining, pct, done: false, overdue, monthsLeft, perMonth: overdue ? remaining : Math.ceil(remaining / monthsLeft) };
}

/** Standard reducing-balance EMI: P·r·(1+r)^n / ((1+r)^n − 1) */
export function calcEMI(principal, annualRatePct, months) {
  const P = Number(principal);
  const n = Math.round(Number(months));
  const r = Number(annualRatePct) / 12 / 100;
  if (!(P > 0) || !(n > 0) || !(r >= 0)) return null;
  const emi = r === 0 ? P / n : (P * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  const totalPayment = emi * n;
  return { emi, totalPayment, totalInterest: totalPayment - P };
}

/* ---------- Export ---------- */

/**
 * CSV with proper quoting, plus formula-injection protection: a cell that
 * starts with = + - @ is prefixed with ' so Excel won't execute it.
 */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCSV(txns) {
  const header = ['Date', 'Type', 'Category', 'Note', 'Amount (INR)'];
  const rows = sortByDateDesc(txns).map((t) => [
    t.date,
    t.type,
    categoryById(t.category).label,
    t.note,
    t.amount.toFixed(2),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
