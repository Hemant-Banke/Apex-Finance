import { useEffect, useMemo, useState } from 'react';
import { Plus, Info } from 'lucide-react';
import { goalsAPI } from '../../lib/api';
import { compactIfLarge, CHART_COLORS } from '../../lib/utils';
import { GOAL_TYPES, goalModel, goalColours, horizonLabel } from '../../lib/goals';
import { useGoalPlan, goalPlanInput, loadGoalPlanSettings, saveGoalPlanSettings } from '../../lib/useGoalPlan';
import { useToast } from '../../context/ToastContext';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import SectionHeader from '../ui/SectionHeader';
import ConfirmModal from '../ui/ConfirmModal';
import { PageBar } from '../layout/TopBar';
import Masthead, { MastheadFigure } from '../ui/Masthead';
import GardenEmpty from '../ui/GardenEmpty';
import GoalForm from './GoalForm';
import GoalCard from './GoalCard';
import GoalDetail from './GoalDetail';
import GoalTimeline from './GoalTimeline';
import PlanRoutes from './PlanRoutes';
import PlanLevers from './PlanLevers';
import GoalAssumptions from './GoalAssumptions';
import PlanMethod from './PlanMethod';

const money = (v) => compactIfLarge(Math.round(v || 0));
const tint = (tone, pct = 16) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;

