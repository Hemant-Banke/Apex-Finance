import { useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ChartTooltip from '../charts/ChartTooltip';
import SegmentedControl from '../ui/SegmentedControl';
import { CHART_COLORS, formatCrore, pnlColor, axisCompact, dayLabel, formatCount } from '../../lib/utils';

/**
 * Where the big money is going — the institutions, the funds, and the crowd.
 *
 * Three different sources, all in ₹ crore, read as one story:
 *
 *  - **FII / FPI and DII cash** — the provisional figures the exchanges publish every
 *    evening. The single most-watched number in Indian markets, because the two are so
 *    often mirror images: foreign money leaves, domestic money catches it.
 *  - **Domestic mutual funds** — as reported to SEBI. This is the closest daily read of
 *    RETAIL money there is: a SIP is retail savings arriving through a fund. It trails
 *    the exchange figures by a few days, and every window says which day it runs to.
 *  - **Positioning** — NSE's participant-wise open interest splits index futures between
 *    Client (retail and HNI), FII, DII and Pro desks. Not a flow but a bet: which way each
 *    group is leaning, and how hard.
 *
 * Colours here are IDENTITY (FII, DII, MF), never gain/loss — a red bar for "FII" would
 * read as "bad" on a day foreign money arrived. Direction is told by the sign and by
 * which side of zero the bar sits.
 */
const C = { fii: CHART_COLORS[1], dii: CHART_COLORS[2], mf: CHART_COLORS[0], client: CHART_COLORS[4], pro: CHART_COLORS[3] };


const WINDOW_COLS = [
  { key: 'd1', label: 'Last session' },
  { key: 'w1', label: '5 sessions' },
  { key: 'm1', label: '21 sessions' },
];

function FlowLedger({ summary }) {
  const rows = [
    { key: 'fii', label: 'FII / FPI',          note: 'Foreign institutions',     color: C.fii },
    { key: 'dii', label: 'DII',                note: 'Domestic institutions',    color: C.dii },
    { key: 'mf',  label: 'Mutual funds',       note: 'Equity · mostly retail SIPs', color: C.mf },
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 460 }}>
        <div className="flex items-center" style={{ gap: 14, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
          <span className="col-head" style={{ flex: 1 }}>Net buying</span>
          {WINDOW_COLS.map(c => (
            <span key={c.key} className="col-head" style={{ width: 112, textAlign: 'right', flexShrink: 0 }}>{c.label}</span>
          ))}
        </div>
        {rows.map(r => {
          const s = summary?.[r.key];
          const through = s?.d1?.through;
          return (
            <div key={r.key} className="flex items-center" style={{ gap: 14, padding: '11px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span className="text-sm" style={{ color: 'var(--color-text-primary)', display: 'block' }}>{r.label}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {r.note}{through ? ` · to ${dayLabel(through)}` : ''}
                  </span>
                </span>
              </span>
              {WINDOW_COLS.map(c => {
                const v = s?.[c.key]?.total;
                return (
                  <span key={c.key} className="figure text-sm" style={{ width: 112, textAlign: 'right', flexShrink: 0, color: v == null ? 'var(--color-text-muted)' : pnlColor(v) }}>
                    {formatCrore(v, { signed: true })}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Daily bars, or the same days as running totals — the drift a month of bars hides. */
function FlowChart({ daily }) {
  const [view, setView] = useState('daily');

  const rows = useMemo(() => {
    // Start where the INSTITUTIONAL series start. The SEBI fund history reaches back
    // further than the exchange history we hold, and summing from its first day drew
    // FII and DII as flat zeros across days they simply have no record for — "no data"
    // dressed up as "no flow" — while the fund line began a week ahead of them.
    const first = daily.findIndex(d => d.fii != null || d.dii != null);
    if (first < 0) return [];
    const span = daily.slice(first);
    if (view === 'daily') return span.filter(d => d.fii != null || d.dii != null);
    // A day a source has not published yet carries the total forward; it does not reset
    // it, and it does not invent a zero-flow day either (the line simply stops there).
    let f = 0, d = 0, m = 0;
    return span.map(r => {
      if (r.fii != null) f += r.fii;
      if (r.dii != null) d += r.dii;
      if (r.mfEquity != null) m += r.mfEquity;
      return { date: r.date, fii: f, dii: d, mfEquity: r.mfEquity != null ? m : null };
    });
  }, [daily, view]);

  if (!rows.length) return null;

  return (
    <>
      <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <p className="eyebrow">{view === 'daily' ? 'Session by session' : 'Running total'}</p>
        <SegmentedControl ariaLabel="Flow view" value={view} onChange={setView}
          options={[{ key: 'daily', label: 'Daily' }, { key: 'cumulative', label: 'Cumulative' }]} />
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows} barGap={2} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} dy={8}
            tickFormatter={d => dayLabel(d)} minTickGap={28} />
          <YAxis tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={v => axisCompact(v)} />
          <ReferenceLine y={0} stroke="var(--color-border-hover)" />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} isAnimationActive={false}
            content={<ChartTooltip formatValue={v => formatCrore(v, { signed: true })} />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
          {view === 'daily' ? (
            <>
              <Bar dataKey="fii" name="FII / FPI" fill={C.fii} radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="dii" name="DII"       fill={C.dii} radius={[3, 3, 0, 0]} maxBarSize={14} />
            </>
          ) : (
            <>
              <Line dataKey="fii" name="FII / FPI" stroke={C.fii} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="dii" name="DII" stroke={C.dii} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="mfEquity" name="Mutual funds (equity)" stroke={C.mf} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

const PARTICIPANTS = {
  client: { label: 'Retail & HNI', note: 'NSE "Client"' },
  fii:    { label: 'FIIs',         note: 'Foreign institutions' },
  dii:    { label: 'DIIs',         note: 'Domestic institutions' },
  pro:    { label: 'Prop desks',   note: "Brokers' own books" },
};

/**
 * Who is long index futures, and how hard. Each row is ONE bar split long | short —
 * a share of that participant's own book, so a small group and a large one compare on
 * the same scale. The 50% tick is the line between leaning long and leaning short.
 */
function Positioning({ positioning }) {
  if (!positioning) return null;
  const { participants, history, date } = positioning;

  return (
    <Card>
      <SectionHeader
        eyebrow="Positioning"
        size="sm"
        sub={`Index futures open interest by participant · ${dayLabel(date, true)}`}
        style={{ marginBottom: 20 }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 28, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {participants.map(p => {
            const meta = PARTICIPANTS[p.key];
            const long = p.longShare;
            return (
              <div key={p.key}>
                <div className="flex items-baseline justify-between" style={{ gap: 10, marginBottom: 6 }}>
                  <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                    {meta.label}
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>{meta.note}</span>
                  </span>
                  <span className="figure text-xs" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {long == null ? '—' : `${long.toFixed(0)}% long`}
                  </span>
                </div>
                {/* One continuous bar — long, then short. It used to carry a 2px gap
                    between the two AND a card-coloured line through the middle at 50%,
                    which together cut every bar in two at a point that meant nothing on
                    its own. The 50% mark is a small tick BELOW the bar instead: there to
                    measure against, not drawn through the data. */}
                <div style={{ position: 'relative', paddingBottom: 5 }}
                  title={`${formatCount(p.idxFutLong)} long · ${formatCount(p.idxFutShort)} short contracts`}>
                  <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${long ?? 0}%`, background: 'color-mix(in srgb, var(--color-success) 68%, #0B0D10)' }} />
                    <div style={{ flex: 1, background: 'color-mix(in srgb, var(--color-danger) 68%, #0B0D10)' }} />
                  </div>
                  <span style={{ position: 'absolute', left: 'calc(50% - 0.5px)', bottom: 0, width: 1, height: 4, background: 'var(--color-text-muted)' }} />
                </div>
                <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 5 }}>
                  Net {p.idxFutNet > 0 ? '+' : p.idxFutNet < 0 ? '−' : ''}{formatCount(Math.abs(p.idxFutNet ?? 0))} contracts
                </p>
              </div>
            );
          })}
        </div>

        {history?.length > 1 && (
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow" style={{ marginBottom: 12 }}>Long share over time</p>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} dy={8}
                  tickFormatter={d => dayLabel(d)} minTickGap={28} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: '#878D97', fontSize: 11 }}
                  axisLine={false} tickLine={false} width={38} tickFormatter={v => `${v}%`} />
                <ReferenceLine y={50} stroke="var(--color-border-hover)" strokeDasharray="3 3" />
                <Tooltip isAnimationActive={false} cursor={{ stroke: 'var(--color-border-hover)' }}
                  content={<ChartTooltip formatValue={v => (v == null ? '—' : `${v.toFixed(1)}% long`)} />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 10 }} iconType="circle" iconSize={7} />
                <Line dataKey="client" name="Retail & HNI" stroke={C.client} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="fii"    name="FIIs"         stroke={C.fii}    strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="pro"    name="Prop desks"   stroke={C.pro}    strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function FlowsPanel({ flows }) {
  if (!flows || (!flows.daily?.length && !flows.positioning)) {
    return (
      <Card>
        <p className="eyebrow">Money flows</p>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 12 }}>
          Flow data has not arrived yet — the exchanges publish each evening.
        </p>
      </Card>
    );
  }
  const { latest, summary, daily, positioning } = flows;

  return (
    <>
      <Card>
        <SectionHeader
          eyebrow="Money flows"
          size="sm"
          sub={`Cash market, ₹ crore · provisional${latest?.date ? ` · latest ${dayLabel(latest.date, true)}` : ''}`}
          style={{ marginBottom: 20 }}
        />

        {/* The day in one sentence: the gross figures behind the two nets. */}
        {latest?.fii?.buy != null && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
            Foreign institutions bought <span className="figure">{formatCrore(latest.fii.buy)}</span> and
            sold <span className="figure">{formatCrore(latest.fii.sell)}</span>;
            domestic institutions bought <span className="figure">{formatCrore(latest.dii?.buy)}</span> and
            sold <span className="figure">{formatCrore(latest.dii?.sell)}</span>.
            {latest.fiiDeriv?.idxFut != null && (
              <> In derivatives, FIIs were net <span className="figure" style={{ color: pnlColor(latest.fiiDeriv.idxFut) }}>
                {formatCrore(latest.fiiDeriv.idxFut, { signed: true })}</span> in index futures.</>
            )}
          </p>
        )}

        <FlowLedger summary={summary} />
        <div style={{ height: 26 }} />
        <FlowChart daily={daily} />
      </Card>

      <Positioning positioning={positioning} />
    </>
  );
}
