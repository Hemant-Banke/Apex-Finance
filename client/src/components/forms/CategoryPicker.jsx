import { useEffect, useReducer } from 'react';
import { categoriesAPI } from '../../lib/api';
import TypePicker from './TypePicker';

// Module-level cache so we don't refetch categories on every mount.
const _cache = {};

/**
 * Transaction category picker — a hierarchical, add-enabled TypePicker wired to
 * the categories API. Value is a "primaryCode" or "primaryCode/secondaryCode".
 */
export default function CategoryPicker({ value, onChange, transactionType, disabled }) {
  const [, bump] = useReducer(x => x + 1, 0); // re-render when the cache updates

  // Derived from the module cache during render (no setState-in-effect).
  const cats    = transactionType ? (_cache[transactionType] || null) : null;
  const loading = !!transactionType && !cats;

  useEffect(() => {
    if (!transactionType || _cache[transactionType]) return;
    let cancelled = false;
    categoriesAPI.getAll(transactionType)
      .then(res => { _cache[transactionType] = res.data; })
      .catch(() => { _cache[transactionType] = { primary: [], secondary: {} }; })
      .finally(() => { if (!cancelled) bump(); });
    return () => { cancelled = true; };
  }, [transactionType]);

  const toOption  = c => ({ value: c.code, label: c.name, emoji: c.emoji });
  const primaries = (cats?.primary || []).map(toOption);
  const childrenOf = pCode => (cats?.secondary?.[pCode] || []).map(toOption);

  async function handleAdd({ name, emoji, level, parent }) {
    const res = await categoriesAPI.create({ name, emoji, level, parent: parent || null, applicableTo: [transactionType] });
    const cat = res.data;
    const updated = { primary: [...(cats?.primary || [])], secondary: { ...(cats?.secondary || {}) } };
    if (level === 'primary') updated.primary.push(cat);
    else updated.secondary[parent] = [...(updated.secondary[parent] || []), cat];
    _cache[transactionType] = updated;
    bump();
    return toOption(cat);
  }

  return (
    <TypePicker
      hierarchical
      value={value}
      onChange={onChange}
      disabled={disabled}
      loading={loading}
      primaries={primaries}
      childrenOf={childrenOf}
      placeholder="Select category"
      clearable
      onAdd={handleAdd}
      addPrimaryLabel="Add category"
      addChildLabel="Add sub-category"
    />
  );
}
