import { useMemo, useState } from 'react';
import { CHART_COLORS, compactIfLarge, formatPct, formatPoints, formatSigned, pnlColor } from '../../lib/utils';
import { assetTypeLabel } from '../../lib/constants';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ShowMore from '../ui/ShowMore';
import AllocationBar, { OTHER_TONE, CASH_TONE } from './AllocationBar';
import PortfolioProfile, { Figure } from './PortfolioProfile';

const LENSES = {
  type:    { label: 'Asset type', noun: 'asset types' },
  holding: { label: 'Holding',    noun: 'holdings' },
  account: { label: 'Account',    noun: 'accounts' },
};

// Every lens is a regrouping of the same marked-to-market holdings.
function groupBy(holdings, lens, accountNames) {
  const out = {};
  const add = (key, name, sub, value, invested, dayChange, symbol) => {
    const g = (out[key] ??= { key, name, sub, value: 0, invested: 0, dayChange: 0, symbols: new Set(), unpriced: false });
    g.value += value; g.invested += invested; g.dayChange += dayChange;
    g.symbols.add(symbol);
    return g;
  };

  for (const h of holdings) {
    if (lens === 'account') {
      // A holding spread over accounts is split by units, so each account carries its own share.
      for (const p of h.positions || []) {
        const frac = h.qty ? p.qty / h.qty : 0;
        const g = add(p.account || 'none', accountNames?.[p.account] || 'Unknown account', null,
          h.value * frac, p.totalInvested ?? h.invested * frac, h.dayChange * frac, h.symbol);
        if (h.priced === false) g.unpriced = true;
      }
      continue;
    }
    const g = lens === 'type'
      ? add(h.type, assetTypeLabel(h.type), null, h.value, h.invested, h.dayChange, h.symbol)
      : add(h.symbol, h.name || h.symbol, h.symbol, h.value, h.invested, h.dayChange, h.symbol);
    if (h.priced === false) g.unpriced = true;
  }

  return Object.values(out).map(g => ({ ...g, count: g.symbols.size }));
}

/**
 * Allocation in full: the mix by value over the mix by cost (drift is the gap between
 * the two bars), concentration in three figures, and a table per slice.
 *
 * Props:
 *   holdings     — `getPortfolio` rows (marked to market)
 *   cash         — idle cash to show as its own neutral slice (an account's page)
 *   accountNames — { id: name }; enables the Account lens when holdings span accounts
 *   profile      — `/dashboard/portfolio`'s profile: style, asset classes, caps, sectors
 */
