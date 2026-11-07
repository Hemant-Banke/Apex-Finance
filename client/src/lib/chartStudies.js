// The indicators and comparisons a user puts on a price chart, shared by every chart.
// Per-device convenience in localStorage; a chart still adds its own default benchmark.
const KEY = 'apex_chart_studies';

const empty = () => ({ indicators: [], compare: [], added: [] });

export function loadStudies() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || typeof s !== 'object') return empty();
    return {
      indicators: Array.isArray(s.indicators) ? s.indicators.filter(i => i?.id && i?.type) : [],
      compare:    Array.isArray(s.compare) ? s.compare.filter(x => typeof x === 'string') : [],
      added:      Array.isArray(s.added) ? s.added.filter(b => b?.symbol) : [],
    };
  } catch { return empty(); }
}

function save(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* convenience only */ }
}

export const saveIndicators = (indicators) => save({ ...loadStudies(), indicators });

// Applies one chart's add/remove gestures, so a page's default benchmark is never saved.
export function saveCompareChange(prev, next, catalogue) {
  const s = loadStudies();
  const added = next.filter(x => !prev.includes(x));
  const removed = prev.filter(x => !next.includes(x));
  const compare = [...s.compare.filter(x => !removed.includes(x)), ...added.filter(x => !s.compare.includes(x))];
  const custom = [...s.added];
  for (const sym of added) {
    const b = catalogue.find(x => x.symbol === sym);
    if (b && !custom.some(x => x.symbol === sym)) custom.push({ symbol: b.symbol, label: b.label, group: b.group });
  }
  save({ ...s, compare, added: custom.filter(b => compare.includes(b.symbol)) });
}
