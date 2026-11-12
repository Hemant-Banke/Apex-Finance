import { CHART_COLORS } from './utils';

/** US$ billions, as RBI publishes them: "$717.1B", "−$4.2B", "+$6.1B" when signed. */
export function usdBn(v, { signed = false, digits = 1 } = {}) {
  if (v == null || isNaN(v)) return '—';
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(digits)}B`;
}

// One hue per kind of money, the same on both sides of the border (identity, never gain/loss).
export const FLOW_TONE = {
  trade: CHART_COLORS[1],
  services: CHART_COLORS[2],
  income: CHART_COLORS[4],
  transfers: CHART_COLORS[5],
  capital: CHART_COLORS[0],
  reserves: 'var(--color-text-muted)',
};

/**
 * One quarter's balance of payments as money in and money out, which balance by construction.
 * Current-account items are gross; capital items are net, on whichever side their sign puts them.
 */
export function bopFlows(items) {
  const v = (k, f) => items[k]?.[f] ?? 0;
  const has = (k) => items[k] != null;
  const inflows = [
    { key: 'goodsX', label: 'Goods exports', value: v('goods', 'cr'), tone: FLOW_TONE.trade },
    { key: 'servicesX', label: 'Services exports', value: v('services', 'cr'), tone: FLOW_TONE.services },
    { key: 'remitIn', label: 'Remittances & transfers', value: v('secondary', 'cr'), tone: FLOW_TONE.transfers },
    { key: 'incomeIn', label: 'Investment income', value: v('primary', 'cr'), tone: FLOW_TONE.income },
  ];
  const nonOil = v('goods', 'dr') - v('pol', 'dr');
  const outflows = [
    ...(has('pol')
      ? [{ key: 'oil', label: 'Oil imports', value: v('pol', 'dr'), tone: FLOW_TONE.trade },
        { key: 'goodsM', label: 'Other goods imports', value: nonOil, tone: FLOW_TONE.trade }]
      : [{ key: 'goodsM', label: 'Goods imports', value: v('goods', 'dr'), tone: FLOW_TONE.trade }]),
    { key: 'servicesM', label: 'Services imports', value: v('services', 'dr'), tone: FLOW_TONE.services },
    { key: 'incomeOut', label: 'Investment income paid', value: v('primary', 'dr'), tone: FLOW_TONE.income },
    { key: 'remitOut', label: 'Transfers abroad', value: v('secondary', 'dr'), tone: FLOW_TONE.transfers },
  ];

  // Capital nets. "Other" is whatever the release does not break out, so the whole still balances.
  const named = [
    ['di', 'Foreign direct investment'], ['pi', 'Portfolio investment'], ['nri', 'NRI deposits'], ['ecb', 'Foreign loans (ECB)'],
  ].filter(([k]) => has(k));
  const capital = named.map(([k, label]) => ({ key: k, label, net: v(k, 'net') }));
  const namedSum = capital.reduce((s, c) => s + c.net, 0);
  capital.push({ key: 'othercap', label: 'Other capital', net: v('capfin', 'net') - v('reserves', 'net') - namedSum + v('eo', 'net') });
  for (const c of capital) {
    if (Math.abs(c.net) < 0.05) continue;
    const row = { key: c.key, label: c.label, value: Math.abs(c.net), tone: FLOW_TONE.capital, net: true };
    (c.net > 0 ? inflows : outflows).push(c.net > 0 ? row : { ...row, label: `${c.label} out` });
  }
  const res = v('reserves', 'net');   // RBI's sign: negative = reserves rose
  if (Math.abs(res) >= 0.05) {
    (res > 0 ? inflows : outflows).push({
      key: 'reserves', label: res > 0 ? 'Drawn from reserves' : 'Added to reserves', value: Math.abs(res), tone: FLOW_TONE.reserves, net: true,
    });
  }
  const keep = (rows) => rows.filter(r => r.value >= 0.05);
  return { inflows: keep(inflows), outflows: keep(outflows) };
}
