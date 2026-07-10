import { useState, useEffect, useRef } from 'react';
import { marketAPI } from '../../lib/api';
import { Search, Loader2 } from 'lucide-react';
import AssetIcon from './AssetIcon';
import Popover from '../ui/Popover';

// ── Popular securities shown before user types ──────────────────────────────
const POPULAR = {
  'Indian Stocks': [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries', type: 'stock' },
    { symbol: 'TCS.NS',      name: 'Tata Consultancy Services', type: 'stock' },
    { symbol: 'INFY.NS',     name: 'Infosys', type: 'stock' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', type: 'stock' },
    { symbol: 'ICICIBANK.NS',name: 'ICICI Bank', type: 'stock' },
    { symbol: 'WIPRO.NS',    name: 'Wipro', type: 'stock' },
  ],
  'US Stocks': [
    { symbol: 'AAPL',  name: 'Apple', type: 'stock' },
    { symbol: 'MSFT',  name: 'Microsoft', type: 'stock' },
    { symbol: 'GOOGL', name: 'Alphabet', type: 'stock' },
    { symbol: 'TSLA',  name: 'Tesla', type: 'stock' },
    { symbol: 'AMZN',  name: 'Amazon', type: 'stock' },
    { symbol: 'NVDA',  name: 'Nvidia', type: 'stock' },
  ],
  'ETFs': [
    { symbol: 'NIFTYBEES.NS', name: 'Nippon Nifty BeES', type: 'etf' },
    { symbol: 'GOLDBEES.NS',  name: 'Nippon Gold BeES', type: 'etf' },
    { symbol: 'SPY',          name: 'SPDR S&P 500', type: 'etf' },
    { symbol: 'QQQ',          name: 'Invesco QQQ', type: 'etf' },
    { symbol: 'VTI',          name: 'Vanguard Total Market', type: 'etf' },
  ],
  'Crypto': [
    { symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
    { symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto' },
    { symbol: 'SOL-USD', name: 'Solana', type: 'crypto' },
    { symbol: 'BNB-USD', name: 'BNB', type: 'crypto' },
  ],
  'Commodities': [
    { symbol: 'GC=F', name: 'Gold Futures', type: 'commodity' },
    { symbol: 'SI=F', name: 'Silver Futures', type: 'commodity' },
    { symbol: 'CL=F', name: 'Crude Oil', type: 'commodity' },
  ],
};

// Manual / unlisted assets — price auto-fetch is skipped for these
const MANUAL = [
  { symbol: 'REAL-ESTATE',   name: 'Real Estate', type: 'other',    isManual: true },
  { symbol: 'FIXED-DEPOSIT', name: 'Fixed Deposit (FD)', type: 'fd', isManual: true },
  { symbol: 'EPF-NPS',       name: 'EPF / NPS', type: 'epf_nps',   isManual: true },
  { symbol: 'PHYS-GOLD',     name: 'Physical Gold', type: 'gold',   isManual: true },
  { symbol: 'PHYS-SILVER',   name: 'Physical Silver', type: 'commodity', isManual: true },
  { symbol: 'PRIVATE-EQUITY',name: 'Private Equity', type: 'other', isManual: true },
  { symbol: 'UNLISTED-BOND', name: 'Unlisted Bond', type: 'bond',   isManual: true },
  { symbol: 'OTHER-ASSET',   name: 'Other', type: 'other',          isManual: true },
];

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

// Compact clickable chip: icon + short ticker + company name.
function SecurityChip({ s, onPick, dashed = false }) {
  const short = s.symbol.replace('.NS', '').replace('-USD', '').replace('=F', '');
  return (
    <button
      onMouseDown={() => onPick(s)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
        padding: '7px 9px', borderRadius: 'var(--radius-sm)',
        border: `1px ${dashed ? 'dashed' : 'solid'} var(--color-border)`,
        background: dashed ? 'transparent' : 'var(--color-bg-elevated)',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        boxShadow: dashed ? 'none' : 'var(--elev-ring)',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-hover)'; e.currentTarget.style.background = 'var(--color-bg-card-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = dashed ? 'transparent' : 'var(--color-bg-elevated)'; }}
    >
      <AssetIcon symbol={s.symbol} name={s.name} type={s.type} size={26} />
      <div style={{ minWidth: 0 }}>
        <div className="figure" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>{short}</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{s.name}</div>
      </div>
    </button>
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

  // Search when debounced query changes
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

  const showResults = query.trim().length > 0;

  const select = (security) => {
    setQuery('');
    setFocused(false);
    onSelect(security);
  };

  // Shared panel content (results or popular grid) — a render helper, not a
  // nested component, so it doesn't remount on every keystroke.
  const renderPanel = () => showResults ? (
    error ? (
      <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{error}</div>
    ) : results.length === 0 && !loading ? (
      <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No results for "{query}"</div>
    ) : (
      results.map(r => (
        <button key={r.symbol} onMouseDown={() => select(r)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left', transition: 'background 0.12s',
            borderBottom: '1px solid var(--color-border-subtle)'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
          <AssetIcon symbol={r.symbol} name={r.name} type={r.type} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span className="figure" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{r.symbol}</span>
              <TypeBadge type={r.type} />
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name}{r.exchange ? ` · ${r.exchange}` : ''}
            </span>
          </div>
        </button>
      ))
    )
  ) : (
    /* Popular securities — compact icon chips (icon + ticker + name) */
    <div style={{ padding: '14px 16px' }}>
      {Object.entries(POPULAR).map(([category, items]) => (
        <div key={category} style={{ marginBottom: 16 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>{category}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {items.map(s => <SecurityChip key={s.symbol} s={s} onPick={select} />)}
          </div>
        </div>
      ))}

      {/* Manual / Unlisted */}
      <div>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Manual / Unlisted</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {MANUAL.map(s => <SecurityChip key={s.symbol} s={s} onPick={select} dashed />)}
        </div>
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
          autoFocus={autoFocus}
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

      {/* Inline panel — caps its own height and scrolls internally so the
          surrounding modal stays fixed instead of growing. */}
      {inline && (
        <div style={{
          marginTop: 12,
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          maxHeight: 'min(52vh, 420px)',
          overflowY: 'auto',
        }}>
          {renderPanel()}
        </div>
      )}

      {/* Floating dropdown — portaled, always on top of the modal */}
      {!inline && (
        <Popover anchorRef={searchBoxRef} open={focused} onClose={() => setFocused(false)} maxHeight={440}>
          <div style={{
            background: 'var(--color-bg-popover)',
            border: '1px solid var(--color-border-hover)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-popover)',
          }}>
            {renderPanel()}
          </div>
        </Popover>
      )}
    </div>
  );
}
