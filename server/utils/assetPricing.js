/**
 * assetPricing — pure helpers for assets that Yahoo cannot price directly.
 *
 * Two mechanisms, both driven by metadata stored on the holding:
 *
 *  1. PURITY (physical gold / silver). We fetch the metal's spot future in USD
 *     per troy ounce plus USD/INR, convert to INR per gram of pure (999) metal,
 *     then scale by the holding's purity factor (22K gold = 0.916, and so on).
 *     Units for these holdings are grams.
 *
 *  2. RATE (FDs, bonds, EPF/NPS, and any other unlisted asset). The holding
 *     carries an annual percentage — a coupon rate for debt instruments, an
 *     expected return for everything else — and the price is accrued from its
 *     cost basis with annual compounding.
 *
 * A real market price always wins; accrual is only the fallback for assets that
 * have none.
 */

const { DAY_MS } = require('./constants');

const TROY_OZ_G = 31.1035;   // grams in a troy ounce
const YEAR_MS   = 365 * DAY_MS;

/** Metals priced from a spot future + FX rather than from their own symbol. */
const METAL_SPOT_SYMBOLS = { gold: 'GC=F', silver: 'SI=F' };
const FX_SYMBOL          = 'USDINR=X';

/**
 * Indian physical metal costs materially more than the international spot: import
 * duty, 3% GST, and a local market premium all sit on top. GC=F/SI=F are COMEX
 * prices and contain none of that, so converting them straight to INR undervalues
 * a domestic holding by ~12-14%.
 *
 * These multipliers close that gap. They are empirically calibrated — the gold
 * wedge measured 1.147 against a jeweller's May-2024 rate and 1.142 against the
 * spot rate today, and silver lands in the same band against SILVERBEES. Duty
 * changes are rare but real, so both are overridable from the environment.
 */
const DOMESTIC_PREMIUM = {
  gold:   Number(process.env.METAL_PREMIUM_GOLD)   || 1.14,
  silver: Number(process.env.METAL_PREMIUM_SILVER) || 1.12,
};

/** Asset types that carry a purity and are valued per gram. */
const PURITY_ASSET_TYPES = ['gold', 'silver'];

/** Asset types whose annual rate is a contractual coupon, not an estimate. */
const COUPON_ASSET_TYPES = ['bond', 'fd', 'epf_nps'];

/** Asset types Yahoo prices for us — these never need an accrual rate. */
const MARKET_ASSET_TYPES = ['stock', 'etf', 'mutual_fund', 'crypto'];

/** Selectable purities, most-pure first. `factor` is the fraction of pure metal. */
const PURITY_OPTIONS = {
  gold: [
    { value: '24K', label: '24K (999)', factor: 0.999 },
    { value: '22K', label: '22K (916)', factor: 0.916 },
    { value: '18K', label: '18K (750)', factor: 0.750 },
    { value: '14K', label: '14K (585)', factor: 0.585 },
  ],
  silver: [
    { value: '999', label: 'Fine (999)',     factor: 0.999 },
    { value: '925', label: 'Sterling (925)', factor: 0.925 },
    { value: '900', label: 'Coin (900)',     factor: 0.900 },
  ],
};

const isPurityAsset = (assetType) => PURITY_ASSET_TYPES.includes(assetType);
const isMarketAsset = (assetType) => MARKET_ASSET_TYPES.includes(assetType);

/** True when the asset should carry an annual rate (coupon or expected return). */
const isRateAsset = (assetType) => !isMarketAsset(assetType) && !isPurityAsset(assetType);

/** What the rate means for this asset type — drives the form label. */
const rateKind = (assetType) => (COUPON_ASSET_TYPES.includes(assetType) ? 'coupon' : 'expected');

/** Fraction of pure metal for a purity key; 1 when unknown, so nothing is scaled away. */
function purityFactor(assetType, purity) {
  const opt = (PURITY_OPTIONS[assetType] || []).find(o => o.value === purity);
  return opt ? opt.factor : 1;
}

/**
 * INR per gram of pure metal as it actually trades in India — the international
 * spot converted to INR, then lifted by the domestic premium (duty + GST + local).
 */
function metalInrPerGram(usdPerOz, usdInr, assetType = 'gold') {
  if (!usdPerOz || !usdInr) return null;
  const international = (usdPerOz * usdInr) / TROY_OZ_G;
  return international * (DOMESTIC_PREMIUM[assetType] || 1);
}

/**
 * Compound `basePrice` at `ratePct` per annum over the elapsed span.
 * A non-positive span returns the base untouched, so a holding is never accrued
 * backwards in time.
 */
function accruedPrice(basePrice, ratePct, basisMs, atMs) {
  if (!basePrice || !ratePct) return basePrice ?? null;
  const years = (atMs - basisMs) / YEAR_MS;
  if (!Number.isFinite(years) || years <= 0) return basePrice;
  return basePrice * Math.pow(1 + ratePct / 100, years);
}

/**
 * The unit price to value a holding at on a given day.
 *
 * @param {{assetType?: string, purity?: string, rate?: number}} meta  holding metadata
 * @param {{marketPrice?: number|null, basePrice?: number|null, basisMs?: number, atMs: number}} ctx
 *   marketPrice — quote for the day (999-metal INR/gram for purity assets), if any
 *   basePrice   — cost basis to accrue from when there is no market price
 * @returns {number|null}  null means "no opinion" — the caller picks the fallback.
 */
function resolveUnitPrice(meta, { marketPrice = null, basePrice = null, basisMs, atMs }) {
  const { assetType, purity, rate } = meta || {};

  // Physical metal: the quote is per gram of pure metal, so scale it by purity.
  // Without a spot quote we have no opinion — the caller falls back to book value.
  if (isPurityAsset(assetType)) {
    return marketPrice != null ? marketPrice * purityFactor(assetType, purity) : null;
  }

  if (marketPrice != null) return marketPrice;

  // No market price: accrue the cost basis at the holding's annual rate.
  if (rate && basePrice != null && basisMs != null) {
    return accruedPrice(basePrice, rate, basisMs, atMs);
  }

  return null;
}

module.exports = {
  TROY_OZ_G,
  METAL_SPOT_SYMBOLS,
  FX_SYMBOL,
  DOMESTIC_PREMIUM,
  PURITY_ASSET_TYPES,
  COUPON_ASSET_TYPES,
  MARKET_ASSET_TYPES,
  PURITY_OPTIONS,
  isPurityAsset,
  isMarketAsset,
  isRateAsset,
  rateKind,
  purityFactor,
  metalInrPerGram,
  accruedPrice,
  resolveUnitPrice,
};
