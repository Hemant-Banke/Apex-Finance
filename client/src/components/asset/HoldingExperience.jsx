import { formatCurrency, formatPct, pnlColor, dayLabel, compactIfLarge, formatCompactNative } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';

const SIP_COLS = 'minmax(90px, 1fr) repeat(4, minmax(80px, 1fr))';
const ROLL_COLS = 'minmax(90px, 1fr) repeat(5, minmax(72px, 1fr))';

/**
 * What owning it was actually like, rather than one point-to-point return: a monthly SIP's
 * outcome, and the spread of every holding period of one and three years.
 */
export default function HoldingExperience({ exp, name, benchmark, currency }) {
  if (!exp?.sip?.length && !exp?.rolling?.length) return null;
  // The SIP runs on the instrument's own prices, so a foreign one is stated in its own currency.
  const foreign = currency && currency !== 'INR';
  const amt = foreign ? (v) => formatCompactNative(v, currency) : (v) => compactIfLarge(v, formatCurrency);
  const bench = benchmark?.label;
  const head = (cols, labels) => (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
      {labels.map((l, i) => <span key={l} className="col-head" style={{ textAlign: i ? 'right' : 'left' }}>{l}</span>)}
    </div>
  );
  const cell = (v, fmt, color) => (
    <span className="figure text-xs" style={{ textAlign: 'right', color: v == null ? 'var(--color-text-muted)' : (color || 'var(--color-text-secondary)') }}>{v == null ? '—' : fmt(v)}</span>
  );
  const rowStyle = (cols) => ({ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'baseline' });

  return (
    <Card>
      <SectionHeader eyebrow="Owning it" size="sm"
        sub="One start date can flatter or damn anything. These ask what a regular investor, and every holder over a period, actually got."
        style={{ marginBottom: 18 }} />

      {exp.sip?.length > 0 && (
        <>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>
            {foreign ? `${formatCompactNative(10000, currency)} invested on the same day every month, in ${currency} — before any move in the rupee` : '₹10,000 invested on the same day every month'}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 460 }}>
              {head(SIP_COLS, ['SIP over', 'Invested', 'Worth today', 'Return a year', bench ? `${bench} SIP` : 'Benchmark'])}
              {exp.sip.map(s => (
                <div key={s.years} style={rowStyle(SIP_COLS)}>
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{s.years} year{s.years > 1 ? 's' : ''}</span>
                  {cell(s.invested, amt)}
                  {cell(s.value, amt, pnlColor(s.value - s.invested))}
                  {cell(s.xirr, v => formatPct(v, 1), pnlColor(s.xirr))}
                  {cell(s.benchXirr, v => formatPct(v, 1), pnlColor(s.benchXirr))}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
            Return a year is the XIRR — the annual rate that turns those instalments into today&apos;s value.
          </p>
        </>
      )}

      {exp.rolling?.length > 0 && (
        <div style={{ marginTop: exp.sip?.length ? 26 : 0 }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Every holding period ending on each trading day of the last five years{exp.rolling.some(r => r.years > 1) ? ' · three-year figures a year' : ''}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 520 }}>
              {head(ROLL_COLS, ['Held for', 'Worst', 'Typical', 'Best', 'Made money', bench ? `Beat ${bench}` : 'Beat benchmark'])}
              {exp.rolling.map(r => (
                <div key={r.years} style={rowStyle(ROLL_COLS)}>
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.years} year{r.years > 1 ? 's' : ''}</span>
                  <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(r.worst) }} title={`Period ending ${dayLabel(r.worstEnd, true)}`}>{formatPct(r.worst, 1)}</span>
                  {cell(r.median, v => formatPct(v, 1), pnlColor(r.median))}
                  <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(r.best) }} title={`Period ending ${dayLabel(r.bestEnd, true)}`}>{formatPct(r.best, 1)}</span>
                  {cell(r.positive, v => `${v}%`)}
                  {cell(r.beat, v => `${v}%`)}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
            Typical is the median period. Made money and beat {bench ? `the ${bench}` : 'the benchmark'} are the share of periods in which {name} did.
          </p>
        </div>
      )}
    </Card>
  );
}
