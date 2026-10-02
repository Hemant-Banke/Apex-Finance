/**
 * screenerService — an Indian company's reported financials and shareholding, from its
 * Screener.in page.
 *
 * Yahoo's fundamentals for Indian companies are thin and drift from the filings (Maruti's
 * FY26 revenue: ₹1.77L Cr on Yahoo, ₹1.83L Cr as reported), carry five quarters, and have
 * no shareholding breakdown at all. Screener renders the company's own consolidated
 * filings in ₹ crore: thirteen quarters, twelve years, the balance sheet and cash flows,
 * and the quarterly shareholding pattern — Promoters, FIIs, DIIs, Government, Public — with
 * the number of shareholders. It is a public page, not an API, so it is parsed defensively
 * and cached; anything missing is simply absent from the result.
 *
 * Two facts about Indian reporting shape what can exist here: results are QUARTERLY, but
 * the balance sheet and cash-flow statement are published only half-yearly and annually
 * (Screener shows the annual ones). So debt and cash flow have no quarterly series, and
 * the company page says so rather than inventing one.
 *
 * All money here is ₹ CRORE, as filed.
 */

const { BROWSER_HEADERS } = require('../utils/constants');
const { parseNumber } = require('../utils/helpers');

const TTL_MS = 6 * 60 * 60 * 1000;     // filings change quarterly; a page an hour old is current
const _memo = new Map();               // symbol → { at, data }

const _text = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\+/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The first `<table class="data-table">` in a chunk of HTML → `{ heads: [...], rows: { label: [values] } }`. */
function _table(html) {
  const t = /<table class="data-table[^"]*">([\s\S]*?)<\/table>/.exec(html || '');
  if (!t) return null;
  const heads = [...(/<thead>([\s\S]*?)<\/thead>/.exec(t[1])?.[1] || '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map(m => _text(m[1])).slice(1);
  const rows = {};
  for (const tr of (/<tbody>([\s\S]*?)<\/tbody>/.exec(t[1])?.[1] || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    if (cells.length < 2) continue;
    const label = _text(cells[0]);
    if (label) rows[label] = cells.slice(1).map(c => parseNumber(_text(c)));
  }
  return { heads, rows };
}

const _section = (html, id) => new RegExp(`<section id="${id}"[\\s\\S]*?</section>`).exec(html)?.[0] || '';
const _div = (html, id) => new RegExp(`<div[^>]*id="${id}"[\\s\\S]*?</table>`).exec(html)?.[0] || '';

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
/** "Mar 2026" → "2026-03-31" (the period's last day); anything else (TTM) → null. */
function _periodEnd(head) {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(head);
  if (!m || !MON[m[1]]) return null;
  const last = new Date(Date.UTC(+m[2], MON[m[1]], 0)).getUTCDate();
  return `${m[2]}-${String(MON[m[1]]).padStart(2, '0')}-${last}`;
}

/** Pick the first row whose label matches — banks and NBFCs name their lines differently. */
const _pick = (rows, ...labels) => {
  for (const l of labels) {
    const key = Object.keys(rows).find(k => k.toLowerCase() === l.toLowerCase());
    if (key) return rows[key];
  }
  return null;
};

/** A table → `[{ date, field: value, … }]`, oldest first, with each field mapped from its row labels. */
function _series(tbl, fields) {
  if (!tbl) return [];
  const cols = {};
  for (const [field, labels] of Object.entries(fields)) cols[field] = _pick(tbl.rows, ...labels);
  return tbl.heads.map((h, i) => {
    const date = _periodEnd(h);
    if (!date) return null;
    const row = { date };
    for (const [field, values] of Object.entries(cols)) row[field] = values?.[i] ?? null;
    return row;
  }).filter(Boolean);
}

const RESULT_FIELDS = {
  revenue:         ['Sales', 'Revenue'],
  expenses:        ['Expenses'],
  operatingProfit: ['Operating Profit', 'Financing Profit'],
  opm:             ['OPM %', 'Financing Margin %'],
  interest:        ['Interest'],
  netIncome:       ['Net Profit'],
  eps:             ['EPS in Rs'],
};

function _parse(html) {
  const quarterly = _series(_table(_section(html, 'quarters')), RESULT_FIELDS);
  const annualPl  = _series(_table(_section(html, 'profit-loss')), RESULT_FIELDS);
  const balance   = _series(_table(_section(html, 'balance-sheet')), {
    equityCapital: ['Equity Capital'], reserves: ['Reserves'], debt: ['Borrowings', 'Borrowing'],
    totalAssets: ['Total Assets'],
  });
  const cash = _series(_table(_section(html, 'cash-flow')), {
    ocf: ['Cash from Operating Activity'], fcf: ['Free Cash Flow'],
  });

  // One annual row per year, the three statements joined on the year's end date.
  const byDate = {};
  for (const r of annualPl) byDate[r.date] = { ...r };
  for (const r of balance) {
    const row = (byDate[r.date] ??= { date: r.date });
    row.debt = r.debt;
    row.equity = r.equityCapital != null && r.reserves != null ? r.equityCapital + r.reserves : null;
  }
  for (const r of cash) Object.assign((byDate[r.date] ??= { date: r.date }), { ocf: r.ocf, fcf: r.fcf });
  const annual = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  const shp = (id) => _series(_table(_div(_section(html, 'shareholding'), id)), {
    promoters: ['Promoters'], fiis: ['FIIs'], diis: ['DIIs'], government: ['Government'],
    public: ['Public'], shareholders: ['No. of Shareholders'],
  });

  const quarterTable = _table(_section(html, 'quarters'));
  return {
    consolidated: _text(_section(html, 'quarters')).includes('Consolidated Figures'),
    // A bank reports "Financing Profit" / "Financing Margin %" where a company reports
    // operating profit: revenue less interest PAID and provisions, which runs negative in
    // a heavy-provisioning quarter. Neither it nor debt-to-equity means for a lender what
    // it means for a manufacturer, so the page needs to know which it is reading.
    kind: quarterTable && _pick(quarterTable.rows, 'Financing Profit') ? 'bank' : 'company',
    quarterly, annual,
    shareholding: { quarterly: shp('quarterly-shp'), yearly: shp('yearly-shp') },
  };
}

async function _fetchPage(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`https://www.screener.in/company/${encodeURIComponent(path.symbol)}/${path.consolidated ? 'consolidated/' : ''}`, {
        headers: { ...BROWSER_HEADERS, Accept: 'text/html', Referer: 'https://www.screener.in/' },
        signal: AbortSignal.timeout(12000),
      });
      if (resp.status === 404) return null;
      if (resp.ok) return await resp.text();
    } catch { /* stalled — one more try on a fresh connection */ }
  }
  return null;
}

/**
 * A company's filings and shareholding, or null when Screener has no page for it.
 * The CONSOLIDATED figures are preferred (the group, as investors are told about it);
 * a company that files standalone only falls back to those.
 */
async function getCompany(symbol) {
  const hit = _memo.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  let data = null;
  const consolidated = await _fetchPage({ symbol, consolidated: true });
  if (consolidated) {
    data = _parse(consolidated);
    // Screener serves the consolidated URL even for standalone-only companies, with an
    // empty results table — fall back to the standalone page then.
    if (!data.quarterly.some(q => q.revenue != null)) {
      const standalone = await _fetchPage({ symbol, consolidated: false });
      if (standalone) data = _parse(standalone);
    }
  }
  if (data && !data.quarterly.length && !data.annual.length) data = null;

  _memo.set(symbol, { at: Date.now(), data });
  return data;
}

module.exports = { getCompany, _parse, _table, _periodEnd };
