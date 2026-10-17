/**
 * Behavioural features of a statement's rows for the categoriser: who was paid, whether
 * that looks like a person or a shop, and how this payee recurs across the WHOLE file.
 * Computed once before batching, so every batch still sees the file-wide pattern.
 */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A payment gateway means an online business; a shop QR means a small vendor (a stall, an auto, a kirana).
const GATEWAY = /rzp|razorpay|payu|cashfree|billdesk|juspay|pinelabs|ccavenue|swiggy|zomato|zepto|blinkit|airtel|jio|amazon|flipkart|\buber|\bola\b|olacabs/i;
const VENDOR_QR = /bharatpe|paytm-|paytmqr|^q\d{6,}@|\/q\d{6,}@|gpay-|phonepe\.|mswipe|\.ezetap/i;
const COMPANY_WORD = /\b(LTD|LIMITED|PVT|PRIVATE|INDIA|IND|TECHNOLOGIES|SERVICES|STORE|MART|ENTERPRISES|TRADERS|FOODS|CAFE|RESTAURANT|HOTEL|MEDICAL|PHARMA|HOSPITAL|BANK|INSURANCE|SOLUTIONS)\b/;

/** The counterparty's name and UPI handle, as the narration spells them. */
function payeeOf(narration) {
  const n = narration || '';
  const handle = (n.match(/[A-Za-z0-9._-]+@[A-Za-z]+/) || [''])[0].toLowerCase();
  // Union / most PSU banks: UPIAR/<ref>/DR/<NAME>/<BANK>/<handle>
  let name = (n.match(/\/(?:DR|CR)\/\s*([^/]+?)\s*\//i) || [])[1];
  // HDFC and co: UPI-<NAME>-<handle>-…
  if (!name) name = (n.match(/^UPI[-/]([^-/@]+?)[-/]/i) || [])[1];
  if (!name) name = n.replace(/^(NEFT|IMPS|RTGS)[A-Z]*[:/-]?/i, '').replace(/[^A-Za-z ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
  return { name: (name || '').replace(/\s+/g, ' ').trim().toUpperCase(), handle, raw: n };
}

/** 'business' (a gateway or a company name), 'vendor' (a shop QR), 'person' (a personal VPA) or 'unknown'. */
function payeeKind({ name, handle, raw = '' }) {
  // The handle is often cut off by the statement, so markers are read off the whole tail too.
  const tail = `${handle} ${raw.replace(/^.*?\/(?:DR|CR)\//i, '')}`;
  if (GATEWAY.test(tail) || COMPANY_WORD.test(name)) return 'business';
  if (VENDOR_QR.test(tail)) return 'vendor';
  if (/^\d{10}(-\d)?@/.test(handle) || /^[a-z][a-z0-9._]*@(ok|ybl|ibl|axl|pt|ap|yb\b|apl|upi)/i.test(handle)) return 'person';
  return 'unknown';
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/**
 * Rows → { [id]: { payee, payeeKind, payeeCount, payeeMedian, payeeDays, hour, day, dom } }.
 * `payeeDays` is how many distinct days this payee was paid on — a daily habit vs a monthly bill.
 */
function buildFeatures(rows) {
  const keyed = rows.map(t => ({ t, p: payeeOf(t.narration) }));
  const groups = new Map();
  for (const { t, p } of keyed) {
    const k = `${t.type}|${p.name || p.handle}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = {};
  for (const { t, p } of keyed) {
    const g = groups.get(`${t.type}|${p.name || p.handle}`);
    const d = new Date(t.date);
    out[t.id] = {
      payee: p.name || p.handle || null,
      payeeKind: payeeKind(p),
      payeeCount: g.length,
      payeeMedian: median(g.map(x => x.amount)),
      payeeDays: new Set(g.map(x => x.date)).size,
      day: isNaN(d) ? null : DOW[d.getUTCDay()],
      dom: isNaN(d) ? null : d.getUTCDate(),
      hour: t.time ? Number(t.time.slice(0, 2)) : null,
    };
  }
  return out;
}

module.exports = { buildFeatures, payeeOf, payeeKind };
