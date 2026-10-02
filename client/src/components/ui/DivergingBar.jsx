/**
 * A signed quantity as a bar from a shared zero in the middle of its track.
 *
 * For anything where adding and taking away are opposite in kind — a holding's
 * contribution to a return, a sector's lead or lag on the market. Growing every bar from
 * one edge would make the worst detractor look like the smallest contributor. Bars are
 * scaled to `max` (the largest magnitude in the set) so a column of them compares.
 *
 * Fills the width it is given; size the container, not the bar.
 */
export default function DivergingBar({ value, max, height = 8, muted = false }) {
  const w = value == null || !max ? 0 : Math.min(50, (Math.abs(value) / max) * 50);
  const up = (value ?? 0) >= 0;
  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <span style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'var(--color-border-hover)' }} />
      {value != null && (
        <span style={{
          position: 'absolute', top: 0, height: '100%', borderRadius: 3,
          left: up ? '50%' : `${50 - w}%`, width: `${Math.max(w, 0.6)}%`,
          background: `color-mix(in srgb, var(--color-${up ? 'success' : 'danger'}) 68%, #0B0D10)`,
          opacity: muted ? 0.5 : 1,
        }} />
      )}
    </div>
  );
}
