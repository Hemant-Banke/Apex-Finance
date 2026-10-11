import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import Card from '../ui/Card';
import GardenEmpty from '../ui/GardenEmpty';
import { compactIfLarge, MONTHS_SHORT } from '../../lib/utils';
import { GOAL_TYPES, goalModel, goalColours, horizonLabel, oddsTone } from '../../lib/goals';
import { useGoalPlan, goalPlanInput, loadGoalPlanSettings } from '../../lib/useGoalPlan';

const money = (v) => compactIfLarge(Math.round(v || 0));
const monthYear = (iso) => `${MONTHS_SHORT[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;
const SHOWN = 4;

/** The goal plan in brief: what it invests each month against the cap, and how the next goals stand. */
export default function GoalsCard({ goals, accounts, portfolio, spending }) {
  const [settings] = useState(loadGoalPlanSettings);
  const models = useMemo(() => goals.map(goalModel).sort((a, b) => a.months - b.months), [goals]);
  const colours = useMemo(() => goalColours(goals), [goals]);
  const input = useMemo(() => (goals.length ? goalPlanInput({ goals, accounts, portfolio, spending }) : null), [goals, accounts, portfolio, spending]);
  const { plan } = useGoalPlan(input, settings);
  const t = plan?.totals;
  const upcoming = models.filter(gm => gm.months > 0).slice(0, SHOWN);

  return (
    <Card flush style={{ display: 'flex', flexDirection: 'column', padding: '22px 24px 20px' }}>
      {/* Same header as Recent activity beside it, so the two eyebrows line up. */}
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <p className="eyebrow">Goals</p>
        <Link to="/goals" className="text-xs font-medium" style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>Goals →</Link>
      </div>

      {!goals.length ? (
        <GardenEmpty card={false} compact icon={Target} title="No goals yet"
          text="Price and date what the money is for — a home, a degree, a sabbatical."
          style={{ flex: 1, borderRadius: 12 }}>
          <Link to="/goals" className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>Add a goal →</Link>
        </GardenEmpty>
      ) : (
        <>
          <div className="flex items-baseline" style={{ gap: 10 }}>
            <span className="figure" style={{ fontSize: '1.6rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{t ? `${t.onTarget} of ${t.count}` : '—'}</span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>goals on target</span>
          </div>

          {/* This month's goal money against the cap, by goal; the rest is spare. */}
          <div className="goals-card-meter" title={t ? `${money(t.monthlyNow)} invested · ${money(t.freeNow)} spare a month` : undefined}>
            {plan && Object.entries(plan.phases[0]?.byGoal || {}).map(([id, amt]) => (
              <span key={id} style={{ width: `${(amt / Math.max(plan.cap0, 1)) * 100}%`, background: colours[id] }} />
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>
            {t ? <>
              <span className="figure">{money(t.monthlyNow)}</span> a month invested, <span className="figure">{money(t.freeNow)}</span> spare
              {t.earmarked >= 1 && <> · <span className="figure">{money(t.earmarked)}</span> set aside</>}
            </> : 'Planning…'}
          </p>

          <div>
            {upcoming.map(gm => {
              const Icon = GOAL_TYPES[gm.goal.type]?.icon || Target;
              const tone = colours[gm.goal._id];
              const gp = plan?.goals[gm.goal._id];
              return (
                <Link key={gm.goal._id} to="/goals" className="goals-card-row">
                  <span className="goals-card-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>
                    <Icon size={15} strokeWidth={1.8} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="truncate" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>{gm.goal.name}</span>
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {monthYear(gm.goal.targetDate)} · in {horizonLabel(gm.months)}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span className="figure" style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>{money(gp?.futureCost ?? gm.futureCost)}</span>
                    {gp && (
                      <span className="text-xs flex items-center" style={{ gap: 5, justifyContent: 'flex-end', color: 'var(--color-text-secondary)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: oddsTone(gp) }} />
                        <span className="figure">{Math.round(gp.odds * 100)}%</span> odds
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
          {models.length > upcoming.length && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 'auto', paddingTop: 12 }}>
              and {models.length - upcoming.length} more on the Goals page
            </p>
          )}
        </>
      )}
    </Card>
  );
}
