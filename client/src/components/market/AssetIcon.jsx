import { useState } from 'react';

/**
 * AssetIcon — a company/instrument avatar for the asset picker.
 *
 * Shows the real company logo when we can resolve a domain (via Clearbit),
 * and gracefully falls back to a tinted monogram disc otherwise — so it always
 * renders something clean, never a broken image.
 */

// Type → accent tint for the monogram fallback.
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

// Known ticker → brand domain (for real logos on the common names).
const DOMAINS = {
  'AAPL': 'apple.com', 'MSFT': 'microsoft.com', 'GOOGL': 'abc.xyz', 'AMZN': 'amazon.com',
  'TSLA': 'tesla.com', 'NVDA': 'nvidia.com', 'META': 'meta.com', 'NFLX': 'netflix.com',
  'SPY': 'ssga.com', 'QQQ': 'invesco.com', 'VTI': 'vanguard.com',
  'RELIANCE.NS': 'ril.com', 'TCS.NS': 'tcs.com', 'INFY.NS': 'infosys.com',
  'HDFCBANK.NS': 'hdfcbank.com', 'ICICIBANK.NS': 'icicibank.com', 'WIPRO.NS': 'wipro.com',
  'BTC-USD': 'bitcoin.org', 'ETH-USD': 'ethereum.org', 'SOL-USD': 'solana.com', 'BNB-USD': 'binance.com',
};

function monogram(symbol, name) {
  const base = (name || symbol || '?').replace(/[^A-Za-z0-9 ]/g, '').trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase() || '?';
}

export default function AssetIcon({ symbol, name, type = 'other', size = 34 }) {
  const domain = DOMAINS[symbol];
  const [broken, setBroken] = useState(false);
  const tint = TYPE_TINT[type] || TYPE_TINT.other;

  const shell = {
    width: size, height: size, flexShrink: 0,
    borderRadius: 9,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--elev-ring)',
  };

  if (domain && !broken) {
    return (
      <div style={{ ...shell, background: '#fff' }}>
        <img
          src={`https://logo.clearbit.com/${domain}?size=64`}
          alt=""
          width={size} height={size}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }}
        />
      </div>
    );
  }

  return (
    <div style={{
      ...shell,
      background: `color-mix(in srgb, ${tint} 16%, var(--color-bg-elevated))`,
      color: tint,
      fontSize: size * 0.36,
      fontWeight: 700,
      letterSpacing: '-0.02em',
    }}>
      {monogram(symbol, name)}
    </div>
  );
}
