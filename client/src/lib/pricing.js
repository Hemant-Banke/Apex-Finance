// The app-wide price basis. Off (default): assets at yesterday's close, cash at today.
// On: assets at live prices too. Kept on this device; read by the API interceptor.
const KEY = 'apex_live_prices';

let live = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

export const isLive = () => live;

export function setLive(on) {
  live = !!on;
  try { localStorage.setItem(KEY, live ? '1' : '0'); } catch { /* per-device convenience only */ }
}

// Endpoints that value the user's assets, and so take the basis as `fetchLatestBal`.
const PRICED = [/^\/accounts\/?$/, /^\/accounts\/[^/]+\/?$/, /^\/accounts\/[^/]+\/daily$/, /^\/dashboard\/(summary|portfolio|contribution|calendar)$/, /^\/networth\/daily$/];
export const takesBasis = (url = '') => PRICED.some(re => re.test(url.split('?')[0]));

// What the last priced response was actually valued at: `{ date, at }`, read from its `asof`.
// The sidebar shows it, so a failed live fetch reads as the close it fell back to.
let lastPriced = null;
const subs = new Set();
export function notePriced(data) {
  const asof = data?.asof ?? data?.totals?.asof ?? (Array.isArray(data) ? data[0]?.asof : null);
  if (!asof) return;
  lastPriced = { date: String(asof).slice(0, 10), at: Date.now() };
  subs.forEach(fn => fn(lastPriced));
}
export function subscribePriced(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const getLastPriced = () => lastPriced;
