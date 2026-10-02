import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AssetIcon from '../market/AssetIcon';
import HoldingLink from './HoldingLink';
import SellButton from './SellButton';
import Delta from '../ui/Delta';
import ShowMore from '../ui/ShowMore';
import {
  formatCurrency, formatNativeCurrency, compactIfLarge, formatPct, formatSigned, formatCount, formatDate, pnlColor,
} from '../../lib/utils';
import { assetTypeLabel, isSelfPricedHolding } from '../../lib/constants';

const gridOf = (sell) => `minmax(0, 1.5fr) minmax(110px, 1.5fr) 104px 92px 74px ${sell ? '86px' : '18px'}`;
// `key: null` is a label only: the bar is drawn from value, which Value already sorts.
const COLS = [
  { key: 'name',             label: 'Holding' },
  { key: null,               label: 'Size · gain', hint: 'Length is the position\'s size. Grey is cost; green past it is gain, red short of it is loss.' },
  { key: 'value',            label: 'Value',  align: 'right' },
  { key: 'unrealisedPnlPct', label: 'Return', align: 'right' },
  { key: 'dayChangePct',     label: '1D',     align: 'right' },
];

// A ticker where there is one; a fund code or a self-named asset says nothing, so its type instead.
const referenceOf = (h) => (h.symbol?.startsWith('AMFI:') || isSelfPricedHolding(h) ? assetTypeLabel(h.type) : h.symbol);

const NEUTRAL = 'color-mix(in srgb, var(--color-text-muted) 45%, var(--color-bg-elevated))';

/** Size and gain in one bar: cost in neutral, gain extending past it in green, a loss as the red gap short of it. */
function GainBar({ h, scale }) {
  const value = Math.abs(h.value), cost = Math.abs(h.invested);
  const pct = (x) => `${scale ? (x / scale) * 100 : 0}%`;
  const base = h.priced ? Math.min(value, cost) : cost;
  const gain = h.priced && value > cost ? value - cost : 0;
  const loss = h.priced && cost > value ? cost - value : 0;
  return (
    <div style={{ height: 8, borderRadius: 99, background: 'var(--color-bg-elevated)', display: 'flex', overflow: 'hidden' }}>
      <span style={{ width: pct(base), background: NEUTRAL }} />
      {gain > 0 && <span style={{ width: pct(gain), background: 'var(--color-success)', marginLeft: 1 }} />}
      {loss > 0 && <span style={{ width: pct(loss), background: 'color-mix(in srgb, var(--color-danger) 55%, var(--color-bg-elevated))', marginLeft: 1 }} />}
    </div>
  );
}

