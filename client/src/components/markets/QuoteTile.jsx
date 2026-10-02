import Delta from '../ui/Delta';
import Sparkline from '../ui/Sparkline';
import { formatPct, pnlColor } from '../../lib/utils';
import { Link } from 'react-router-dom';
import { WINDOWS, formatLevel, assetPath } from '../../lib/markets';

/**
 * One index or asset: its level, today's move, and the longer windows beneath.
 *
 * Today's change is the headline of a quote and gets the Delta chip; the week, month and
 * year sit under it as a quiet row of figures, because a quote read only by its day
 * change is a quote read by its noise. The sparkline is the last three months — enough
 * to say "falling for weeks" or "bounced", which the 1M figure alone cannot.
 *
 * `fear` (India VIX) inverts the COLOUR of a move, never its sign: volatility rising is
 * up and is not good news — the same rule `Delta.invert` exists for.
 *
 * A tile with a `symbol` opens that instrument's asset page; one without (the G-Sec
 * index, which has no chartable history) is a plain card.
 */
export default function QuoteTile({ q }) {
  const flip = q.fear ? -1 : 1;
  const Shell = q.symbol ? Link : 'div';
  const link = q.symbol ? { to: assetPath(q.symbol), title: `Open ${q.label}`, className: 'card card-compact quote-tile-link' } : { className: 'card card-compact' };
  return (
    <Shell {...link} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div className="flex items-start justify-between" style={{ gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{q.label}</p>
          <p className="figure" style={{ fontSize: '1.0625rem', fontWeight: 500, color: 'var(--color-text-primary)', marginTop: 4, whiteSpace: 'nowrap' }}>
            {formatLevel(q.last, q.unit ? q.currency : undefined)}
          </p>
          {q.unit && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{q.unit}</p>}
        </div>
        {/* The line takes the move's own direction over its window, in a muted tone —
            identity stays with the label, the shape is what it adds. */}
        <Sparkline values={q.spark} width={72} height={30}
          tone={(q.spark?.length > 1 && (q.spark.at(-1) - q.spark[0]) * flip < 0) ? 'var(--color-danger)' : 'var(--color-success)'}
          title={`${q.label}, last three months`} />
      </div>

      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        {q.chg1d != null
          ? <Delta value={q.chg1d} pct={q.chg1d} amount={false} invert={q.fear} />
          : <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>—</span>}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>today</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, paddingTop: 9, borderTop: '1px solid var(--color-border-subtle)' }}>
        {WINDOWS.slice(1).map(w => (
          <div key={w.key} style={{ minWidth: 0 }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: '0.625rem', letterSpacing: '0.06em' }}>{w.label}</p>
            <p className="figure text-xs" style={{ color: q[w.field] == null ? 'var(--color-text-muted)' : pnlColor(q[w.field] * flip), marginTop: 2 }}>
              {formatPct(q[w.field], 1)}
            </p>
          </div>
        ))}
      </div>
    </Shell>
  );
}
