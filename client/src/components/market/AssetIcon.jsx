import { useState } from 'react';

/**
 * AssetIcon — an instrument avatar for the asset picker.
 *
 * Shows the real brand logo via logo.dev when we can resolve a domain, and
 * gracefully falls back to a themed emoji glyph (per-symbol store → asset-type)
 * otherwise — so it always renders something clean, never a broken image.
 *
 * logo.dev needs a publishable token in `VITE_LOGODEV_TOKEN`; without it we skip
 * straight to the emoji glyph.
 */

const LOGODEV_TOKEN = import.meta.env.VITE_LOGODEV_TOKEN;

// Type → accent tint for the disc background.
const TYPE_TINT = {
  stock:       '#C9A96A',
  etf:         '#e78a5c',
  crypto:      '#a78bfa',
  mutual_fund: '#60a5fa',
  bond:        '#3fbf9a',
  commodity:   '#e0b64b',
  gold:        '#e0b64b',
  fd:          '#3fbf9a',
  epf_nps:     '#60a5fa',
  other:       '#8ea0b8',
};

// Asset type → emoji (the fallback for any symbol without a logo).
const TYPE_EMOJI = {
  stock:       '📈',
  etf:         '🧺',
  mutual_fund: '📊',
  crypto:      '🪙',
  bond:        '📜',
  commodity:   '🛢️',
  gold:        '🥇',
  fd:          '🏦',
  epf_nps:     '🛡️',
  other:       '💠',
};

// Curated per-symbol store — recognizable glyphs for the assets we surface most
// (popular commodities, crypto, and every manual / unlisted option).
const SYMBOL_EMOJI = {
  'BTC-USD': '🟠', 'ETH-USD': '🔷', 'SOL-USD': '🟣', 'BNB-USD': '🟡',
  'GC=F': '🥇', 'SI=F': '🥈', 'CL=F': '🛢️',
  'REAL-ESTATE': '🏠', 'FIXED-DEPOSIT': '🏦', 'EPF-NPS': '🛡️',
  'PHYS-GOLD': '🥇', 'PHYS-SILVER': '🥈', 'PRIVATE-EQUITY': '📊',
  'UNLISTED-BOND': '📜', 'OTHER-ASSET': '💠',
};

// Equity-like assets resolve on logo.dev's /ticker endpoint; crypto has its own
// /crypto endpoint. Everything else (commodity / manual) falls to the emoji.
const TICKER_TYPES = new Set(['stock', 'etf', 'mutual_fund', 'bond']);

// Build a logo.dev URL for a symbol per its docs:
//   stocks/ETFs → /ticker/:symbol   (kept whole incl. exchange suffix, e.g.
//                 `RELIANCE.NS` — logo.dev resolves Indian tickers by `.NS`)
//   crypto      → /crypto/:symbol   (lowercase, quote suffix like `-USD` stripped)
// fallback=404 → logo.dev 404s (instead of a generic placeholder) when it has no
// logo, so `onError` fires and we drop to the themed emoji glyph.
function logoSrc(symbol, type, px) {
  if (!LOGODEV_TOKEN || !symbol) return null;
  const q = `token=${LOGODEV_TOKEN}&size=${px}&format=png&fallback=404`;
  if (type === 'crypto') {
    const coin = symbol.replace(/-USDT?$/i, '').trim().toLowerCase();
    if (coin) return `https://img.logo.dev/crypto/${encodeURIComponent(coin)}?${q}`;
  }
  if (TICKER_TYPES.has(type)) {
    const ticker = symbol.trim();
    if (ticker) return `https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?${q}`;
  }
  return null;
}

export default function AssetIcon({ symbol, type = 'other', size = 34 }) {
  // Track the symbol whose logo failed (rather than a bare boolean) so switching
  // to a new symbol re-attempts its logo without a stale "broken" state.
  const [failedSym, setFailedSym] = useState(null);
  const tint = TYPE_TINT[type] || TYPE_TINT.other;
  const src  = logoSrc(symbol, type, Math.round(size * 2));

  const shell = {
    width: size, height: size, flexShrink: 0,
    borderRadius: 9,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--elev-ring)',
  };

  if (src && failedSym !== symbol) {
    return (
      <div style={{ ...shell, background: '#fff' }}>
        <img
          src={src}
          alt=""
          width={size} height={size}
          onError={() => setFailedSym(symbol)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }}
        />
      </div>
    );
  }

  const glyph = SYMBOL_EMOJI[symbol] || TYPE_EMOJI[type] || TYPE_EMOJI.other;
  return (
    <div
      aria-hidden="true"
      style={{
        ...shell,
        background: `color-mix(in srgb, ${tint} 14%, var(--color-bg-elevated))`,
        fontSize: Math.round(size * 0.5),
      }}
    >
      {glyph}
    </div>
  );
}
