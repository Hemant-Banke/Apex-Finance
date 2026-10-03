import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { goalsAPI } from '../../lib/api';
import { compactIfLarge, formatCurrency, CHART_COLORS, todayStr } from '../../lib/utils';
import { GOAL_TYPES, PRIORITIES, goalModel, fundingWaterfall, monthsUntil } from '../../lib/goals';
import { useToast } from '../../context/ToastContext';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import SectionHeader from '../ui/SectionHeader';
import ConfirmModal from '../ui/ConfirmModal';
import Masthead, { MastheadFigure } from '../ui/Masthead';
import GoalForm from './GoalForm';
import GoalDetail from './GoalDetail';
import { NeedsChart } from './GoalCharts';

const money = (v) => compactIfLarge(Math.round(v || 0));
const NEUTRAL = 'var(--color-text-muted)';
const horizon = (months) => (months < 12 ? `${months} mo` : `${+(months / 12).toFixed(1)} yrs`);

// Colour follows the goal (creation order), never its rank; past the palette it is neutral.
function colourGoals(goals) {
  const order = [...goals].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return Object.fromEntries(order.map((g, i) => [g._id, CHART_COLORS[i] ?? NEUTRAL]));
}

function Bar({ pct, tone }) {
  return (
    <div style={{ height: 3, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: tone, borderRadius: 99, transition: 'width 0.4s ease' }} />
    </div>
  );
}

