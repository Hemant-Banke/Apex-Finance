import { RotateCcw } from 'lucide-react';
import { compactIfLarge } from '../../lib/utils';
import Card from '../ui/Card';

const money = (v) => compactIfLarge(Math.round(v || 0));
const pct = (v) => `${+v.toFixed(2)}%`;

/** Label and value on one line, the slider beneath; the explanation lives in the tooltip. */
function Dial({ label, value, min, max, step = 1, format = (v) => v, onChange, hint }) {
  const v = Math.min(max, Math.max(min, value ?? min));
  return (
    <label title={hint} style={{ display: 'block', minWidth: 0 }}>
      <span className="flex items-baseline justify-between" style={{ gap: 8, marginBottom: 8 }}>
        <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        <span className="figure" style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{format(v)}</span>
      </span>
      <input type="range" className="plan-range" min={min} max={max} step={step} value={v}
        onChange={e => onChange(Number(e.target.value))} style={{ '--pct': `${((v - min) / (max - min)) * 100}%` }} />
    </label>
  );
}

/** A typed number with its unit — for values you know exactly, like your age. */
function Field({ label, value, onChange, min, max, prefix, suffix, hint, placeholder }) {
  return (
    <label title={hint} style={{ display: 'block', minWidth: 0 }}>
      <span className="text-xs truncate" style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</span>
      <span className="plan-field">
        {prefix && <span className="plan-field-unit">{prefix}</span>}
        <input type="number" inputMode="numeric" className="figure" value={value ?? ''} min={min} max={max} placeholder={placeholder}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={e => { const n = Number(e.target.value); if (e.target.value !== '' && min != null && n < min) onChange(min); if (max != null && n > max) onChange(max); }} />
        {suffix && <span className="plan-field-unit">{suffix}</span>}
      </span>
    </label>
  );
}

function Head({ children }) {
  return <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 8 }}>{children}</p>;
}

/** A section title with the figure it settles on, right-aligned. */
function GroupHead({ title, figure, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="flex items-baseline justify-between" style={{ gap: 12 }}>
        <span className="text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{title}</span>
        <span className="figure" style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--color-accent)' }}>{figure}</span>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>{sub}</p>
    </div>
  );
}

/** One option of a choice board: its name, then its figure, large enough to compare. */
function Choice({ on, label, value, title, onClick, radio = false, check = false }) {
  return (
    <button type="button" className="plan-toggle" title={title} onClick={onClick}
      {...(radio ? { role: 'radio', 'aria-checked': on } : {})} aria-pressed={on}
      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '10px 12px' }}>
      <span className="text-xs flex items-center" style={{ gap: 6, fontWeight: 500 }}>
        {check && <span style={{ width: 7, height: 7, borderRadius: 2, background: on ? 'var(--color-text-primary)' : 'var(--color-border-hover)' }} />}
        {radio && <span className={`plan-radio${on ? ' is-on' : ''}`} />}
        {label}
      </span>
      <span className="figure" style={{ fontSize: '0.95rem', fontWeight: 500, color: on ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{value}</span>
    </button>
  );
}

const SPLIT = [
  ['essential', 'Essential', 'var(--color-garden)', 'Rent, groceries, bills, EMIs'],
  ['discretionary', 'Discretionary', 'var(--color-accent)', 'Eating out, shopping, travel'],
  ['other', 'Unclassified', 'var(--color-text-muted)', 'Not yet sorted — counted as essential in Lean'],
];

