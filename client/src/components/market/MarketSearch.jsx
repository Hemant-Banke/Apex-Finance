import { useState, useEffect, useRef } from 'react';
import { marketAPI, dashboardAPI } from '../../lib/api';
import { Search, Loader2, X } from 'lucide-react';
import AssetIcon from './AssetIcon';
import Popover from '../ui/Popover';
import { formatNativeCurrency, formatCount } from '../../lib/utils';
import { isSelfPricedHolding } from '../../lib/constants';

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

// The board shown ahead of POPULAR in `browse` mode (the Markets page), where the point
// is to LOOK at an instrument rather than book a trade in it: the indices — which no one
// can buy, so the asset form never lists them — and the domestic metal prices.
const BROWSE = {
  'Indices': [
    { symbol: '^NSEI',             name: 'Nifty 50',         type: 'index' },
    { symbol: '^BSESN',            name: 'Sensex',           type: 'index' },
    { symbol: '^NSEBANK',          name: 'Nifty Bank',       type: 'index' },
    { symbol: 'NIFTYMIDCAP150.NS', name: 'Nifty Midcap 150', type: 'index' },
    { symbol: '^GSPC',             name: 'S&P 500',          type: 'index' },
    { symbol: '^IXIC',             name: 'Nasdaq Composite', type: 'index' },
  ],
  'Metals & currency': [
    { symbol: '_METAL:gold',   name: 'Gold (₹/g)',   type: 'gold' },
    { symbol: '_METAL:silver', name: 'Silver (₹/g)', type: 'silver' },
    { symbol: 'USDINR=X',      name: 'US dollar',    type: 'currency' },
  ],
};
const BROWSE_ITEMS = Object.values(BROWSE).flat();

/** Board entries whose name or ticker carries every typed token ("gold" → Gold ₹/g). */
function matchBrowse(q) {
  const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return BROWSE_ITEMS.filter(b => toks.every(t => `${b.name} ${b.symbol}`.toLowerCase().includes(t)));
}

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

/**
 * A holding the user already owns, as a pickable security.
 *
 * `owned` is what tells the form the instrument already EXISTS: a manual asset reached
 * this way must not re-ask for its name and type, because it has them — re-typing
 * "Wedding Gold" a second time creates `WEDDING-GOLD` all over again as far as the user
 * is concerned, and a single character off ("Wedding gold ") would have split one asset
 * into two. Its valuation metadata rides along for the same reason: purity, rate and
 * quote currency are facts about the asset, not about the trade being recorded.
 */
const ownedToSecurity = (h) => ({
  symbol:   h.symbol,
  name:     h.name || h.symbol,
  type:     h.type || 'other',
  currency: h.currency || '',
  purity:   h.purity || '',
  rate:     h.rate,
  owned:    true,
  qty:      h.qty,
  isManual: isSelfPricedHolding(h),
});

/**
 * The user's own holdings, matched locally.
 *
 * A manual asset is not in any index in the world — it exists only on this user's own
 * books — so "search for it and add more to it" cannot be a market query. It is also the
 * one set small enough to filter in the browser, which makes it the only part of this
 * panel that answers instantly and cannot fail.
 *
 * Every token must appear somewhere in the name or the symbol, so "wedding gold" finds
 * `Wedding Gold` and a half-typed "wedd" finds it too.
 */
// Grouped and trimmed ("11,833.94 units"); fractional crypto keeps four places.
const qtyLabel = (n) => `${formatCount(n, Math.abs(n) < 10 ? 4 : 2)} units`;

function matchOwned(holdings, q) {
  const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return holdings.filter(h => {
    const hay = `${h.name || ''} ${h.symbol || ''}`.toLowerCase();
    return toks.every(t => hay.includes(t));
  });
}

// Short, quiet type tags — one neutral chip, never a hue per type.
const TYPE_TAGS = { mutual_fund: 'Fund', epf_nps: 'EPF / NPS', fd: 'FD', index: 'Index', currency: 'FX' };

function TypeBadge({ type }) {
  return <span className="search-tag">{TYPE_TAGS[type] || (type || 'other').replace('_', ' ')}</span>;
}

