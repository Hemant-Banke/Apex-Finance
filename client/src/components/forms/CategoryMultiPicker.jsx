import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, Tags } from 'lucide-react';
import { categoriesAPI } from '../../lib/api';
import { groupState, toggleGroup, toggleCode } from '../../lib/categorySelection';
import Popover from '../ui/Popover';
import Checkbox from '../ui/Checkbox';

const TYPES = [{ key: 'expense', label: 'Expense' }, { key: 'income', label: 'Income' }];
let _tree = null;   // { expense: {primary, secondary}, income: {...} }, fetched once

/**
 * Filter by any number of categories: tick a whole group, or individual categories in it.
 * `value` is an array of group codes and "group/child" codes (see lib/categorySelection).
 */
export default function CategoryMultiPicker({ value = [], onChange }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState(_tree);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (_tree) return;
    Promise.all(TYPES.map(t => categoriesAPI.getAll(t.key).then(r => r.data).catch(() => ({ primary: [], secondary: {} }))))
      .then(([expense, income]) => { _tree = { expense, income }; setTree(_tree); });
  }, []);

  const childrenOf = useMemo(() => {
    const map = {};
    for (const t of TYPES) for (const [p, kids] of Object.entries(tree?.[t.key]?.secondary || {})) {
      map[p] = [...new Set([...(map[p] || []), ...kids.map(k => k.code)])];
    }
    return (p) => map[p] || [];
  }, [tree]);

  // Names for the trigger label, and the visible tree after the search.
  const { names, sections } = useMemo(() => {
    const names = {};
    const seen = new Set();
    const q = query.trim().toLowerCase();
    const sections = TYPES.map(t => {
      const data = tree?.[t.key] || { primary: [], secondary: {} };
      const groups = [];
      for (const p of data.primary) {
        if (seen.has(p.code)) continue;
        seen.add(p.code);
        names[p.code] = `${p.emoji ? `${p.emoji} ` : ''}${p.name}`;
        const kids = (data.secondary[p.code] || []).map(k => {
          names[`${p.code}/${k.code}`] = `${k.emoji ? `${k.emoji} ` : ''}${k.name}`;
          return k;
        });
        const groupHit = !q || p.name.toLowerCase().includes(q);
        const shownKids = groupHit ? kids : kids.filter(k => k.name.toLowerCase().includes(q));
        if (groupHit || shownKids.length) groups.push({ ...p, kids: shownKids, allKids: kids });
      }
      return { ...t, groups };
    });
    return { names, sections };
  }, [tree, query]);

  const label = !value.length ? 'All categories'
    : value.length === 1 ? (names[value[0]] || '1 category')
    : `${value.length} categories`;

  const toggleOpen = (code) => setExpanded(s => {
    const n = new Set(s);
    if (n.has(code)) n.delete(code); else n.add(code);
    return n;
  });

  return (
    <>
      <button ref={ref} type="button" className="input-field" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left',
          color: value.length ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        }}>
        <span className="truncate">{label}</span>
        <Tags size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>

      <Popover anchorRef={ref} open={open} onClose={() => { setOpen(false); setQuery(''); }} width={320} maxHeight={440}>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 440 }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--color-border-subtle)', position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 21, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a category"
              className="input-field" style={{ fontSize: '0.8125rem', padding: '8px 10px 8px 30px' }} />
          </div>

          <div style={{ overflowY: 'auto', padding: '4px 0', flex: 1 }}>
            {!tree && <p className="text-xs" style={{ padding: 14, color: 'var(--color-text-muted)' }}>Loading…</p>}
            {sections.map(sec => sec.groups.length > 0 && (
              <div key={sec.key}>
                <p className="col-head" style={{ padding: '10px 14px 6px' }}>{sec.label}</p>
                {sec.groups.map(g => {
                  const state = groupState(value, g.code, childrenOf);
                  const isOpen = !!query.trim() || expanded.has(g.code);
                  const picked = value.filter(c => c.startsWith(`${g.code}/`)).length;
                  return (
                    <div key={g.code}>
                      <div className="flex items-center category-option" style={{ gap: 10, padding: '6px 10px 6px 14px' }}>
                        <Checkbox tone="plain" label={`Select ${g.name}`}
                          checked={state === 'all'} indeterminate={state === 'some'}
                          onChange={() => onChange(toggleGroup(value, g.code))} />
                        <button type="button" onClick={() => onChange(toggleGroup(value, g.code))}
                          className="text-sm truncate"
                          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-primary)' }}>
                          {g.emoji && <span style={{ marginRight: 6 }}>{g.emoji}</span>}{g.name}
                          {state === 'some' && <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>{picked}/{g.allKids.length}</span>}
                        </button>
                        {g.allKids.length > 0 && (
                          <button type="button" onClick={() => toggleOpen(g.code)} aria-label={isOpen ? `Collapse ${g.name}` : `Expand ${g.name}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', color: 'var(--color-text-muted)' }}>
                            <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
                          </button>
                        )}
                      </div>
                      {isOpen && g.kids.map(k => {
                        const full = `${g.code}/${k.code}`;
                        const on = value.includes(g.code) || value.includes(full);
                        return (
                          <div key={full} className="flex items-center category-option" style={{ gap: 10, padding: '5px 14px 5px 42px' }}>
                            <Checkbox tone="plain" label={`Select ${k.name}`} checked={on}
                              onChange={() => onChange(toggleCode(value, full, childrenOf))} />
                            <button type="button" onClick={() => onChange(toggleCode(value, full, childrenOf))}
                              className="text-sm truncate"
                              style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-secondary)' }}>
                              {k.emoji && <span style={{ marginRight: 6 }}>{k.emoji}</span>}{k.name}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
            {tree && sections.every(s => !s.groups.length) && (
              <p className="text-xs" style={{ padding: 14, color: 'var(--color-text-muted)' }}>No category matches “{query}”</p>
            )}
          </div>

          <div className="flex items-center justify-between" style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border-subtle)' }}>
            <button type="button" onClick={() => onChange([])} disabled={!value.length} className="text-xs font-medium"
              style={{ background: 'none', border: 'none', cursor: value.length ? 'pointer' : 'default', padding: 0, color: 'var(--color-text-muted)', opacity: value.length ? 1 : 0.5 }}>
              Clear{value.length ? ` (${value.length})` : ''}
            </button>
            <button type="button" onClick={() => { setOpen(false); setQuery(''); }} className="text-xs font-medium"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-accent)', fontWeight: 600 }}>
              Done
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}