/** Today's spending by class: one bar, each class named with its amount and share beneath. */
function SpendSplit({ sp }) {
  const total = sp.expense || 0;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 99, overflow: 'hidden', background: 'var(--color-bg-elevated)' }}>
        {SPLIT.map(([k, , c]) => (
          <span key={k} style={{ width: `${total ? (sp[k] / total) * 100 : 0}%`, background: c, opacity: k === 'other' ? 0.5 : 0.85 }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 10 }}>
        {SPLIT.map(([k, label, c, tip]) => (
          <div key={k} title={tip} style={{ minWidth: 0 }}>
            <p className="text-xs flex items-center" style={{ gap: 6, color: 'var(--color-text-muted)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: c, opacity: k === 'other' ? 0.5 : 0.85, flexShrink: 0 }} />
              {label}
            </p>
            <p style={{ marginTop: 3 }}>
              <span className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{money(sp[k])}</span>
              <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>{total ? Math.round((sp[k] / total) * 100) : 0}%</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Every assumption the plan rests on, as one compact board. */
export default function PlanControls({ s, set, reset, m }) {
  const working = Math.max(0, s.retireAge - s.age), retired = Math.max(0, s.endAge - s.retireAge);
  const realDraw = ((1 + s.drawRet / 100) / (1 + s.inflation / 100) - 1) * 100;
  const sp = m.spending;

  return (
    <Card>
      <div className="flex items-start justify-between" style={{ gap: 16, marginBottom: 22 }}>
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow" style={{ marginBottom: 14 }}>Assumptions</p>
          {/* What the dials below add up to, as readouts rather than a run-on sentence. */}
          <div className="flex" style={{ flexWrap: 'wrap', rowGap: 10, marginTop: 4 }}>
            {[
              ['Working', `${working} yrs`, 'Years left to build, from now to retirement'],
              ['Retired', `${retired} yrs`, 'Years the money has to last, from retirement to the age you plan to'],
              ['Real return', `${(m.accReal * 100).toFixed(1)}% → ${realDraw.toFixed(1)}%`, 'Return after inflation, before retiring → after'],
              ['Multiple', `${(100 / s.swr).toFixed(1)}×`, "How many years of spending the target holds (100 ÷ withdrawal rate)"],
              ['Target', money(m.target), 'The corpus that funds your spending for good'],
            ].map(([label, value, tip], i) => (
              <div key={label} title={tip} style={{ padding: i ? '0 18px' : '0 18px 0 0', borderLeft: i ? '1px solid var(--color-border-subtle)' : 'none' }}>
                <p className="col-head" style={{ fontSize: '0.58rem', marginBottom: 4 }}>{label}</p>
                <p className="figure text-sm" style={{ color: label === 'Target' ? 'var(--color-accent)' : 'var(--color-text-primary)', fontWeight: 500 }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
        <button type="button" onClick={reset} className="text-xs flex items-center"
          style={{ gap: 6, background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0 }}>
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '22px 28px' }}>
        <Field label="Age now" value={s.age} min={16} max={90} suffix="yrs" onChange={v => v != null && set({ age: v })} />
        <Field label="Retire at" value={s.retireAge} min={18} max={95} suffix="yrs" onChange={v => v != null && set({ retireAge: v })} />
        <Field label="Plan to age" value={s.endAge} min={50} max={110} suffix="yrs" onChange={v => v != null && set({ endAge: v })}
          hint="Planning past your life expectancy is the cautious choice" />
        <Field label={s.monthly == null ? 'Invested a month · from history' : 'Invested a month'} prefix="₹"
          value={s.monthly ?? Math.round(m.historicMonthly)} min={0} onChange={v => set({ monthly: v })}
          hint={`Your history (income less spending) says ${money(m.historicMonthly)} · clear the field to use it`} />

        <Dial label="Return until retiring" value={s.ret} min={4} max={16} step={0.5} format={pct} onChange={v => set({ ret: v })}
          hint="Nominal, a year — Indian equity has averaged 11–13% over long stretches" />
        <Dial label="Return after retiring" value={s.drawRet} min={4} max={12} step={0.5} format={pct} onChange={v => set({ drawRet: v })}
          hint="Usually lower — a calmer, more conservative mix" />
        <Dial label="Inflation" value={s.inflation} min={2} max={10} step={0.5} format={pct} onChange={v => set({ inflation: v })}
          hint="Every figure is in today's rupees, grown at return minus this" />
        <Dial label="Withdrawal rate" value={s.swr} min={2.5} max={6} step={0.25} format={pct} onChange={v => set({ swr: v })}
          hint="Share of the corpus drawn each year · 3–3.5% is the cautious Indian range" />

        <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <GroupHead title="Monthly spending in retirement" figure={money(m.spend)}
            sub="The life your corpus has to pay for, in today's rupees" />
          <div role="radiogroup" aria-label="Spending basis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
            {[['lean', 'Lean', 'Essentials only'], ['current', 'Current', 'What you spend today'], ['fat', 'Fat', '1.5× today'], ['custom', 'Custom', 'Your own figure']].map(([k, l, tip]) => (
              <Choice key={k} on={s.basis === k} radio label={l} title={tip}
                value={money(k === 'custom' ? s.customSpend : m.spendOptions[k])} onClick={() => set({ basis: k })} />
            ))}
          </div>
          {s.basis === 'custom' ? (
            <div style={{ marginTop: 12 }}>
              <Field label="Custom, a month" prefix="₹" value={s.customSpend} min={0} onChange={v => set({ customSpend: v ?? 0 })} />
            </div>
          ) : <SpendSplit sp={sp} />}
        </div>

        <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <GroupHead title="What counts toward your corpus" figure={money(m.corpus)}
            sub="Tick what you would actually live on" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
            {[
              ['cash', 'Cash', m.sources.cash],
              ['liquid', 'Investments', m.sources.liquid],
              ['illiquid', 'Locked-in', m.sources.illiquid],
              ['debts', 'Less debt', -m.sources.debts],
            ].map(([k, label, v]) => (
              <Choice key={k} on={!!s.include[k]} check label={label} value={money(v)}
                title={{ cash: 'Cash in the bank', liquid: 'Investments sellable within days', illiquid: 'EPF, FDs, bonds, property', debts: 'Subtract what you owe' }[k]}
                onClick={() => set({ include: { ...s.include, [k]: !s.include[k] } })} />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
