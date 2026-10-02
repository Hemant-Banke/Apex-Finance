import { compactIfLarge, formatDate, formatPct, pnlColor } from '../../lib/utils';
import Card from '../ui/Card';
import Divider from '../ui/Divider';
import SectionHeader from '../ui/SectionHeader';
import { MastheadFigure } from '../ui/Masthead';
import ContributionBreakdown from './ContributionBreakdown';

const muted = (text) => <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{text}</span>;

/**
 * What an account's investments have made: lifetime gain split into on-paper and booked,
 * the money-weighted annual rate, and which holdings produced it over a chosen window.
 * `totals` is `/dashboard/portfolio?account=`'s totals.
 */
export default function PerformancePanel({ totals, account, id, sub }) {
  const t = totals;
  return (
    <Card id={id}>
      <SectionHeader eyebrow="Performance" size="sm" style={{ marginBottom: 22 }}
        sub={sub ?? 'What the investments here have made — on paper, booked, and per year'} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 20 }}>
        <MastheadFigure tight label="Total gain" value={compactIfLarge(Math.round(t.totalGain || 0))} accent={pnlColor(t.totalGain)}
          sub={muted(t.since ? `since ${formatDate(t.since)}` : 'unrealised + realised')} />
        <MastheadFigure tight label="Unrealised" value={compactIfLarge(Math.round(t.unrealisedPnl || 0))} accent={pnlColor(t.unrealisedPnl)}
          sub={t.invested > 0
            ? <span className="figure text-xs" style={{ color: pnlColor(t.unrealisedPnl) }}>{formatPct(t.unrealisedPnlPct, 1)} on cost</span>
            : muted('nothing held')} />
        <MastheadFigure tight label="Realised" value={compactIfLarge(Math.round(t.realisedPnl || 0))} accent={pnlColor(t.realisedPnl)}
          sub={muted('booked on sales')} />
        <MastheadFigure tight label="XIRR" value={t.xirr == null ? '—' : formatPct(t.xirr, 1)} accent={t.xirr == null ? undefined : pnlColor(t.xirr)}
          sub={muted(t.xirr == null ? 'needs 90 days of history' : 'a year, money-weighted')} />
        <MastheadFigure tight label="Last session" value={compactIfLarge(Math.round(t.dayChange || 0))} accent={pnlColor(t.dayChange)}
          sub={t.holdingsCount
            ? <span className="figure text-xs" style={{ color: pnlColor(t.dayChange) }}>{formatPct(t.dayChangePct, 2)}</span>
            : muted('nothing held')} />
        <MastheadFigure tight label="Invested" value={compactIfLarge(Math.round(t.invested || 0))}
          sub={muted(`cost of ${t.holdingsCount || 0} holding${t.holdingsCount === 1 ? '' : 's'}`)} />
      </div>

      {!t.priced && (
        <p className="text-xs" style={{ color: 'var(--color-chart-warm)', marginTop: 16 }}>
          Some holdings have no quote and are valued at cost — their gain is unknown, not zero.
        </p>
      )}

      <Divider gilt margin={26} />
      <ContributionBreakdown account={account} bare />
    </Card>
  );
}
