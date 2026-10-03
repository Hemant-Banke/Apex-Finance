// A disc of dots on the app's dither lattice; each dot's delay is its distance from the centre.
const N = 9;
const DOTS = [];
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const d = Math.hypot(r - (N - 1) / 2, c - (N - 1) / 2);
    if (d <= N / 2) DOTS.push({ r, c, d });
  }
}

/** The bloom loader alone: a ripple of gold dots spreading out from its centre. */
export function Bloom({ size = 1 }) {
  return (
    <span className="bloom-loader" aria-hidden style={{ '--n': N, '--s': size }}>
      {DOTS.map(({ r, c, d }) => (
        <span key={`${r}-${c}`} style={{ gridRow: r + 1, gridColumn: c + 1, animationDelay: `${(d * 0.14).toFixed(2)}s` }} />
      ))}
    </span>
  );
}

/**
 * The loading state for a view or panel, centred in a box of its own.
 * `height` is the only layout knob — a page blanks to 60vh, a panel to a couple of hundred pixels.
 */
export default function Spinner({ height = '60vh', label }) {
  return (
    <div role="status" aria-label={label || 'Loading'} className="flex flex-col items-center justify-center" style={{ height, gap: 14 }}>
      <Bloom />
      {label && <span className="text-xs" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>{label}</span>}
    </div>
  );
}
