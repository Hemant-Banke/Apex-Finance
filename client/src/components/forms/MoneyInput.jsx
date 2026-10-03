import { useLayoutEffect, useRef } from 'react';
import { formatCompact } from '../../lib/utils';

const group = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-IN'));

/**
 * A rupee amount typed with live Indian digit grouping (25,00,000), caret kept in place.
 * `value` is a number or null; `compact` echoes ₹25L at the right once it reaches a lakh.
 */
export default function MoneyInput({ value, onChange, placeholder = '0', compact = true, size = 'md', autoFocus, ariaLabel }) {
  const ref = useRef(null);
  const caret = useRef(null);

  // Put the caret back after the same number of digits it followed before regrouping.
  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current == null || !el) return;
    let left = caret.current, i = 0;
    while (i < el.value.length && left > 0) { if (/\d/.test(el.value[i])) left--; i++; }
    el.setSelectionRange(i, i);
    caret.current = null;
  });

  const change = (e) => {
    const raw = e.target.value;
    caret.current = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/\D/g, '').length;
    const digits = raw.replace(/\D/g, '').slice(0, 13);
    onChange(digits ? Number(digits) : null);
  };

  return (
    <div className={`money-input money-input-${size}`}>
      <span className="money-input-mark">₹</span>
      <input ref={ref} type="text" inputMode="numeric" autoComplete="off" className="figure" aria-label={ariaLabel}
        autoFocus={autoFocus} placeholder={placeholder} value={group(value)} onChange={change} />
      {compact && value >= 1_00_000 && <span className="money-input-echo figure">{formatCompact(value)}</span>}
    </div>
  );
}
