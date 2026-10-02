const MfScheme = require('../models/MfScheme');
const { classify } = require('../utils/assetClass');
const { peekClassification } = require('./sectorService');
const { DAY_MS } = require('../utils/constants');
const { todayMs } = require('../utils/helpers');

const add = (obj, key, v) => { if (v) obj[key] = (obj[key] || 0) + v; };

/**
 * The book described as a whole: asset classes, equity by market cap, region, sectors of
 * direct equity, liquidity, fixed-income yield, how much is in profit and how long it has
 * been held. All in rupees (the client normalises, adding cash where it has it).
 * Local reads only — AMFI categories from Mongo, NSE sectors/caps from memory.
 */
async function getProfile(holdings) {
  const live = holdings.filter(h => h.value > 0);
  const codes = live.filter(h => h.symbol.startsWith('AMFI:')).map(h => h.symbol.slice(5));
  const schemes = codes.length
    ? Object.fromEntries((await MfScheme.find({ schemeCode: { $in: codes } }, { schemeCode: 1, category: 1 }).lean())
      .map(d => [d.schemeCode, d.category || '']))
    : {};
  const nse = peekClassification();

  const classes = {}, caps = {}, regions = {}, sectorMap = {}, members = [];
  let liquid = 0, locked = 0, yieldNum = 0, yieldBase = 0, ageNum = 0, ageBase = 0, hybrid = false;
  const inProfit = { count: 0, value: 0 };
  const today = todayMs();

  for (const h of live) {
    const sym = h.symbol.replace(/\.(NS|BO)$/, '');
    const isNse = /\.(NS|BO)$/.test(h.symbol);
    const c = classify(h, {
      category: h.symbol.startsWith('AMFI:') ? schemes[h.symbol.slice(5)] : '',
      nse: isNse ? nse.bySymbol.get(sym) || null : null,
      capRank: isNse ? nse.rank.get(sym) ?? null : null,
      nseReady: nse.ready,
    });

    members.push({
      symbol: h.symbol, name: h.name, type: h.type, currency: h.currency, value: h.value,
      cls: c.cls, cap: c.cap, global: c.global, sector: c.sector?.key || null,
      basis: c.basis, capBasis: c.capBasis,
    });
    for (const [k, f] of Object.entries(c.cls)) add(classes, k, h.value * f);
    const eq = h.value * (c.cls.equity || 0);
    if (eq) {
      add(regions, c.global ? 'global' : 'india', eq);
      if (c.global) add(caps, 'global', eq);
      else for (const [k, f] of Object.entries(c.cap || { flexi: 1 })) add(caps, k, eq * f);
    }
    if (c.sector) {
      const s = (sectorMap[c.sector.key] ??= { key: c.sector.key, label: c.sector.label, value: 0, count: 0 });
      s.value += h.value; s.count += 1;
    }
    if (c.hybrid) hybrid = true;
    if (c.locked) locked += h.value; else liquid += h.value;
    if (h.rate > 0) { yieldNum += h.rate * h.value; yieldBase += h.value; }
    if (h.unrealisedPnl > 0) { inProfit.count += 1; inProfit.value += h.value; }
    if (h.firstPurchaseDate) {
      const years = (today - new Date(h.firstPurchaseDate).getTime()) / (365.25 * DAY_MS);
      if (years >= 0) { ageNum += years * h.value; ageBase += h.value; }
    }
  }

  return {
    total: live.reduce((s, h) => s + h.value, 0),
    n: live.length,
    classes, caps, regions,
    sectors: Object.values(sectorMap).sort((a, b) => b.value - a.value),
    sectorsReady: nse.ready,
    liquid, locked,
    yield: yieldBase ? yieldNum / yieldBase : null,
    yieldBase,
    inProfit,
    avgAgeYears: ageBase ? ageNum / ageBase : null,
    hybrid,
    // Per holding, so a slice can be opened to show what was counted in it and why.
    members,
  };
}

module.exports = { getProfile };
