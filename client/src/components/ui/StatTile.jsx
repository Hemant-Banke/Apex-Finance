import Card from './Card';

/**
 * StatTile — a single headline metric.
 * Label eyebrow, a large mono ledger figure (the signature numeral treatment),
 * an optional sub caption, and a muted icon. Pass `highlight` for the gilt
 * accent on the tile's most important figure.
 *
 * Props:
 *   label     — small caption above the figure
 *   value     — the figure (string, already formatted)
 *   sub       — optional secondary caption below
 *   icon      — lucide icon component
 *   accent    — colour for the figure + icon (defaults to primary text)
 *   highlight — when true, adds the gilt top-rule
 */
export default function StatTile({ label, value, sub, icon: Icon, accent, highlight = false }) {
  const figureColor = accent || 'var(--color-text-primary)';
  return (
    <Card compact gilt={highlight}>
      <div className="flex items-start justify-between" style={{ marginBottom: 12 }}>
        <p className="heading-sm" style={{ letterSpacing: '0.1em' }}>{label}</p>
        {Icon && <Icon size={15} style={{ color: accent || 'var(--color-text-muted)', opacity: accent ? 0.85 : 0.55 }} strokeWidth={1.75} />}
      </div>
      <p className="figure" style={{ fontSize: '1.35rem', fontWeight: 500, color: figureColor, lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>{sub}</p>}
    </Card>
  );
}
