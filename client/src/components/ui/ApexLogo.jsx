/**
 * Apex logo mark — traced from logo_insp.png.
 * Six elongated blade shapes (3 per side) fan out from a shared
 * bottom-centre origin, creating a layered crown / apex mark.
 * Uses `currentColor` so it inherits the parent's colour.
 */
export default function ApexLogo({ size = 28, style = {}, className = '' }) {
  const h = Math.round(size * (142 / 200));
  return (
    <svg
      viewBox="0 0 200 142"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: size, height: h, display: 'block', flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      {/* ── Left blades (inner → outer) ── */}
      <path d="M 87 0 L 79 2 L 91 96 L 105 88 Z" />
      <path d="M 34 5 L 26 11 L 90 113 L 104 103 Z" />
      <path d="M 12 67 L 4 77 L 88 134 L 104 122 Z" />
      {/* ── Right blades (inner → outer) ── */}
      <path d="M 113 0 L 121 2 L 109 96 L 95 88 Z" />
      <path d="M 166 5 L 174 11 L 110 113 L 96 103 Z" />
      <path d="M 188 67 L 196 77 L 112 134 L 96 122 Z" />
    </svg>
  );
}
