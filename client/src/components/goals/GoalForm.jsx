import { useState } from 'react';
import { CalendarDays, Minus, Plus } from 'lucide-react';
import ApexLogo from '../ui/ApexLogo';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import SegmentedControl from '../ui/SegmentedControl';
import StepSlider from '../ui/StepSlider';
import TypePicker from '../forms/TypePicker';
import DatePicker from '../forms/DatePicker';
import MoneyInput from '../forms/MoneyInput';
import {
  GOAL_TYPES, PRIORITIES, STRATEGIES, GOAL_DEFAULTS, withdrawals, requiredCorpus, addMonths, monthsUntil, horizonLabel,
} from '../../lib/goals';
import { compactIfLarge, todayStr, toDateInput, MONTHS_SHORT, CHART_COLORS } from '../../lib/utils';
import { numericOnly, wholeNumber } from '../../lib/numericInput';

const money = (v) => compactIfLarge(Math.round(v || 0));
const monthYear = (iso) => `${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

const TYPE_OPTIONS = Object.entries(GOAL_TYPES).map(([value, t]) => ({ value, label: t.label, icon: <t.icon size={15} strokeWidth={1.8} /> }));

// Low to high, cool to warm, so the scale reads before the labels do.
const PRIORITY_TONES = { aspirational: CHART_COLORS[1], important: 'var(--color-accent)', essential: 'var(--color-chart-coral)' };
const PRIORITY_STOPS = ['aspirational', 'important', 'essential'].map(k => ({ key: k, label: PRIORITIES[k].label, color: PRIORITY_TONES[k] }));

// Calm to hot as the equity share, and so the swings, grow.
const RISK_TONES = { conservative: 'var(--color-garden-light)', balanced: 'var(--color-accent)', growth: 'var(--color-chart-warm)', aggressive: 'var(--color-chart-coral)' };
// "Apex picks" is a strategy too, just not a point on the risk scale: it glides along it with the date.
const MIX_STOPS = [
  { key: 'auto', label: 'Apex picks', color: 'var(--color-success)', icon: ApexLogo, detached: true },
  ...Object.entries(RISK_TONES).map(([k, color]) => ({ key: k, label: STRATEGIES[k].label, color })),
];

const Field = ({ label, aside, children, style }) => (
  <div style={{ minWidth: 0, ...style }}>
    <div className="goal-field-head">
      <span className="label">{label}</span>
      {aside}
    </div>
    {children}
  </div>
);

const Step = ({ n, title, aside, children }) => (
  <section className="goal-step">
    <p className="goal-step-head"><span className="figure">{n}</span>{title}{aside && <span className="goal-step-aside">{aside}</span>}</p>
    {children}
  </section>
);

// Caps: a goal is at most 60 years out, and pays out over at most 40 years.
const WHEN_MAX = { years: 60, months: 720 };
const PAYOUT_MAX = 40;

/** − n + : nudge by one, or type it; capped at `max`. */
function Stepper({ value, onChange, min = 1, max, unit, label }) {
  const step = (d) => onChange(Math.min(max, Math.max(min, (value || 0) + d)));
  return (
    <div className="goal-stepper">
      <button type="button" aria-label={`Fewer ${unit}`} disabled={(value || 0) <= min} onClick={() => step(-1)}><Minus size={12} strokeWidth={2.2} /></button>
      <input type="text" inputMode="numeric" className="figure" aria-label={label} value={value ?? ''}
        onChange={e => onChange(wholeNumber(e.target.value, max))} onBlur={() => { if (!value) onChange(min); }} />
      <span>{unit}</span>
      <button type="button" aria-label={`More ${unit}`} disabled={(value || 0) >= max} onClick={() => step(1)}><Plus size={12} strokeWidth={2.2} /></button>
    </div>
  );
}

/** One field for "when": the unit on top, the number (or the date) beneath. */
function WhenField({ when, setWhen, date, setDate, targetDate, future }) {
  const pick = (k) => {
    if (k === 'date') { setDate(targetDate); setWhen(w => ({ ...w, mode: 'date' })); return; }
    // Switching unit keeps the same span: 5 years becomes 60 months, not 5.
    setWhen(w => {
      if (w.mode === 'date') return { mode: 'in', unit: k, n: Math.min(WHEN_MAX[k], k === 'years' ? Math.max(1, Math.round(monthsUntil(targetDate) / 12)) : Math.max(1, monthsUntil(targetDate))) };
      if (w.unit === k || w.n == null) return { ...w, mode: 'in', unit: k };
      return { mode: 'in', unit: k, n: Math.min(WHEN_MAX[k], k === 'months' ? w.n * 12 : Math.max(1, Math.round(w.n / 12))) };
    });
  };
  return (
    <div className={`goal-when${future ? '' : ' is-invalid'}`}>
      <SegmentedControl size="sm" ringless block ariaLabel="Count in" value={when.mode === 'date' ? 'date' : when.unit} onChange={pick}
        options={[{ key: 'months', label: 'Months' }, { key: 'years', label: 'Years' }, { key: 'date', label: 'Date', icon: CalendarDays }]} />
      <div className="goal-when-body">
        {when.mode === 'in' ? (
          <>
            <input type="text" inputMode="numeric" className="figure" aria-label={`${when.unit} from now`} placeholder="0"
              title={`Up to ${WHEN_MAX[when.unit]} ${when.unit}`}
              value={when.n ?? ''} onChange={e => setWhen(w => ({ ...w, n: wholeNumber(e.target.value, WHEN_MAX[w.unit]) }))} />
            <span className="goal-when-unit">{when.unit} from now</span>
            <span className="goal-when-out figure">{future ? monthYear(targetDate) : '—'}</span>
          </>
        ) : (
          <div className="goal-when-date"><DatePicker value={date} min={todayStr()} max={addMonths(todayStr(), WHEN_MAX.months)} onChange={setDate} /></div>
        )}
      </div>
    </div>
  );
}

/** Add or edit a goal: inputs on the left, what it takes on the right — one screen, no scroll. */
export default function GoalForm({ open, onClose, onSave, goal, initialType }) {
  const [f, setF] = useState(() => goal
    ? { ...GOAL_DEFAULTS(goal.type), ...goal, targetDate: toDateInput(goal.targetDate) }
    : { ...GOAL_DEFAULTS(initialType || 'other'), name: initialType ? GOAL_TYPES[initialType].label : '' });
  // "Needed by" is asked either as a span from today or as a date; the span resolves to a date.
  const [when, setWhen] = useState(() => (goal ? { mode: 'date', n: 5, unit: 'years' } : { mode: 'in', n: 5, unit: 'years' }));
  const [saving, setSaving] = useState(false);
  const set = (patch) => setF(prev => ({ ...prev, ...patch }));

  const targetDate = when.mode === 'in'
    ? addMonths(todayStr(), (when.n || 0) * (when.unit === 'years' ? 12 : 1))
    : f.targetDate;

  // Inflation is prefilled from the kind; picking another kind resets it to that kind's default.
  const pickType = (type) => {
    const t = GOAL_TYPES[type];
    set(goal
      ? { type, inflation: t.inflation }
      : { type, inflation: t.inflation, withdrawal: { mode: t.mode, years: t.years || 1 }, name: f.name && f.name !== GOAL_TYPES[f.type]?.label ? f.name : t.label });
  };

  const draft = { ...f, targetDate };
  const future = !!targetDate && targetDate > todayStr();
  const months = future ? monthsUntil(targetDate) : 0;
  const valid = f.name?.trim() && f.amount > 0 && f.inflation != null && future && (f.withdrawal?.mode !== 'spread' || f.withdrawal.years >= 1);
  const payouts = valid ? withdrawals(draft, months) : [];
  const futureCost = payouts.reduce((a, w) => a + w, 0);
  const required = valid ? requiredCorpus(draft, months) : 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try { await onSave(draft); onClose(); } finally { setSaving(false); }
  };

  const spread = f.withdrawal?.mode === 'spread';
  const auto = f.strategy === 'auto';
  const Kind = GOAL_TYPES[f.type].icon;
  const pTone = PRIORITY_TONES[f.priority];
  const firstPayout = payouts[0] || 0;
  const inflationAdds = (spread ? futureCost : firstPayout) - f.amount;

  return (
    <Modal open={open} onClose={onClose} eyebrow="Goals" title={goal ? 'Edit goal' : 'New goal'} maxWidth={920} align="top">
      <form onSubmit={submit} className="goal-form">
        <div className="goal-form-inputs">
          <Step n="01" title="What it is">
            <div className="goal-row" style={{ gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)' }}>
              <Field label="Goal type"><TypePicker options={TYPE_OPTIONS} value={f.type} onChange={pickType} /></Field>
              <Field label="Name">
                <input className="input-field" maxLength={60} value={f.name} placeholder="e.g. Down payment" onChange={e => set({ name: e.target.value })} />
              </Field>
            </div>
            <div className="goal-row" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 0.7fr)' }}>
              <Field label={spread ? 'Total cost, in today’s money' : 'Cost, in today’s money'}>
                <MoneyInput value={f.amount} onChange={amount => set({ amount })} placeholder="25,00,000" ariaLabel="Cost today" />
              </Field>
              <Field label="Inflation">
                <div className="field-shell" title={`Typical for a ${GOAL_TYPES[f.type].label.toLowerCase()} goal — change it if yours differs`}>
                  <input type="number" inputMode="decimal" min="0" max="30" step="0.5" className="figure" value={f.inflation ?? ''} {...numericOnly()}
                    onChange={e => set({ inflation: e.target.value === '' ? null : Math.min(30, Math.max(0, Number(e.target.value))) })} />
                  <span className="field-shell-unit">% a year</span>
                </div>
              </Field>
            </div>
          </Step>

          <Step n="02" title="When, and how much it matters">
            <div className="goal-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
              <Field label="Needed" aside={future
                ? <span className="goal-field-aside figure">in {horizonLabel(months)}</span>
                : <span className="goal-field-aside" style={{ color: 'var(--color-danger)' }}>pick a future date</span>}>
                <WhenField when={when} setWhen={setWhen} date={f.targetDate} setDate={v => set({ targetDate: v })} targetDate={targetDate} future={future} />
              </Field>
              <Field label="Priority" aside={<span className="goal-field-aside" style={{ color: pTone }}>{PRIORITIES[f.priority].hint}</span>}>
                <div className="goal-slider-box">
                  <StepSlider ariaLabel="Priority" stops={PRIORITY_STOPS} value={f.priority} onChange={v => set({ priority: v })} />
                </div>
              </Field>
            </div>
          </Step>

          <Step n="03" title="How it is paid out">
            <div className="goal-payout">
              <div style={{ minWidth: 0 }}>
                <span className="label">Paid out</span>
                <p className="goal-payout-hint">
                  {spread
                    ? `${f.withdrawal.years || '—'} yearly payments${future ? `, from ${monthYear(targetDate)}` : ''}`
                    : `One payment${future ? `, in ${monthYear(targetDate)}` : ''}`}
                </p>
              </div>
              <div className="goal-payout-controls">
                <SegmentedControl value={f.withdrawal.mode} onChange={mode => set({ withdrawal: { ...f.withdrawal, mode } })}
                  options={[{ key: 'lump', label: 'All at once' }, { key: 'spread', label: 'Spread out' }]} />
                {/* Always mounted and grown from zero width, so the pills slide aside rather than jump. */}
                <div className={`goal-payout-years${spread ? ' is-on' : ''}`} aria-hidden={!spread} inert={!spread}>
                  <div>
                    <Stepper value={f.withdrawal.years} max={PAYOUT_MAX} unit="yrs" label="Years of payouts"
                      onChange={years => set({ withdrawal: { ...f.withdrawal, years } })} />
                  </div>
                </div>
              </div>
            </div>
          </Step>

          <Step n="04" title="How it is invested" aside={auto
            ? 'Equity while the date is far, gliding to debt as it nears'
            : `About ${Math.round(STRATEGIES[f.strategy].mix.equity * 100)}% equity, de-risked in the last 3 years`}>
            <div className="goal-slider-box">
              <StepSlider ariaLabel="Asset mix" stops={MIX_STOPS} value={f.strategy} onChange={v => set({ strategy: v })} />
            </div>
          </Step>
        </div>

        <aside className="goal-ticket">
          <div className="goal-ticket-id">
            <span className="goal-form-kind"><Kind size={18} strokeWidth={1.8} /></span>
            <div style={{ minWidth: 0 }}>
              <p className="truncate" style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{f.name?.trim() || GOAL_TYPES[f.type].label}</p>
              <p className="goal-ticket-meta">
                <span style={{ color: pTone }}><i style={{ background: pTone }} />{PRIORITIES[f.priority].label}</span>
                {future && <span className="figure">{monthYear(targetDate)}</span>}
              </p>
            </div>
          </div>

          {valid ? (
            <>
              <div>
                <p className="col-head">{spread ? 'Corpus needed' : 'You will need'}</p>
                <p className="figure goal-ticket-figure">{money(required)}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  by {monthYear(targetDate)}, in {horizonLabel(months)}
                </p>
              </div>

              {spread ? (
                <div>
                  <CostBars today={f.amount} payouts={payouts} />
                  <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
                    <span>Today</span><span>{f.withdrawal.years} yearly payouts</span>
                  </div>
                </div>
              ) : (
                <div className="goal-compare">
                  <CompareRow label="Today" value={f.amount} max={firstPayout} />
                  <CompareRow label={monthYear(targetDate)} value={firstPayout} max={firstPayout} gold />
                </div>
              )}

              <dl className="goal-facts">
                <div><dt>Cost today</dt><dd className="figure">{money(f.amount)}</dd></div>
                <div><dt>Inflation adds</dt><dd className="figure">+{money(inflationAdds)} <small>at {f.inflation}%</small></dd></div>
                {spread && <div><dt>Paid out in total</dt><dd className="figure">{money(futureCost)}</dd></div>}
                <div><dt>Invested as</dt><dd>{auto ? 'Apex picks' : STRATEGIES[f.strategy].label}</dd></div>
              </dl>
              {spread && (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  The corpus is less than the total paid out: what is not yet drawn keeps earning.
                </p>
              )}
            </>
          ) : (
            <div className="goal-ticket-empty">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>What will it take?</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                Add a name, a cost and a future date, and the figure appears here.
              </p>
            </div>
          )}

          <Button type="submit" variant="gold" disabled={!valid || saving} style={{ width: '100%', marginTop: 'auto' }}>
            {saving ? 'Saving…' : goal ? 'Save goal' : 'Add goal'}
          </Button>
        </aside>
      </form>
    </Modal>
  );
}

/** Today's cost beside each inflated payout, on one scale, so the date's effect is visible. */
function CostBars({ today, payouts }) {
  const max = Math.max(today, ...payouts, 1);
  return (
    <div className="goal-bars" aria-hidden>
      <span className="goal-bar is-today" style={{ height: `${(today / max) * 100}%` }} />
      <span className="goal-bars-gap" />
      {payouts.map((w, i) => <span key={i} className="goal-bar" style={{ height: `${(w / max) * 100}%` }} />)}
    </div>
  );
}

const CompareRow = ({ label, value, max, gold }) => (
  <div className="goal-compare-row">
    <span className="goal-compare-label">{label}</span>
    <span className="goal-compare-track"><span className={gold ? 'is-gold' : ''} style={{ width: `${(value / Math.max(max, 1)) * 100}%` }} /></span>
    <span className="figure goal-compare-value">{money(value)}</span>
  </div>
);
