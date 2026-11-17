// Run with: npm test   (uses Node's built-in test runner, no dependencies)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatINR, escapeHTML, cycleFor, toISODate, summarize, safeToSpend,
  budgetStatus, goalPlan, calcEMI, validateTxn, csvCell, toCSV, filterTxns, inRange,
} from '../js/core.js';

const d = (iso) => { const [y, m, day] = iso.split('-').map(Number); return new Date(y, m - 1, day); };

describe('formatINR', () => {
  test('uses Indian digit grouping', () => {
    assert.equal(formatINR(100000), '₹1,00,000');
    assert.equal(formatINR(1234567), '₹12,34,567');
  });
  test('rounds and survives bad input', () => {
    assert.equal(formatINR(99.6), '₹100');
    assert.equal(formatINR('abc'), '₹0');
  });
});

describe('escapeHTML', () => {
  test('neutralises script injection in notes', () => {
    assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});

describe('cycleFor', () => {
  test('payday on the 1st, mid-month', () => {
    const c = cycleFor(d('2026-11-17'), 1);
    assert.equal(toISODate(c.start), '2026-11-01');
    assert.equal(toISODate(c.end), '2026-12-01');
    assert.equal(c.daysLeft, 14);
    assert.equal(c.daysTotal, 30);
  });
  test('before payday falls back to previous month, across the year', () => {
    const c = cycleFor(d('2027-01-10'), 25);
    assert.equal(toISODate(c.start), '2026-12-25');
    assert.equal(toISODate(c.end), '2027-01-25');
  });
  test('payday 31 clamps to the end of short months', () => {
    const c = cycleFor(d('2027-02-15'), 31);
    assert.equal(toISODate(c.start), '2027-01-31');
    assert.equal(toISODate(c.end), '2027-02-28');
  });
  test('on payday itself a new cycle starts', () => {
    const c = cycleFor(d('2026-11-07'), 7);
    assert.equal(c.elapsed, 0);
    assert.equal(toISODate(c.start), '2026-11-07');
  });
});

describe('summaries and filters', () => {
  const txns = [
    { id: '1', type: 'income', amount: 80000, category: 'salary', note: 'Salary', date: '2026-11-01' },
    { id: '2', type: 'expense', amount: 1200, category: 'food', note: 'Groceries', date: '2026-11-03' },
    { id: '3', type: 'expense', amount: 300, category: 'food', note: 'Lunch', date: '2026-11-04' },
    { id: '4', type: 'expense', amount: 500, category: 'transport', note: 'Metro card', date: '2026-10-28' },
  ];
  test('summarize splits income, expense and categories', () => {
    const s = summarize(txns);
    assert.equal(s.income, 80000);
    assert.equal(s.expense, 2000);
    assert.deepEqual(s.byCategory, { food: 1500, transport: 500 });
  });
  test('inRange includes start, excludes end', () => {
    assert.equal(inRange(txns, d('2026-11-01'), d('2026-11-04')).length, 2);
  });
  test('filterTxns searches notes and category names', () => {
    assert.equal(filterTxns(txns, { q: 'metro' }).length, 1);
    assert.equal(filterTxns(txns, { q: 'groceries' }).length, 2); // note + "Food & groceries"
    assert.equal(filterTxns(txns, { type: 'income' }).length, 1);
  });
});

describe('safeToSpend', () => {
  test('spreads the remaining plan over the days left', () => {
    const r = safeToSpend({ salary: 100000, savingsRate: 20, spent: 50000, daysLeft: 10 });
    assert.equal(r.planned, 80000);
    assert.equal(r.perDay, 3000);
    assert.equal(r.overspent, false);
  });
  test('never suggests negative spending', () => {
    const r = safeToSpend({ salary: 50000, savingsRate: 0, spent: 60000, daysLeft: 5 });
    assert.equal(r.perDay, 0);
    assert.equal(r.overspent, true);
  });
});

describe('budgetStatus', () => {
  test('thresholds', () => {
    assert.equal(budgetStatus(1000, 500).state, 'ok');
    assert.equal(budgetStatus(1000, 800).state, 'warn');
    assert.equal(budgetStatus(1000, 1001).state, 'over');
    assert.equal(budgetStatus(0, 500).state, 'none');
  });
});

describe('goalPlan', () => {
  test('monthly amount needed to hit the deadline', () => {
    const p = goalPlan({ target: 60000, saved: 0, deadline: '2027-05-17' }, d('2026-11-17'));
    assert.equal(p.monthsLeft, 6);
    assert.equal(p.perMonth, 10000);
  });
  test('done and overdue states', () => {
    assert.equal(goalPlan({ target: 100, saved: 150, deadline: '2027-01-01' }, d('2026-11-17')).done, true);
    assert.equal(goalPlan({ target: 100, saved: 0, deadline: '2026-01-01' }, d('2026-11-17')).overdue, true);
  });
});

describe('calcEMI', () => {
  test('matches the standard formula', () => {
    const r = calcEMI(500000, 10, 60);
    assert.ok(Math.abs(r.emi - 10623.52) < 0.01);
    assert.ok(Math.abs(r.totalInterest - 137411.27) < 0.5);
  });
  test('zero interest and invalid input', () => {
    assert.equal(calcEMI(12000, 0, 12).emi, 1000);
    assert.equal(calcEMI(-5, 10, 12), null);
    assert.equal(calcEMI(1000, 10, 0), null);
  });
});

describe('validateTxn', () => {
  const today = d('2026-11-17');
  const good = { type: 'expense', amount: '250', category: 'food', note: ' Chai ', date: '2026-11-16' };
  test('accepts and normalises valid input', () => {
    const r = validateTxn(good, today);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { type: 'expense', amount: 250, category: 'food', note: 'Chai', date: '2026-11-16' });
  });
  test('rejects bad amounts, future dates and mismatched categories', () => {
    assert.ok(validateTxn({ ...good, amount: '-4' }, today).errors.amount);
    assert.ok(validateTxn({ ...good, amount: '' }, today).errors.amount);
    assert.ok(validateTxn({ ...good, date: '2026-11-18' }, today).errors.date);
    assert.ok(validateTxn({ ...good, date: '2026-02-30' }, today).errors.date);
    assert.ok(validateTxn({ ...good, category: 'salary' }, today).errors.category);
  });
});

describe('CSV export', () => {
  test('quotes commas and quotes', () => {
    assert.equal(csvCell('Dinner, "Social"'), '"Dinner, ""Social"""');
  });
  test('blocks spreadsheet formula injection', () => {
    assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  });
  test('has a header row', () => {
    const csv = toCSV([{ type: 'expense', amount: 10, category: 'food', note: 'Tea', date: '2026-11-01' }]);
    assert.equal(csv.split('\n')[0], 'Date,Type,Category,Note,Amount (INR)');
  });
});
