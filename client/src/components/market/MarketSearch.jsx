import { useState, useEffect, useRef } from 'react';
import { marketAPI } from '../../lib/api';
import { Search, Loader2 } from 'lucide-react';
import AssetIcon from './AssetIcon';
import Popover from '../ui/Popover';

// ── Popular securities shown before user types ──────────────────────────────
const POPULAR = {
  'Popular Indian Stocks': [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries', type: 'stock' },
    { symbol: 'TCS.NS',      name: 'Tata Consultancy Services', type: 'stock' },
    { symbol: 'INFY.NS',     name: 'Infosys', type: 'stock' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', type: 'stock' },
    { symbol: 'ICICIBANK.NS',name: 'ICICI Bank', type: 'stock' },
    { symbol: 'WIPRO.NS',    name: 'Wipro', type: 'stock' },
  ],
  'Popular US Stocks': [
    { symbol: 'AAPL',  name: 'Apple', type: 'stock' },
    { symbol: 'MSFT',  name: 'Microsoft', type: 'stock' },
    { symbol: 'GOOGL', name: 'Alphabet', type: 'stock' },
    { symbol: 'TSLA',  name: 'Tesla', type: 'stock' },
    { symbol: 'AMZN',  name: 'Amazon', type: 'stock' },
    { symbol: 'NVDA',  name: 'Nvidia', type: 'stock' },
  ],
  'Popular ETFs': [
    { symbol: 'NIFTYBEES.NS', name: 'Nippon Nifty BeES', type: 'etf' },
    { symbol: 'GOLDBEES.NS',  name: 'Nippon Gold BeES', type: 'etf' },
    { symbol: 'SPY',          name: 'SPDR S&P 500', type: 'etf' },
    { symbol: 'QQQ',          name: 'Invesco QQQ', type: 'etf' },
    { symbol: 'VTI',          name: 'Vanguard Total Market', type: 'etf' },
  ],
  'Popular Crypto': [
    { symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
    { symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto' },
    { symbol: 'SOL-USD', name: 'Solana', type: 'crypto' },
    { symbol: 'BNB-USD', name: 'BNB', type: 'crypto' },
  ],
  'Popular Commodities': [
    { symbol: 'GC=F', name: 'Gold Futures', type: 'commodity' },
    { symbol: 'SI=F', name: 'Silver Futures', type: 'commodity' },
    { symbol: 'CL=F', name: 'Crude Oil', type: 'commodity' },
  ],
};

// Manual / unlisted assets — price auto-fetch is skipped for these. `keywords`
// let a free-text query surface the right option (e.g. "house" → Real Estate).
const MANUAL = [
  { symbol: 'REAL-ESTATE',   name: 'Real Estate', type: 'other',    isManual: true, keywords: ['real estate', 'house', 'home', 'property', 'apartment', 'flat', 'land', 'plot'] },
  { symbol: 'FIXED-DEPOSIT', name: 'Fixed Deposit (FD)', type: 'fd', isManual: true, keywords: ['fixed deposit', 'fd', 'deposit', 'recurring deposit', 'rd'] },
  { symbol: 'EPF-NPS',       name: 'EPF / NPS', type: 'epf_nps',   isManual: true, keywords: ['epf', 'nps', 'pf', 'provident fund', 'pension', 'retirement'] },
  { symbol: 'PHYS-GOLD',     name: 'Physical Gold', type: 'gold',   isManual: true, keywords: ['gold', 'jewellery', 'jewelry', 'bullion'] },
  { symbol: 'PHYS-SILVER',   name: 'Physical Silver', type: 'silver', isManual: true, keywords: ['silver'] },
  { symbol: 'PRIVATE-EQUITY',name: 'Private Equity', type: 'other', isManual: true, keywords: ['private equity', 'pe', 'startup', 'esop', 'unlisted equity', 'venture'] },
  { symbol: 'UNLISTED-BOND', name: 'Unlisted Bond', type: 'bond',   isManual: true, keywords: ['bond', 'debenture', 'ncd'] },
  { symbol: 'OTHER-ASSET',   name: 'Other', type: 'other',          isManual: true, keywords: ['other', 'misc', 'custom'] },
];

// Manual assets whose name or keywords match the query — so typing "real estate"
// or "house" surfaces our manual listing alongside live market results.
function matchManual(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return MANUAL.filter(m =>
    m.name.toLowerCase().includes(s) ||
    m.keywords.some(k => k.includes(s) || s.includes(k))
  );
}

// Per-category header meta — an emoji marker + colour-coded accent, so the empty
// state reads as an organised board, not a flat list.
const CATEGORY_META = {
  'Popular Indian Stocks': { emoji: '🇮🇳', accent: 'var(--color-accent)' },
  'Popular US Stocks':     { emoji: '🇺🇸', accent: '#60a5fa' },
  'Popular ETFs':          { emoji: '🧺', accent: 'var(--color-chart-warm)' },
  'Popular Crypto':        { emoji: '🪙', accent: '#a78bfa' },
  'Popular Commodities':   { emoji: '🛢️', accent: '#fbbf24' },
};

const TYPE_COLORS = {
  stock:       'var(--color-accent)',
  etf:         'var(--color-chart-warm)',
  crypto:      '#a78bfa',
  mutual_fund: '#60a5fa',
  bond:        '#22c55e',
  commodity:   '#fbbf24',
  gold:        '#fbbf24',
  fd:          '#22c55e',
  epf_nps:     '#60a5fa',
  other:       'var(--color-text-muted)',
};

function TypeBadge({ type }) {
  const label = type?.replace('_', ' ') || 'other';
  return (
    <span style={{
      fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', color: TYPE_COLORS[type] || 'var(--color-text-muted)',
      background: 'var(--color-bg-elevated)', borderRadius: 4,
      padding: '2px 5px'
    }}>
      {label}
    </span>
  );
}

// Compact clickable chip: icon + short ticker + company name. Lifts slightly and
// warms to a gilt hairline on hover so the board feels tactile.
function SecurityChip({ s, onPick, dashed = false }) {
  const short = s.symbol.replace('.NS', '').replace('-USD', '').replace('=F', '');
  const rest = dashed ? 'transparent' : 'var(--color-bg-elevated)';
  return (
    <button
      onMouseDown={() => onPick(s)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
        padding: '7px 9px', borderRadius: 'var(--radius-sm)',
        border: `1px ${dashed ? 'dashed' : 'solid'} var(--color-border)`,
        background: rest,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        boxShadow: dashed ? 'none' : 'var(--elev-ring)',
        transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent-muted)'; e.currentTarget.style.background = 'var(--color-bg-card-hover)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = rest; e.currentTarget.style.transform = 'none'; }}
    >
      <AssetIcon symbol={s.symbol} name={s.name} type={s.type} size={26} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
        <div className="figure" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{short}</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{s.name}</div>
      </div>
    </button>
  );
}

// Category header — a bare emoji marker + tracked label, with a hairline rule
// that carries the eye across the row.
function CategoryHeader({ label, emoji, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
      {emoji
        ? <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{emoji}</span>
        : <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0, boxShadow: `0 0 8px -1px ${accent}` }} />}
      <p className="eyebrow" style={{ margin: 0 }}>{label}</p>
      <span style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
    </div>
  );
}

