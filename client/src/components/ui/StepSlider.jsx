/**
 * A slider over a few ordered stops on a coloured track — for a scale (priority, risk),
 * where a row of equal buttons would hide that the choices have an order.
 * `stops`: [{ key, label, color, icon?, detached? }]. A leading `detached` stop sits off the
 * scale, joined by a dotted line — an option that is not a point on it (e.g. "let Apex pick").
 */
export default function StepSlider({ stops, value, onChange, ariaLabel }) {
  const n = stops.length;
  const i = Math.max(0, stops.findIndex(s => s.key === value));
  const lead = stops[0]?.detached ? 1 : 0;
  const pct = (k) => (k / (n - 1)) * 100;
  const at = (k) => `${pct(k)}%`;
  const on = stops[i];
  const scale = stops.slice(lead);
  const track = `linear-gradient(90deg in oklch, ${scale.map((s, k) => `${s.color} ${(k / Math.max(1, scale.length - 1)) * 100}%`).join(', ')})`;
  const scaleBox = { left: at(lead), right: '0%' };
  const offScale = i < lead;
  // End labels align to the outer edge of their stop's mark, not to its centre.
  const labelAt = (k) => (k === 0 ? { left: `calc(0% - var(--edge))` }
    : k === n - 1 ? { left: `calc(100% + var(--edge))`, transform: 'translateX(-100%)' }
    : { left: at(k), transform: 'translateX(-50%)' });

  return (
    <div className="step-slider" style={{ '--edge': lead ? '11px' : '9px' }}>
      <div className="step-slider-rail">
        {lead > 0 && <span className="step-slider-link" style={{ left: 0, width: at(lead) }} />}
        <span className="step-slider-track" style={{ ...scaleBox, background: track }} />
        {!offScale && (
          <span className="step-slider-fill" style={{
            ...scaleBox, background: track,
            clipPath: `inset(0 ${100 - ((i - lead) / Math.max(1, n - 1 - lead)) * 100}% 0 0 round 99px)`,
          }} />
        )}
        {stops.map((s, k) => (s.icon
          ? <span key={s.key} className={`step-slider-icon${k === i ? ' is-on' : ''}`} style={{ left: at(k), '--c': s.color }}><s.icon size={14} /></span>
          : <span key={s.key} className={`step-slider-tick${k <= i && k >= lead && !offScale ? ' is-passed' : ''}`} style={{ left: at(k), '--c': s.color }} />
        ))}
        {!on.icon && <span className="step-slider-thumb" style={{ left: at(i), '--c': on.color }} />}
        <input type="range" min={0} max={n - 1} step={1} value={i} aria-label={ariaLabel}
          aria-valuetext={on.label} onChange={e => onChange(stops[Number(e.target.value)].key)} />
      </div>
      <div className="step-slider-labels">
        {stops.map((s, k) => (
          <button key={s.key} type="button" onClick={() => onChange(s.key)}
            className={on.key === s.key ? 'is-on' : ''}
            style={{ ...labelAt(k), '--c': s.color }}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