// A board entry: icon, name, and a ticker or what you hold beneath. A quiet row that lifts on hover.
function SecurityChip({ s, onPick, sub }) {
  const short = s.symbol.startsWith('_METAL:') ? 'Domestic price' : s.symbol.replace('.NS', '').replace('-USD', '').replace('=F', '');
  return (
    <button type="button" className="search-chip" onMouseDown={() => onPick(s)} title={s.name}>
      <AssetIcon symbol={s.symbol} name={s.name} type={s.type} size={30} />
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="search-chip-name">{s.name}</span>
        <span className="figure" style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub || short}</span>
      </span>
    </button>
  );
}

function GroupHeader({ label, count }) {
  return (
    <div className="search-group-head">
      <span className="col-head">{label}</span>
      {count != null && <span className="figure" style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>{count}</span>}
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
 * It searches TWO things, and the user's own book comes first. An asset you named
 * yourself — "Wedding Gold", "Mumbai Apartment", an FD — is not listed anywhere on
 * earth, so a market query can never find it; adding a second contribution to it meant
 * starting from the manual catalogue again and retyping the name EXACTLY, and a stray
 * character silently created a second asset that split the position in two. Your
 * holdings are matched locally, appear under their own heading above the market hits,
 * and are on the board before you type a thing.
 *
 * A symbol you own that the market also lists (AAPL, an AMFI fund) appears ONCE, as the
 * owned row: it is the same instrument, and the owned row is the one carrying what you
 * hold and how it is valued.
 *
 * Props:
 *   onSelect(security) — called with { symbol, name, type, exchange?, isManual?, owned? }
 *   placeholder        — input placeholder text
 *   autoFocus          — focus input on mount
 *   inline             — render suggestions in normal flow (use inside modals/panels)
 *   filter(security)   — keep only securities passing it, in EVERY group (holdings,
 *                        popular board, market hits); manual assets are offered only
 *                        when there is no filter. The Markets page passes "NSE-listed
 *                        equity", since only those have a company page.
 *   size               — 'md' (default, the dialog's command-palette field) | 'sm'
 *                        (a page-header field)
 *   panelWidth         — results panel width when it should be wider than the field
 *   browse             — Markets: searching to VIEW, not to trade. Market indices are
 *                        included and an Indices / Metals board leads the popular one.
 */
export default function MarketSearch({
  onSelect, placeholder = 'Search your holdings, stocks, ETFs, crypto, funds…', autoFocus = true, inline = true,
  filter = null, size = 'md', panelWidth, browse = false,
}) {
  const keep = filter || (() => true);
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [owned, setOwned]       = useState([]);
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

  // The user's own book, fetched once per mount — which is once per opening of the
  // dialog, so the quantities are always current. Deliberately not cached at module
  // level: it goes stale the moment a trade is recorded, and it is a small array.
  // A failure here is silent; the market half of the panel still works.
  useEffect(() => {
    let cancelled = false;
    dashboardAPI.getHoldings()
      .then(r => {
        if (cancelled) return;
        // Biggest position first, so the board opens on what you actually own most of.
        setOwned([...(r.data || [])].sort((a, b) => (b.totalInvested || 0) - (a.totalInvested || 0)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Search when debounced query changes — a data-fetching effect that owns the
  // results/loading/error state, so the synchronous resets here are intentional.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!debouncedQ.trim()) { setResults([]); setError(''); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    marketAPI.search(debouncedQ, browse)
      .then(r => { if (!cancelled) setResults(r.data || []); })
      .catch(() => { if (!cancelled) setError('Search unavailable'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ, browse]);
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
    const manualMatches = filter ? [] : matchManual(query);
    const ownedMatches  = matchOwned(owned, query).filter(h => keep(ownedToSecurity(h)));
    // A symbol you own that the market also lists is ONE instrument, and the owned row
    // is the one that knows what you hold — so the market's copy of it goes.
    const ownedSymbols  = new Set(ownedMatches.map(h => h.symbol));
    // In browse mode the board's own entries answer first — Yahoo has no "domestic gold
    // per gram", and its index hits come back named in capitals ("NIFTY 50").
    const boardMatches  = browse ? matchBrowse(query).filter(keep) : [];
    const boardSymbols  = new Set(boardMatches.map(b => b.symbol));
    const marketResults = [
      ...boardMatches,
      ...results.filter(r => !ownedSymbols.has(r.symbol) && !boardSymbols.has(r.symbol) && keep(r)),
    ];

    const nothing = marketResults.length === 0 && manualMatches.length === 0 && ownedMatches.length === 0;
    if (error && nothing) {
      return <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{error}</div>;
    }
    if (!loading && nothing) {
      return <div style={{ padding: '16px 20px', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No results for "{query}"</div>;
    }
    // When we also surface a manual option, drop one live result so the list
    // doesn't overflow into a scroll.
    const shown = manualMatches.length ? marketResults.slice(0, Math.max(0, marketResults.length - 1)) : marketResults;
    return (
      <div style={{ padding: 6 }}>

        {/* Your own book, first. What you already hold is the likeliest thing you mean
            — and for an asset you named yourself it is the ONLY place it exists. */}
        {ownedMatches.length > 0 && (
          <>
            <GroupHeader label="In your portfolio" count={ownedMatches.length} />
            {ownedMatches.map(h => (
              <button key={`own-${h.symbol}`} onMouseDown={() => select(ownedToSecurity(h))}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 10px', border: 'none', cursor: 'pointer',
                  textAlign: 'left', borderRadius: 'var(--radius-sm)',
                }}
                className="search-row">
                <AssetIcon symbol={h.symbol} name={h.name} type={h.type} size={34} />
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
                  <span style={{
                    fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)',
                    minWidth: 0, lineHeight: 1.35,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', overflowWrap: 'anywhere',
                  }}>{h.name}</span>
                  {/* What you hold, not what it is worth: this is the "add more to it"
                      path, and the quantity is what tells you it is the right one. */}
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    <span className="figure">{qtyLabel(h.qty)}</span>
                    {!isSelfPricedHolding(h) && <> · <span className="figure">{h.symbol}</span></>}
                  </span>
                </div>
                <span style={{ flexShrink: 0, marginTop: 2 }}><TypeBadge type={h.type} /></span>
              </button>
            ))}
          </>
        )}

        {ownedMatches.length > 0 && shown.length > 0 && <GroupHeader label="Markets" count={shown.length} />}
        {shown.map(r => (
          <button key={r.symbol} onMouseDown={() => select(r)}
            style={{
              width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '9px 10px', border: 'none', cursor: 'pointer',
              textAlign: 'left', borderRadius: 'var(--radius-sm)',
            }}
            className="search-row">
            <AssetIcon symbol={r.symbol} name={r.name} type={r.type} size={34} />
            {/* Name leads — it is what the user is actually looking for; the ticker
                is the reference, so it sits beneath in the mono figure face.
                A fund's full plan name runs long ("… - Direct Plan - Growth Option"),
                so it WRAPS to a second line rather than being clipped to a stub that
                hides the very part that distinguishes one plan from another. */}
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
              <span style={{
                fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)',
                minWidth: 0, lineHeight: 1.35,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', overflowWrap: 'anywhere',
              }}>{r.name}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className="figure">{r.symbol.startsWith("_METAL:") ? "Domestic price" : r.symbol}</span>{r.exchange ? ` · ${r.exchange}` : ''}
                {/* Same-named fund plans (Direct/Regular, Growth/IDCW) are only
                    distinguishable by NAV — Yahoo exposes the plan nowhere. */}
                {r.nav != null && (
                  <> · NAV <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatNativeCurrency(r.nav, r.navCurrency)}
                  </span></>
                )}
              </span>
            </div>

            {/* Type tag pinned to the right edge, clear of the wrapping name. */}
            <span style={{ flexShrink: 0, marginTop: 2 }}>
              <TypeBadge type={r.type} />
            </span>
          </button>
        ))}

        {/* Manual / unlisted matches for the query (e.g. "house" → Real Estate) */}
        {manualMatches.length > 0 && (
          <>
            <GroupHeader label="Add manually" />
            {manualMatches.map(m => (
              <button key={m.symbol} onMouseDown={() => select(m)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 10px', border: 'none', cursor: 'pointer',
                  textAlign: 'left', borderRadius: 'var(--radius-sm)',
                }}
                className="search-row">
                <AssetIcon symbol={m.symbol} name={m.name} type={m.type} size={34} />
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.name}</span>
                    <span className="search-tag">Manual</span>
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

  // The pre-typing board, through the same filter as the results.
  const ownedBoard = owned.filter(h => keep(ownedToSecurity(h)));
  const popularBoard = Object.entries(browse ? { ...BROWSE, ...POPULAR } : POPULAR)
    .map(([category, items]) => [category, items.filter(keep)])
    .filter(([, items]) => items.length);

  const renderPanel = () => showResults ? renderResults() : (
    // The board before typing: your holdings first, then the popular markets, then manual assets.
    <div style={{ padding: '4px 2px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Adding to something you already own is the commonest reason this opens, and for a
          manual asset it is the only route that does not mean retyping its name exactly. */}
      {ownedBoard.length > 0 && (
        <section>
          <GroupHeader label="Your holdings" count={ownedBoard.length > 8 ? `8 of ${ownedBoard.length}` : undefined} />
          <div className="search-board">
            {ownedBoard.slice(0, 8).map(h => (
              <SecurityChip key={`own-${h.symbol}`} s={ownedToSecurity(h)} onPick={select} sub={qtyLabel(h.qty)} />
            ))}
          </div>
        </section>
      )}

      {popularBoard.map(([category, items]) => (
        <section key={category}>
          <GroupHeader label={category.replace(/^Popular /, '')} />
          <div className="search-board">
            {items.map(s => <SecurityChip key={s.symbol} s={s} onPick={select} />)}
          </div>
        </section>
      ))}

      {!filter && (
        <section>
          <GroupHeader label="Manual · priced by you" />
          <div className="search-board">
            {MANUAL.map(s => <SecurityChip key={s.symbol} s={s} onPick={select} sub="Self-priced" />)}
          </div>
        </section>
      )}
    </div>
  );
  const sm = size === 'sm';

  return (
    <div style={{ position: inline ? 'static' : 'relative' }}>
      {/* Search input — command-palette style. Focus lifts the field; it is never gold. */}
      <div ref={searchBoxRef} className={`search-field${sm ? ' is-sm' : ''}${focused ? ' is-focused' : ''}`}>
        {loading
          ? <Loader2 size={sm ? 14 : 17} style={{ color: 'var(--color-text-secondary)', flexShrink: 0, animation: 'spin 0.6s linear infinite' }} />
          : <Search size={sm ? 14 : 17} style={{ color: focused ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', flexShrink: 0, transition: 'color 0.2s' }} />
        }
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => inline && setFocused(false)}
          placeholder={placeholder}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            color: 'var(--color-text-primary)', fontSize: sm ? '0.875rem' : '1rem', fontFamily: 'inherit'
          }}
        />
        {query && (
          <button type="button" className="search-clear" onMouseDown={e => { e.preventDefault(); setQuery(''); inputRef.current?.focus(); }}
            aria-label="Clear search" title="Clear">
            <X size={12} strokeWidth={2.25} />
          </button>
        )}
      </div>

      {/* Inline panel — flows directly beneath the search field (no detached
          block) so it reads as part of the dialog. Caps its own height and
          scrolls internally so the surrounding modal stays fixed. */}
      {inline && (
        <div className="search-panel">
          {renderPanel()}
        </div>
      )}

      {/* Floating dropdown — portaled, always on top of the modal. The Popover
          panel supplies the surface (bg + border + radius + shadow). */}
      {!inline && (
        <Popover anchorRef={searchBoxRef} open={focused} onClose={() => setFocused(false)} maxHeight={480} width={panelWidth}>
          {renderPanel()}
        </Popover>
      )}
    </div>
  );
}