/** Goals on one time axis — where each falls, sized by what it costs then. */
function Timeline({ models, colours, selected, onSelect }) {
  const span = Math.max(12, ...models.map(gm => gm.months));
  const maxCost = Math.max(...models.map(gm => gm.futureCost));
  const startYear = Number(todayStr().slice(0, 4));
  const years = Math.ceil(span / 12);
  const step = years > 20 ? 5 : years > 8 ? 2 : 1;
  return (
    <div style={{ position: 'relative', height: 118, margin: '6px 18px 0' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 60, height: 1, background: 'var(--color-border-hover)' }} />
      {Array.from({ length: Math.floor(years / step) + 1 }, (_, i) => i * step).map(y => (
        <span key={y} className="figure" style={{ position: 'absolute', top: 70, left: `${(y * 12 / span) * 100}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--color-text-muted)' }}>
          {y === 0 ? 'Now' : startYear + y}
        </span>
      ))}
      {models.map((gm, i) => {
        const size = 10 + 16 * Math.sqrt(gm.futureCost / maxCost);
        const on = selected === gm.goal._id;
        const above = i % 2 === 0;
        return (
          <button key={gm.goal._id} type="button" onClick={() => onSelect(gm.goal._id)}
            title={`${gm.goal.name} · ${money(gm.futureCost)} in ${horizon(gm.months)}`}
            style={{ position: 'absolute', left: `${(gm.months / span) * 100}%`, top: 60, transform: 'translate(-50%, -50%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <span style={{
              display: 'block', width: size, height: size, borderRadius: '50%', background: colours[gm.goal._id],
              boxShadow: on ? '0 0 0 2px var(--color-bg-card), 0 0 0 3.5px var(--color-text-primary)' : '0 0 0 2px var(--color-bg-card)',
            }} />
            <span className="text-xs" style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
              [above ? 'bottom' : 'top']: size + 8, color: on ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}>{gm.goal.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Priority first, then date: what the monthly surplus pays for, and where it runs out. */
function Funding({ rows, surplus, planned, colours }) {
  const scale = Math.max(surplus, rows.reduce((s, r) => s + r.need, 0), 1);
  const committed = rows.reduce((s, r) => s + r.need, 0);
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
            <div style={{ width: `${(r.covered / scale) * 100}%`, background: 'var(--color-accent)' }} />
            {r.short > 1 && <div style={{ width: `${(r.short / scale) * 100}%`, background: 'color-mix(in srgb, var(--color-danger) 55%, transparent)' }} />}
          </div>
        </div>
      ))}
      <div className="flex items-baseline justify-between" style={{ gap: 12, paddingTop: 12, borderTop: '1px solid var(--color-border-subtle)' }}>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{left >= 0 ? 'Left for independence' : 'Goals ask more than you save'}</span>
        <span className="figure text-sm" style={{ color: left >= 0 ? 'var(--color-accent)' : 'var(--color-danger)' }}>{money(Math.abs(left))} a month</span>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.55 }}>
        Surplus is your average income less spending. You plan to invest {money(planned)} a month across these goals;
        the bars show what each NEEDS on the middle path. Goal money comes out of the same pot as your independence plan.
      </p>
    </Card>
  );
}

function GoalRow({ gm, colour, selected, onSelect, onEdit, onDelete }) {
  const { goal } = gm;
  const Icon = GOAL_TYPES[goal.type]?.icon || GOAL_TYPES.other.icon;
  const gap = gm.gap;
  return (
    <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={e => e.key === 'Enter' && onSelect()} className="group"
      style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) repeat(3, minmax(0, 1fr)) 64px', gap: 18, alignItems: 'center',
        padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
        background: selected ? 'var(--color-bg-elevated)' : 'transparent',
        boxShadow: selected ? 'inset 0 0 0 1px var(--color-border-hover)' : 'none',
      }}>
      <div className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, color: colour, background: `color-mix(in srgb, ${colour} 16%, transparent)` }}>
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="text-sm truncate" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{goal.name}</p>
          <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            {PRIORITIES[goal.priority].label} · {String(goal.targetDate).slice(0, 4)} · {horizon(gm.months)}
          </p>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>{money(gm.futureCost)}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{money(goal.amount)} today</p>
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="figure text-sm" style={{ color: 'var(--color-text-secondary)', marginBottom: 6 }}>{gm.funded.toFixed(0)}% <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>funded</span></p>
        <Bar pct={gm.funded} tone={colour} />
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="figure text-sm" style={{ color: gm.status.tone }}>{gm.prob.toFixed(0)}% <span className="text-xs">{gm.status.label}</span></p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
          {!Number.isFinite(gap) ? 'date has arrived' : gap > 1 ? `${money(gap)}/mo more needed` : 'contributions suffice'}
        </p>
      </div>
      <div className="flex justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100" style={{ gap: 2, transition: 'opacity 0.15s' }}>
        <button type="button" className="btn-icon" title="Edit" aria-label="Edit goal" style={{ width: 28, height: 28 }}
          onClick={e => { e.stopPropagation(); onEdit(); }}><Pencil size={13} /></button>
        <button type="button" className="btn-icon" title="Delete" aria-label="Delete goal" style={{ width: 28, height: 28 }}
          onClick={e => { e.stopPropagation(); onDelete(); }}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function Empty({ onAdd }) {
  return (
    <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
      <p className="eyebrow" style={{ justifyContent: 'center', marginBottom: 14 }}>Goals</p>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', color: 'var(--color-text-primary)' }}>Name what the money is for</h2>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: '10px auto 22px', maxWidth: 440, lineHeight: 1.6 }}>
        A home, a child’s education, a sabbatical. Give each a date and a price, and see the monthly plan, the odds and the mix that gets you there.
      </p>
      <div className="flex justify-center" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {['home', 'education', 'car', 'wedding', 'travel', 'emergency'].map(k => {
          const T = GOAL_TYPES[k];
          return (
            <button key={k} type="button" className="pill-item" onClick={() => onAdd(k)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 99, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              <T.icon size={13} /> {T.label}
            </button>
          );
        })}
      </div>
      <Button variant="gold" icon={Plus} onClick={() => onAdd()}>Add a goal</Button>
    </Card>
  );
}

/** The Goals tab of the Freedom Plan. `surplus` is the monthly income less spending. */
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
  const saved = models.reduce((s, gm) => s + (gm.goal.saved || 0), 0);
  const planned = models.reduce((s, gm) => s + (gm.goal.monthly || 0), 0);
  const needed = funding.reduce((s, r) => s + r.need, 0);
  const onTrack = models.filter(gm => gm.status.key === 'on').length;
  const goalList = models.map(gm => ({ id: gm.goal._id, name: gm.goal.name, color: colours[gm.goal._id] }));

  return (
    <>
      <Masthead
        lead={<>
          <p className="eyebrow" style={{ marginBottom: 12 }}>{models.length} goal{models.length === 1 ? '' : 's'} · {onTrack} on track</p>
          <p className="display-number figure" style={{ fontSize: 'clamp(1.9rem, 4vw, 2.5rem)', color: 'var(--color-text-primary)' }}>{money(then)}</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
            what they cost when they fall due · {money(today)} in today’s rupees
          </p>
        </>}
        action={<Button variant="gold" icon={Plus} onClick={() => setForm({})}>Add goal</Button>}
        band={
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 20 }}>
            <MastheadFigure label="Set aside" value={money(saved)} />
            <MastheadFigure label="Planned a month" value={money(planned)} />
            <MastheadFigure label="Needed a month" value={money(needed)} accent={needed > planned + 1 ? 'var(--color-danger)' : undefined} />
            <MastheadFigure label="Monthly surplus" value={money(surplus)} accent={needed > surplus ? 'var(--color-danger)' : undefined} />
          </div>
        } />

      <Card>
        <SectionHeader eyebrow="Timeline" size="sm" style={{ marginBottom: 6 }} sub="When each goal falls due · size is what it costs then" />
        <Timeline models={models} colours={colours} selected={current?.goal._id} onSelect={setSelected} />
      </Card>

      <Card flush style={{ padding: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) repeat(3, minmax(0, 1fr)) 64px', gap: 18, padding: '10px 16px 6px' }}>
          <span className="col-head">Goal</span><span className="col-head">Costs then</span>
          <span className="col-head">Funded today</span><span className="col-head">Odds</span><span />
        </div>
        {models.map(gm => (
          <GoalRow key={gm.goal._id} gm={gm} colour={colours[gm.goal._id]} selected={current?.goal._id === gm.goal._id}
            onSelect={() => setSelected(gm.goal._id)} onEdit={() => setForm({ goal: gm.goal })} onDelete={() => setDeleting(gm.goal)} />
        ))}
      </Card>

      {current && <GoalDetail key={current.goal._id + current.goal.updatedAt} gm={current} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Funding rows={funding} surplus={surplus} planned={planned} colours={colours} />
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
