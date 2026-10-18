import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, SlidersHorizontal } from 'lucide-react';

// Colour + icon per cash transaction type.
const TYPE_META = {
  income:     { label: 'Income',     Icon: ArrowDownLeft,     color: 'var(--color-success)' },
  expense:    { label: 'Expense',    Icon: ArrowUpRight,      color: 'var(--color-danger)' },
  transfer:   { label: 'Transfer',   Icon: ArrowLeftRight,    color: 'var(--color-chart-warm)' },
  adjustment: { label: 'Adjustment', Icon: SlidersHorizontal, color: 'var(--color-accent)' },
};

/** The cash-type tiles of the transaction form. `inline` lays icon and label side by side to sit beside inputs. */
export default function TxnTypeTiles({ types, value, onChange, inline = false, style }) {
  return (
    <div role="radiogroup" aria-label="Type" style={{ display: 'grid', gridTemplateColumns: `repeat(${types.length}, 1fr)`, gap: 6, ...style }}>
      {types.map(k => {
        const m = TYPE_META[k];
        const on = value === k;
        return (
          <button key={k} type="button" role="radio" aria-checked={on} onClick={() => onChange(k)}
            style={{
              display: 'flex', flexDirection: inline ? 'row' : 'column', alignItems: 'center', justifyContent: 'center',
              gap: inline ? 6 : 5, padding: inline ? '0 6px' : '10px 4px', minHeight: inline ? '100%' : undefined,
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.6875rem', fontWeight: 600,
              border: `1px solid ${on ? m.color : 'var(--color-border)'}`,
              background: on ? `color-mix(in srgb, ${m.color} 12%, transparent)` : 'var(--color-bg-elevated)',
              color: on ? m.color : 'var(--color-text-muted)',
              boxShadow: on ? `inset 0 0 0 1px ${m.color}` : 'var(--elev-ring)',
              transition: 'all 0.15s ease',
            }}>
            <m.Icon size={inline ? 13 : 16} strokeWidth={2.2} /> {m.label}
          </button>
        );
      })}
    </div>
  );
}
