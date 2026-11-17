// store.js — persistence. The only file that touches localStorage for app data.
import { cycleFor, addDays, toISODate, uid } from './core.js';

const KEY = 'kosh-state-v1';

/** Demo data placed inside the current pay cycle so the dashboard is never empty. */
export function seedState(today = new Date()) {
  const settings = { salary: 85000, payday: 1, savingsRate: 20 };
  const cycle = cycleFor(today, settings.payday);
  const day = (n) => toISODate(addDays(cycle.start, Math.min(n, cycle.elapsed)));
  const later = (months) => toISODate(new Date(today.getFullYear(), today.getMonth() + months, 1));

  const raw = [
    ['income', 85000, 'salary', 'Salary credited', 0],
    ['expense', 22000, 'rent', 'House rent', 0],
    ['expense', 2400, 'food', 'Monthly groceries', 2],
    ['expense', 1000, 'transport', 'Metro card recharge', 3],
    ['expense', 680, 'food', 'Dinner with team', 5],
    ['expense', 1850, 'rent', 'Electricity bill', 6],
    ['expense', 649, 'fun', 'Streaming subscription', 7],
    ['expense', 3200, 'shopping', 'Running shoes', 9],
    ['expense', 450, 'health', 'Pharmacy', 10],
    ['expense', 340, 'transport', 'Cab to airport', 12],
    ['expense', 900, 'fun', 'Movie tickets', 13],
    ['expense', 1900, 'food', 'Groceries top-up', 14],
    ['expense', 260, 'food', 'Office lunch', 16],
  ];

  return {
    version: 1,
    settings,
    txns: raw.map(([type, amount, category, note, n], i) => ({
      id: uid(), type, amount, category, note, date: day(n), createdAt: i,
    })),
    budgets: { rent: 25000, food: 9000, transport: 3000, shopping: 5000, health: 2000, fun: 3000, other: 2000 },
    goals: [
      { id: uid(), name: 'Emergency fund', target: 200000, saved: 65000, deadline: later(10) },
      { id: uid(), name: 'Goa trip', target: 40000, saved: 12000, deadline: later(4) },
    ],
  };
}

function isValidState(s) {
  return s && s.version === 1 && s.settings && Array.isArray(s.txns) && Array.isArray(s.goals) && s.budgets;
}

export function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (isValidState(parsed)) return parsed;
  } catch {
    /* corrupted or blocked storage: fall through to demo data */
  }
  return seedState();
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // private mode or quota full — app keeps working in memory
  }
}
