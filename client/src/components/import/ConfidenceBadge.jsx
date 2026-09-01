import { confidenceBand, BAND_COLOR, BAND_LABEL, asPercent, confidenceDetail } from '../../lib/confidence';

/**
 * How much of this statement the parser stands behind — one figure, for the file.
 *
 * An import used to arrive as a flat list of equally-confident assertions: a figure
 * lifted off a strict regex and cross-checked against the running balance looked
 * exactly like one a vision model guessed at off a blurry screenshot. Asked to review
 * all of it with the same suspicion, people review none of it.
 *
 * It sits beside the AI-generated pill because that pill raises the question ("should
 * I trust this?") without answering it. The tooltip carries what is actually
 * actionable — the method, and what specifically came out shaky.
 */
export default function ConfidenceBadge({ summary }) {
  const band = confidenceBand(summary?.score);
  if (!band) return null;

  const color = BAND_COLOR[band];
  const detail = confidenceDetail(summary);

  return (
    <span
      title={`${BAND_LABEL[band]}${detail ? `\n\n${detail}` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
        cursor: 'default', color,
        padding: '3px 8px', borderRadius: 999,
        fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.02em',
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-mono)' }}>{asPercent(summary.score)}</span>
      confident
    </span>
  );
}
