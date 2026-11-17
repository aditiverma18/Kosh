// api.js — live exchange rates from a public API, with timeout, cache and fallback.
const ENDPOINT = 'https://open.er-api.com/v6/latest/INR';
const CACHE_KEY = 'kosh-rates-v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Approximate rates so the converter still works offline. Shown as "approximate".
const FALLBACK = { USD: 0.0118, EUR: 0.0102, GBP: 0.0089, AED: 0.0434, SGD: 0.0153, AUD: 0.0181, CAD: 0.0165, JPY: 1.79 };

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && c.rates ? c : null;
  } catch {
    return null;
  }
}

function writeCache(value) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* ignore */ }
}

/**
 * Returns { rates, updated, source } where source is
 * 'live' | 'cache' (fresh enough) | 'stale' (network failed, old cache) | 'offline' (built-in).
 */
export async function getRates({ timeoutMs = 6000, fetchImpl = fetch } = {}) {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) return { ...cached, source: 'cache' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ENDPOINT, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result !== 'success' || typeof data.rates !== 'object') throw new Error('Unexpected response');
    const value = { rates: data.rates, updated: data.time_last_update_unix * 1000, fetchedAt: Date.now() };
    writeCache(value);
    return { ...value, source: 'live' };
  } catch {
    if (cached) return { ...cached, source: 'stale' };
    return { rates: FALLBACK, updated: null, fetchedAt: Date.now(), source: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
