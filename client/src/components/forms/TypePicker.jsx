import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, ArrowLeft, Plus } from 'lucide-react';
import Popover from '../ui/Popover';

/**
 * TypePicker — one dropdown "type/option picker" for every place the app needs
 * to choose from a fixed (or extendable) vocabulary.
 *
 * Two shapes, selected by `hierarchical`:
 *
 *   Flat (default):
 *     <TypePicker options={[{value,label,emoji?,sublabel?,icon?}]} value onChange />
 *     - account type in the account form
 *     - destination account in a transfer
 *
 *   Hierarchical (two levels, path values "primary/secondary"):
 *     <TypePicker hierarchical primaries={[…]} childrenOf={fn} value onChange />
 *     - transaction categories (with add support)
 *
 * Optional add support (`onAdd`) renders an inline "Add …" form (emoji + name)
 * and calls `onAdd({ name, emoji, level, parent })`, expecting the created
 * option `{ value, label, emoji? }` back so it can be selected immediately.
 */

const DEFAULT_EMOJIS = [
  '💰','💳','🏦','📈','📊','💹','🏠','🚗','🍔','✈️',
  '🎭','📱','🛍️','💊','📚','🎮','☕','🛒','💻','🎁',
  '❤️','🔔','🏥','💼','🏢','🎯','💪','👕','🧴','🎬',
  '🎪','⛽','🚌','🚕','🛡️','💡','🔧','📋','🍽️','📖',
];

