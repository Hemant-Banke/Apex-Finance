import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { goalsAPI } from '../../lib/api';
import { compactIfLarge, formatCurrency, CHART_COLORS, todayStr, MONTHS_SHORT } from '../../lib/utils';
import { GOAL_TYPES, PRIORITIES, goalModel, fundingWaterfall, monthsUntil, horizonLabel } from '../../lib/goals';
import { useToast } from '../../context/ToastContext';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import SectionHeader from '../ui/SectionHeader';
import ConfirmModal from '../ui/ConfirmModal';
import Masthead, { MastheadFigure } from '../ui/Masthead';
import GardenEmpty from '../ui/GardenEmpty';
import GoalForm from './GoalForm';
import GoalDetail from './GoalDetail';
import { NeedsChart } from './GoalCharts';

const money = (v) => compactIfLarge(Math.round(v || 0));
const NEUTRAL = 'var(--color-text-muted)';
const monthYear = (iso) => `${MONTHS_SHORT[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;

// Colour follows the goal (creation order), never its rank; past the palette it is neutral.
function colourGoals(goals) {
  const order = [...goals].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return Object.fromEntries(order.map((g, i) => [g._id, CHART_COLORS[i] ?? NEUTRAL]));
}

const tint = (tone, pct = 16) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;

/** Goals on one time axis: a stem rises from each due date to the goal, its disc sized by what it costs then. */
function Timeline({ models, colours, selected, onSelect }) {
  const span = Math.max(12, ...models.map(gm => gm.months)) * 1.04;
  const maxCost = Math.max(...models.map(gm => gm.futureCost));
  const startYear = Number(todayStr().slice(0, 4));
  const years = Math.ceil(span / 12);
  const step = years > 24 ? 5 : years > 10 ? 2 : 1;
  const AXIS = 132;
  // Stems alternate between three heights so neighbouring labels do not collide.
  const LIFT = [38, 74, 110];
  return (
    <div style={{ position: 'relative', height: AXIS + 30, margin: '10px 22px 0' }}>
      <div className="goal-axis" style={{ top: AXIS }} />
      {Array.from({ length: Math.floor(years / step) + 1 }, (_, i) => i * step).map(y => (
        <span key={y} className="figure" style={{ position: 'absolute', top: AXIS + 10, left: `${(y * 12 / span) * 100}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--color-text-muted)' }}>
          {y === 0 ? 'Now' : startYear + y}
        </span>
      ))}
      {models.map((gm, i) => {
        const tone = colours[gm.goal._id];
        const on = selected === gm.goal._id;
        const size = 22 + 14 * Math.sqrt(gm.futureCost / maxCost);
        const lift = LIFT[i % LIFT.length];
        const Icon = GOAL_TYPES[gm.goal.type]?.icon || GOAL_TYPES.other.icon;
        const left = `${(gm.months / span) * 100}%`;
        return (
          <div key={gm.goal._id}>
            <span style={{ position: 'absolute', left, top: AXIS - lift, height: lift, width: 1, background: `linear-gradient(${tone}, ${tint(tone, 10)})`, opacity: on ? 1 : 0.6 }} />
            <span style={{ position: 'absolute', left, top: AXIS, width: 7, height: 7, borderRadius: 99, transform: 'translate(-50%, -50%)', background: tone }} />
            <button type="button" onClick={() => onSelect(gm.goal._id)} className="goal-pin"
              title={`${gm.goal.name} · ${money(gm.futureCost)} · ${monthYear(gm.goal.targetDate)}`}
              style={{ left, top: AXIS - lift, '--tone': tone, opacity: on || !selected ? 1 : 0.72 }}>
              <span className="goal-pin-disc" style={{ width: size, height: size, boxShadow: on ? `0 0 0 2px var(--color-bg-card), 0 0 0 3.5px ${tone}` : undefined }}>
                <Icon size={Math.round(size * 0.48)} strokeWidth={1.9} />
              </span>
              <span className={`goal-pin-label${gm.months / span > 0.72 ? ' is-left' : ''}`}>
                <span style={{ color: on ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{gm.goal.name}</span>
                <span className="figure" style={{ color: 'var(--color-text-muted)' }}>{money(gm.futureCost)}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Priority first, then date: what the monthly surplus pays for, and where it runs out. */
function Funding({ rows, surplus, colours }) {
  const committed = rows.reduce((s, r) => s + r.need, 0);
  const scale = Math.max(surplus, committed, 1);
  const left = surplus - committed;
  return (
    <Card>
      <SectionHeader eyebrow="Funding" size="sm" style={{ marginBottom: 16 }}
        sub={`What your ${money(surplus)}-a-month surplus carries, most important first`} />
      {rows.map(r => (
        <div key={r.gm.goal._id} style={{ padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-baseline justify-between" style={{ gap: 12, marginBottom: 7 }}>
            <span className="text-sm flex items-center truncate" style={{ gap: 8, color: 'var(--color-text-secondary)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: colours[r.gm.goal._id], flexShrink: 0 }} />
              <span className="truncate">{r.gm.goal.name}</span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{PRIORITIES[r.gm.goal.priority].label}</span>
            </span>
            <span className="figure text-xs" style={{ color: r.short > 1 ? 'var(--color-danger)' : 'var(--color-text-primary)', flexShrink: 0 }}>
              {r.need ? `${formatCurrency(Math.round(r.need))}/mo` : 'funded'}{r.short > 1 ? ` · ${money(r.short)} short` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', height: 6, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden', gap: 2 }}>
            <div style={{ width: `${(r.covered / scale) * 100}%`, background: colours[r.gm.goal._id] }} />
            {r.short > 1 && <div style={{ width: `${(r.short / scale) * 100}%`, background: tint('var(--color-danger)', 55) }} />}
          </div>
        </div>
      ))}
      <div className="flex items-baseline justify-between" style={{ gap: 12, paddingTop: 12, borderTop: '1px solid var(--color-border-subtle)' }}>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{left >= 0 ? 'Left for independence' : 'Goals ask more than you save'}</span>
        <span className="figure text-sm" style={{ color: left >= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>{money(Math.abs(left))} a month</span>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.55 }}>
        Surplus is your average income less spending. Each goal is shown at what Apex suggests investing for it;
        goal money comes out of the same pot as your independence plan.
      </p>
    </Card>
  );
}

/** One goal as a card: what it is, what it costs when due, and what it takes a month. */
function GoalCard({ gm, tone, selected, onSelect, onEdit, onDelete }) {
  const { goal } = gm;
  const Icon = GOAL_TYPES[goal.type]?.icon || GOAL_TYPES.other.icon;
  const due = Number.isFinite(gm.need);
  return (
    <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={e => e.key === 'Enter' && onSelect()}
      className={`goal-card group${selected ? ' is-selected' : ''}`} style={{ '--tone': tone }}>
      <div className="flex items-start justify-between" style={{ gap: 10 }}>
        <span className="goal-card-icon"><Icon size={17} strokeWidth={1.8} /></span>
        <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100" style={{ gap: 2, transition: 'opacity 0.15s' }}>
          <button type="button" className="btn-icon" title="Edit" aria-label="Edit goal" style={{ width: 28, height: 28 }}
            onClick={e => { e.stopPropagation(); onEdit(); }}><Pencil size={13} /></button>
          <button type="button" className="btn-icon" title="Delete" aria-label="Delete goal" style={{ width: 28, height: 28 }}
            onClick={e => { e.stopPropagation(); onDelete(); }}><Trash2 size={13} /></button>
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <p className="text-sm truncate" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{goal.name}</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>
          {PRIORITIES[goal.priority].label} · {monthYear(goal.targetDate)}{gm.months ? ` · in ${horizonLabel(gm.months)}` : ''}
        </p>
      </div>

      <div>
        <p className="figure goal-card-figure">{money(gm.futureCost)}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>
          when due · {money(goal.amount)} today{goal.withdrawal?.mode === 'spread' ? `, over ${goal.withdrawal.years} yrs` : ''}
        </p>
      </div>

      <div className="goal-card-foot">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{due ? 'Invest a month' : 'Date has arrived'}</span>
        {due && <span className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>{formatCurrency(Math.round(gm.monthly))}</span>}
      </div>
    </div>
  );
}

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
      text="Give each goal a price and a date. Apex works out what it costs by then, and the corpus it needs.">
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

/** The Goals page body. `surplus` is the monthly income less spending. */
export default function GoalsView({ surplus }) {
  const toast = useToast();
  const [goals, setGoals] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);      // { goal } or { type }
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    goalsAPI.getAll().then(r => setGoals(r.data))
      .catch(e => { setGoals([]); toast.error(e.response?.data?.message || 'Failed to load goals'); });
  }, [toast]);

  const models = useMemo(() => (goals || []).map(goalModel).sort((a, b) => a.months - b.months), [goals]);
  const colours = useMemo(() => colourGoals(goals || []), [goals]);
  const current = models.find(gm => gm.goal._id === selected) || models[0];
  const funding = useMemo(() => fundingWaterfall(models, surplus), [models, surplus]);

  const needs = useMemo(() => {
    const startYear = Number(todayStr().slice(0, 4));
    const byYear = {};
    for (const gm of models) {
      const first = startYear + Math.round(monthsUntil(gm.goal.targetDate) / 12);
      gm.draws.forEach((w, k) => {
        const y = first + k;
        byYear[y] ??= { year: y, total: 0 };
        byYear[y][gm.goal._id] = (byYear[y][gm.goal._id] || 0) + w;
        byYear[y].total += w;
      });
    }
    const ys = Object.keys(byYear).map(Number);
    if (!ys.length) return [];
    const out = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push(byYear[y] || { year: y, total: 0 });
    return out;
  }, [models]);

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
    <GoalForm open key={form.goal?._id || form.type || 'new'} goal={form.goal}
      initialType={form.type} onClose={() => setForm(null)} onSave={save} />
  );

  if (!models.length) return <>{<Empty onAdd={type => setForm({ type })} />}{formEl}</>;

  const today = models.reduce((s, gm) => s + gm.goal.amount, 0);
  const then = models.reduce((s, gm) => s + gm.futureCost, 0);
  const needed = funding.reduce((s, r) => s + r.need, 0);
  const left = surplus - needed;
  const next = models.find(gm => gm.months > 0);
  const goalList = models.map(gm => ({ id: gm.goal._id, name: gm.goal.name, color: colours[gm.goal._id] }));
  const barScale = Math.max(surplus, needed, 1);

  return (
    <>
      <Masthead
        lead={<>
          <p className="eyebrow" style={{ marginBottom: 12 }}>
            {models.length} goal{models.length === 1 ? '' : 's'}{next ? ` · next is ${next.goal.name}, in ${horizonLabel(next.months)}` : ''}
          </p>
          <p className="display-number figure" style={{ fontSize: 'clamp(1.9rem, 4vw, 2.5rem)', color: 'var(--color-text-primary)' }}>{money(then)}</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
            what they cost when they fall due · {money(today)} in today’s rupees
          </p>
        </>}
        action={<Button variant="gold" icon={Plus} onClick={() => setForm({})}>Add goal</Button>}
        band={<>
          {/* The monthly surplus, split by what each goal takes; the rest is free. */}
          <div style={{ display: 'flex', height: 6, gap: 2, borderRadius: 99, overflow: 'hidden', background: 'var(--color-bg-elevated)', marginBottom: 16 }}
            title="Your monthly surplus, by what each goal takes">
            {funding.filter(r => r.need > 0).map(r => (
              <div key={r.gm.goal._id} style={{ width: `${(r.need / barScale) * 100}%`, background: colours[r.gm.goal._id] }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 20 }}>
            <MastheadFigure label="Goals take a month" value={money(needed)} />
            <MastheadFigure label="Monthly surplus" value={money(surplus)} />
            <MastheadFigure label={left >= 0 ? 'Left for independence' : 'Short a month'} value={money(Math.abs(left))}
              accent={left < 0 ? 'var(--color-danger)' : 'var(--color-accent)'} />
          </div>
        </>} />

      <Card>
        <SectionHeader eyebrow="Timeline" size="sm" style={{ marginBottom: 6 }} sub="When each goal falls due · size is what it costs then" />
        <Timeline models={models} colours={colours} selected={current?.goal._id} onSelect={setSelected} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {models.map(gm => (
          <GoalCard key={gm.goal._id} gm={gm} tone={colours[gm.goal._id]} selected={current?.goal._id === gm.goal._id}
            onSelect={() => setSelected(gm.goal._id)} onEdit={() => setForm({ goal: gm.goal })} onDelete={() => setDeleting(gm.goal)} />
        ))}
        <button type="button" className="starter-card" onClick={() => setForm({})}
          style={{ '--tone': 'var(--color-accent)', minHeight: 0, alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
          <Plus size={18} />
          <span className="text-sm">Add a goal</span>
        </button>
      </div>

      {current && <GoalDetail key={current.goal._id + current.goal.updatedAt} gm={current} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Funding rows={funding} surplus={surplus} colours={colours} />
        <Card>
          <SectionHeader eyebrow="When the money is needed" size="sm" style={{ marginBottom: 12 }}
            sub="Each year’s payouts, inflated to that year" />
          <div className="flex" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
            {goalList.map(g => (
              <span key={g.id} className="text-xs flex items-center" style={{ gap: 6, color: 'var(--color-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />{g.name}
              </span>
            ))}
          </div>
          <NeedsChart data={needs} goals={goalList} />
        </Card>
      </div>

      {formEl}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => remove(deleting)}
        title="Remove goal" confirmLabel="Remove"
        message={deleting ? `Remove “${deleting.name}”? It is a plan, not money — no balance or transaction changes.` : ''} />
    </>
  );
}