const STARTERS = [
  { type: 'home',       what: 'A down payment, paid on the day' },
  { type: 'education',  what: 'Fees, drawn over four years' },
  { type: 'car',        what: 'Bought outright, not on a loan' },
  { type: 'wedding',    what: 'One season, fully paid' },
  { type: 'travel',     what: 'The long trip, saved for' },
  { type: 'emergency',  what: 'Six months of spending, held safe' },
];
function Empty({ onAdd }) {
  return (
    <GardenEmpty eyebrow="Goals" title="Name what the money is for"
      text="Give each goal a price and a date. Apex plans them together: what each can take from what you hold, what to invest each month, and where.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, maxWidth: 760, margin: '0 auto 18px' }}>
        {STARTERS.map(({ type, what }, i) => {
          const T = GOAL_TYPES[type];
          const tone = CHART_COLORS[i];
          return (
            <button key={type} type="button" onClick={() => onAdd(type)} className="starter-card starter-row" style={{ '--tone': tone }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: tint(tone), color: tone }}>
                <T.icon size={16} strokeWidth={1.7} />
              </span>
              <span style={{ textAlign: 'left', minWidth: 0 }}>
                <span className="text-sm" style={{ display: 'block', color: 'var(--color-text-primary)', fontWeight: 500 }}>{T.label}</span>
                <span className="text-xs truncate" style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 2 }}>{what}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Button variant="gold" icon={Plus} onClick={() => onAdd()}>Add your own goal</Button>
    </GardenEmpty>
  );
}

/** The Goals page body: every goal planned together against what you hold and what you save. */
export default function GoalsView({ spending, accounts, portfolio }) {
  const toast = useToast();
  const [goals, setGoals] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);      // { goal } or { type }
  const [deleting, setDeleting] = useState(null);
  const [settings, setSettings] = useState(loadGoalPlanSettings);
  const [method, setMethod] = useState(false);

  useEffect(() => {
    goalsAPI.getAll().then(r => setGoals(r.data))
      .catch(e => { setGoals([]); toast.error(e.response?.data?.message || 'Failed to load goals'); });
  }, [toast]);

  const changeSettings = (s) => { setSettings(s); saveGoalPlanSettings(s); };
  const models = useMemo(() => (goals || []).map(goalModel).sort((a, b) => a.months - b.months), [goals]);
  const colours = useMemo(() => goalColours(goals || []), [goals]);
  const names = useMemo(() => Object.fromEntries((goals || []).map(g => [g._id, g.name])), [goals]);
  const current = models.find(gm => gm.goal._id === selected) || models.find(gm => gm.months > 0) || models[0];
  const input = useMemo(() => (goals?.length ? goalPlanInput({ goals, accounts, portfolio, spending }) : null), [goals, accounts, portfolio, spending]);
  const { plan, levers, goalLevers } = useGoalPlan(input, settings, current?.goal._id);

  if (!goals) return <Spinner height={300} />;

  const save = async (data) => {
    try {
      if (form.goal) {
        const { data: g } = await goalsAPI.update(form.goal._id, data);
        setGoals(gs => gs.map(x => (x._id === g._id ? g : x)));
        toast.success('Goal updated');
      } else {
        const { data: g } = await goalsAPI.create(data);
        setGoals(gs => [...gs, g]);
        setSelected(g._id);
        toast.success('Goal added');
      }
    } catch (e) { toast.error(e.response?.data?.message || 'Could not save the goal'); throw e; }
  };

  const remove = async (goal) => {
    try {
      await goalsAPI.delete(goal._id);
      setGoals(gs => gs.filter(x => x._id !== goal._id));
      toast.success('Goal removed');
    } catch (e) { toast.error(e.response?.data?.message || 'Could not remove the goal'); }
  };

  const formEl = form && (
    <GoalForm open key={`form-${form.goal?._id || form.type || 'new'}`} goal={form.goal}
      initialType={form.type} onClose={() => setForm(null)} onSave={save} />
  );

  if (!models.length) return <>{<Empty onAdd={type => setForm({ type })} />}{formEl}</>;

  const surplus = Math.max(0, (spending?.income || 0) - (spending?.expense || 0));
  const then = models.reduce((s, gm) => s + (plan?.goals[gm.goal._id]?.futureCost ?? gm.futureCost), 0);
  const next = models.find(gm => gm.months > 0);
  const t = plan?.totals;
  const cap = plan?.cap0 ?? settings.cap ?? surplus;
  const rows = models.map(gm => ({ gm, gp: plan?.goals[gm.goal._id], tone: colours[gm.goal._id] }));

  return (
    <>
      <PageBar actions={<>
        <Button variant="secondary" icon={Info} disabled={!plan} onClick={() => setMethod(true)}>How it works</Button>
        <Button variant="gold" icon={Plus} onClick={() => setForm({})}>Add goal</Button>
      </>} />
      <Masthead
        lead={<>
          <p className="eyebrow" style={{ marginBottom: 12 }}>
            {models.length} goal{models.length === 1 ? '' : 's'}{next ? ` · next is ${next.goal.name}, in ${horizonLabel(next.months)}` : ''}
          </p>
          <p className="display-number figure" style={{ fontSize: 'clamp(1.9rem, 4vw, 2.5rem)', color: 'var(--color-text-primary)' }}>{money(then)}</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
            what they cost when they fall due · {t ? `${t.onTarget} of ${t.count} on target` : 'planning…'}
          </p>
        </>}
        band={<>
          {/* This month's goal money, by goal; what is left is spare. */}
          <div style={{ display: 'flex', height: 6, gap: 2, borderRadius: 99, overflow: 'hidden', background: 'var(--color-bg-elevated)', marginBottom: 16 }}
            title="This month's goal money, by goal">
            {plan && Object.entries(plan.phases[0]?.byGoal || {}).map(([id, amt]) => (
              <div key={id} style={{ width: `${(amt / Math.max(cap, 1)) * 100}%`, background: colours[id] }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 20 }}>
            <MastheadFigure label="Set aside today" value={t ? money(t.earmarked) : '—'} />
            <MastheadFigure label="Invested a month" value={t ? money(t.monthlyNow) : '—'} />
            <MastheadFigure label="Monthly cap" value={money(cap)} />
            <MastheadFigure label="Spare a month" value={t ? money(t.freeNow) : '—'} accent="var(--color-accent)" />
          </div>
        </>} />

      <Card>
        <SectionHeader eyebrow="Timeline" size="sm" style={{ marginBottom: 8 }}
          sub="Each goal at its date, its ring filled to its odds · below, what the plan invests each month, goal by goal" />
        {plan ? <GoalTimeline rows={rows} phases={plan.phases} cap={cap} today={plan.today} selected={current?.goal._id} onSelect={setSelected} />
          : <Spinner height={280} label="Planning your goals" />}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {rows.map(r => (
          <GoalCard key={r.gm.goal._id} gm={r.gm} gp={r.gp} tone={r.tone} today={plan?.today}
            selected={current?.goal._id === r.gm.goal._id} onSelect={() => setSelected(r.gm.goal._id)}
            onEdit={() => setForm({ goal: r.gm.goal })} onDelete={() => setDeleting(r.gm.goal)} />
        ))}
        <button type="button" className="starter-card goal-add-card" onClick={() => setForm({})}>
          <Plus size={18} />
          <span className="text-sm">Add a goal</span>
        </button>
      </div>

      {current && plan?.goals[current.goal._id] && (
        <GoalDetail key={`detail-${current.goal._id}`} gm={current} gp={plan.goals[current.goal._id]} plan={plan}
          levers={goalLevers[current.goal._id]} tone={colours[current.goal._id]} names={names} colours={colours} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, alignItems: 'start' }}>
        {plan ? <PlanRoutes plan={plan} names={names} colours={colours} /> : <Card><Spinner height={260} /></Card>}
        <GoalAssumptions settings={settings} onChange={changeSettings} surplus={surplus}
          monthlySpend={spending?.expense || 0} sources={plan?.sources} />
      </div>

      {plan && <PlanLevers levers={levers} plan={plan} names={names} colours={colours} />}
      {plan && <PlanMethod plan={plan} open={method} onClose={() => setMethod(false)} />}

      {formEl}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => remove(deleting)}
        title="Remove goal" confirmLabel="Remove"
        message={deleting ? `Remove “${deleting.name}”? It is a plan, not money — no balance or transaction changes.` : ''} />
    </>
  );
}
