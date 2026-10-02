import { formatPct, formatPoints as pp, pnlColor, dayLabel } from '../../lib/utils';
import { rupeeLevel } from '../../lib/markets';
import Card from '../ui/Card';
import ShowMore from '../ui/ShowMore';
import SectionHeader from '../ui/SectionHeader';

/**
 * The price-side pieces of an instrument page — a statistic grid, the 52-week range bar
 * and the Performance & risk card — shared by a company's page and every other asset's
 * (an index, gold, a fund, a coin), so a 1-year return or a drawdown is drawn one way.
 * Prices print through `fmt`, because an index is in points, gold in ₹ a gram and a US
 * share in dollars; the default is a rupee level.
 */


/** A labelled statistic with an optional line saying what it means. */
export function Stat({ label, value, note, tone, text = false }) {
  return (
    <div style={{ minWidth: 0, padding: '12px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      {/* Figures in the mono face; words (an industry, a city) in the text face. */}
      <p className={text ? 'text-sm' : 'figure'} style={{ fontSize: text ? '0.875rem' : '1rem', fontWeight: 500, marginTop: 4, color: tone || 'var(--color-text-primary)' }}>{value ?? '—'}</p>
      {note && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.45 }}>{note}</p>}
    </div>
  );
}

const statGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', columnGap: 24 };

/**
 * A grid of statistics that folds like every other long list: the first `initial` open,
 * the rest behind the toggle. A statistic with no value is DROPPED rather than printed as
 * "—" — a row of dashes is a grid of things the page does not know, said out loud.
 */
export function StatGrid({ stats, initial = 8, noun = 'measures', style }) {
  const shown = stats.filter(st => st && st.value != null && st.value !== '');
  return (
    <ShowMore items={shown} initial={initial} noun={noun}
      wrap={(body) => <div style={{ ...statGrid, ...style }}>{body}</div>}
      render={(st) => <Stat key={st.label} {...st} />} />
  );
}

/** Where today sits between the 52-week low and high. `fmt` prints a level in its unit. */
export function RangeBar({ low, high, value, fmt = rupeeLevel }) {
  if (low == null || high == null || value == null || high <= low) return null;
  const pos = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <div>
      <div style={{ position: 'relative', height: 6, borderRadius: 99, background: 'var(--color-bg-elevated)', marginTop: 8 }}>
        <div style={{ position: 'absolute', left: 0, width: `${pos}%`, top: 0, bottom: 0, borderRadius: 99, background: 'var(--color-accent-dim)' }} />
        <div style={{ position: 'absolute', left: `calc(${pos}% - 1px)`, top: -4, bottom: -4, width: 2, borderRadius: 2, background: 'var(--color-accent)' }} />
      </div>
      <div className="flex justify-between figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
        <span>{fmt(low)}</span><span>{fmt(high)}</span>
      </div>
    </div>
  );
}

// ── Performance & risk ──────────────────────────────────────────────────────────

