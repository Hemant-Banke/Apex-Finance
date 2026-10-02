import { useId } from 'react';

/**
 * A balance's shape over time, at row scale.
 *
 * Drawn by hand in SVG rather than through the charting library: there is one of these
 * per account row, it has no axes, no tooltip and no interaction, and mounting a
 * Recharts container per row to draw twenty-four points would cost more than the whole
 * rest of the page.
 *
 * The line carries no judgement — it is gold on an account and danger-toned on a debt,
 * matching the row, and never green-for-up / red-for-down. A current account falling
 * through the month is not a loss, it is January; colouring it as failure would be the
 * chart lying about something it cannot know.
 *
 * Props:
 *   values — numbers, oldest first (2+; fewer has no shape and renders nothing)
 *   tone   — stroke colour, defaults to the gold accent
 */
export default function Sparkline({
  values = [],
  width = 92,
  height = 26,
  tone = 'var(--color-accent)',
  title,
  fluid = false,   // stretch to the container's width (no end dot, which would distort)
}) {
  const gradientId = useId();
  if (!values || values.length < 2) return null;

  const min  = Math.min(...values);
  const max  = Math.max(...values);
  const span = (max - min) || 1;      // a flat run would divide by zero
  const pad  = 3;                     // keeps the stroke off the top and bottom edges

  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const line   = `M ${points.join(' L ')}`;
  const area   = `${line} L ${width},${height} L 0,${height} Z`;

  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <svg
      width={fluid ? '100%' : width} height={height} viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
      role="img"
      aria-label={title || 'Balance trend'}
    >
      {title && <title>{title}</title>}
      <defs>
        {/* Unique per instance — one shared id would have every row painting itself
            with the first row's gradient. */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={tone} stopOpacity="0.22" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      {/* Where the line has got TO is the figure beside it — the dot ties the two. */}
      {!fluid && <circle cx={lastX} cy={lastY} r="2" fill={tone} />}
    </svg>
  );
}