function useDebounce(val, ms) {
  const [dv, setDv] = useState(val);
  useEffect(() => {
    const t = setTimeout(() => setDv(val), ms);
    return () => clearTimeout(t);
  }, [val, ms]);
  return dv;
}

/**
 * MarketSearch — reusable security search bar.
 *
 * Props:
 *   onSelect(security) — called with { symbol, name, type, exchange?, isManual? }
 *   placeholder        — input placeholder text
 *   autoFocus          — focus input on mount
 *   inline             — render suggestions in normal flow (use inside modals/panels)
 */
export default function MarketSearch({ onSelect, placeholder = 'Search stocks, ETFs, crypto, mutual funds…', autoFocus = true, inline = false }) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [focused, setFocused]   = useState(false);
  const [error, setError]       = useState('');
  const debouncedQ              = useDebounce(query, 300);
  const inputRef                = useRef(null);
  const searchBoxRef            = useRef(null);

  // Focus after the host modal's entrance settles, so the results popover opens
  // against a stationary field and lands in its natural spot (just below it) —
  // exactly as it does on a manual click — instead of during the fade-down.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 210);
    return () => clearTimeout(t);
  }, [autoFocus]);

  // Search when debounced query changes — a data-fetching effect that owns the
  // results/loading/error state, so the synchronous resets here are intentional.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!debouncedQ.trim()) { setResults([]); setError(''); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    marketAPI.search(debouncedQ)
      .then(r => { if (!cancelled) setResults(r.data || []); })
      .catch(() => { if (!cancelled) setError('Search unavailable'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const showResults = query.trim().length > 0;

  const select = (security) => {
    setQuery('');
    setFocused(false);
    onSelect(security);
  };

  // Shared panel content (results or popular grid) — a render helper, not a
  // nested component, so it doesn't remount on every keystroke.
  const renderResults = () => {
    const manualMatches = matchManual(query);
    if (error && results.length === 0 && manualMatches.length === 0) {
      return <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{error}</div>;
    }
    if (!loading && results.length === 0 && manualMatches.length === 0) {
      return <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No results for "{query}"</div>;
    }
    // When we also surface a manual option, drop one live result so the list
    // doesn't overflow into a scroll.
    const shown = manualMatches.length ? results.slice(0, Math.max(0, results.length - 1)) : results;
    return (
      <div style={{ padding: 6 }}>
        {shown.map(r => (
          <button key={r.symbol} onMouseDown={() => select(r)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 10px', background: 'none', border: 'none', cursor: 'pointer',
              textAlign: 'left', transition: 'background 0.12s', borderRadius: 'var(--radius-sm)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <AssetIcon symbol={r.symbol} name={r.name} type={r.type} size={34} />
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="figure" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{r.symbol}</span>
                <TypeBadge type={r.type} />
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}{r.exchange ? ` · ${r.exchange}` : ''}
              </span>
            </div>
          </button>
        ))}

        {/* Manual / unlisted matches for the query (e.g. "house" → Real Estate) */}
        {manualMatches.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 4px' }}>
              <p className="eyebrow" style={{ margin: 0 }}>Add manually</p>
              <span style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
            </div>
            {manualMatches.map(m => (
              <button key={m.symbol} onMouseDown={() => select(m)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 10px', background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', transition: 'background 0.12s', borderRadius: 'var(--radius-sm)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <AssetIcon symbol={m.symbol} name={m.name} type={m.type} size={34} />
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.name}</span>
                    <span className="badge badge-gold" style={{ fontSize: '0.5625rem' }}>Manual</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Track this holding yourself</span>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    );
  };

  const renderPanel = () => showResults ? renderResults() : (
    /* Empty state — a colour-coded board of popular markets + manual options */
    <div style={{ padding: '16px 16px 14px' }}>
      {Object.entries(POPULAR).map(([category, items]) => (
        <div key={category} style={{ marginBottom: 18 }}>
          <CategoryHeader
            label={category}
            emoji={CATEGORY_META[category]?.emoji}
            accent={CATEGORY_META[category]?.accent || 'var(--color-accent)'}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {items.map(s => <SecurityChip key={s.symbol} s={s} onPick={select} />)}
          </div>
        </div>
      ))}

      {/* Manual / Unlisted — set off by a gilt hairline; these are self-priced */}
      <div className="gilt-rule" style={{ margin: '4px 0 14px' }} />
      <CategoryHeader label="Manual · self-priced" emoji="✍️" accent="var(--color-text-muted)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        {MANUAL.map(s => <SecurityChip key={s.symbol} s={s} onPick={select} dashed />)}
      </div>
    </div>
  );

  return (
    <div style={{ position: inline ? 'static' : 'relative' }}>
      {/* Search input — prominent, command-palette style */}
      <div ref={searchBoxRef} style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--color-bg-input)',
        border: `1px solid ${focused ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        boxShadow: focused ? 'inset 0 1px 2px rgba(0,0,0,0.25), 0 0 0 3px var(--color-accent-dim)' : 'inset 0 1px 2px rgba(0,0,0,0.25)',
        transition: 'border-color 0.2s, box-shadow 0.2s'
      }}>
        {loading
          ? <Loader2 size={18} style={{ color: 'var(--color-accent)', flexShrink: 0, animation: 'spin 0.6s linear infinite' }} />
          : <Search size={18} style={{ color: focused ? 'var(--color-accent)' : 'var(--color-text-muted)', flexShrink: 0, transition: 'color 0.2s' }} />
        }
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            color: 'var(--color-text-primary)', fontSize: '1rem', fontFamily: 'inherit'
          }}
        />
        {query && (
          <button onClick={() => setQuery('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>
            ×
          </button>
        )}
      </div>

      {/* Inline panel — flows directly beneath the search field (no detached
          block) so it reads as part of the dialog. Caps its own height and
          scrolls internally so the surrounding modal stays fixed. */}
      {inline && (
        <div style={{
          marginTop: 8,
          maxHeight: 'min(52vh, 420px)',
          overflowY: 'auto',
        }}>
          {renderPanel()}
        </div>
      )}

      {/* Floating dropdown — portaled, always on top of the modal. The Popover
          panel supplies the surface (bg + border + radius + shadow). */}
      {!inline && (
        <Popover anchorRef={searchBoxRef} open={focused} onClose={() => setFocused(false)} maxHeight={480}>
          {renderPanel()}
        </Popover>
      )}
    </div>
  );
}
