import { journeyMarks } from '../../lib/planModel';

const TRACK = 26;   // px from the top: the line from the chart above runs down to here

/**
 * The milestones under the path chart, on its own age axis. Each milestone's line starts in
 * the chart and ends on its dot here; labels sit below in two staggered rows so none crosses
 * a line. `inset` matches the chart's plot margins.
 */
export default function Journey({ m, s, inset = { left: 56, right: 12 } }) {
  const from = s.age, to = s.endAge;
  const frac = (age) => Math.min(1, Math.max(0, (age - from) / (to - from)));
  const x = (age) => `${frac(age) * 100}%`;
  const retire = Math.min(to, Math.max(from, s.retireAge));
  const marks = journeyMarks(m, s);

  return (
    <div style={{ position: 'relative', height: TRACK + 92, marginLeft: inset.left, marginRight: inset.right }}>
      {/* Building, then drawing down — two segments of one track. */}
      <div style={{ position: 'absolute', top: TRACK - 2, left: 0, width: x(retire), height: 4, borderRadius: '99px 0 0 99px',
        background: 'linear-gradient(90deg, var(--color-accent-muted), var(--color-accent))' }} />
      <div style={{ position: 'absolute', top: TRACK - 2, left: x(retire), right: 0, height: 4, borderRadius: '0 99px 99px 0',
        background: 'var(--color-bg-elevated)' }} />

      {marks.map((mk, i) => {
        const f = frac(mk.age);
        const row = i % 2;   // stagger neighbours so close milestones don't collide
        const anchor = f > 0.92 ? { right: -6, textAlign: 'right' } : f < 0.08 ? { left: -6, textAlign: 'left' } : { left: '50%', transform: 'translateX(-50%)' };
        return (
          <div key={`${mk.label}-${i}`} style={{ position: 'absolute', left: x(mk.age), top: 0, bottom: 0 }}>
            {/* The line down from the chart, ending on the dot. */}
            {i > 0 && (
              <span style={{ position: 'absolute', left: 0, top: 0, height: TRACK, width: 0, borderLeft: `1px dashed ${mk.tone}`, opacity: 0.55 }} />
            )}
            <span style={{
              position: 'absolute', left: 0, top: TRACK, transform: 'translate(-50%, -50%)',
              width: mk.major ? 13 : 10, height: mk.major ? 13 : 10, borderRadius: 99, background: mk.tone,
              boxShadow: '0 0 0 3px var(--color-bg-card)',
            }} />
            {/* A short stem from the dot to its label in the lower row. */}
            {row === 1 && <span style={{ position: 'absolute', left: 0, top: TRACK + 8, height: 38, borderLeft: '1px solid var(--color-border-hover)' }} />}
            <span style={{ position: 'absolute', whiteSpace: 'nowrap', top: TRACK + (row ? 50 : 12), ...anchor }}>
              <span className="text-xs" style={{ display: 'block', color: mk.tone, fontWeight: 500 }}>{mk.label}</span>
              <span className="figure" style={{ display: 'block', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 1 }}>age {mk.age.toFixed(0)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
