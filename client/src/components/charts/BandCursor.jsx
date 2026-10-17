import { chartBandWidth } from '../../lib/utils';

/**
 * The hovered category (a month, a session) as a soft band behind its bars, for a
 * Recharts `cursor`.
 *
 * A ComposedChart draws its cursor as a full-height hairline even when it holds only bars
 * — a bright line through the data that reads as one more series. A band the width of
 * the slot says "this one" without drawing over anything. `count` is the number of slots.
 */
export default function BandCursor({ points, top, height, left, width, count }) {
  const x = points?.[0]?.x;
  if (x == null || !count) return null;
  const w = chartBandWidth(width, count);
  // Clamped into the plot so the first and last slots' bands do not overhang it.
  const bx = Math.min(Math.max(x - w / 2, left), left + width - w);
  return <rect x={bx} y={top} width={w} height={height} rx={Math.min(6, w / 4)}
    fill="var(--color-text-primary)" fillOpacity={0.045} pointerEvents="none" />;
}
