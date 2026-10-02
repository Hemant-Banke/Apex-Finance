/**
 * THE selector for every set of mutually exclusive choices — a window, a range, a view,
 * a filter, a tab, a form's type. A recessed pill track with the chosen option raised.
 *
 * Options: `{ key, label?, icon?, title?, hint?, tone?, count? }`. `icon` alone makes an
 * icon-only pill; `tone` colours the active pill (buy/sell, income/expense); `hint` adds a
 * muted second line (form choices); `count` a small figure after the label.
 *
 * size     — 'sm' (chart toolbars), 'md' (default), 'lg' (form fields)
 * block    — fill the width in equal columns
 * children — extra pills rendered inside the track (e.g. a popover trigger using `.pill-item`)
 */
export default function SegmentedControl({
  options, value, onChange, ariaLabel, size = 'md', block = false, children, style,
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className={`pill-group pill-${size}${block ? ' pill-block' : ''}`} style={style}>
      {options.map(o => {
        const on = o.key === value;
        const Icon = o.icon;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} title={o.title}
            aria-label={!o.label ? (o.title || String(o.key)) : undefined}
            onClick={() => onChange(o.key)}
            className={`pill-item${on ? ' active' : ''}${o.hint ? ' has-hint' : ''}`}
            style={on && o.tone ? {
              color: o.tone,
              background: `color-mix(in srgb, ${o.tone} 14%, var(--color-bg-elevated))`,
              boxShadow: `var(--shadow-sm), inset 0 0 0 1px color-mix(in srgb, ${o.tone} 45%, transparent)`,
            } : undefined}>
            <span className="pill-label">
              {Icon && <Icon size={size === 'lg' ? 15 : size === 'sm' ? 12 : 13} strokeWidth={2} />}
              {o.label}
              {o.count != null && <span className="figure pill-count">{o.count}</span>}
            </span>
            {o.hint && <span className="pill-hint">{o.hint}</span>}
          </button>
        );
      })}
      {children}
    </div>
  );
}
