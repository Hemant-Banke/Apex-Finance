import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// What each page looked like, per history entry: Back returns to it, a fresh visit starts clean.
const STORAGE = 'apex_back';
const KEEP = 80;
const SCROLL = '__scroll';

const entries = (() => {
  try { return JSON.parse(sessionStorage.getItem(STORAGE)) || {}; } catch { return {}; }
})();

let flushTimer = null;
function flush() {
  flushTimer = null;
  const keys = Object.keys(entries);
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete entries[k];
  try { sessionStorage.setItem(STORAGE, JSON.stringify(entries)); } catch { /* best effort */ }
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (flushTimer) { clearTimeout(flushTimer); flush(); } });

function recall(entry, id) { return entries[entry]?.[id]; }

function remember(entry, id, value) {
  const bag = entries[entry] || {};
  delete entries[entry];          // re-inserted last, so the oldest entries are the ones pruned
  entries[entry] = { ...bag, [id]: value };
  if (!flushTimer) flushTimer = setTimeout(flush, 300);
}

// The location key alone repeats ('default') for a tab's first entry, so the path is part of it.
const entryOf = (loc) => `${loc.key}${loc.pathname}`;

/** useState that Back restores: the value is kept per history entry. Values must be JSON. */
export function useBackState(id, initial) {
  const entry = entryOf(useLocation());
  const [value, setValue] = useState(() => {
    const saved = recall(entry, id);
    return saved !== undefined ? saved : typeof initial === 'function' ? initial() : initial;
  });
  const set = useCallback((next) => setValue(prev => {
    const v = typeof next === 'function' ? next(prev) : next;
    remember(entry, id, v);
    return v;
  }), [entry, id]);
  // A replace (a filter written to the URL) makes a new entry while this stays mounted; carry the value over.
  useEffect(() => { if (recall(entry, id) === undefined) remember(entry, id, value); }, [entry, id, value]);
  return [value, set];
}

/** Keeps a scroll box's position per history entry: Back restores it, a new page opens at the top. */
export function useScrollMemory(ref) {
  const loc = useLocation();
  const type = useNavigationType();
  const entry = entryOf(loc);
  const restoring = useRef(false);
  const lastPath = useRef(loc.pathname);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onScroll = () => { if (!restoring.current) remember(entry, SCROLL, el.scrollTop); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref, entry]);

  useLayoutEffect(() => {
    const el = ref.current;
    const samePage = lastPath.current === loc.pathname;
    lastPath.current = loc.pathname;
    if (!el) return undefined;
    if (type !== 'POP') { if (!samePage) el.scrollTop = 0; return undefined; }
    const target = recall(entry, SCROLL) || 0;
    if (!target) { el.scrollTop = 0; return undefined; }

    // The page refetches as it remounts, so keep pinning until it is tall enough and has settled.
    restoring.current = true;
    const start = performance.now();
    let frame = 0, lastHeight = 0, stableSince = start, done = false;
    const end = () => {
      if (done) return;
      done = true;
      restoring.current = false;
      cancelAnimationFrame(frame);
      el.removeEventListener('wheel', end);
      el.removeEventListener('touchstart', end);
      el.removeEventListener('pointerdown', end);
      window.removeEventListener('keydown', end);
    };
    const tick = () => {
      const now = performance.now();
      const max = el.scrollHeight - el.clientHeight;
      if (el.scrollHeight !== lastHeight) { lastHeight = el.scrollHeight; stableSince = now; }
      el.scrollTop = Math.min(target, max);
      if ((max >= target && now - stableSince > 500) || now - start > 4000) { end(); return; }
      frame = requestAnimationFrame(tick);
    };
    el.addEventListener('wheel', end, { passive: true });
    el.addEventListener('touchstart', end, { passive: true });
    el.addEventListener('pointerdown', end);
    window.addEventListener('keydown', end);
    tick();
    return end;
  }, [ref, entry, type, loc.pathname]);
}
