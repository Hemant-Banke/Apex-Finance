import { Check } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { BENCHMARKS } from '../../lib/constants';

/**
 * One benchmark row — a colour swatch (the line it will render as, once picked)
 * plus its name. The swatch is drawn even when unselected, dimmed, so picking a
 * few rows previews the palette they'll take on the chart.
 */
function Row({ label, color, checked, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '7px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--color-bg-elevated)' : 'transparent',
        textAlign: 'left',
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: 3, flexShrink: 0,
        background: color, opacity: checked ? 1 : 0.35,
      }} />
      <span className="text-sm" style={{ flex: 1, color: checked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
        {label}
      </span>
      <span style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        border: `2px solid ${checked ? 'var(--color-accent)' : 'var(--color-border-hover)'}`,
        background: checked ? 'var(--color-accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <Check size={12} strokeWidth={3} color="var(--color-bg-primary)" />}
      </span>
    </button>
  );
}

/**
 * Multi-select dialog for the growth view's index comparison overlay.
 *
 * Props:
 *   open, onClose
 *   selected     — array of selected symbols (controlled)
 *   onChange     — (nextSymbols[]) => void
 *   colorOf(sym) — maps a symbol to the swatch/line colour it will render as
 *   options      — the catalogue to pick from (default: BENCHMARKS)
 */
export default function CompareIndexDialog({ open, onClose, selected, onChange, colorOf, options = BENCHMARKS }) {
  const toggle = (symbol) => {
    onChange(selected.includes(symbol)
      ? selected.filter(s => s !== symbol)
      : [...selected, symbol]);
  };

  // The catalogue's own order, filed under its `group` headings (indices, global
  // markets, assets) — fourteen rows in one undifferentiated list is a scan.
  const groups = [];
  for (const b of options) {
    const last = groups[groups.length - 1];
    if (last && last[0] === (b.group || '')) last[1].push(b);
    else groups.push([b.group || '', [b]]);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Growth view"
      title="Compare against"
      subtitle="Overlay an index or an asset on the same base-100 scale"
    >
      {/* The list scrolls inside a capped box so the dialog stays short and Done stays
          in view; each group's heading sticks while its rows pass beneath it. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        maxHeight: 'min(46vh, 340px)', overflowY: 'auto', overscrollBehavior: 'contain',
        margin: '0 -6px 16px', padding: '0 6px',
      }}>
        {groups.map(([group, rows], gi) => (
          <div key={group || gi} style={{ marginTop: gi ? 10 : 0 }}>
            {group && (
              <p className="col-head" style={{
                padding: '6px 12px', position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--color-bg-card)',
              }}>{group}</p>
            )}
            {rows.map(b => (
              <Row
                key={b.symbol}
                label={b.label}
                color={colorOf(b.symbol)}
                checked={selected.includes(b.symbol)}
                onToggle={() => toggle(b.symbol)}
              />
            ))}
          </div>
        ))}
      </div>
      <Button variant="gold" onClick={onClose} style={{ width: '100%' }}>Done</Button>
    </Modal>
  );
}
