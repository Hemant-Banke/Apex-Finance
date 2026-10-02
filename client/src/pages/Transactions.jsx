import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { transactionsAPI, accountsAPI } from '../lib/api';
import {
  formatCurrency, compactIfLarge, formatSigned, pnlColor, todayStr, MONTHS_SHORT, formatCount,
} from '../lib/utils';
import { getCategoryMap, describeCategory, useCategoryNames } from '../lib/categoryNames';
import { transactionTypeLabel } from '../lib/constants';
import { toCreatePayload } from '../lib/undo';
import { toggleCode, isSelected } from '../lib/categorySelection';
import { accountOptions } from '../lib/accountPickerOptions';
import Spinner from '../components/ui/Spinner';
import TransactionRow from '../components/transactions/TransactionRow';
import SpendCalendar, { CalendarLegend } from '../components/transactions/SpendCalendar';
import CategoryBreakdown from '../components/charts/CategoryBreakdown';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Checkbox from '../components/ui/Checkbox';
import Delta from '../components/ui/Delta';
import Popover from '../components/ui/Popover';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import SectionHeader from '../components/ui/SectionHeader';
import SegmentedControl from '../components/ui/SegmentedControl';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import TransactionForm from '../components/forms/TransactionForm';
import AssetTransactionForm from '../components/market/AssetTransactionForm';
import { DateRangePicker } from '../components/forms/DatePicker';
import TypePicker from '../components/forms/TypePicker';
import CategoryMultiPicker from '../components/forms/CategoryMultiPicker';
import ImportModal from '../components/import/ImportModal';
import AssetIcon from '../components/market/AssetIcon';
import {
  ArrowLeftRight, Upload, Search, X, Plus, CalendarRange, SlidersHorizontal, Download, Trash2,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const SKIP_DELETE_KEY = 'apex_skip_tx_delete';
const PAGE = 40;
const DEFAULT_PERIOD = '3m';
const DAY = 86_400_000;

const PERIODS = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All' },
];

// Type chips. Trades are one chip: a buy and a sell are the same kind of event.
const KINDS = [
  { key: 'all',        label: 'All' },
  { key: 'income',     label: 'Income',      types: ['income'] },
  { key: 'expense',    label: 'Expenses',    types: ['expense'] },
  { key: 'transfer',   label: 'Transfers',   types: ['transfer'] },
  { key: 'trades',     label: 'Trades',      types: ['buy', 'sell'] },
  { key: 'adjustment', label: 'Adjustments', types: ['adjustment'] },
];

const SORTS = [{ key: 'date', label: 'Latest' }, { key: 'amount', label: 'Largest' }];

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const msOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

function windowOf(period, custom) {
  // An open-ended custom range runs to today, so it still has an equal window to compare with.
  if (period === 'custom') return { startDate: custom.from || '', endDate: custom.to || (custom.from ? todayStr() : '') };
  const p = PERIODS.find(x => x.key === period);
  if (!p?.days) return { startDate: '', endDate: '' };
  const end = todayStr();
  return { startDate: ymd(msOf(end) - (p.days - 1) * DAY), endDate: end };
}

function shortDate(s, withYear) {
  const d = new Date(msOf(s));
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
}