function Stat({ label, children, color, sub, plain = false }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className="col-head" style={{ marginBottom: 5 }}>{label}</p>
      <p className={plain ? 'text-sm' : 'figure text-sm'} style={{ color: color || 'var(--color-text-primary)' }}>{children}</p>
      {sub && <p className="figure" style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

/**
 * The holdings book, marked to market — shared by Analytics and an account's page.
 * One quiet line per position (size and gain drawn, value, return, today); the full
 * numbers open beneath a row on click. `onSell` adds the hover Sell action; `accountNames`
 * (id → name) names where a position is held when it spans accounts.
 */
export default function HoldingsBook({ holdings = [], onSell, accountNames, initial = 8 }) {
  const [sort, setSort] = useState({ key: 'value', dir: -1 });
  const [open, setOpen] = useState(null);
  if (!holdings.length) return null;

  const rows = [...holdings].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (typeof av === 'string') return sort.dir * av.localeCompare(bv);
    return sort.dir * ((av ?? 0) - (bv ?? 0));
  });
  const scale = Math.max(...holdings.map(h => Math.max(Math.abs(h.value), Math.abs(h.invested))));
  const grid = gridOf(!!onSell);
  const toggleSort = (key) => setSort(s => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, padding: '0 24px 10px', alignItems: 'end' }}>
        {COLS.map(c => {
          const on = c.key && sort.key === c.key;
          return (
            <button key={c.label} type="button" onClick={c.key ? () => toggleSort(c.key) : undefined} title={c.hint}
              className="col-head"
              style={{
                textAlign: c.align || 'left', background: 'none', border: 'none', padding: 0,
                cursor: c.key ? 'pointer' : 'help', color: on ? 'var(--color-accent)' : undefined,
              }}>
              {c.label}{on ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
            </button>
          );
        })}
        <span />
      </div>

      <ShowMore items={rows} initial={initial} noun="holdings"
        toggleStyle={{ width: 'calc(100% - 48px)', margin: '10px 24px 16px' }}
        render={(h) => {
          const expanded = open === h.symbol;
          const short = h.qty < 0;
          return (
            <div key={h.symbol} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <div className="table-row group" role="button" tabIndex={0} aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : h.symbol)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(expanded ? null : h.symbol); } }}
                style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, alignItems: 'center', padding: '12px 24px', cursor: 'pointer' }}>

                <div className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
                  <AssetIcon symbol={h.symbol} name={h.name} type={h.type} size={28} />
                  <div style={{ minWidth: 0 }}>
                    {/* Two lines: a fund plan's distinguishing words are at the END of its name. */}
                    <p className="text-sm" title={h.name} style={{
                      color: 'var(--color-text-primary)', display: '-webkit-box', WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3,
                    }}>
                      <span onClick={e => e.stopPropagation()}><HoldingLink h={h}>{h.name}</HoldingLink></span>
                    </p>
                    <p className="figure truncate" style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {referenceOf(h)}{short && ' · short'}{!h.priced && ' · at cost'}
                    </p>
                  </div>
                </div>

                <GainBar h={h} scale={scale} />

                <div style={{ textAlign: 'right' }}>
                  <p className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{compactIfLarge(Math.round(h.value))}</p>
                  <p className="figure" style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{h.weight.toFixed(1)}%</p>
                </div>

                <div style={{ textAlign: 'right' }}>
                  {h.priced ? <>
                    <p className="figure text-sm" style={{ color: pnlColor(h.unrealisedPnl), fontWeight: 500 }}>{formatPct(h.unrealisedPnlPct, 1)}</p>
                    <p className="figure" style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{formatSigned(Math.round(h.unrealisedPnl), compactIfLarge)}</p>
                  </> : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }} title="No market quote; valued at what it cost">no quote</p>}
                </div>

                <div style={{ textAlign: 'right' }}>
                  {h.priced && h.dayChange
                    ? <Delta value={h.dayChange} pct={h.dayChangePct} amount={false} />
                    : <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>—</span>}
                </div>

                <div className="flex items-center justify-end" style={{ gap: 8 }}>
                  {onSell && (
                    <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                      <SellButton onClick={() => onSell(h)} title={`Sell ${h.name}`} />
                    </span>
                  )}
                  <ChevronDown size={14} style={{
                    color: 'var(--color-text-muted)', transition: 'transform 0.15s ease', flexShrink: 0,
                    transform: expanded ? 'rotate(180deg)' : 'none',
                  }} />
                </div>
              </div>

              {expanded && (
                <div className="animate-in" style={{ padding: '16px 24px 18px 64px', background: 'var(--color-bg-secondary)', borderTop: '1px solid var(--color-border-subtle)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px 20px' }}>
                    <Stat label={h.type === 'gold' || h.type === 'silver' ? 'Grams' : 'Quantity'}>{formatCount(h.qty, 4)}</Stat>
                    <Stat label="Avg cost" sub={h.currency && h.currency !== 'INR' && h.avgCostPerUnitNative != null
                      ? formatNativeCurrency(h.avgCostPerUnitNative, h.currency) : null}>
                      {formatCurrency(h.avgCostPerUnit)}
                    </Stat>
                    <Stat label="Price">{h.priced ? formatCurrency(h.price) : '—'}</Stat>
                    <Stat label="Invested">{formatCurrency(h.invested)}</Stat>
                    <Stat label="Value">{formatCurrency(h.value)}</Stat>
                    <Stat label="Unrealised" color={pnlColor(h.unrealisedPnl)}>{h.priced ? formatSigned(h.unrealisedPnl) : '—'}</Stat>
                    {!!h.realisedPnl && <Stat label="Realised" color={pnlColor(h.realisedPnl)}>{formatSigned(h.realisedPnl)}</Stat>}
                    {h.priced && !!h.dayChange && <Stat label="Today" color={pnlColor(h.dayChange)}>{formatSigned(h.dayChange)}</Stat>}
                    {h.firstPurchaseDate && <Stat label="Held since" plain>{formatDate(h.firstPurchaseDate)}</Stat>}
                    <Stat label="Type" plain>{assetTypeLabel(h.type)}</Stat>
                  </div>

                  {(accountNames && h.positions?.length > 1) && (
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 14 }}>
                      Held in {h.positions.map(p => `${accountNames[p.account] || 'an account'} (${formatCount(p.qty, 4)})`).join(' · ')}
                    </p>
                  )}

                </div>
              )}
            </div>
          );
        }} />
    </div>
  );
}
