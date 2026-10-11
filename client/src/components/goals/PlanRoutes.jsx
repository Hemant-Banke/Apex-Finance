import { ArrowRight } from 'lucide-react';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ShowMore from '../ui/ShowMore';
import PlanAccount from './PlanAccount';
import { compactIfLarge, formatCurrency, MONTHS_SHORT } from '../../lib/utils';
import { ASSETS } from '../../lib/goals';

const money = (v) => compactIfLarge(Math.round(v || 0));
const monthYear = (iso) => `${MONTHS_SHORT[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;
const what = (cls) => (cls === 'cash' ? 'cash' : ASSETS[cls]?.label.toLowerCase());

function Part({ title, sub, children }) {
  return (
    <div style={{ paddingTop: 16, borderTop: '1px solid var(--color-border-subtle)' }}>
      <div className="flex items-baseline justify-between" style={{ gap: 12, marginBottom: 8 }}>
        <p className="col-head">{title}</p>
        {sub && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

/** The whole plan as instructions, account by account: what to move now, what goes where each month, and what is drawn when. */
export default function PlanRoutes({ plan, names, colours }) {
  const { moves, phases, withdrawals, totals } = plan;
  return (
    <Card>
      <SectionHeader eyebrow="Where the money goes" size="sm" style={{ marginBottom: 16 }}
        sub="The plan as instructions, account by account" />

      <Part title="Now" sub={totals.earmarked ? `${money(totals.earmarked)} set aside for goals` : null}>
        {moves.length ? moves.map(m => (
          <div key={`${m.from.id}-${m.to.id}-${m.cls}`} className="plan-move">
            <PlanAccount account={m.from} sub={what(m.fromClass)} />
            <ArrowRight size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <PlanAccount account={m.to} sub={what(m.cls)} />
            <span className="figure text-sm" style={{ marginLeft: 'auto', color: 'var(--color-text-primary)' }}>{money(m.amount)}</span>
          </div>
        )) : (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            {totals.earmarked ? 'What is set aside already sits where the plan wants it.' : 'Nothing is set aside — every goal starts from scratch.'}
          </p>
        )}
        {totals.unusedLump >= 1 && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
            <span className="figure">{money(totals.unusedLump)}</span> of what you hold is not needed by any goal.
          </p>
        )}
      </Part>

      <Part title="Each month" sub={`today's rupees, rising ${plan.settings.capGrowth}% a year`}>
        {phases.map(p => (
          <div key={p.from} style={{ padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
            <div className="flex items-baseline justify-between" style={{ gap: 12, marginBottom: 7 }}>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {p.from === 0 ? 'From now' : `From ${monthYear(p.start)}`} to {monthYear(p.end)}
              </span>
              <span className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {formatCurrency(Math.round(p.total))}
                {p.free >= 1 && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}> · {money(p.free)} spare</span>}
              </span>
            </div>
            {/* The month split by goal, then where it is invested. */}
            <div className="plan-split">
              {Object.entries(p.byGoal).map(([id, amt]) => (
                <span key={id} title={`${names[id]} · ${formatCurrency(Math.round(amt))}`} style={{ flex: amt, background: colours[id] }} />
              ))}
              {p.free >= 1 && <span title={`${money(p.free)} spare`} style={{ flex: p.free, background: 'var(--color-bg-elevated)' }} />}
            </div>
            <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {p.routes.map(r => <PlanAccount key={r.account.id} account={r.account} sub={formatCurrency(Math.round(r.amount))} />)}
            </div>
          </div>
        ))}
      </Part>

      <Part title="Payouts" sub="the middle outcome">
        {withdrawals.length ? (
          <ShowMore items={withdrawals} initial={5} noun="payouts" render={w => (
            <div key={`${w.goal}-${w.month}`} style={{ padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-baseline" style={{ gap: 10, marginBottom: 7 }}>
                <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', width: 64, flexShrink: 0 }}>{monthYear(w.date)}</span>
                <span className="text-xs flex items-center truncate" style={{ gap: 6, color: 'var(--color-text-secondary)', minWidth: 0, flex: 1 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: colours[w.goal], flexShrink: 0 }} />
                  <span className="truncate">{names[w.goal]}</span>
                </span>
                <span className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>{money(w.amount)}</span>
              </div>
              <div className="flex" style={{ gap: 6, flexWrap: 'wrap', paddingLeft: 74 }}>
                {w.routes.map(r => <PlanAccount key={r.account.id} account={r.account} sub={money(r.amount)} />)}
              </div>
            </div>
          )} />
        ) : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No payouts in the middle outcome.</p>}
      </Part>
    </Card>
  );
}
