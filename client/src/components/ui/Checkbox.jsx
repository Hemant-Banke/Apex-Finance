import { Check } from 'lucide-react';

// Square checkbox; `accent` (gilt, filled) for a master select-all, `plain` for rows. It is a <button>.
export default function Checkbox({ checked, indeterminate, onChange, tone = 'accent', label }) {
  // 'accent' — the master select-all: gilt, filled when checked (the primary
  // control). 'plain' — per-row: when checked it stays an outlined square with
  // just a white tick (no filled background), so rows read lighter than the
  // master. Unchecked states are an empty square with a greyish border.
  const isPlain = tone === 'plain';
  const on = tone === 'accent'
    ? { line: 'var(--color-accent)', fill: 'var(--color-accent)', tick: 'var(--color-bg-primary)' }
    : { line: 'var(--color-text-primary)', fill: 'var(--color-text-primary)', tick: 'var(--color-bg-primary)' };
  const active = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate && !checked ? 'mixed' : !!checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        border: active
          ? `2px solid ${isPlain ? 'var(--color-text-muted)' : on.line}`
          : `2px solid ${isPlain ? 'var(--color-border)' : 'var(--color-border-hover)'}`,
        background: checked
          ? (isPlain ? 'transparent' : on.fill)
          : indeterminate ? 'var(--color-accent-muted)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0,
      }}
    >
      {checked && <Check size={12} style={{ color: isPlain ? on.line : on.tick, strokeWidth: 3 }} />}
      {indeterminate && !checked && <span style={{ width: 8, height: 2, background: on.line, borderRadius: 1, display: 'block' }} />}
    </button>
  );
}
