import { useEffect, useState } from 'react';
import { categoriesAPI } from './api';

/**
 * Category display names, resolved from the taxonomy.
 *
 * A category's CODE is an internal handle ("tp_other_exp/ts_misc_exp"). It is not a
 * label, and prettifying it produces garbage — "Tp other exp · Ts misc exp". Anywhere a
 * category is shown to a human, its real name must be looked up. This module is the one
 * place that does that.
 *
 * The full taxonomy (both types) is fetched once and cached at module level, so every
 * consumer shares one request.
 */

let _all = null;          // { [code]: { name, emoji, parent, level } }
let _loading = null;      // in-flight promise, so concurrent mounts share one fetch
let _gen = 0;             // bumped on invalidate, so a stale in-flight fetch cannot win
const _subscribers = new Set();

function indexTaxonomy(data) {
  const map = {};
  for (const p of (data.primary || [])) {
    map[p.code] = { name: p.name, emoji: p.emoji, level: 'primary' };
  }
  for (const [parent, kids] of Object.entries(data.secondary || {})) {
    for (const c of kids) {
      map[c.code] = { name: c.name, emoji: c.emoji, level: 'secondary', parent };
    }
  }
  return map;
}

async function loadCategories() {
  if (_all) return _all;
  if (_loading) return _loading;

  const gen = _gen;
  const req = categoriesAPI.getAll()
    .then(res => indexTaxonomy(res.data))
    .catch(() => ({}))
    .then(map => {
      if (gen !== _gen) return loadCategories();
      _all = map;
      _loading = null;
      _subscribers.forEach(fn => fn());
      return _all;
    });
  _loading = req;

  return _loading;
}

/** The taxonomy map, awaiting the shared fetch if it has not happened yet. */
export function getCategoryMap() {
  return loadCategories();
}

/** Refetch after a category is created, renamed or removed. Mounted readers keep the old
 *  names until the new taxonomy lands, then re-render with it. */
export function invalidateCategories() {
  _gen += 1;
  _loading = null;
  const stale = _all;
  _all = null;
  loadCategories();
  _all = _all || stale;
}

/**
 * A code → what a human should read.
 *
 * @returns {{ emoji: string, group: string, name: string, label: string }}
 *   `label` is "Group · Name" (or just the group, for a primary-only code).
 *   Falls back to a de-slugged code only when the taxonomy has no entry — a category
 *   the user deleted, say — so a stale transaction still shows *something*.
 */
export function describeCategory(code, map = _all) {
  if (!code) return { emoji: '', group: '', name: '', label: '' };

  const [pCode, cCode] = String(code).split('/');
  const p = map?.[pCode];
  const c = cCode ? map?.[cCode] : null;

  if (!p && !c) {
    // Unknown code (deleted category, or the taxonomy has not loaded yet).
    const pretty = (s) => s.replace(/^t[sp]u?_/, '').replace(/_/g, ' ')
      .replace(/\b\w/g, ch => ch.toUpperCase());
    const parts = String(code).split('/').map(pretty);
    return { emoji: '', group: parts[0] || '', name: parts[1] || '', label: parts.join(' · ') };
  }

  const group = p?.name || '';
  const name  = c?.name || '';
  return {
    emoji: c?.emoji || p?.emoji || '',
    group,
    name,
    // Join only the parts that exist. A code whose GROUP is unknown (a deleted parent, a
    // half-migrated code) would otherwise render as "· Salary" — a stray separator that
    // reads like a missing word.
    label: [group, name].filter(Boolean).join(' · '),
  };
}

/**
 * Hook form: gives a `describe(code)` bound to the loaded taxonomy, and re-renders
 * when it arrives (or is invalidated).
 */
export function useCategoryNames() {
  const [map, setMap] = useState(_all);

  useEffect(() => {
    let alive = true;
    const sync = () => { if (alive) setMap(_all); };
    _subscribers.add(sync);
    loadCategories().then(sync);
    return () => { alive = false; _subscribers.delete(sync); };
  }, []);

  return {
    ready: !!map,
    describe: (code) => describeCategory(code, map),
    label: (code) => describeCategory(code, map).label,
  };
}