function dayHeading(s, today) {
  if (s === today) return 'Today';
  if (msOf(today) - msOf(s) === DAY) return 'Yesterday';
  const d = new Date(msOf(s));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return `${wd}, ${shortDate(s, s.slice(0, 4) !== today.slice(0, 4))}`;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function Transactions() {
  const toast = useToast();
  const { label: categoryLabel } = useCategoryNames();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayStr();

  // ── Filters ───────────────────────────────────────────────────────────────
  // Account, type and window live in the URL: a hand-off link, a reload, Back and the sidebar
  // all see the same filter. Defaults are left out so a bare /transactions stays bare.
  const urlPeriod = searchParams.get('period');
  const period  = urlPeriod === 'custom' || PERIODS.some(p => p.key === urlPeriod) ? urlPeriod : DEFAULT_PERIOD;
  const custom  = { from: searchParams.get('from') || '', to: searchParams.get('to') || '' };
  const account = searchParams.get('account') || '';
  const kind    = KINDS.some(k => k.key === searchParams.get('type')) ? searchParams.get('type') : 'all';

  // One URL write per gesture; separate writes in one tick would each start from the same URL.
  const patchUrl = (patch) => setSearchParams(prev => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) {
      const isDefault = !v || (k === 'period' && v === DEFAULT_PERIOD) || (k === 'type' && v === 'all');
      if (isDefault) next.delete(k); else next.set(k, v);
    }
    return next;
  }, { replace: true });
  const setAccount = (v) => patchUrl({ account: v });
  const setKind    = (k) => patchUrl({ type: k });
  const setPeriod  = (k) => patchUrl({ period: k, from: '', to: '' });
  const categoryParam = searchParams.get('category') || '';
  const categories = useMemo(() => categoryParam.split(',').filter(Boolean), [categoryParam]);
  const setCategories = (codes) => patchUrl({ category: codes.join(',') });
  const [day, setDay]         = useState(null);              // list-only: one day picked on the calendar
  const [searchBox, setSearchBox] = useState('');
  const [search, setSearch]   = useState('');
  const [amount, setAmount]   = useState({ min: '', max: '' });
  const [sort, setSort]       = useState('date');

  // ── Data ──────────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState([]);
  const [catMap, setCatMap]     = useState(null);
  const [insights, setInsights] = useState(null);
  const [txns, setTxns]         = useState([]);
  const [list, setList]         = useState({ total: 0, page: 1, pages: 1, summary: null });
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  // ── Dialogs ───────────────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [addAccount, setAddAccount] = useState(null);       // null = closed, '' = picking
  const [editTx, setEditTx]   = useState(null);
  const [deleteTx, setDeleteTx] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const searchRef = useRef(null);
  const ledgerRef = useRef(null);
  // A day picked on the calendar is a question about the list below the fold; take the reader there.
  const pickDay = (d) => {
    setDay(d);
    if (d) requestAnimationFrame(() => ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  // The toast API is rebuilt each render; a ref keeps it out of the fetch effects' deps.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });

  useEffect(() => { accountsAPI.getAll().then(r => setAccounts(r.data)).catch(() => {}); }, []);
  useEffect(() => { getCategoryMap().then(setCatMap); }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchBox.trim()), 300);
    return () => clearTimeout(t);
  }, [searchBox]);

  // "/" jumps to search, as in every ledger worth using.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A search also finds the categories whose NAME matches, since codes mean nothing to a person.
  const childrenOf = useMemo(() => {
    const map = {};
    for (const [code, c] of Object.entries(catMap || {})) if (c.parent) (map[c.parent] ||= []).push(code);
    return (p) => map[p] || [];
  }, [catMap]);

  const searchCategories = useMemo(() => {
    if (!search || !catMap) return '';
    const q = search.toLowerCase();
    return Object.entries(catMap)
      .filter(([, c]) => c.name?.toLowerCase().includes(q))
      .map(([code, c]) => (c.parent ? `${c.parent}/${code}` : code))
      .join(',');
  }, [search, catMap]);

  const win = windowOf(period, custom);
  const query = useMemo(() => {
    const p = { ...win };
    const k = KINDS.find(x => x.key === kind);
    if (k?.types) p.type = k.types.join(',');
    if (account) p.account = account;
    if (categoryParam) p.category = categoryParam;
    if (search) { p.search = search; if (searchCategories) p.searchCategories = searchCategories; }
    if (amount.min !== '') p.minAmount = amount.min;
    if (amount.max !== '') p.maxAmount = amount.max;
    for (const key of Object.keys(p)) if (p[key] === '') delete p[key];
    return p;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.startDate, win.endDate, kind, account, categoryParam, search, searchCategories, amount]);

  const listQuery = useMemo(
    () => (day ? { ...query, startDate: day, endDate: day } : query),
    [query, day],
  );

  // Each load ignores its response if a newer one has been asked for, so a quick 1Y → 3M
  // cannot end on 1Y's figures. Insights carry the window they were fetched for, and the
  // calendar and layout read THAT, so shape and data change in the same frame.
  const insightsReq = useRef(0);
  const listReq = useRef(0);
  const [pending, setPending] = useState(false);

  const loadInsights = useCallback(async () => {
    const id = ++insightsReq.current;
    // Dim only if the wait is noticeable; a fast answer just swaps in.
    const dim = setTimeout(() => { if (id === insightsReq.current) setPending(true); }, 150);
    try {
      const r = await transactionsAPI.getInsights(query);
      if (id !== insightsReq.current) return;
      setInsights({ ...r.data, window: { from: query.startDate || '', to: query.endDate || '' } });
    } catch { if (id === insightsReq.current) setInsights(null); }
    finally {
      clearTimeout(dim);
      if (id === insightsReq.current) setPending(false);
    }
  }, [query]);

  const loadList = useCallback(async () => {
    const id = ++listReq.current;
    try {
      const r = await transactionsAPI.getAll({ ...listQuery, sort, page: 1, limit: PAGE });
      if (id !== listReq.current) return;
      setTxns(r.data.transactions);
      setList({ total: r.data.total, page: 1, pages: r.data.pages, summary: r.data.summary });
      setSelected(new Set());
    } catch (e) { if (id === listReq.current) toastRef.current.error(e.response?.data?.message || 'Failed to load transactions'); }
    finally { if (id === listReq.current) setLoading(false); }
  }, [listQuery, sort]);

  useEffect(() => { loadInsights(); }, [loadInsights]);
  useEffect(() => { loadList(); }, [loadList]);

  const refresh = () => { loadInsights(); loadList(); };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = list.page + 1;
      const r = await transactionsAPI.getAll({ ...listQuery, sort, page: next, limit: PAGE });
      setTxns(t => [...t, ...r.data.transactions]);
      setList(l => ({ ...l, page: next }));
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load more'); }
    finally { setLoadingMore(false); }
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const del = async (tx) => {
    try {
      await transactionsAPI.delete(tx._id);
      refresh();
      toast.success('Transaction deleted', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try { await transactionsAPI.create(toCreatePayload(tx)); refresh(); }
            catch (e) { toast.error(e.response?.data?.message || 'Could not restore the transaction'); }
          },
        },
      });
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to delete transaction'); }
  };

  const bulkDelete = async () => {
    const doomed = txns.filter(t => selected.has(t._id));
    if (!doomed.length) return;
    try {
      await transactionsAPI.bulkDelete(doomed.map(t => t._id));
      refresh();
      toast.success(`${doomed.length} transaction${doomed.length === 1 ? '' : 's'} deleted`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try { await transactionsAPI.bulkCreate(doomed.map(toCreatePayload)); refresh(); }
            catch (e) { toast.error(e.response?.data?.message || 'Could not restore the transactions'); }
          },
        },
      });
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to delete transactions'); }
  };

  const exportCsv = async () => {
    try {
      const r = await transactionsAPI.getAll({ ...listQuery, sort, page: 1, limit: 5000 });
      const head = ['Date', 'Type', 'Account', 'To account', 'Category', 'Asset', 'Units', 'Amount (INR)', 'Notes'];
      const rows = r.data.transactions.map(t => [
        String(t.date).slice(0, 10), transactionTypeLabel(t.type), t.account?.name, t.toAccount?.name,
        t.category && ['income', 'expense'].includes(t.type) ? categoryLabel(t.category) : '',
        t.assetName || t.assetSymbol, t.units, t.amount, t.notes,
      ]);
      const csv = [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `apex-transactions-${today}.csv` });
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${formatCount(rows.length)} transactions`);
    } catch { toast.error('Export failed'); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const s = insights?.summary;
  const prev = insights?.prev;
  // The window the SHOWN insights describe — not the one just picked, which may still be loading.
  const shownWin = insights?.window || win;
  const windowFrom = shownWin.from ?? shownWin.startDate ?? '';
  const windowTo = shownWin.to ?? shownWin.endDate ?? '';
  const calFrom = windowFrom || insights?.first || today;
  const calTo = windowTo || today;
  const days = Math.max(1, Math.round((msOf(calTo) - msOf(calFrom)) / DAY) + 1);
  const periodLabel = period === 'custom'
    ? (win.startDate || win.endDate ? `${win.startDate ? shortDate(win.startDate, true) : '…'} – ${win.endDate ? shortDate(win.endDate, true) : 'today'}` : 'All time')
    : period === 'all' ? 'All time' : `Last ${PERIODS.find(p => p.key === period).days} days`;
  const showInsights = ['all', 'income', 'expense'].includes(kind);
  const measure = kind === 'income' ? 'in' : 'out';

  const catRows = useMemo(() => {
    const rows = (measure === 'in' ? insights?.incomeCategories : insights?.expenseCategories) || [];
    return rows.map(r => {
      const d = describeCategory(r._id, catMap || undefined);
      return { ...r, name: r._id ? d.label : 'Uncategorised', emoji: d.emoji };
    });
  }, [insights, catMap, measure]);

  // Rows grouped by day when reading in date order; a ranking by size is one flat list.
  const groups = useMemo(() => {
    if (sort !== 'date') return [{ key: 'all', rows: txns }];
    const out = [];
    for (const tx of txns) {
      const k = String(tx.date).slice(0, 10);
      if (out.at(-1)?.key !== k) out.push({ key: k, rows: [] });
      out.at(-1).rows.push(tx);
    }
    return out;
  }, [txns, sort]);

  const selecting = selected.size > 0;
  const selectedTotal = txns.filter(t => selected.has(t._id)).reduce((sum, t) => sum + t.amount, 0);
  const allSelected = txns.length > 0 && txns.every(t => selected.has(t._id));
  const toggle = (id) => setSelected(prevSel => {
    const n = new Set(prevSel);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const pills = [
    ...categories.map(code => {
      const d = describeCategory(code, catMap || undefined);
      return { key: `cat:${code}`, label: `${d.emoji ? `${d.emoji} ` : ''}${d.name || d.group}`, clear: () => setCategories(categories.filter(c => c !== code)) };
    }),
    day && { key: 'day', label: dayHeading(day, today), clear: () => setDay(null) },
  ].filter(Boolean);
  const anyFilter = pills.length > 0 || !!account || !!search || amount.min !== '' || amount.max !== '' || kind !== 'all';
  const clearAll = () => {
    patchUrl({ account: '', type: '', category: '' }); setDay(null); setAmount({ min: '', max: '' }); setSearchBox('');
  };

  const accountName = accounts.find(a => a._id === account)?.name;
  const savedRate = s?.income > 0 ? (s.net / s.income) * 100 : null;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <SectionHeader
        eyebrow="Transactions"
        title="The ledger"
        sub="Every movement of money, and what it adds up to."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" icon={Upload} onClick={() => setShowImport(true)}>Import</Button>
            <Button variant="gold" icon={Plus} onClick={() => setAddAccount(account || '')}>Add transaction</Button>
          </div>
        }
      />

      {/* What the window adds up to */}
      <Masthead
        lead={<>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Net cashflow{accountName && <> · <span style={{ color: 'var(--color-text-secondary)' }}>{accountName}</span></>} · {periodLabel}
          </p>
          <p className="display-number" style={{ color: pnlColor(s?.net, { flat: 'var(--color-text-primary)' }), opacity: pending ? 0.6 : 1, transition: 'opacity 0.2s ease' }}>
            {s ? formatSigned(s.net) : '—'}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="figure">{formatCount(s?.count || 0)}</span> transactions
            {prev && (prev.income || prev.expense) ? <>
              <span>·</span>
              <Delta value={(s?.net || 0) - prev.net} compact />
              <span>vs the previous {formatCount(days)} days, which netted{' '}
                <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>{formatSigned(prev.net, compactIfLarge)}</span>
              </span>
            </> : null}
          </p>
        </>}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SegmentedControl options={PERIODS} value={period} ariaLabel="Period"
              onChange={(k) => { setPeriod(k); setDay(null); }} />
            <DateRangePicker
              value={custom}
              max={today}
              onChange={(v) => {
                // Clearing the range is a return to all time, not a custom range of nothing.
                const next = { from: v.from || '', to: v.to || '' };
                patchUrl({ ...next, period: next.from || next.to ? 'custom' : 'all' }); setDay(null);
              }}
              trigger={({ toggle: open }) => (
                <button type="button" onClick={open} title="Custom range" aria-label="Custom range"
                  className="text-xs font-medium"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
                    border: '1px solid ' + (period === 'custom' ? 'var(--color-accent-dim)' : 'var(--color-border-subtle)'),
                    background: period === 'custom' ? 'var(--color-accent-dim)' : 'transparent',
                    color: period === 'custom' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  }}>
                  {/* The icon sits in a text-height box, so this matches the period chips exactly. */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', height: '1rem' }}><CalendarRange size={13} /></span>
                  {period === 'custom' && periodLabel}
                </button>
              )}
            />
          </div>
        }
        band={s && (
          <div style={{ opacity: pending ? 0.6 : 1, transition: 'opacity 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 20 }}>
            <MastheadFigure tight label="In" value={compactIfLarge(s.income)} accent="var(--color-success)"
              sub={prev?.income > 0 && <Delta value={s.income - prev.income} pct={((s.income - prev.income) / prev.income) * 100} amount={false} />} />
            <MastheadFigure tight label="Out" value={compactIfLarge(s.expense)} accent="var(--color-danger)"
              sub={prev?.expense > 0 && <Delta value={s.expense - prev.expense} pct={((s.expense - prev.expense) / prev.expense) * 100} amount={false} invert />} />
            <MastheadFigure tight label="Kept" value={savedRate == null ? '—' : `${savedRate.toFixed(0)}%`}
              sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>of what came in</span>} />
            <MastheadFigure tight label="Spend / day" value={compactIfLarge(s.expense / days)}
              sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>over {formatCount(days)} days</span>} />
            {(s.invested > 0 || s.divested > 0) && (
              <MastheadFigure tight label="Net invested" value={formatSigned(s.invested - s.divested, compactIfLarge)}
                sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}
                  title={`${formatCurrency(s.invested)} bought, ${formatCurrency(s.divested)} sold`}>
                  {s.divested > 0
                    ? <>after <span className="figure">{compactIfLarge(s.divested)}</span> of sales</>
                    : 'all new purchases'}
                </span>} />
            )}
          </div>
        )}
      />

      {/* Shape of the window: when it went, and on what. A long window gets the calendar full width. */}
      {showInsights && insights && (() => {
        const calendar = (
          <Card>
            <SectionHeader eyebrow={measure === 'in' ? 'Income rhythm' : 'Spending rhythm'} size="sm"
              sub="Each square is a day, against a typical one"
              action={<CalendarLegend measure={measure} />}
              style={{ marginBottom: 20 }} />
            <SpendCalendar daily={insights.daily} from={calFrom} to={calTo} measure={measure}
              activeDay={day} onSelectDay={pickDay} />
          </Card>
        );
        const largestCard = measure === 'out' && insights.largest?.length > 0 && (
              <Card>
                <SectionHeader eyebrow="Largest outflows" size="sm" style={{ marginBottom: 12 }}
                  sub="The single payments that moved this window most" />
                {insights.largest.map((t, i) => {
                  const share = s?.expense ? (t.amount / s.expense) * 100 : 0;
                  return (
                    <button key={t._id} type="button" onClick={() => setEditTx(t)} className="data-row"
                      style={{ width: '100%', padding: '8px 10px', margin: '0 -10px', borderRadius: 8, border: 'none', background: 'none', gap: 12, boxSizing: 'content-box' }}>
                      <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', width: 14 }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <span className="text-sm truncate" style={{ display: 'block', color: 'var(--color-text-primary)' }}>
                          {categoryLabel(t.category) || 'Expense'}
                        </span>
                        <span className="text-xs truncate" style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {shortDate(String(t.date).slice(0, 10), true)} · {t.account?.name}{t.notes ? ` · ${t.notes}` : ''}
                        </span>
                      </span>
                      <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>{share.toFixed(0)}% of out</span>
                      <span className="figure text-sm" style={{ color: 'var(--color-text-primary)', minWidth: 90, textAlign: 'right' }}>
                        {formatCurrency(t.amount)}
                      </span>
                    </button>
                  );
                })}
              </Card>
        );
        const categoryCard = (
          <CategoryBreakdown
            title={measure === 'in' ? 'Where it came from' : 'Where it went'}
            sub={categories.length ? 'Click to add or remove from the filter' : `${periodLabel} · click one to filter`}
            rows={catRows}
            invert={measure === 'out'}
            active={(catRows || []).filter(r => isSelected(categories, r._id)).map(r => r._id)}
            onSelect={(c) => setCategories(toggleCode(categories, c._id, childrenOf))}
            emptyText={measure === 'in' ? 'No income in this window' : 'Nothing spent in this window'}
          />
        );
        // One grid whose areas move, rather than two trees: the cards keep their identity across
        // 3M ↔ 1Y, so nothing remounts or re-measures mid-switch.
        const wide = days > 120;
        return (
          <div style={{
            display: 'grid', gap: 20, alignItems: 'start',
            gridTemplateColumns: wide ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1.45fr) minmax(0, 1fr)',
            gridTemplateRows: 'auto 1fr',
            gridTemplateAreas: wide ? '"cal cal" "lar cat"' : '"cal cat" "lar cat"',
            opacity: pending ? 0.6 : 1, transition: 'opacity 0.2s ease',
          }}>
            <div style={{ gridArea: 'cal', minWidth: 0 }}>{calendar}</div>
            {largestCard && <div style={{ gridArea: 'lar', minWidth: 0 }}>{largestCard}</div>}
            <div style={{ gridArea: 'cat', minWidth: 0 }}>{categoryCard}</div>
          </div>
        );
      })()}

      {/* The ledger */}
      <Card flush style={{ overflow: 'visible', scrollMarginTop: 16 }} ref={ledgerRef}>
        <Toolbar
          kind={kind} setKind={setKind}
          categories={categories} setCategories={setCategories}
          counts={insights?.typeCounts || {}}
          searchRef={searchRef} searchBox={searchBox} setSearchBox={setSearchBox}
          accounts={accounts} account={account} setAccount={setAccount}
          amount={amount} setAmount={setAmount}
          sort={sort} setSort={setSort}
          onExport={exportCsv}
        />

        {pills.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '0 24px 14px' }}>
            {pills.map(p => (
              <span key={p.key} className="text-xs" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: 99,
                background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)',
              }}>
                {p.label}
                <button type="button" onClick={p.clear} aria-label={`Remove ${p.key} filter`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--color-text-muted)' }}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Count / selection bar */}
        <div className="flex items-center justify-between" style={{
          gap: 12, padding: '10px 24px', borderTop: '1px solid var(--color-border-subtle)',
          background: selecting ? 'var(--color-accent-dim)' : 'transparent',
        }}>
          <div className="flex items-center" style={{ gap: 14 }}>
            <Checkbox label="Select all shown" checked={allSelected} indeterminate={selecting && !allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(txns.map(t => t._id)))} />
            {selecting ? (
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="figure">{selected.size}</span> selected · <span className="figure">{formatCurrency(selectedTotal)}</span> gross
              </span>
            ) : (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <span className="figure">{formatCount(list.total)}</span> transaction{list.total === 1 ? '' : 's'}
                {day && ` on ${dayHeading(day, today)}`}
                {txns.length < list.total && <> · showing <span className="figure">{formatCount(txns.length)}</span></>}
                {anyFilter && <>{' · '}
                  <button type="button" onClick={clearAll} className="text-xs font-medium"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-accent)' }}>
                    Clear filters
                  </button></>}
              </span>
            )}
          </div>
          {selecting ? (
            <div className="flex items-center" style={{ gap: 6 }}>
              <Button variant="danger" size="sm" icon={Trash2} onClick={() => setBulkConfirm(true)}>Delete</Button>
              <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>Cancel</Button>
            </div>
          ) : list.summary && (list.summary.income > 0 || list.summary.expense > 0) && (
            <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span style={{ color: 'var(--color-success)' }}>+{compactIfLarge(list.summary.income)}</span>
              {'  '}<span style={{ color: 'var(--color-danger)' }}>−{compactIfLarge(list.summary.expense)}</span>
            </span>
          )}
        </div>

        {loading ? (
          <Spinner height={200} />
        ) : txns.length > 0 ? (
          <div className={selecting ? 'ledger-selecting' : undefined}>
            {groups.map(g => {
              const dayIn  = g.rows.filter(t => t.type === 'income').reduce((x, t) => x + t.amount, 0);
              const dayOut = g.rows.filter(t => t.type === 'expense').reduce((x, t) => x + t.amount, 0);
              return (
                <div key={g.key}>
                  {sort === 'date' && (
                    <div className="ledger-day">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)', letterSpacing: '0.02em' }}>
                        {dayHeading(g.key, today)}
                      </span>
                      {(dayIn > 0 || dayOut > 0) && (
                        <span className="figure text-xs" style={{ color: pnlColor(dayIn - dayOut) }}>
                          {formatSigned(dayIn - dayOut)}
                        </span>
                      )}
                    </div>
                  )}
                  {g.rows.map((tx, i) => {
                    const incoming = account && tx.type === 'transfer'
                      ? (tx.toAccount?._id || tx.toAccount) === account
                      : undefined;
                    return (
                      <TransactionRow
                        key={tx._id}
                        tx={tx}
                        divided={i > 0}
                        incoming={incoming}
                        selected={selected.has(tx._id)}
                        leading={<span className="ledger-check"><Checkbox tone="plain" label="Select transaction" checked={selected.has(tx._id)} onChange={() => toggle(tx._id)} /></span>}
                        subtitle={<>
                          {tx.account?.name}
                          {tx.type === 'transfer' && tx.toAccount?.name && ` → ${tx.toAccount.name}`}
                          {sort !== 'date' && ` · ${shortDate(String(tx.date).slice(0, 10), true)}`}
                          {tx.assetSymbol && ` · ${formatCount(tx.units, 4)} units`}
                          {tx.notes && ` · ${tx.notes}`}
                        </>}
                        onEdit={setEditTx}
                        onDelete={(t) => {
                          if (localStorage.getItem(SKIP_DELETE_KEY) === 'true') del(t);
                          else setDeleteTx(t);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}

            {txns.length < list.total && (
              <div style={{ padding: 16, display: 'flex', justifyContent: 'center', borderTop: '1px solid var(--color-border-subtle)' }}>
                <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Show ${Math.min(PAGE, list.total - txns.length)} more`}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center" style={{ padding: '64px 24px', borderTop: '1px solid var(--color-border-subtle)' }}>
            <ArrowLeftRight size={24} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 12 }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {anyFilter ? 'Nothing matches these filters' : 'No transactions in this window'}
            </p>
            {anyFilter && (
              <button onClick={clearAll} className="text-xs font-medium"
                style={{ color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 12 }}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </Card>

      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        accounts={accounts}
        onSuccess={() => { setShowImport(false); refresh(); }}
      />

      {/* Add — the account is chosen first, since every transaction lives in one. */}
      <Modal open={addAccount !== null} onClose={() => setAddAccount(null)} eyebrow="New" title="Add transaction">
        <div style={{ marginBottom: 18 }}>
          <label className="label block" style={{ marginBottom: 6 }}>Account</label>
          <TypePicker options={accountOptions(accounts)} value={addAccount || ''} onChange={setAddAccount}
            placeholder="Choose an account" searchable={accounts.length > 6} />
        </div>
        {addAccount && (
          <TransactionForm
            key={addAccount}
            accountId={addAccount}
            account={accounts.find(a => a._id === addAccount)}
            allAccounts={accounts.filter(a => a._id !== addAccount)}
            onSuccess={() => { setAddAccount(null); refresh(); }}
          />
        )}
      </Modal>

      {/* Edit — AssetTransactionForm for buy/sell, TransactionForm for everything else */}
      <Modal open={!!editTx} onClose={() => setEditTx(null)}
        eyebrow="Edit"
        title={['buy', 'sell'].includes(editTx?.type) ? `${editTx?.type === 'buy' ? 'Buy' : 'Sell'} · ${editTx?.assetSymbol}` : 'Edit transaction'}
        subtitle={['buy', 'sell'].includes(editTx?.type) ? editTx?.assetName : undefined}
        titlePrefix={['buy', 'sell'].includes(editTx?.type)
          ? <AssetIcon symbol={editTx.assetSymbol} type={editTx.assetType} size={40} />
          : undefined}
        wide={['buy', 'sell'].includes(editTx?.type)}>
        {editTx && (['buy', 'sell'].includes(editTx.type) ? (
          <AssetTransactionForm
            key={editTx._id}
            transaction={editTx}
            accounts={accounts}
            onSuccess={() => { setEditTx(null); refresh(); }}
          />
        ) : (
          <TransactionForm
            key={editTx._id}
            transaction={editTx}
            allAccounts={accounts.filter(a => a._id !== (editTx?.account?._id || editTx?.account))}
            onSuccess={() => { setEditTx(null); refresh(); }}
          />
        ))}
      </Modal>

      <ConfirmModal
        open={!!deleteTx}
        onClose={() => setDeleteTx(null)}
        onConfirm={() => del(deleteTx)}
        title="Delete transaction"
        message={`Delete this ${deleteTx?.type} transaction of ${deleteTx ? formatCurrency(deleteTx.amount) : ''}? You can undo it from the notice that follows.`}
        skipKey={SKIP_DELETE_KEY}
      />

      <ConfirmModal
        open={bulkConfirm}
        onClose={() => setBulkConfirm(false)}
        onConfirm={bulkDelete}
        title={`Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}`}
        message={`Delete ${selected.size} selected transaction${selected.size === 1 ? '' : 's'} totalling ${formatCurrency(selectedTotal)}? Balances and net worth are rebuilt; you can undo from the notice that follows.`}
      />
    </div>
  );
}

