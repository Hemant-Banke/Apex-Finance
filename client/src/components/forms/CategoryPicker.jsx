import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, ArrowLeft, Plus } from 'lucide-react';
import { categoriesAPI } from '../../lib/api';

const EMOJI_SUGGESTIONS = [
  '💰','💳','🏦','📈','📊','💹','🏠','🚗','🍔','✈️',
  '🎭','📱','🛍️','💊','📚','🎮','☕','🛒','💻','🎁',
  '❤️','🔔','🏥','💼','🏢','🎯','💪','👕','🧴','🎬',
  '🎪','⛽','🚌','🚕','🛡️','💡','🔧','📋','🍽️','📖',
  '🎓','🏨','🗺️','🎵','💫','📦','🏡','🩺','🎀','⭐',
];

// Module-level cache so we don't refetch on every open
const _cache = {};

function getCache(type) { return _cache[type] || null; }
function setCache(type, data) { _cache[type] = data; }
function patchCache(type, updater) {
  if (_cache[type]) _cache[type] = updater(_cache[type]);
}

export default function CategoryPicker({ value, onChange, transactionType, disabled }) {
  const [isOpen, setIsOpen]           = useState(false);
  const [phase, setPhase]             = useState('primary');
  const [navPrimary, setNavPrimary]   = useState(null);
  const [categories, setCategories]   = useState(() => getCache(transactionType));
  const [loading, setLoading]         = useState(false);
  const [showAdd, setShowAdd]         = useState(false);
  const [newEmoji, setNewEmoji]       = useState('📋');
  const [newName, setNewName]         = useState('');
  const [addError, setAddError]       = useState('');
  const [adding, setAdding]           = useState(false);
  const containerRef = useRef(null);
  const nameInputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = e => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Load categories when transactionType changes or cache is empty
  useEffect(() => {
    if (!transactionType) return;
    const cached = getCache(transactionType);
    if (cached) { setCategories(cached); return; }
    setLoading(true);
    categoriesAPI.getAll(transactionType)
      .then(res => {
        setCache(transactionType, res.data);
        setCategories(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [transactionType]);

  // Focus name input when add form opens
  useEffect(() => {
    if (showAdd) setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [showAdd]);

  function closeDropdown() {
    setIsOpen(false);
    setPhase('primary');
    setNavPrimary(null);
    setShowAdd(false);
    setAddError('');
  }

  // Parse current value: "tp_food" | "tp_food/ts_restaurants" | ""
  const parts        = (value || '').split('/');
  const primaryCode  = parts[0];
  const secondaryCode= parts[1];
  const primaryCat   = categories?.primary?.find(c => c.code === primaryCode);
  const secondaryCat = secondaryCode
    ? categories?.secondary?.[primaryCode]?.find(c => c.code === secondaryCode)
    : null;

  const displayLabel = primaryCat
    ? secondaryCat
      ? `${primaryCat.emoji} ${primaryCat.name} · ${secondaryCat.emoji} ${secondaryCat.name}`
      : `${primaryCat.emoji} ${primaryCat.name}`
    : null;

  function openDropdown() {
    if (disabled) return;
    setIsOpen(true);
    setPhase('primary');
    setNavPrimary(null);
    setShowAdd(false);
    setNewName('');
    setNewEmoji('📋');
    setAddError('');
  }

  function handlePrimaryClick(cat) {
    const subs = categories?.secondary?.[cat.code] || [];
    if (subs.length === 0) {
      onChange(cat.code);
      closeDropdown();
    } else {
      setNavPrimary(cat);
      setPhase('secondary');
      setShowAdd(false);
    }
  }

  function handleSecondaryClick(cat) {
    onChange(`${navPrimary.code}/${cat.code}`);
    closeDropdown();
  }

  function handlePrimaryOnly() {
    onChange(navPrimary.code);
    closeDropdown();
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange('');
  }

  async function handleAdd() {
    if (!newName.trim()) { setAddError('Name is required'); return; }
    setAdding(true);
    setAddError('');
    try {
      const level  = phase === 'primary' ? 'primary' : 'secondary';
      const parent = phase === 'secondary' ? navPrimary.code : null;
      const res    = await categoriesAPI.create({
        name:         newName.trim(),
        emoji:        newEmoji || '📋',
        level,
        parent,
        applicableTo: [transactionType],
      });
      const newCat = res.data;

      // Update cache and local state
      const updated = { ...categories };
      if (level === 'primary') {
        updated.primary = [...updated.primary, newCat];
      } else {
        updated.secondary = { ...updated.secondary };
        updated.secondary[parent] = [...(updated.secondary[parent] || []), newCat];
      }
      setCache(transactionType, updated);
      setCategories(updated);

      onChange(level === 'primary' ? newCat.code : `${parent}/${newCat.code}`);
      closeDropdown();
    } catch (err) {
      setAddError(err.response?.data?.message || 'Failed to add category');
    } finally {
      setAdding(false);
    }
  }

  const primaries   = categories?.primary || [];
  const secondaries = navPrimary ? (categories?.secondary?.[navPrimary.code] || []) : [];

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* ── Trigger ── */}
      <button
        type="button"
        onClick={isOpen ? closeDropdown : openDropdown}
        disabled={disabled}
        className="input-field"
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          cursor:         disabled ? 'not-allowed' : 'pointer',
          textAlign:      'left',
          gap:            8,
        }}
      >
        <span style={{
          flex:      1,
          color:     displayLabel ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          fontSize:  '0.875rem',
          overflow:  'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {displayLabel || 'Select category'}
        </span>

        {value && !disabled && (
          <span
            onClick={handleClear}
            style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
            title="Clear"
          >
            ✕
          </span>
        )}

        <ChevronDown
          size={14}
          style={{
            color:      'var(--color-text-muted)',
            flexShrink: 0,
            transform:  isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {/* ── Dropdown panel ── */}
      {isOpen && (
        <div style={{
          position:     'absolute',
          top:          'calc(100% + 4px)',
          left:         0,
          right:        0,
          zIndex:       200,
          background:   'var(--color-bg-card)',
          border:       '1px solid var(--color-border-hover)',
          borderRadius: 'var(--radius)',
          overflow:     'hidden',
          boxShadow:    '0 12px 32px rgba(0,0,0,0.5)',
        }}>

          {/* Secondary phase header */}
          {phase === 'secondary' && (
            <div style={{
              padding:      '10px 12px',
              borderBottom: '1px solid var(--color-border)',
              display:      'flex',
              alignItems:   'center',
              gap:          8,
            }}>
              <button
                type="button"
                onClick={() => { setPhase('primary'); setNavPrimary(null); setShowAdd(false); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-accent)', display: 'flex', alignItems: 'center',
                  gap: 4, fontSize: '0.75rem', padding: 0, fontFamily: 'inherit',
                }}
              >
                <ArrowLeft size={12} /> Back
              </button>
              <span style={{ color: 'var(--color-border-hover)' }}>·</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                {navPrimary.emoji} {navPrimary.name}
              </span>
            </div>
          )}

          {/* Category list */}
          <div style={{ maxHeight: 232, overflowY: 'auto', padding: '4px 0' }}>

            {loading && (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                Loading…
              </div>
            )}

            {/* Primary list */}
            {!loading && phase === 'primary' && primaries.map(cat => (
              <CategoryRow
                key={cat.code}
                emoji={cat.emoji}
                name={cat.name}
                hasArrow={(categories?.secondary?.[cat.code]?.length || 0) > 0}
                onClick={() => handlePrimaryClick(cat)}
              />
            ))}

            {/* Secondary list */}
            {!loading && phase === 'secondary' && (
              <>
                <button
                  type="button"
                  onClick={handlePrimaryOnly}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-muted)', fontSize: '0.8125rem', textAlign: 'left',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    fontFamily: 'inherit',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ width: 22, flexShrink: 0 }} />
                  <span>No sub-category</span>
                </button>
                {secondaries.map(cat => (
                  <CategoryRow
                    key={cat.code}
                    emoji={cat.emoji}
                    name={cat.name}
                    hasArrow={false}
                    onClick={() => handleSecondaryClick(cat)}
                  />
                ))}
              </>
            )}
          </div>

          {/* ── Add section ── */}
          {!showAdd ? (
            <div style={{ borderTop: '1px solid var(--color-border)', padding: '4px' }}>
              <button
                type="button"
                onClick={() => { setShowAdd(true); setNewName(''); setNewEmoji('📋'); setAddError(''); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-muted)', fontSize: '0.8125rem',
                  borderRadius: 'var(--radius-sm)', fontFamily: 'inherit',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-bg-elevated)';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'none';
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                }}
              >
                <Plus size={13} />
                {phase === 'primary' ? 'Add category' : 'Add sub-category'}
              </button>
            </div>
          ) : (
            /* ── Add form ── */
            <div style={{ borderTop: '1px solid var(--color-border)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Emoji + Name row */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={newEmoji}
                  onChange={e => setNewEmoji(e.target.value || '📋')}
                  style={{
                    width: 42, height: 38, textAlign: 'center', fontSize: '1.2rem',
                    background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)',
                    fontFamily: 'inherit', outline: 'none', flexShrink: 0,
                  }}
                />
                <input
                  ref={nameInputRef}
                  type="text"
                  placeholder={phase === 'primary' ? 'Category name' : 'Sub-category name'}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                  style={{
                    flex: 1, height: 38, padding: '0 12px',
                    background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)',
                    fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                />
              </div>

              {/* Emoji grid */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {EMOJI_SUGGESTIONS.map(em => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setNewEmoji(em)}
                    style={{
                      width: 28, height: 28, fontSize: '0.9rem',
                      background: newEmoji === em ? 'var(--color-accent-muted)' : 'var(--color-bg-elevated)',
                      border: newEmoji === em ? '1px solid var(--color-accent)' : '1px solid transparent',
                      borderRadius: 6, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {em}
                  </button>
                ))}
              </div>

              {addError && (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-danger)', margin: 0 }}>{addError}</p>
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setAddError(''); }}
                  style={{
                    flex: 1, padding: '7px', fontSize: '0.8125rem',
                    background: 'none', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    color: 'var(--color-text-secondary)', fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding}
                  style={{
                    flex: 1, padding: '7px', fontSize: '0.8125rem',
                    background: 'var(--color-text-primary)', border: 'none',
                    borderRadius: 'var(--radius-sm)', cursor: adding ? 'not-allowed' : 'pointer',
                    color: 'var(--color-bg-primary)', fontFamily: 'inherit', fontWeight: 500,
                    opacity: adding ? 0.6 : 1,
                  }}
                >
                  {adding ? '…' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryRow({ emoji, name, hasArrow, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', background: hovered ? 'var(--color-bg-elevated)' : 'none',
        border: 'none', cursor: 'pointer', color: 'var(--color-text-primary)',
        fontSize: '0.875rem', textAlign: 'left', fontFamily: 'inherit',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ fontSize: '1.05em', width: 22, textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>
        {emoji}
      </span>
      <span style={{ flex: 1 }}>{name}</span>
      {hasArrow && <ChevronRight size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
    </button>
  );
}
