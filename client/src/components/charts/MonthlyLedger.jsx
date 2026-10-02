import ShowMore from '../ui/ShowMore';
import { compactIfLarge, monthLabel, pnlColor } from '../../lib/utils';

// One ruled line per active month (newest first), closing on an Average-month summary.
// Averages run over months with activity, so empty months do not halve a real habit.
const COL = { money: 108, rate: 62 };

function LedgerHead() {
  return (
    <div className="flex items-center" style={{ gap: 16, paddingBottom: 10, borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span className="col-head" style={{ flex: 1, minWidth: 96 }}>Month</span>
      <span className="col-head" style={{ width: COL.money, textAlign: 'right', flexShrink: 0 }}>In</span>
      <span className="col-head" style={{ width: COL.money, textAlign: 'right', flexShrink: 0 }}>Out</span>
      <span className="col-head" style={{ width: COL.money, textAlign: 'right', flexShrink: 0 }}>Net</span>
      <span className="col-head" style={{ width: COL.rate,  textAlign: 'right', flexShrink: 0 }}>Saved</span>
    </div>
  );
}

export default function MonthlyLedger({ rows, avgIncome, avgExpense, overallRate }) {
  // Only worth naming a best and a worst when there is more than one month to rank.
  const byNet = [...rows].sort((a, b) => b.net - a.net);
  const best  = byNet.length > 1 ? byNet[0].month : null;
  const worst = byNet.length > 1 ? byNet[byNet.length - 1].month : null;

  // Newest first: a ledger is read from the month you are living in, backwards.
  const ordered = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  const avgNet  = avgIncome - avgExpense;

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 480 }}>
        <LedgerHead />

        {/* The latest six months open; the rest of the window is a click away. The
            summary line stays put beneath whatever is showing — it is the ledger's
            answer, and it describes the WHOLE window either way. */}
        <ShowMore items={ordered} initial={6} noun="months"
          // `body`, not `rows`: the summary below counts the ledger's own `rows` (every
          // active month), and a parameter of that name would silently count the six
          // rows on screen instead.
          wrap={(body) => (
            <>
              {body}
          {/* The totals line of a ledger, in the app's own accent so it reads as the
              summary OF the rows above rather than one more of them. */}
          <div className="flex items-center"
            style={{ gap: 16, padding: '13px 0 0', marginTop: 2, borderTop: '1px solid var(--color-accent-dim)' }}>
            <span className="text-sm" style={{ flex: 1, minWidth: 96, color: 'var(--color-accent)' }}>
              Average month
              <span className="text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                over {rows.length} active month{rows.length === 1 ? '' : 's'}
              </span>
            </span>
            <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-primary)' }}>
              {compactIfLarge(avgIncome)}
            </span>
            <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-primary)' }}>
              {compactIfLarge(avgExpense)}
            </span>
            <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, fontWeight: 500, color: pnlColor(avgNet) }}>
              {compactIfLarge(avgNet)}
            </span>
            <span className="figure text-sm" style={{ width: COL.rate, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-muted)' }}>
              {overallRate == null ? '—' : `${overallRate.toFixed(0)}%`}
            </span>
          </div>
            </>
          )}
          render={(m) => (
            <div key={m.month} className="flex items-center"
              style={{ gap: 16, padding: '11px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <span className="text-sm" style={{ flex: 1, minWidth: 96, color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                <span className="truncate">{monthLabel(m.month)}</span>
                {/* The ranking, on the row it is about — where "Best month · ₹42k" in a
                    tile could only ever be a claim about a row you then had to find. */}
                {(m.month === best || m.month === worst) && (
                  <span className="text-xs" style={{ flexShrink: 0, opacity: 0.85, color: m.month === best ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {m.month === best ? 'best' : 'worst'}
                  </span>
                )}
              </span>
              <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-secondary)' }}>
                {compactIfLarge(m.income)}
              </span>
              <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-secondary)' }}>
                {compactIfLarge(m.expense)}
              </span>
              <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, fontWeight: 500, color: pnlColor(m.net) }}>
                {compactIfLarge(m.net)}
              </span>
              {/* A month with no income has no rate at all — that is not the same as
                  having kept none of it, so it prints as nothing rather than 0%. */}
              <span className="figure text-sm" style={{ width: COL.rate, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-muted)' }}>
                {m.savingsRate == null ? '—' : `${m.savingsRate.toFixed(0)}%`}
              </span>
            </div>
          )} />
      </div>
    </div>
  );
}