export default function AllocationPanel({ holdings = [], cash = 0, accountNames, profile, eyebrow = 'Allocation', sub }) {
  const spansAccounts = !!accountNames && holdings.some(h => h.positions?.length)
    && new Set(holdings.flatMap(h => (h.positions || []).map(p => p.account))).size > 1;
  const lenses = Object.entries(LENSES)
    .filter(([k]) => k !== 'account' || spansAccounts)
    .map(([key, l]) => ({ key, label: l.label }));

  const [lens, setLens]     = useState('type');
  const [active, setActive] = useState(null);

  const { rows, bar, costBar, stats } = useMemo(() => {
    const groups = groupBy(holdings, lens, accountNames)
      .filter(g => g.value > 0)
      .sort((a, b) => b.value - a.value);

    // Past the palette the tail shares one neutral "Other" in the bars; the table still lists each.
    const fold = groups.length > CHART_COLORS.length;
    const keep = fold ? CHART_COLORS.length - 1 : groups.length;
    const coloured = groups.map((g, i) => i < keep
      ? { ...g, color: CHART_COLORS[i], barKey: g.key }
      : { ...g, color: OTHER_TONE, barKey: 'other' });

    const all = cash > 0 && lens !== 'account'
      ? [...coloured, { key: 'cash', barKey: 'cash', name: 'Cash', sub: 'Uninvested', value: cash, invested: cash, dayChange: 0, count: 0, color: CASH_TONE, isCash: true }]
      : coloured;
    all.sort((a, b) => b.value - a.value);

    const totalValue = all.reduce((s, r) => s + r.value, 0);
    const totalCost  = all.reduce((s, r) => s + Math.max(0, r.invested), 0);
    const rows = all.map(r => {
      const weight     = totalValue ? (r.value / totalValue) * 100 : 0;
      const costWeight = totalCost ? (Math.max(0, r.invested) / totalCost) * 100 : 0;
      const pnl        = r.value - r.invested;
      return { ...r, weight, costWeight, drift: weight - costWeight, pnl, pnlPct: r.invested > 0 ? (pnl / r.invested) * 100 : null };
    });

    const toBar = (weightKey, valueKey) => {
      const items = [];
      for (const r of rows) {
        const prev = items.find(i => i.key === r.barKey);
        if (prev) { prev.value += r[valueKey]; prev.weight += r[weightKey]; continue; }
        items.push({ key: r.barKey, name: r.barKey === 'other' ? 'Other' : r.name, color: r.color, value: r[valueKey], weight: r[weightKey] });
      }
      return items;
    };

    // Measured over the same slices the bar draws (cash included), so the two agree.
    const shares = rows.map(r => r.weight / 100);
    const hhi = shares.reduce((s, w) => s + w * w, 0);
    const stats = rows.length && {
      hasCash: rows.some(r => r.isCash),
      largest: rows[0],
      largestShare: rows[0].weight,
      top3: rows.length > 3 ? shares.slice(0, 3).reduce((s, w) => s + w, 0) * 100 : null,
      effective: hhi ? 1 / hhi : null,
      n: rows.length,
    };

    return { rows, bar: toBar('weight', 'value'), costBar: toBar('costWeight', 'invested'), stats };
  }, [holdings, lens, accountNames, cash]);

  if (!rows.length) return null;

  const maxWeight = Math.max(...rows.map(r => r.weight));
  const noun = LENSES[lens].noun;

  return (
    <Card>
      <SectionHeader
        eyebrow={eyebrow}
        size="sm"
        sub={sub ?? 'What the book is made of, and what kind of portfolio that makes it'}
        style={{ marginBottom: 24 }}
      />

      {profile && (
        <>
          <PortfolioProfile profile={profile} cash={cash} />
          <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '30px 0 24px' }} />
        </>
      )}

      {/* The breakdown: one lens at a time, value over cost, and a row per slice. */}
      <div className="flex items-center justify-between" style={{ gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p className="col-head">Breakdown</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>By market value, with cost beneath it — the gap between the two bars is drift</p>
        </div>
        {lenses.length > 1 && <SegmentedControl options={lenses} value={lens} onChange={k => { setLens(k); setActive(null); }} ariaLabel="Group allocation by" />}
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 18, marginBottom: 22 }}>
          <Figure label="Largest" value={`${stats.largestShare.toFixed(1)}%`} sub={stats.largest.name} />
          {stats.top3 != null && <Figure label="Top 3" value={`${stats.top3.toFixed(1)}%`} sub={`of ${stats.n} ${noun}${stats.hasCash ? ' incl. cash' : ''}`} />}
          {stats.effective != null && stats.n > 1 && (
            <Figure
              label="Behaves like"
              value={stats.effective.toFixed(1)}
              sub={`equal-sized ${lens === 'type' ? 'assets' : noun}`}
              title="1 ÷ Σ(weight²). Equal weights give the full count; one dominant position pulls it toward 1."
            />
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', alignItems: 'center', rowGap: 8, columnGap: 12 }}>
        <span className="col-head">Value</span>
        <AllocationBar items={bar} height={14} legend={false} active={active} onActive={setActive} />
        <span className="col-head">Cost</span>
        <AllocationBar items={costBar} height={6} legend={false} active={active} onActive={setActive} muted />
      </div>

      <div style={{ marginTop: 26 }}>
        <div className="flex items-center" style={{ gap: 16, paddingBottom: 10, borderBottom: '1px solid var(--color-border-subtle)' }}>
          <span className="col-head" style={{ flex: 1 }}>{LENSES[lens].label}</span>
          <span className="col-head" style={{ width: 180, flexShrink: 0 }}>Weight</span>
          <span className="col-head" style={{ width: 74, textAlign: 'right', flexShrink: 0 }} title="Weight now, less its share of cost — what the market did to the mix">Drift</span>
          <span className="col-head" style={{ width: 92, textAlign: 'right', flexShrink: 0 }}>Value</span>
          <span className="col-head" style={{ width: 120, textAlign: 'right', flexShrink: 0 }}>Return</span>
        </div>

        <ShowMore items={rows} initial={6} noun={noun}
          wrap={body => <div onMouseLeave={() => setActive(null)}>{body}</div>}
          render={r => {
            const dim = active != null && active !== r.barKey;
            return (
              <div key={r.key} className="flex items-center"
                onMouseEnter={() => setActive(r.barKey)}
                style={{ gap: 16, padding: '11px 0', borderBottom: '1px solid var(--color-border-subtle)', opacity: dim ? 0.45 : 1, transition: 'opacity 0.18s ease' }}>
                <div className="flex items-center gap-2.5" style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: r.color }} />
                  <div style={{ minWidth: 0 }}>
                    <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{r.name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 1 }}>
                      {r.isCash ? r.sub
                        : lens === 'holding' ? <span className="figure">{r.sub}</span>
                        : `${r.count} holding${r.count === 1 ? '' : 's'}`}
                      {r.unpriced && <span style={{ color: 'var(--color-chart-warm)' }}> · at cost</span>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center" style={{ width: 180, flexShrink: 0, gap: 10 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${maxWeight ? (r.weight / maxWeight) * 100 : 0}%`, background: r.color }} />
                  </div>
                  <span className="figure text-xs" style={{ width: 44, textAlign: 'right', color: 'var(--color-text-primary)' }}>
                    {r.weight.toFixed(1)}%
                  </span>
                </div>

                {/* Points, not percent, and not gain/loss colours — drift is a shift in the mix, not a profit. */}
                <span className="figure text-xs" style={{ width: 74, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-muted)' }}
                  title={`${r.costWeight.toFixed(1)}% of cost → ${r.weight.toFixed(1)}% of value`}>
                  {Math.abs(r.drift) < 0.05 ? '—' : formatPoints(r.drift)}
                </span>

                <span className="figure text-sm" style={{ width: 92, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-primary)' }}>
                  {compactIfLarge(r.value)}
                </span>

                <div style={{ width: 120, textAlign: 'right', flexShrink: 0 }}>
                  {r.isCash ? (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>—</span>
                  ) : (
                    <>
                      <p className="figure text-sm" style={{ color: pnlColor(r.pnl) }}>{formatSigned(r.pnl, compactIfLarge)}</p>
                      <p className="figure text-xs" style={{ color: pnlColor(r.pnl), opacity: 0.8, marginTop: 1 }}>{formatPct(r.pnlPct, 1)}</p>
                    </>
                  )}
                </div>
              </div>
            );
          }}
        />
      </div>
    </Card>
  );
}
