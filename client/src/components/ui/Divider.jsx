/**
 * Divider — a plain horizontal hairline.
 *
 * Props:
 *   margin — vertical margin (number → px, or any CSS length)
 */
export default function Divider({ margin = 0, style }) {
  const m = typeof margin === 'number' ? `${margin}px` : margin;
  return <hr className="divider" style={{ margin: `${m} 0`, ...style }} />;
}
