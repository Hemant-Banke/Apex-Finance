import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ChartTooltip from '../charts/ChartTooltip';
import { CHART_COLORS, pnlColor, fiscalQuarter, monthLabel, formatPoints, formatCount, formatPct, dayLabel } from '../../lib/utils';
import ShowMore from '../ui/ShowMore';
import AllocationBar from '../portfolio/AllocationBar';

/**
 * Who owns the company, and which way that is moving — the quarterly shareholding pattern
 * every listed Indian company files.
 *
 * The groups are SEBI's: **promoters** (the founding family or parent), **FIIs** (foreign
 * institutions), **DIIs** (domestic institutions — mutual funds, insurers, banks),
 * **government**, and **public** — everyone else: retail investors, HNIs and corporate
 * bodies, the published measure of retail ownership. The number of shareholders beside
 * it says whether that retail base is widening.
 *
 * Changes are in percentage POINTS — a stake going from 20% to 18% is "−2.0 pts", not
 * "−10%", and points are what add up across the groups (every quarter's moves net to
 * zero). The interesting reading is usually the hand-off: foreign money selling down
 * while domestic funds buy what it sells.
 *
 * One axis, one unit (% of the company), so every group shares the chart honestly; each
 * keeps one categorical colour.
 */
const GROUPS = {
  promoters:  { label: 'Promoters',  note: 'Founders / parent', color: CHART_COLORS[0] },
  fiis:       { label: 'FIIs',       note: 'Foreign institutions', color: CHART_COLORS[1] },
  diis:       { label: 'DIIs',       note: 'Mutual funds, insurers, banks', color: CHART_COLORS[2] },
  public:     { label: 'Public',     note: 'Retail, HNIs & others', color: CHART_COLORS[4] },
  government: { label: 'Government', note: 'Central & state', color: CHART_COLORS[3] },
};

const pts = (v) => formatPoints(v, 2, 'pts');

export default function Ownership({ ownership, money }) {
  if (ownership?.kind === 'holders') return <Holders o={ownership} money={money} />;
  if (!ownership?.groups?.length) return null;
  const { groups, history, shareholders, shareholdersY1, since, asof } = ownership;
  // Government holdings under half a percent are noise on a shared axis; the table keeps them.
  const charted = groups.filter(g => g.key !== 'government' || g.pct >= 0.5);
  // The label goes AFTER the spread — `h.date` would otherwise overwrite it with the raw ISO date.
  const rows = history.map(h => ({ ...h, date: fiscalQuarter(h.date)?.short || monthLabel(h.date) }));
  const holdersGrowth = shareholders && shareholdersY1 ? ((shareholders / shareholdersY1) - 1) * 100 : null;
  const grid = '1.4fr 80px 84px 84px 96px';

  return (
    <Card>
      <SectionHeader eyebrow="Ownership" size="sm"
        sub={`Shareholding pattern as filed · ${fiscalQuarter(asof)?.fq || monthLabel(asof)} · changes in percentage points`}
        style={{ marginBottom: 18 }} />

      {rows.length > 1 && (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} dy={8} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} width={40}
              tickFormatter={v => `${v}%`} domain={[0, 'auto']} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: 'var(--color-border-hover)' }}
              content={<ChartTooltip formatValue={v => (v == null ? '—' : `${v.toFixed(2)}%`)} />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 10 }} iconType="circle" iconSize={7} />
            {charted.map(g => (
              <Line key={g.key} dataKey={g.key} name={GROUPS[g.key].label} stroke={GROUPS[g.key].color}
                strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: GROUPS[g.key].color }} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      <div style={{ overflowX: 'auto', marginTop: 18 }}>
        <div style={{ minWidth: 520 }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head">Holder</span>
            <span className="col-head" style={{ textAlign: 'right' }}>Holding</span>
            <span className="col-head" style={{ textAlign: 'right' }}>1 quarter</span>
            <span className="col-head" style={{ textAlign: 'right' }}>1 year</span>
            <span className="col-head" style={{ textAlign: 'right' }} title={`Since ${monthLabel(since)}`}>Since {fiscalQuarter(since)?.short || monthLabel(since)}</span>
          </div>
          {groups.map(g => (
            <div key={g.key} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: GROUPS[g.key].color, flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{GROUPS[g.key].label}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>{GROUPS[g.key].note}</span>
                </span>
              </span>
              <span className="figure text-sm" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{g.pct.toFixed(2)}%</span>
              {/* Points moved, not good or bad news — a promoter selling down can be either,
                  so the change keeps the direction colour of the holding itself. */}
              {['q1', 'y1', 'sinceFirst'].map(k => (
                <span key={k} className="figure text-xs" style={{ textAlign: 'right', color: g[k] ? pnlColor(g[k]) : 'var(--color-text-muted)' }}>{pts(g[k])}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {shareholders != null && (
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)', marginTop: 14 }}>
          <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{formatCount(shareholders)}</span> shareholders
          {holdersGrowth != null && (
            <> · <span className="figure" style={{ color: pnlColor(holdersGrowth) }}>{holdersGrowth > 0 ? '+' : '−'}{Math.abs(holdersGrowth).toFixed(1)}%</span> on a year ago — {holdersGrowth >= 0 ? 'a widening' : 'a narrowing'} retail base</>
          )}
        </p>
      )}
    </Card>
  );
}

/** A company listed abroad: no SEBI pattern, so insiders vs institutions and the largest institutional holders. */
function Holders({ o, money }) {
  const rest = o.insiders != null && o.institutions != null ? Math.max(0, 100 - o.insiders - o.institutions) : null;
  const split = [
    o.institutions != null && { name: 'Institutions', value: o.institutions, weight: o.institutions },
    o.insiders != null && { name: 'Insiders', value: o.insiders, weight: o.insiders },
    rest != null && { name: 'Everyone else', value: rest, weight: rest },
  ].filter(Boolean);
  const grid = '1.6fr 80px 110px 84px';
  return (
    <Card>
      <SectionHeader eyebrow="Ownership" size="sm"
        sub={`Who holds the shares${o.institutionsCount ? ` · ${formatCount(o.institutionsCount)} institutions` : ''}${o.asof ? ` · filings to ${dayLabel(o.asof, true)}` : ''}`}
        style={{ marginBottom: 18 }} />
      {split.length > 0 && <AllocationBar showValue={false} items={split} />}
      {o.institutionsFloat != null && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 12 }}>
          Institutions hold <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>{o.institutionsFloat.toFixed(1)}%</span> of the shares that actually trade.
        </p>
      )}
      {o.top?.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 20 }}>
          <div style={{ minWidth: 460 }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
              <span className="col-head">Largest holders</span>
              {['Stake', 'Worth', 'Last change'].map(h => <span key={h} className="col-head" style={{ textAlign: 'right' }}>{h}</span>)}
            </div>
            <ShowMore items={o.top} initial={6} noun="holders" render={(h) => (
              <div key={h.name} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'baseline' }}>
                <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>{h.name}</span>
                <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{h.pct != null ? `${h.pct.toFixed(2)}%` : '—'}</span>
                <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{money ? money.big(h.value) : '—'}</span>
                {/* The holder's own position change last filing, not the stock's. */}
                <span className="figure text-xs" style={{ textAlign: 'right', color: h.change ? pnlColor(h.change) : 'var(--color-text-muted)' }}>{formatPct(h.change, 1)}</span>
              </div>
            )} />
          </div>
        </div>
      )}
    </Card>
  );
}
