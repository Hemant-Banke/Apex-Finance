/**
 * An on/off switch with its label (and optional sub-line) — the whole row is the control.
 * Off reads empty; on, the knob slides across in white. `className` styles the row.
 */
export default function Switch({ on, onChange, label, sub, className = '', title }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title} className={`switch ${className}`} onClick={() => onChange(!on)}>
      <span className="switch-track"><span /></span>
      <span style={{ minWidth: 0, textAlign: 'left' }}>
        <span className="switch-label">{label}</span>
        {sub && <span className="switch-sub">{sub}</span>}
      </span>
    </button>
  );
}
