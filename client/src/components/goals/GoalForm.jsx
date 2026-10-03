import { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import SegmentedControl from '../ui/SegmentedControl';
import TypePicker from '../forms/TypePicker';
import DatePicker from '../forms/DatePicker';
import { GOAL_TYPES, PRIORITIES, STRATEGIES, GOAL_DEFAULTS, goalModel } from '../../lib/goals';
import { compactIfLarge, formatCurrency, todayStr, toDateInput } from '../../lib/utils';

const money = (v) => compactIfLarge(Math.round(v || 0));
const TYPE_OPTIONS = Object.entries(GOAL_TYPES).map(([value, t]) => ({ value, label: t.label, icon: <t.icon size={15} strokeWidth={1.8} /> }));

function Money({ value, onChange, placeholder }) {
  return (
    <div className="amount-field">
      <input type="number" inputMode="numeric" min="0" className="input-field" placeholder={placeholder}
        value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} />
    </div>
  );
}

function Num({ value, onChange, suffix, min = 0, max }) {
  return (
    <span className="plan-field">
      <input type="number" inputMode="decimal" className="figure" value={value ?? ''} min={min} max={max}
        onChange={e => onChange(e.target.value === '' ? 0 : Math.min(max ?? Infinity, Math.max(min, Number(e.target.value))))} />
      {suffix && <span className="plan-field-unit">{suffix}</span>}
    </span>
  );
}

const Row = ({ children, cols = 2 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14, marginBottom: 16 }}>{children}</div>
);

/** Add or edit a goal. A live readout says what the plan needs before it is saved. */
export default function GoalForm({ open, onClose, onSave, goal }) {
  const [f, setF] = useState(() => goal
    ? { ...GOAL_DEFAULTS(goal.type), ...goal, targetDate: toDateInput(goal.targetDate) }
    : GOAL_DEFAULTS('other'));
  const [saving, setSaving] = useState(false);
  const set = (patch) => setF(prev => ({ ...prev, ...patch }));

  // A new goal's type carries its own inflation and payout shape; an edited one keeps what was chosen.
  const pickType = (type) => {
    const t = GOAL_TYPES[type];
    set(goal ? { type } : { type, inflation: t.inflation, withdrawal: { mode: t.mode, years: t.years || 1 }, name: f.name || t.label });
  };

  const valid = f.name?.trim() && f.amount > 0 && f.targetDate > todayStr();
  const preview = useMemo(() => (valid ? goalModel(f) : null), [valid, f]);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try { await onSave(f); onClose(); } finally { setSaving(false); }
  };

  const spread = f.withdrawal?.mode === 'spread';

  return (
    <Modal open={open} onClose={onClose} eyebrow="Goal" title={goal ? 'Edit goal' : 'New goal'} maxWidth={620} align="top">
      <form onSubmit={submit}>
        <Row>
          <div>
            <label className="label">Kind</label>
            <TypePicker options={TYPE_OPTIONS} value={f.type} onChange={pickType} />
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input-field" maxLength={60} value={f.name} placeholder="e.g. Down payment" onChange={e => set({ name: e.target.value })} />
          </div>
        </Row>

        <Row>
          <div>
            <label className="label">{spread ? 'Total cost, today’s rupees' : 'Cost in today’s rupees'}</label>
            <Money value={f.amount} onChange={v => set({ amount: v })} placeholder="25,00,000" />
          </div>
          <div>
            <label className="label">Needed by</label>
            <DatePicker value={f.targetDate} min={todayStr()} onChange={v => set({ targetDate: v })} />
          </div>
        </Row>

        <div style={{ marginBottom: 16 }}>
          <label className="label">Priority</label>
          <SegmentedControl block size="lg" value={f.priority} onChange={v => set({ priority: v })}
            options={Object.entries(PRIORITIES).map(([key, p]) => ({ key, label: p.label, hint: p.hint }))} />
        </div>

        <p className="col-head" style={{ margin: '22px 0 12px' }}>Contribution plan</p>
        <Row cols={3}>
          <div>
            <label className="label">Set aside today</label>
            <Money value={f.saved} onChange={v => set({ saved: v || 0 })} placeholder="0" />
          </div>
          <div>
            <label className="label">Invest a month</label>
            <Money value={f.monthly} onChange={v => set({ monthly: v || 0 })} placeholder="0" />
          </div>
          <div>
            <label className="label">Raise it yearly by</label>
            <Num value={f.stepUp} max={50} suffix="%" onChange={v => set({ stepUp: v })} />
          </div>
        </Row>

        <p className="col-head" style={{ margin: '22px 0 12px' }}>Withdrawal plan</p>
        <Row>
          <SegmentedControl block value={f.withdrawal.mode} onChange={mode => set({ withdrawal: { ...f.withdrawal, mode } })}
            options={[{ key: 'lump', label: 'All at once' }, { key: 'spread', label: 'Spread over years' }]} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {spread
              ? <Num value={f.withdrawal.years} min={1} max={40} suffix="yrs" onChange={years => set({ withdrawal: { ...f.withdrawal, years: Math.max(1, years) } })} />
              : <span />}
            <span title="How fast this cost rises — education runs well ahead of general inflation">
              <Num value={f.inflation} max={30} suffix="% infl." onChange={v => set({ inflation: v })} />
            </span>
          </div>
        </Row>

        <p className="col-head" style={{ margin: '22px 0 12px' }}>Asset strategy</p>
        <SegmentedControl block value={f.strategy} onChange={v => set({ strategy: v })} style={{ marginBottom: 8 }}
          options={Object.entries(STRATEGIES).map(([key, st]) => ({ key, label: st.label }))} />
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          {f.strategy === 'auto'
            ? 'Mostly equity while the date is far, gliding to debt as it nears.'
            : `Held at ${Math.round(STRATEGIES[f.strategy].mix.equity * 100)}% equity until the last three years, then de-risked.`}
        </p>

        {preview && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, padding: '14px 16px', borderRadius: 10, background: 'var(--color-bg-input)', border: '1px solid var(--color-border-subtle)', marginBottom: 20 }}>
            <div>
              <p className="col-head">Costs by then</p>
              <p className="figure text-sm" style={{ marginTop: 5, color: 'var(--color-text-primary)' }}>{money(preview.futureCost)}</p>
            </div>
            <div>
              <p className="col-head">Needs a month</p>
              <p className="figure text-sm" style={{ marginTop: 5, color: 'var(--color-text-primary)' }}>
                {Number.isFinite(preview.need) ? formatCurrency(Math.round(preview.need)) : '—'}
              </p>
            </div>
            <div>
              <p className="col-head">Odds as planned</p>
              <p className="figure text-sm" style={{ marginTop: 5, color: preview.status.tone }}>{preview.prob.toFixed(0)}% · {preview.status.label}</p>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" disabled={!valid || saving}>{saving ? 'Saving…' : goal ? 'Save goal' : 'Add goal'}</Button>
        </div>
      </form>
    </Modal>
  );
}
