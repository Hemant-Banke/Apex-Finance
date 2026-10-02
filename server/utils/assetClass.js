/**
 * What a holding IS, for portfolio-level analytics: its asset class (as fractions, since a
 * hybrid fund is part equity, part debt), its equity market-cap tier and its region.
 * Pure — every lookup it needs (fund category, NSE sector, cap rank) is passed in.
 */

const LOCKED_TYPES = new Set(['fd', 'epf_nps', 'bond', 'other']);

// Typical equity share of a hybrid category (SEBI bands, midpoint).
const HYBRID_EQUITY = [
  [/aggressive/i, 0.75], [/balanced advantage|dynamic asset/i, 0.5], [/multi asset/i, 0.55],
  [/equity savings/i, 0.35], [/conservative/i, 0.2], [/retirement|children/i, 0.6],
];

const isMetal = (t) => /\b(gold|silver)\b/i.test(t);
const metalOf = (t) => (/silver/i.test(t) ? 'silver' : 'gold');
const isGlobal = (t) => /overseas|international|global|nasdaq|s&p 500|us equity|world|emerging market/i.test(t);
const isDebt = (t) => /debt|income|liquid|overnight|gilt|money market|bond|credit risk|duration|floating|banking and psu|arbitrage|fixed maturity|fmp/i.test(t);

/** Cap tier of an equity fund/ETF from its category or name; null when it is unconstrained. */
function fundCap(text) {
  if (/large\s*&\s*mid/i.test(text)) return { large: 0.5, mid: 0.5 };
  if (/multi\s*cap/i.test(text)) return { large: 0.34, mid: 0.33, small: 0.33 };
  if (/small\s*cap|smallcap/i.test(text)) return { small: 1 };
  if (/mid\s*cap|midcap/i.test(text)) return { mid: 1 };
  if (/large\s*cap|bluechip|nifty\s*(50|100)\b|sensex|next\s*50|bank\s*nifty|nifty\s*bank/i.test(text)) return { large: 1 };
  return null;
}

/**
 * classify(h, ctx) → { cls: { equity?, debt?, gold?, silver?, crypto?, commodity?, alt? },
 *                       cap: { large?, mid?, small?, flexi?, unknown? } | null, global: bool, locked: bool,
 *                       sector?: { key, label }, basis, capBasis } — the two `basis` strings say why
 * ctx: { category (AMFI), nse: { sector, label } | null, capRank: number | null, nseReady }
 */
const TYPE_BASIS = {
  crypto: 'Cryptocurrency', gold: 'Physical gold', silver: 'Physical silver', commodity: 'Commodity',
  bond: 'Bond', fd: 'Fixed deposit', epf_nps: 'EPF / NPS', other: 'Self-valued asset',
};

function classify(h, { category = '', nse = null, capRank = null, nseReady = true } = {}) {
  const name = h.name || '';
  const foreign = !!h.currency && h.currency !== 'INR';
  const abroad = foreign ? `Priced in ${h.currency}` : null;
  const base = { cap: null, global: foreign, locked: LOCKED_TYPES.has(h.type), basis: null, capBasis: abroad };

  switch (h.type) {
    case 'stock': {
      const out = { ...base, cls: { equity: 1 }, basis: 'Listed stock' };
      if (foreign) return out;
      // SEBI tiers: top 100 large, 101–250 mid, the rest small. Outside the Nifty 500 is small
      // too, but only once the list is loaded; until then the tier is unknown.
      out.cap = capRank == null ? (nse || !nseReady ? { unknown: 1 } : { small: 1 })
        : capRank <= 100 ? { large: 1 } : capRank <= 250 ? { mid: 1 } : { small: 1 };
      out.capBasis = capRank != null ? `Rank ${capRank} by market cap in the Nifty 500`
        : !nseReady ? 'Nifty 500 list not loaded yet' : nse ? 'Market cap not available' : 'Not in the Nifty 500';
      if (nse) out.sector = { key: nse.sector, label: nse.label };
      return out;
    }
    case 'etf':
    case 'mutual_fund': {
      const text = `${category} ${name}`;
      const cat = category || (h.type === 'etf' ? 'ETF, classified by its name' : 'Fund, classified by its name');
      if (isMetal(text) && !/equity|mining/i.test(category)) return { ...base, cls: { [metalOf(text)]: 1 }, basis: cat };
      if (/hybrid|balanced|asset allocation|equity savings|solution oriented|retirement/i.test(category) && !/arbitrage/i.test(category)) {
        const eq = HYBRID_EQUITY.find(([re]) => re.test(text))?.[1] ?? 0.5;
        return {
          ...base, cls: { equity: eq, debt: 1 - eq }, cap: { flexi: 1 }, hybrid: true,
          basis: `${cat} · typical mix ${Math.round(eq * 100)}% equity / ${Math.round((1 - eq) * 100)}% debt`,
          capBasis: 'Hybrid fund — the manager picks across caps',
        };
      }
      if (isDebt(text) && !/equity/i.test(category)) return { ...base, cls: { debt: 1 }, basis: cat };
      const global = foreign || isGlobal(text);
      const cap = global ? null : fundCap(text);
      return {
        ...base, global, cls: { equity: 1 }, cap: global ? null : (cap || { flexi: 1 }), basis: cat,
        capBasis: global ? (abroad || cat) : cap ? cat : `${cat} — not tied to one cap tier`,
      };
    }
    case 'crypto':    return { ...base, cls: { crypto: 1 },    basis: TYPE_BASIS.crypto };
    case 'gold':      return { ...base, cls: { gold: 1 },      basis: TYPE_BASIS.gold };
    case 'silver':    return { ...base, cls: { silver: 1 },    basis: TYPE_BASIS.silver };
    case 'commodity': return { ...base, cls: { commodity: 1 }, basis: TYPE_BASIS.commodity };
    case 'bond':
    case 'fd':
    case 'epf_nps':   return { ...base, cls: { debt: 1 },      basis: TYPE_BASIS[h.type] };
    default:          return { ...base, cls: { alt: 1 },       basis: TYPE_BASIS.other };
  }
}

module.exports = { classify };
