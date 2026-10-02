/**
 * A small row of mutually exclusive choices — a look-back window, a chart range, a view.
 *
 * THE picker for every "which window / which view" control in the app (the cashflow
 * months, the contribution window, the sector window, the flows view, a company's
 * financials), so they all read as one control. Options are `{ key, label }`.
 */
export default function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.key)}
            className="text-xs font-medium"
            style={{
              padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
              border: '1px solid ' + (on ? 'var(--color-accent-dim)' : 'var(--color-border-subtle)'),
              background: on ? 'var(--color-accent-dim)' : 'transparent',
              color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
              transition: 'all 0.15s ease',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
