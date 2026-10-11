import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import Spinner from '../ui/Spinner';
import { compactIfLarge, formatPoints } from '../../lib/utils';

const money = (v) => compactIfLarge(Math.round(Math.abs(v || 0)));

/** One lever's effect: goals crossing their target, the odds of goals below it, and the spare money. */
export function LeverEffects({ lever: l, plan, names, colours, exclude }) {
  const below = new Set(Object.entries(plan.goals).filter(([, g]) => !g.due && g.odds < g.target).map(([id]) => id));
  const moved = Object.entries(l.delta).filter(([id, d]) => below.has(id) && id !== exclude && !l.crossed.includes(id) && Math.abs(d) >= 2)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2);
  const crossed = l.crossed.map(id => ({ id, up: (l.odds[id] ?? 0) >= plan.goals[id].target }));
  // Below 1% of the plan's headroom a change is within the optimiser's step, not a finding.
  const head = Math.abs(l.headroom) >= Math.max(10000, 0.01 * (l.baseHeadroom || 0));
  return (
    <span className="plan-lever-effects">
      {crossed.map(c => (
        <span key={c.id} className="plan-lever-chip" style={{ color: c.up ? 'var(--color-success)' : 'var(--color-danger)' }}>
          <i style={{ background: colours[c.id] }} />{names[c.id]} {c.up ? 'reaches' : 'misses'} its target
        </span>
      ))}
      {moved.map(([id, d]) => (
        <span key={id} className="plan-lever-chip">
          <i style={{ background: colours[id] }} />{names[id]} <span className="figure" style={{ color: d > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatPoints(d, 0)}</span>
        </span>
      ))}
      {head && (
        <span className="plan-lever-chip" title="Present value of the money the plan leaves unused">
          <span className="figure" style={{ color: l.headroom > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {l.headroom > 0 ? '+' : '−'}{money(l.headroom)}
          </span> spare
        </span>
      )}
      {!crossed.length && !moved.length && !head && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>no change</span>}
    </span>
  );
}

/**
 * What moves the whole plan: each lever re-solves it with one assumption changed. A goal already
 * at its target cannot gain, so the effect shows where it can — goals crossing their target, the
 * odds of goals below it, and the money left spare (its present value).
 */
export default function PlanLevers({ levers, plan, names, colours }) {
  return (
    <Card>
      <SectionHeader eyebrow="What moves the plan" size="sm" style={{ marginBottom: 14 }}
        sub="Each line re-solves every goal with one assumption changed" />
      {!levers ? <Spinner height={220} label="Re-solving the plan" /> : (
        <div className="plan-levers">
          {levers.map(l => (
            <div key={l.key} className="plan-lever">
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{l.label}</span>
              <LeverEffects lever={l} plan={plan} names={names} colours={colours} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