export default function TypePicker({
  value,
  onChange,
  disabled = false,
  // flat mode
  options = [],
  // hierarchical mode
  hierarchical = false,
  primaries = [],
  childrenOf = () => [],
  // display / behaviour
  placeholder = 'Select…',
  clearable = false,
  searchable = false,
  loading = false,
  // add support
  onAdd = null,
  addPrimaryLabel = 'Add option',
  addChildLabel = 'Add sub-option',
  emojiSuggestions = DEFAULT_EMOJIS,
}) {
  const [isOpen, setIsOpen]       = useState(false);
  const [phase, setPhase]         = useState('primary'); // 'primary' | 'secondary'
  const [navPrimary, setNavPrimary] = useState(null);
  const [query, setQuery]         = useState('');
  const [showAdd, setShowAdd]     = useState(false);
  const [newName, setNewName]     = useState('');
  const [newEmoji, setNewEmoji]   = useState('📋');
  const [addError, setAddError]   = useState('');
  const [adding, setAdding]       = useState(false);

  const triggerRef   = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => { if (showAdd) setTimeout(() => nameInputRef.current?.focus(), 40); }, [showAdd]);

  function close() {
    setIsOpen(false);
    setPhase('primary');
    setNavPrimary(null);
    setShowAdd(false);
    setAddError('');
    setQuery('');
  }
  function open() {
    if (disabled) return;
    setIsOpen(true);
    setPhase('primary');
    setNavPrimary(null);
    setShowAdd(false);
    setNewName(''); setNewEmoji('📋'); setAddError(''); setQuery('');
  }

  // ── Resolve the current value into a display label ──────────────────────────
  const topList = hierarchical ? primaries : options;
  let displayLabel = null;
  if (hierarchical) {
    const [pCode, cCode] = (value || '').split('/');
    const p = primaries.find(o => o.value === pCode);
    const c = cCode ? childrenOf(pCode).find(o => o.value === cCode) : null;
    if (p) displayLabel = c
      ? `${p.emoji ? p.emoji + ' ' : ''}${p.label} · ${c.emoji ? c.emoji + ' ' : ''}${c.label}`
      : `${p.emoji ? p.emoji + ' ' : ''}${p.label}`;
  } else {
    const o = options.find(o => o.value === value);
    if (o) displayLabel = `${o.emoji ? o.emoji + ' ' : ''}${o.label}`;
  }

  // ── Visible rows for the current phase, filtered by search ──────────────────
  const rows = (phase === 'secondary' && navPrimary ? childrenOf(navPrimary.value) : topList) || [];
  const filtered = query.trim()
    ? rows.filter(r => r.label.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  function selectFlat(o)      { onChange(o.value); close(); }
  function selectPrimary(o) {
    const kids = childrenOf(o.value);
    if (kids.length === 0) { onChange(o.value); close(); }
    else { setNavPrimary(o); setPhase('secondary'); setShowAdd(false); setQuery(''); }
  }
  function selectPrimaryOnly() { onChange(navPrimary.value); close(); }
  function selectChild(o)      { onChange(`${navPrimary.value}/${o.value}`); close(); }
  function clear(e)            { e.stopPropagation(); onChange(''); }

  async function handleAdd() {
    if (!newName.trim()) { setAddError('Name is required'); return; }
    setAdding(true); setAddError('');
    try {
      const level  = hierarchical ? phase : 'primary';
      const parent = (hierarchical && phase === 'secondary') ? navPrimary.value : null;
      const created = await onAdd({ name: newName.trim(), emoji: newEmoji || '📋', level, parent });
      if (created?.value != null) {
        onChange(parent ? `${parent}/${created.value}` : created.value);
      }
      close();
    } catch (err) {
      setAddError(err?.response?.data?.message || err?.message || 'Failed to add');
    } finally {
      setAdding(false);
    }
  }

  const canAddHere = !!onAdd;

  return (
    <div style={{ position: 'relative' }}>
      {/* ── Trigger ── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={isOpen ? close : open}
        disabled={disabled}
        className="input-field"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', gap: 8,
          ...(isOpen ? { borderColor: 'var(--color-accent)', background: 'var(--color-bg-secondary)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.28), var(--shadow-md), 0 0 0 3px var(--color-accent-dim)' } : null),
        }}
      >
        <span style={{ flex: 1, color: displayLabel ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel || placeholder}
        </span>
        {clearable && value && !disabled && (
          <span onClick={clear} title="Clear" style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>✕</span>
        )}
        <ChevronDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {/* ── Dropdown (portaled, always on top) ── */}
      <Popover anchorRef={triggerRef} open={isOpen} onClose={close} maxHeight={360}>
        <div style={{ background: 'var(--color-bg-popover)', border: '1px solid var(--color-border-hover)', borderRadius: 'var(--radius)', overflow: 'hidden', boxShadow: 'var(--shadow-popover)' }}>

          {/* Secondary-phase header */}
          {hierarchical && phase === 'secondary' && (
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => { setPhase('primary'); setNavPrimary(null); setShowAdd(false); setQuery(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', padding: 0, fontFamily: 'inherit' }}>
                <ArrowLeft size={12} /> Back
              </button>
              <span style={{ color: 'var(--color-border-hover)' }}>·</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                {navPrimary.emoji ? navPrimary.emoji + ' ' : ''}{navPrimary.label}
              </span>
            </div>
          )}

          {/* Search */}
          {searchable && !showAdd && (
            <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontSize: '0.8125rem', fontFamily: 'inherit', outline: 'none' }}
              />
            </div>
          )}

          {/* Rows */}
          <div style={{ maxHeight: 248, overflowY: 'auto', padding: '4px 0' }}>
            {loading && <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Loading…</div>}

            {!loading && hierarchical && phase === 'secondary' && !query && (
              <Row emoji="" label="No sub-category" muted onClick={selectPrimaryOnly} />
            )}

            {!loading && filtered.map(o => (
              <Row
                key={o.value}
                emoji={o.emoji}
                icon={o.icon}
                label={o.label}
                sublabel={o.sublabel}
                hasArrow={hierarchical && phase === 'primary' && childrenOf(o.value).length > 0}
                onClick={() => hierarchical ? (phase === 'primary' ? selectPrimary(o) : selectChild(o)) : selectFlat(o)}
              />
            ))}

            {!loading && filtered.length === 0 && (
              <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>No matches</div>
            )}
          </div>

          {/* Add */}
          {canAddHere && (!showAdd ? (
            <div style={{ borderTop: '1px solid var(--color-border)', padding: 4 }}>
              <button type="button" onClick={() => { setShowAdd(true); setNewName(''); setNewEmoji('📋'); setAddError(''); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8125rem', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                <Plus size={13} /> {hierarchical && phase === 'secondary' ? addChildLabel : addPrimaryLabel}
              </button>
            </div>
          ) : (
            <div style={{ borderTop: '1px solid var(--color-border)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" value={newEmoji} onChange={e => setNewEmoji(e.target.value || '📋')}
                  style={{ width: 42, height: 38, textAlign: 'center', fontSize: '1.2rem', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontFamily: 'inherit', outline: 'none', flexShrink: 0 }} />
                <input ref={nameInputRef} type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                  placeholder="Name"
                  style={{ flex: 1, height: 38, padding: '0 12px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {emojiSuggestions.map(em => (
                  <button key={em} type="button" onClick={() => setNewEmoji(em)}
                    style={{ width: 28, height: 28, fontSize: '0.9rem', background: newEmoji === em ? 'var(--color-accent-muted)' : 'var(--color-bg-elevated)', border: newEmoji === em ? '1px solid var(--color-accent)' : '1px solid transparent', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {em}
                  </button>
                ))}
              </div>
              {addError && <p style={{ fontSize: '0.75rem', color: 'var(--color-danger)', margin: 0 }}>{addError}</p>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => { setShowAdd(false); setAddError(''); }}
                  style={{ flex: 1, padding: 7, fontSize: '0.8125rem', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button type="button" onClick={handleAdd} disabled={adding}
                  style={{ flex: 1, padding: 7, fontSize: '0.8125rem', background: 'var(--color-text-primary)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: adding ? 'not-allowed' : 'pointer', color: 'var(--color-bg-primary)', fontFamily: 'inherit', fontWeight: 500, opacity: adding ? 0.6 : 1 }}>
                  {adding ? '…' : 'Add'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function Row({ emoji, icon, label, sublabel, hasArrow, muted, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: hovered ? 'var(--color-bg-elevated)' : 'none', border: 'none', cursor: 'pointer', color: muted ? 'var(--color-text-muted)' : 'var(--color-text-primary)', fontSize: '0.875rem', textAlign: 'left', fontFamily: 'inherit', transition: 'background 0.1s' }}>
      {icon
        ? <span style={{ width: 22, display: 'flex', justifyContent: 'center', flexShrink: 0, color: 'var(--color-text-secondary)' }}>{icon}</span>
        : <span style={{ fontSize: '1.05em', width: 22, textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>{emoji}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {sublabel && <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 1 }}>{sublabel}</span>}
      </span>
      {hasArrow && <ChevronRight size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
    </button>
  );
}