/** Type chips with counts, then search, account, amount range, sort and export. */
function Toolbar({
  kind, setKind, counts, searchRef, searchBox, setSearchBox, categories, setCategories,
  accounts, account, setAccount, amount, setAmount, sort, setSort, onExport,
}) {
  const amountRef = useRef(null);
  const [amountOpen, setAmountOpen] = useState(false);
  const [draft, setDraft] = useState(amount);
  const total = Object.values(counts).reduce((x, n) => x + n, 0);
  const countOf = (k) => (k.types ? k.types.reduce((x, t) => x + (counts[t] || 0), 0) : total);
  const amountOn = amount.min !== '' || amount.max !== '';

  const amountLabel = !amountOn ? 'Any amount'
    : amount.min !== '' && amount.max !== '' ? `₹${formatCount(amount.min)} – ₹${formatCount(amount.max)}`
    : amount.min !== '' ? `≥ ₹${formatCount(amount.min)}` : `≤ ₹${formatCount(amount.max)}`;

  return (
    <div style={{ padding: '18px 24px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* What kind of row, and in what order. */}
      <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div role="radiogroup" aria-label="Type" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {KINDS.map(k => {
            const on = kind === k.key;
            const n = countOf(k);
            if (k.types && !n && !on) return null;
            return (
              <button key={k.key} type="button" role="radio" aria-checked={on} onClick={() => setKind(k.key)}
                className="text-xs font-medium"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
                  border: '1px solid ' + (on ? 'var(--color-accent-dim)' : 'var(--color-border-subtle)'),
                  background: on ? 'var(--color-accent-dim)' : 'transparent',
                  color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}>
                {k.label}
                <span className="figure" style={{ fontSize: 10, opacity: 0.7 }}>{formatCount(n)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <SegmentedControl options={SORTS} value={sort} onChange={setSort} ariaLabel="Sort" />
          {/* Sized like the sort chips beside it, not like a toolbar button. */}
          <button type="button" onClick={onExport} title="Export CSV" aria-label="Export CSV" className="chip-button">
            <Download size={13} />
          </button>
        </div>
      </div>

      {/* Narrowing: one row of equal-height fields. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 200px 200px 170px', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
          <input ref={searchRef} type="text" value={searchBox} onChange={e => setSearchBox(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearchBox(''); e.currentTarget.blur(); } }}
            placeholder="Search notes, assets, categories" title="Search notes, assets and category names"
            className="input-field"
            style={{ paddingLeft: 36, paddingRight: 34 }} />
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
            {searchBox
              ? <button onClick={() => setSearchBox('')} aria-label="Clear search"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', display: 'flex' }}>
                  <X size={14} />
                </button>
              : <kbd className="figure" style={{ fontSize: 10, color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)', borderRadius: 4, padding: '0 5px' }}>/</kbd>}
          </span>
        </div>

        <TypePicker options={accountOptions(accounts)} value={account} onChange={setAccount}
          placeholder="All accounts" searchable={accounts.length > 6} clearable />

        <CategoryMultiPicker value={categories} onChange={setCategories} />

        <button ref={amountRef} type="button" className="input-field"
          onClick={() => { setDraft(amount); setAmountOpen(o => !o); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left',
            color: amountOn ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          }}>
          <span className={amountOn ? 'figure truncate' : 'truncate'}>{amountLabel}</span>
          <SlidersHorizontal size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        </button>
      </div>
      <Popover anchorRef={amountRef} open={amountOpen} onClose={() => setAmountOpen(false)} width={260}>
        <form style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}
          onSubmit={e => { e.preventDefault(); setAmount(draft); setAmountOpen(false); }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {['min', 'max'].map(k => (
              <div key={k}>
                <label className="label block" style={{ marginBottom: 6 }}>{k === 'min' ? 'At least' : 'At most'} (₹)</label>
                <input type="number" min="0" className="input-field figure" value={draft[k]}
                  onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} style={{ fontSize: '0.8125rem' }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between" style={{ gap: 8 }}>
            <Button type="button" variant="secondary" size="sm"
              onClick={() => { setAmount({ min: '', max: '' }); setAmountOpen(false); }}>Reset</Button>
            <Button type="submit" variant="gold" size="sm">Apply</Button>
          </div>
        </form>
      </Popover>
    </div>
  );
}
