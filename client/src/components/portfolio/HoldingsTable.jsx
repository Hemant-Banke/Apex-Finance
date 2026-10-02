import { useState } from 'react';
import AssetIcon from '../market/AssetIcon';
import HoldingLink from './HoldingLink';
import Delta from '../ui/Delta';
import SellButton from './SellButton';
import ShowMore from '../ui/ShowMore';
import { formatCurrency, formatNativeCurrency, compactIfLarge, formatPct, pnlColor } from '../../lib/utils';
import { assetTypeLabel } from '../../lib/constants';

/**
 * The holdings book, marked to market — the table this app never had.
 *
 * Every column but the first is a figure, so the whole grid is right-aligned in the mono
 * face and the eye can compare down a column. Sorting is client-side: the whole book is
 * already here, and a round-trip to re-order twenty rows would be absurd.
 *
 * A row whose price could not be fetched (`priced: false`) is marked. Its "value" is its
 * cost basis, so its P&L is exactly zero — which would otherwise read as "this holding
 * has gone nowhere" rather than "we do not know what this is worth".
 *
 * `onSell` is optional. Given one, each row grows a hover-revealed Sell action — the
 * book is where you decide to sell, and until now the decision and the action lived on
 * different pages. Omit it and the table stays exactly as read-only as it was.
 */

const COLUMNS = [
  { key: 'name',          label: 'Holding',  align: 'left'  },
  { key: 'qty',           label: 'Qty',      align: 'right' },
  { key: 'avgCostPerUnit',label: 'Avg cost', align: 'right' },
  { key: 'price',         label: 'Price',    align: 'right' },
  { key: 'value',         label: 'Value',    align: 'right' },
  { key: 'dayChange',     label: 'Day',      align: 'right' },
  { key: 'unrealisedPnl', label: 'P&L',      align: 'right' },
  { key: 'weight',        label: 'Weight',   align: 'right' },
];

export default function HoldingsTable({ holdings = [], onSell }) {
  const [sort, setSort] = useState({ key: 'value', dir: -1 });

  if (!holdings.length) return null;

  const rows = [...holdings].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (typeof av === 'string') return sort.dir * av.localeCompare(bv);
    return sort.dir * ((av ?? 0) - (bv ?? 0));
  });

  const toggle = (key) =>
    setSort(s => ({ key, dir: s.key === key ? -s.dir : -1 }));

  const cell = { padding: '12px 14px', whiteSpace: 'nowrap' };

  // The largest eight positions open (by whatever the table is sorted on); a long book
  // keeps the rest behind the toggle, beneath the table rather than inside it.
  return (
    <ShowMore items={rows} initial={8} noun="holdings"
      // The table sits in a flush card, so the toggle supplies the card's own 24px gutter
      // itself — full width inside it, exactly as in a padded card (Contributions). Not
      // `width: auto`: a <button> shrinks to its label rather than stretching.
      toggleStyle={{ width: 'calc(100% - 48px)', margin: '10px 24px 16px' }}
      wrap={(body) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
        <thead>
          <tr>
            {COLUMNS.map(c => (
              <th
                key={c.key}
                onClick={() => toggle(c.key)}
                className="heading-sm"
                style={{
                  ...cell,
                  textAlign: c.align,
                  cursor: 'pointer',
                  userSelect: 'none',
                  fontSize: '0.6875rem',
                  letterSpacing: '0.08em',
                  borderBottom: '1px solid var(--color-border-subtle)',
                  color: sort.key === c.key ? 'var(--color-accent)' : undefined,
                }}
              >
                {c.label}
                {sort.key === c.key && (sort.dir < 0 ? ' ↓' : ' ↑')}
              </th>
            ))}
            {onSell && <th style={{ ...cell, width: 1 }} />}
          </tr>
        </thead>

        <tbody>{body}</tbody>
      </table>
    </div>
    )} render={(h) => (
            <tr key={h.symbol} className="table-row group" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
              {/* Identity: the name leads, the ticker is the quieter reference beneath. */}
              <td style={{ ...cell, maxWidth: 260 }}>
                <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                  <AssetIcon symbol={h.symbol} type={h.type} size={26} />
                  <div style={{ minWidth: 0 }}>
                    <p className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {/* Anything with a market opens its page — an Indian listed stock its
                          company page, every other quoted holding (a fund, a coin, physical
                          gold → the gold price) the asset page. An FD has no market. */}
                      <HoldingLink h={h}>{h.name}</HoldingLink>
                    </p>
                    <p className="figure text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {h.symbol} · {assetTypeLabel(h.type)}
                      {!h.priced && ' · at cost'}
                    </p>
                  </div>
                </div>
              </td>

              <td className="figure text-sm" style={{ ...cell, textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                {+h.qty.toFixed(4)}
              </td>

              {/*
                Avg cost leads in INR because the PRICE column beside it is INR, and the
                two only mean anything read against each other. Showing "$185" next to
                "₹30,072" invited reading a 160× gain off a stock that is up 76%.
                The native figure — what the exchange actually charged — sits beneath.
              */}
              <td style={{ ...cell, textAlign: 'right' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                  <span className="figure text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatCurrency(h.avgCostPerUnit)}
                  </span>
                  {h.currency && h.currency !== 'INR' && (
                    <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {formatNativeCurrency(h.avgCostPerUnitNative, h.currency)}
                    </span>
                  )}
                </div>
              </td>

              <td className="figure text-sm" style={{ ...cell, textAlign: 'right', color: 'var(--color-text-primary)' }}>
                {formatCurrency(h.price)}
              </td>

              <td className="figure text-sm" style={{ ...cell, textAlign: 'right', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                {compactIfLarge(h.value)}
              </td>

              <td style={{ ...cell, textAlign: 'right' }}>
                {h.priced
                  ? <Delta value={h.dayChange} pct={h.dayChangePct} amount={false} />
                  : <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>—</span>}
              </td>

              <td style={{ ...cell, textAlign: 'right' }}>
                {h.priced
                  ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      <span className="figure text-sm" style={{ color: pnlColor(h.unrealisedPnl), fontWeight: 500 }}>
                        {compactIfLarge(h.unrealisedPnl)}
                      </span>
                      <span className="figure text-xs" style={{ color: pnlColor(h.unrealisedPnl), opacity: 0.75 }}>
                        {formatPct(h.unrealisedPnlPct, 1)}
                      </span>
                    </div>
                  : <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>no quote</span>}
              </td>

              <td className="figure text-sm" style={{ ...cell, textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                {h.weight.toFixed(1)}%
              </td>

              {onSell && (
                <td style={{ ...cell, textAlign: 'right', paddingLeft: 0 }}>
                  <SellButton onClick={() => onSell(h)} title={`Sell ${h.name}`} />
                </td>
              )}
            </tr>
    )} />
  );
}