const PERIOD_ORDER = [
  ['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['3m', '3M'], ['6m', '6M'],
  ['ytd', 'YTD'], ['1y', '1Y'], ['3y', '3Y'], ['5y', '5Y'],
];

/**
 * Returns over each window against a benchmark (the Nifty 50 unless the payload names
 * another — the Nifty's own page is compared with the Sensex), the gap in points, and
 * the risk measures. `perf.returns[k]` is `{ stock, nifty }` — the asset and its yardstick.
 */
export function Performance({ perf, name, fmt = rupeeLevel, sub = "The share's return over each window, against the Nifty 50", benchLabel = 'Nifty 50' }) {
  const r = perf?.returns || {};
  const cols = PERIOD_ORDER.filter(([k]) => r[k]);
  const grid = `110px repeat(${cols.length}, minmax(58px, 1fr))`;
  const row = (label, pick, colorFn) => (
    <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'baseline' }}>
      <span className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      {cols.map(([k]) => {
        const v = pick(r[k]);
        return <span key={k} className="figure text-xs" style={{ textAlign: 'right', color: v == null ? 'var(--color-text-muted)' : colorFn(v) }}>{v == null ? '—' : colorFn === gapColor ? pp(v) : formatPct(v, 1)}</span>;
      })}
    </div>
  );
  const gapColor = (v) => pnlColor(v);

  const dd = perf.maxDrawdown1y;
  const beta = perf.beta;
  return (
    <Card>
      <SectionHeader eyebrow="Performance & risk" size="sm" sub={sub} style={{ marginBottom: 16 }} />
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span />
            {cols.map(([k, l]) => <span key={k} className="col-head" style={{ textAlign: 'right' }}>{l}</span>)}
          </div>
          {row(name, x => x?.stock, pnlColor)}
          {row(benchLabel, x => x?.nifty, pnlColor)}
          {/* The row the comparison exists for — in points, because the gap between two
              returns is not itself a return. */}
          {row('Gap', x => (x?.stock != null && x?.nifty != null ? x.stock - x.nifty : null), gapColor)}
        </div>
      </div>
      {(r['3y']?.stockCagr != null || r['5y']?.stockCagr != null) && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10 }}>
          Annualised: {['3y', '5y'].filter(k => r[k]?.stockCagr != null).map(k => (
            <span key={k} style={{ marginRight: 14 }}>
              {k.toUpperCase()} <span className="figure" style={{ color: pnlColor(r[k].stockCagr) }}>{formatPct(r[k].stockCagr, 1)}</span>
              <span> a year vs the {benchLabel}&apos;s </span><span className="figure">{formatPct(r[k].niftyCagr, 1)}</span>
            </span>
          ))}
        </p>
      )}

      {/* The four that say the most open; the trend and texture measures fold. */}
      <StatGrid initial={4} noun="risk measures" style={{ marginTop: 14 }} stats={[
        { label: 'Volatility (1Y)', value: perf.volatility != null ? `${perf.volatility.toFixed(1)}%` : null, note: 'Annualised swing of daily returns' },
        { label: `Beta to the ${benchLabel}`, value: beta?.toFixed(2),
          note: beta == null ? null : `Moves about ${beta.toFixed(1)}× the ${benchLabel}${perf.correlation != null ? ` · correlation ${perf.correlation.toFixed(2)}` : ''}` },
        { label: 'Worst fall (1Y)', value: dd ? formatPct(dd.pct, 1) : null, tone: dd?.pct ? 'var(--color-danger)' : undefined,
          note: dd?.peakDate ? `${dayLabel(dd.peakDate, true)} → ${dayLabel(dd.troughDate, true)}` : null },
        { label: 'From 52-week high', value: perf.fromHigh != null ? formatPct(perf.fromHigh, 1) : null, tone: pnlColor(perf.fromHigh),
          note: perf.rangePosition != null ? `${perf.rangePosition}% of the way up the year's range` : null },
        { label: 'Against 200-day average', value: perf.vsSma200 != null ? formatPct(perf.vsSma200, 1) : null, tone: pnlColor(perf.vsSma200),
          note: perf.sma200 ? `Average ${fmt(perf.sma200)} — the long trend` : null },
        { label: 'Against 50-day average', value: perf.vsSma50 != null ? formatPct(perf.vsSma50, 1) : null, tone: pnlColor(perf.vsSma50),
          note: perf.sma50 ? `Average ${fmt(perf.sma50)} — the recent trend` : null },
        { label: 'Up days (1Y)', value: perf.upDays != null ? `${perf.upDays}%` : null, note: 'Sessions that closed higher' },
        // Only worth a cell when the five-year fall was worse than the one-year one.
        perf.maxDrawdown5y?.pct < (dd?.pct ?? 0) && {
          label: 'Worst fall (5Y)', value: formatPct(perf.maxDrawdown5y.pct, 1), tone: 'var(--color-danger)',
          note: `${dayLabel(perf.maxDrawdown5y.peakDate, true)} → ${dayLabel(perf.maxDrawdown5y.troughDate, true)}` },
      ]} />
    </Card>
  );
}
