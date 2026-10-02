/**
 * A multi-category selection over the two-level taxonomy.
 *
 * Entries are a group code ("tp_food", meaning every category in it) or a full code
 * ("tp_food/ts_grocery"). A group is never stored alongside its own children, so a
 * selection always reads one way. `childrenOf(group)` returns that group's child codes.
 */

const groupOf = (code) => String(code).split('/')[0];

export function groupState(sel, group, childrenOf) {
  if (sel.includes(group)) return 'all';
  const kids = childrenOf(group);
  const picked = sel.filter(c => c.startsWith(`${group}/`)).length;
  if (!picked) return 'none';
  return kids.length && picked >= kids.length ? 'all' : 'some';
}

export function toggleGroup(sel, group) {
  const rest = sel.filter(c => c !== group && groupOf(c) !== group);
  return sel.includes(group) ? rest : [...rest, group];
}

/** Toggle one full code; a fully-picked group collapses to the group, and un-picking from a whole group expands it. */
export function toggleCode(sel, full, childrenOf) {
  const group = groupOf(full);
  if (!full.includes('/')) return toggleGroup(sel, group);
  const kids = childrenOf(group).map(c => `${group}/${c}`);

  if (sel.includes(group)) {
    return [...sel.filter(c => c !== group), ...kids.filter(k => k !== full)];
  }
  const next = sel.includes(full) ? sel.filter(c => c !== full) : [...sel, full];
  const picked = next.filter(c => c.startsWith(`${group}/`));
  return kids.length && picked.length === kids.length
    ? [...next.filter(c => groupOf(c) !== group), group]
    : next;
}

/** Is a full code covered by the selection, directly or through its group? */
export const isSelected = (sel, code) => sel.includes(code) || sel.includes(groupOf(code));
