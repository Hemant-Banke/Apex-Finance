// Safari lets any text into a number <input>, and every browser takes e/E/+; so only digits, one '.', and '-' when `signed`.
// It also blurs on wheel, so scrolling past a focused field cannot nudge its value.
export const numericOnly = ({ signed = false } = {}) => {
  const ok = signed ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;
  return {
    onKeyDown: (e) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/\d/.test(e.key)) return;
      if (e.key === '.' && !String(e.currentTarget.value).includes('.')) return;
      if (e.key === '-' && signed) return;
      e.preventDefault();
    },
    onPaste: (e) => {
      const text = e.clipboardData.getData('text').trim().replace(/,/g, '');
      if (!ok.test(text)) e.preventDefault();
    },
    onDrop: (e) => e.preventDefault(),
    onWheel: (e) => e.currentTarget.blur(),
  };
};

/** Digits only, clamped to `max`; null when empty, so a field can be cleared while typing. */
export function wholeNumber(raw, max) {
  const d = String(raw).replace(/\D/g, '').slice(0, String(max).length);
  return d ? Math.min(max, Number(d)) : null;
}
