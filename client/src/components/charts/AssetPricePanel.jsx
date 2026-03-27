import { useState, useCallback } from 'react';
import { marketAPI } from '../../lib/api';
import PriceGrapher from './PriceGrapher';

// Symbols that cannot be fetched from Yahoo Finance (manual / unlisted assets)
const MANUAL_PREFIXES = ['REAL-', 'FIXED-', 'EPF-', 'PHYS-', 'PRIVATE-', 'UNLISTED-', 'OTHER-'];
const isManualAsset = (symbol) => MANUAL_PREFIXES.some(p => symbol?.startsWith(p));

const PRICE_RANGES = [
  { label: '1D',  days: 2   },
  { label: '1W',  days: 7   },
  { label: '1M',  days: 30  },
  { label: '3M',  days: 90  },
  { label: '1Y',  days: 365 },
  { label: 'Max', days: null },
];

function formatPrice(v) {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) >= 1_00_000) return `₹${(v / 1_00_000).toFixed(2)}L`;
  if (Math.abs(v) >= 1_000)    return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  return `₹${v.toFixed(2)}`;
}

/**
 * Renders a PriceGrapher (with candlestick toggle) for a selectable holding.
 *
 * Props:
 *   holdings  — array of {symbol, name, type, qty}
 *   title     — section heading (default: "Asset Prices")
 *   height    — chart height (default: 280)
 */
export default function AssetPricePanel({ holdings = [], title = 'Asset Prices', height = 280 }) {
  const tradeable = holdings.filter(h => h.qty !== 0 && !isManualAsset(h.symbol));
  const [selected, setSelected] = useState(null);

  const activeSymbol  = selected ?? tradeable[0]?.symbol ?? null;
  const activeHolding = tradeable.find(h => h.symbol === activeSymbol);

  const fetchPrice = useCallback(
    (days) => marketAPI.ohlc(activeSymbol, days).then(r =>
      r.data.candles.map(c => ({ date: c.date, value: c.close }))
    ),
    [activeSymbol]
  );

  const fetchOHLC = useCallback(
    (days) => marketAPI.ohlc(activeSymbol, days).then(r => r.data.candles),
    [activeSymbol]
  );

  if (!tradeable.length) return null;

  return (
    <div>
      {/* Section header with symbol picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <p className="heading-sm">{title}</p>
        {tradeable.length > 1 && (
          <div className="pill-group" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tradeable.slice(0, 10).map(h => (
              <button
                key={h.symbol}
                onClick={() => setSelected(h.symbol)}
                className={`pill-item${activeSymbol === h.symbol ? ' active' : ''}`}
                style={{ fontSize: 11, padding: '3px 9px' }}
              >
                {h.symbol}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeSymbol && (
        <PriceGrapher
          key={activeSymbol}
          fetchData={fetchPrice}
          fetchOHLC={fetchOHLC}
          title={activeHolding?.name || activeSymbol}
          valueLabel="Price"
          formatValue={formatPrice}
          height={height}
          ranges={PRICE_RANGES}
          defaultRange="1M"
          emptyText="No price data available for this asset"
        />
      )}
    </div>
  );
}
