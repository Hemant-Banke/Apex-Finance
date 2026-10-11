// The controls of an assumptions board: shared by the Freedom Plan and the goal plan.

/** Label and value on one line, the slider beneath; the explanation lives in the tooltip. */
export function Dial({ label, value, min, max, step = 1, format = (v) => v, onChange, hint }) {
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
export function Field({ label, value, onChange, min, max, prefix, suffix, hint, placeholder }) {
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

/** A section title with the figure it settles on, right-aligned. */
export function GroupHead({ title, figure, sub }) {
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
export function Choice({ on, label, value, title, onClick, radio = false, check = false }) {
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
