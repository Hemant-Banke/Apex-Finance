import { useState, useEffect, useRef } from 'react';
import { marketAPI } from '../../lib/api';
import { Search, Loader2 } from 'lucide-react';

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
  const containerRef            = useRef(null);

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

  // Close on outside click (floating mode only)
  useEffect(() => {
    if (inline) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [inline]);

  const showPanel   = inline || focused || query.length > 0;
  const showResults = query.trim().length > 0;

  const select = (security) => {
    setQuery('');
    setFocused(false);
    onSelect(security);
  };

  // Shared panel content (results or popular grid)
  const PanelContent = () => showResults ? (
    error ? (
      <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{error}</div>
    ) : results.length === 0 && !loading ? (
      <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No results for "{query}"</div>
    ) : (
      results.map(r => (
        <button key={r.symbol} onMouseDown={() => select(r)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left', transition: 'background 0.12s',
            borderBottom: '1px solid var(--color-border-subtle)'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{r.symbol}</span>
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
    /* Popular securities grid */
    <div style={{ padding: '16px' }}>
      {Object.entries(POPULAR).map(([category, items]) => (
        <div key={category} style={{ marginBottom: 20 }}>
          <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            {category}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map(s => (
              <button key={s.symbol} onMouseDown={() => select(s)}
                style={{
                  padding: '5px 10px', borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)',
                  color: 'var(--color-text-secondary)', fontSize: '0.75rem', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
                {s.symbol.replace('.NS', '').replace('-USD', '').replace('=F', '')}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Manual / Unlisted */}
      <div>
        <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Manual / Unlisted
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {MANUAL.map(s => (
            <button key={s.symbol} onMouseDown={() => select(s)}
              style={{
                padding: '5px 10px', borderRadius: 'var(--radius-pill)',
                border: '1px dashed var(--color-border)', background: 'transparent',
                color: 'var(--color-text-muted)', fontSize: '0.75rem', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-hover)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}>
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={{ position: inline ? 'static' : 'relative' }}>
      {/* Search input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--color-bg-input)',
        border: `1px solid ${focused ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '10px 14px',
        boxShadow: focused ? '0 0 0 3px var(--color-accent-dim)' : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s'
      }}>
        {loading
          ? <Loader2 size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0, animation: 'spin 0.6s linear infinite' }} />
          : <Search size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
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
            color: 'var(--color-text-primary)', fontSize: '0.9rem', fontFamily: 'inherit'
          }}
        />
        {query && (
          <button onClick={() => setQuery('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>
            ×
          </button>
        )}
      </div>

      {/* Inline panel — renders in normal flow, no clipping */}
      {inline && (
        <div style={{
          marginTop: 12,
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
        }}>
          <PanelContent />
        </div>
      )}

      {/* Floating dropdown — for standalone use outside modals */}
      {!inline && showPanel && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 100,
          background: 'var(--color-bg-modal)',
          border: '1px solid var(--color-border-hover)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          maxHeight: 420, overflowY: 'auto'
        }}>
          <PanelContent />
        </div>
      )}
    </div>
  );
}
