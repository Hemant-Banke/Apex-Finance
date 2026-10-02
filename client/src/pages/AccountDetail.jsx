import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { accountsAPI, transactionsAPI, dashboardAPI } from '../lib/api';
import { formatCurrency, compactIfLarge, formatDate, formatSigned, pnlColor } from '../lib/utils';
import Modal from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import TransactionRow from '../components/transactions/TransactionRow';
import ConfirmModal from '../components/ui/ConfirmModal';
import TransactionForm from '../components/forms/TransactionForm';
import MarketSearch from '../components/market/MarketSearch';
import AssetTransactionForm from '../components/market/AssetTransactionForm';
import HoldingsBook from '../components/portfolio/HoldingsBook';
import AllocationPanel from '../components/portfolio/AllocationPanel';
import PerformancePanel from '../components/portfolio/PerformancePanel';
import CashflowPanel from '../components/cashflow/CashflowPanel';
import AccountEmpty from '../components/accounts/AccountEmpty';
import SellHoldingModal from '../components/portfolio/SellHoldingModal';
import PriceGrapher from '../components/charts/PriceGrapher';
import ImportModal from '../components/import/ImportModal';
import Button from '../components/ui/Button';
import AssetIcon from '../components/market/AssetIcon';
import { assetTypeLabel } from '../lib/constants';
import { toCreatePayload } from '../lib/undo';
import Card from '../components/ui/Card';
import SectionHeader from '../components/ui/SectionHeader';
import SegmentedControl from '../components/ui/SegmentedControl';
import BackLink from '../components/ui/BackLink';
import {
  Plus, Pencil, TrendingUp, Shield, CreditCard,
  Landmark, Wallet, Briefcase, BarChart2, Upload
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const SKIP_DELETE_KEY = 'apex_skip_tx_delete';

/**
 * How many rows the activity list shows, and grows by.
 *
 * Six is about what fits without the section becoming the page. The rest are already
 * loaded — this is a display cap, not a fetch boundary, so "show more" is instant.
 */
const TX_PAGE = 6;

/**
 * Activity filters, named for what the MONEY did rather than for the schema. Trades
 * are one option because buying and selling are two halves of the same errand when you
 * are scanning for "what did I do with my investments here".
 */
const TX_FILTERS = [
  { key: 'all',      label: 'All',       match: () => true },
  { key: 'in',       label: 'In',        match: t => t.type === 'income' },
  { key: 'out',      label: 'Out',       match: t => t.type === 'expense' },
  { key: 'transfer', label: 'Transfers', match: t => t.type === 'transfer' },
  { key: 'trades',   label: 'Trades',    match: t => t.type === 'buy' || t.type === 'sell' },
];

// The activity chip a "View all" carries over, as the ledger's own type filter.
const LEDGER_KIND = { in: 'income', out: 'expense', transfer: 'transfer', trades: 'trades' };

// Small pill showing an asset's type in a modal header.
function AssetTypePill({ type }) {
  if (!type) return null;
  return (
    <span style={{
      flexShrink: 0, padding: '3px 9px', borderRadius: 999,
      fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--color-accent)', background: 'var(--color-accent-dim)',
      border: '1px solid var(--color-accent-dim)', whiteSpace: 'nowrap',
    }}>
      {assetTypeLabel(type)}
    </span>
  );
}

// The asset's ticker, for a modal subtitle — the name carries the title, so the
// symbol reads as the quieter reference line, in the mono figure face.
function AssetTicker({ symbol, exchange }) {
  if (!symbol) return null;
  return (
    <span>
      <span className="figure" style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{symbol}</span>
      {exchange ? <span style={{ color: 'var(--color-text-muted)' }}> · {exchange}</span> : null}
    </span>
  );
}

/**
 * A supporting figure in the masthead — cash, assets.
 *
 * Deliberately smaller than the total it sits beside: these are its components, and
 * three equal columns (what this replaced) said they were three equal facts.
 */
function Figure({ label, value, sub }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className="heading-sm" style={{ marginBottom: 8, letterSpacing: '0.12em' }}>{label}</p>
      <p className="figure" style={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

const iconMap = {
  bank: Landmark, brokerage: TrendingUp, retirement: Shield,
  debt: CreditCard, wallet: Wallet, other: Briefcase
};

export default function AccountDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [account, setAccount]       = useState(null);
  const [txns, setTxns]             = useState([]);
  const [allAccounts, setAllAccounts] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState(false);
  const [editTx, setEditTx]         = useState(null);
  const [deleteTx, setDeleteTx]     = useState(null);
  const [chartKey, setChartKey]     = useState(0);
  // Asset buy/sell modal (MarketSearch → AssetTransactionForm)
  const [assetModal, setAssetModal]         = useState(false);
  const [selectedSecurity, setSelectedSecurity] = useState(null);
  const [importOpen, setImportOpen]         = useState(false);
  // Sell-a-holding modal — the holding itself is the open flag.
  const [sellHolding, setSellHolding]       = useState(null);
  const [book, setBook]                     = useState(null);
  const [profile, setProfile]               = useState(null);
  const [perf, setPerf]                     = useState(null);
  // Activity list: which kind of movement, and how many rows are on show.
  const [txFilter, setTxFilter]             = useState('all');
  const [txShown,  setTxShown]              = useState(TX_PAGE);
  // Rename / edit-details modal
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails]         = useState({ name: '', description: '' });
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => { load(); }, [id]);

  const load = async () => {
    try {
      const [a, t, p] = await Promise.all([
        accountsAPI.getById(id),
        transactionsAPI.getAll({ account: id, limit: 100 }),
        // This account's positions marked to market; without it the rows fall back to cost.
        dashboardAPI.getPortfolio({ account: id }).catch(() => null),
      ]);
      setAccount(a.data);
      setTxns(t.data.transactions);
      setBook(p?.data?.holdings || null);
      setProfile(p?.data?.profile || null);
      setPerf(p?.data?.totals || null);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load account'); }
    finally { setLoading(false); }
  };

  const openModal = async () => {
    try {
      const res = await accountsAPI.getAll();
      setAllAccounts(res.data.filter(a => a._id !== id));
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    setModal(true);
  };

  const closeModal = () => setModal(false);

  const openEdit = async (tx) => {
    if (allAccounts.length === 0) {
      try {
        const res = await accountsAPI.getAll();
        setAllAccounts(res.data.filter(a => a._id !== id));
      } catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    }
    setEditTx(tx);
  };

  // Takes the whole transaction, not just its id: undo posts the document back, and
  // after the delete this page no longer holds it.
  const delTx = async (tx) => {
    const refresh = () => { load(); setChartKey(k => k + 1); };
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
    }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete transaction'); }
  };

  const handleDeleteClick = (tx) => {
    if (localStorage.getItem(SKIP_DELETE_KEY) === 'true') {
      delTx(tx);
    } else {
      setDeleteTx(tx);
    }
  };

  const closeAssetModal = () => { setAssetModal(false); setSelectedSecurity(null); };

  const openDetails = () => {
    setDetails({ name: account.name, description: account.description || '' });
    setDetailsOpen(true);
  };

  const saveDetails = async (e) => {
    e.preventDefault();
    setSavingDetails(true);
    try {
      await accountsAPI.update(id, { name: details.name.trim(), description: details.description });
      setDetailsOpen(false);
      load();
      toast.success('Account updated');
    } catch (e) {
      toast.error(e.response?.data?.message || e.response?.data?.errors?.[0]?.msg || 'Failed to update account');
    } finally { setSavingDetails(false); }
  };

  const openImport = async () => {
    if (allAccounts.length === 0) {
      try {
        const res = await accountsAPI.getAll();
        setAllAccounts(res.data.filter(a => a._id !== id));
      } catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    }
    setImportOpen(true);
  };

  // Fetch function for PriceGrapher — stable ref, uses account id from closure.
  // The /daily route returns { date, cashValue, assetValue, totalValue }; the
  // chart plots `value`, so map to the total account balance over time.
  // `growth` is threaded straight through — PriceGrapher only ever passes it when
  // its own Complete/Growth toggle is on.
  const fetchDailyBalance = useCallback(
    (days, growth) => accountsAPI.getDaily(id, days, growth).then(res =>
      res.data.map(d => ({ date: d.date, value: d.totalValue }))
    ),
    [id]
  );

  // Balance breakdown (non-debt accounts). `assetBalance` and `balance` come from the
  // server, already settled at the T-1 close; `totalInvested` is the cost
  // basis, which is what the gain is measured against — not what the account is worth.
  const cashBalance   = account?.cashBalance ?? account?.balance ?? 0;
  const assetValue    = account?.assetBalance ?? 0;
  const totalValue    = account?.balance ?? (cashBalance + assetValue);
  const totalInvested = account?.holdings?.filter(h => h.qty > 0).reduce((s, h) => s + h.totalInvested, 0) || 0;
  const assetPnl      = assetValue - totalInvested;

  const filteredTxns = txns.filter(TX_FILTERS.find(f => f.key === txFilter)?.match ?? (() => true));

  // The marked-to-market book; if it could not be fetched, the stored positions at cost.
  const holdingsBook = book || (account?.holdings || []).map(h => ({
    ...h, invested: h.totalInvested, value: h.totalInvested, priced: false,
    unrealisedPnl: 0, unrealisedPnlPct: 0, dayChange: 0, dayChangePct: 0,
    weight: totalInvested ? (h.totalInvested / totalInvested) * 100 : 0,
  }));

  if (loading) return <Spinner />;
  if (!account) return (
    <div className="text-center" style={{ paddingTop: '20vh' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Account not found</p>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <BackLink to="/accounts">Back to accounts</BackLink>
      </div>
    </div>
  );

  const Icon = iconMap[account.type] || Briefcase;
  // Asset-holding accounts (brokerage/retirement) lead with the Add-asset CTA.
  const isAssetAccount = ['brokerage', 'retirement'].includes(account.type);
  // A brand-new account: no history to chart and no activity to list, just a way in.
  const noTxns = txns.length === 0;
  const noHistory = noTxns && !totalValue && !account.balance;
  const hasTrades = txns.some(t => t.type === 'buy' || t.type === 'sell');

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      <BackLink to="/accounts">Back to accounts</BackLink>

      {/* ── Masthead ──────────────────────────────────────────────────────────
          Identity and balance were two stacked blocks: a header row, then a card of
          three equal columns. Nothing on the page was bigger than anything else, so
          the one figure the page exists to answer — what is in this account — read as
          just another cell. They are one surface now, carrying the gilt top-rule the
          system reserves for a headline, with the total set in the ledger numerals
          (`display-number`) that were going unused here, and cash/assets demoted to
          the supporting figures they are. */}
      <Card gilt flush>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '22px 24px 20px' }}>
          <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: 'var(--color-bg-elevated)', boxShadow: 'var(--elev-ring)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={20} style={{ color: 'var(--color-text-secondary)' }} strokeWidth={1.5} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2 group">
                <h1 className="heading-lg" style={{ minWidth: 0 }}>{account.name}</h1>
                <button onClick={openDetails} title="Rename account" aria-label="Rename account"
                  className="opacity-0 group-hover:!opacity-100 transition-opacity"
                  style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4, flexShrink: 0 }}>
                  <Pencil size={14} />
                </button>
              </div>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>
                {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                {account.description && ` · ${account.description}`}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <Button variant="icon" icon={Upload} onClick={openImport} title="Import transactions" aria-label="Import transactions" />
            {(() => {
              const addTxn   = <Button key="txn" variant={isAssetAccount ? 'secondary' : 'gold'} icon={Plus} onClick={openModal}>Add transaction</Button>;
              const addAsset = <Button key="asset" variant={isAssetAccount ? 'gold' : 'secondary'} icon={BarChart2} onClick={() => { setSelectedSecurity(null); setAssetModal(true); }}>Add asset</Button>;
              // Left → right: import (icon), then secondary, then the gold primary.
              // Asset accounts make Add asset primary; cash accounts make Add transaction primary.
              // Debt accounts hold no assets, so only Add transaction.
              if (account.isDebt) return addTxn;
              return isAssetAccount ? [addTxn, addAsset] : [addAsset, addTxn];
            })()}
          </div>
        </div>

        {/* The figure, in FULL rupees. Everywhere else a number is a comparison and
            `compactIfLarge` helps the eye; here it is read against a bank app that
            prints every digit, and ₹12.53L cannot be reconciled with ₹12,52,840. */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          gap: 32, flexWrap: 'wrap', padding: '20px 24px 22px',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}>
          <div style={{ minWidth: 0 }}>
            <p className="heading-sm" style={{ marginBottom: 10 }}>
              {account.isDebt ? 'Outstanding' : 'Total value'}
            </p>
            <p className="display-number" style={{
              fontSize: 'clamp(1.6rem, 4vw, 2rem)',
              color: account.isDebt
                ? (account.balance <= 0 ? 'var(--color-danger)' : 'var(--color-success)')
                : 'var(--color-text-primary)',
            }}>
              {/* Printed as stored — a debt account's balance is already negative. */}
              {formatCurrency(account.isDebt ? account.balance : totalValue)}
            </p>
            {account.asof && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
                as of {formatDate(account.asof)}
              </p>
            )}
          </div>

          {/* Components sit beside the total, not level with it — they add up TO it. */}
          {!account.isDebt && (
            <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
              <Figure label="Cash" value={formatCurrency(cashBalance)} />
              <Figure
                label="Assets"
                value={formatCurrency(assetValue)}
                sub={totalInvested > 0 && (
                  <>
                    <span className="figure">{compactIfLarge(totalInvested)}</span> invested
                    {' · '}
                    <span className="figure" style={{ color: pnlColor(assetPnl) }}>
                      {formatSigned(Math.round(assetPnl), compactIfLarge)}
                    </span> gain
                  </>
                )}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Account Balance History */}
      {!noHistory && <PriceGrapher
        fetchData={fetchDailyBalance}
        title="Account Balance"
        valueLabel="Balance"
        refreshKey={chartKey}
        height={240}
        defaultRange="6M"
        ranges={[
          { label: '1M',  days: 30  },
          { label: '3M',  days: 90  },
          { label: '6M',  days: 182 },
          { label: '1Y',  days: 365 },
          { label: 'Max', days: null },
        ]}
        emptyText="No transaction history yet"
        // Growth (money-only, deposits/withdrawals removed) only means something for an
        // account that can hold assets — every non-debt account, not just brokerage/
        // retirement (a bank or wallet account can hold assets too, e.g. NEXO Crypto).
        growthCapable={!account.isDebt}
      />}

      {/* Cash and debt accounts: what the money does here, as the allocation card does for a book. */}
      {!isAssetAccount && (
        <CashflowPanel accountId={id} balance={cashBalance} isDebt={account.isDebt} refreshKey={chartKey} />
      )}

      {/* This account's own mix, with its idle cash as a slice — how much is actually at work. */}
      {!account.isDebt && holdingsBook.length > 0 && (
        <AllocationPanel
          holdings={holdingsBook}
          cash={Math.max(0, cashBalance)}
          profile={profile}
          sub="This account's mix by market value, cash included · cost beneath shows the drift"
        />
      )}

      {/* ── Holdings ──────────────────────────────────────────────────────────
          This was THREE stacked cards saying overlapping things: a donut whose legend
          already listed every holding by name and value, a per-asset price-chart panel,
          and a "Breakdown" list of the same holdings again. One card now.

          A bar rather than the donut, per the project's own rule — length beats angle
          for comparing to a whole, and the donut earns its place only where the split
          IS the subject. Here the holdings are the subject and the split is context. */}
      {/* Lifetime gain, booked and on paper, and which holdings made it — any account that has traded. */}
      {!account.isDebt && perf && (holdingsBook.length > 0 || hasTrades) && (
        <PerformancePanel id="performance" totals={perf} account={id} />
      )}

      {/* An investment account with history but nothing open: say so, rather than leave a gap. */}
      {isAssetAccount && !noTxns && holdingsBook.length === 0 && (
        <Card>
          <SectionHeader eyebrow="Holdings" size="sm" style={{ marginBottom: 18 }} />
          <div className="flex items-center justify-between" style={{ gap: 20, flexWrap: 'wrap' }}>
            <div className="flex items-center" style={{ gap: 14, minWidth: 0 }}>
              <span style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--color-bg-elevated)', boxShadow: 'var(--elev-ring)',
              }}>
                <BarChart2 size={18} strokeWidth={1.5} style={{ color: 'var(--color-text-muted)' }} />
              </span>
              <div style={{ minWidth: 0 }}>
                <p className="text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>No open positions</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                  {hasTrades
                    ? <>Everything bought here has been sold. What it made is in{' '}
                        <button type="button" onClick={() => document.getElementById('performance')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--color-accent)' }}>
                          Performance ↑
                        </button></>
                    : `${cashBalance > 0 ? `${formatCurrency(cashBalance)} is sitting in cash. ` : ''}Add an asset to start tracking it here.`}
                </p>
              </div>
            </div>
            <Button variant="gold" icon={BarChart2} onClick={() => { setSelectedSecurity(null); setAssetModal(true); }}>Add asset</Button>
          </div>
        </Card>
      )}

      {holdingsBook.length > 0 && (
        <Card flush>
          <div style={{ padding: '22px 24px 16px' }}>
            <SectionHeader
              eyebrow="Holdings"
              size="sm"
              sub="Marked to market · click a holding for the full numbers"
              action={
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {holdingsBook.length} position{holdingsBook.length === 1 ? '' : 's'}
                </span>
              }
            />
          </div>
          <HoldingsBook holdings={holdingsBook} onSell={setSellHolding} initial={6} />
        </Card>
      )}

      {/* ── Activity ──────────────────────────────────────────────────────────
          The whole ledger used to print here — up to a hundred rows below every other
          section, so the page had no end and the recent activity you actually came for
          was the first six of an endless scroll. Now: the recent few, a filter for the
          kind of movement you are looking for, and more on request. */}
      {noTxns ? (
        <AccountEmpty
          isDebt={account.isDebt}
          invest={isAssetAccount}
          onAdd={openModal}
          onAddAsset={!isAssetAccount ? undefined : () => { setSelectedSecurity(null); setAssetModal(true); }}
          onImport={openImport}
        />
      ) : (
        <Card flush>
          <div style={{ padding: '22px 24px 16px' }}>
            <SectionHeader
              eyebrow="Activity"
              size="sm"
              sub="The latest movements in and out of this account"
              action={
                <div className="flex items-center" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <SegmentedControl ariaLabel="Activity type" value={txFilter}
                    onChange={k => { setTxFilter(k); setTxShown(TX_PAGE); }}
                    options={TX_FILTERS.map(f => ({ key: f.key, label: f.label }))} />
                  {/* Only the most recent hundred are loaded here. Anything older lives on
                      the Transactions page, which already has date ranges, search and
                      paging — so this hands off rather than rebuilding them. */}
                  <Link to={`/transactions?${new URLSearchParams({ account: id, period: 'all', ...(LEDGER_KIND[txFilter] && { type: LEDGER_KIND[txFilter] }) })}`}
                    className="text-xs font-medium"
                    style={{ color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
                    View all →
                  </Link>
                </div>
              }
            />
          </div>

          {filteredTxns.length > 0 ? (
            <>
              {filteredTxns.slice(0, txShown).map((tx) => {
                // The statement carries transfers INTO this account as well as out of
                // it, and the two read as opposites from here: one credits, one debits.
                const incoming = tx.type === 'transfer'
                  ? (tx.toAccount?._id || tx.toAccount) === id
                  : undefined;
                const counterparty = incoming ? tx.account : tx.toAccount;
                return (
                  <TransactionRow
                    key={tx._id}
                    tx={tx}
                    divided
                    incoming={incoming}
                    // Some rows here are read-only, so every row keeps the action gutter
                    // — without it their amounts stopped at a different x.
                    reserveActions
                    subtitle={<>
                      {tx.type} · {formatDate(tx.date)}
                      {counterparty?.name && ` ${incoming ? '←' : '→'} ${counterparty.name}`}
                    </>}
                    // An incoming transfer is the OTHER account's transaction — the edit
                    // form is built around `account`, which from here is the DESTINATION,
                    // so it would rewrite the wrong side. This end stays read-only; the
                    // row is editable from the source account (or the Transactions page).
                    onEdit={incoming ? undefined : openEdit}
                    onDelete={incoming ? undefined : handleDeleteClick}
                  />
                );
              })}

              {filteredTxns.length > txShown && (
                <button type="button"
                  onClick={() => setTxShown(n => n + TX_PAGE)}
                  style={{
                    width: '100%', padding: '12px 24px', cursor: 'pointer', fontFamily: 'inherit',
                    background: 'none', border: 'none', borderTop: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-accent)', fontSize: '0.75rem', fontWeight: 600,
                  }}>
                  Show {Math.min(TX_PAGE, filteredTxns.length - txShown)} more
                  <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>
                    {' '}· {filteredTxns.length - txShown} older
                  </span>
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center" style={{ padding: '36px 24px 40px', borderTop: '1px solid var(--color-border-subtle)' }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {txFilter === 'all'
                  ? 'No transactions in this account yet'
                  : `No ${TX_FILTERS.find(f => f.key === txFilter)?.label.toLowerCase()} here`}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Add Transaction Modal */}
      <Modal open={modal} onClose={closeModal} eyebrow={account.name} title="New transaction" icon={Plus}>
        <TransactionForm
          accountId={id}
          account={account}
          allAccounts={allAccounts}
          onSuccess={() => { closeModal(); load(); setChartKey(k => k + 1); }}
        />
      </Modal>

      {/* Edit Transaction Modal — AssetTransactionForm for buy/sell */}
      <Modal open={!!editTx} onClose={() => setEditTx(null)}
        // Buy/Sell moves to the eyebrow now that the asset name owns the title.
        eyebrow={['buy','sell'].includes(editTx?.type)
          ? `Edit ${editTx?.type === 'buy' ? 'purchase' : 'sale'}`
          : 'Edit'}
        title={['buy','sell'].includes(editTx?.type)
          ? (editTx?.assetName || editTx?.assetSymbol)
          : 'Edit transaction'}
        subtitle={['buy','sell'].includes(editTx?.type) ? <AssetTicker symbol={editTx?.assetSymbol} /> : undefined}
        titleSuffix={['buy','sell'].includes(editTx?.type) ? <AssetTypePill type={editTx?.assetType} /> : undefined}
        titlePrefix={['buy','sell'].includes(editTx?.type)
          ? <AssetIcon symbol={editTx.assetSymbol} name={editTx.assetName} type={editTx.assetType} size={40} />
          : undefined}
        wide={['buy','sell'].includes(editTx?.type)}>
        {editTx && (['buy','sell'].includes(editTx.type) ? (
          <AssetTransactionForm
            key={editTx._id}
            transaction={editTx}
            accounts={[account, ...allAccounts]}
            onSuccess={() => { setEditTx(null); load(); setChartKey(k => k + 1); }}
          />
        ) : (
          <TransactionForm
            key={editTx._id}
            transaction={editTx}
            account={account}
            allAccounts={allAccounts}
            onSuccess={() => { setEditTx(null); load(); setChartKey(k => k + 1); }}
          />
        ))}
      </Modal>

      {/* Delete Transaction Confirm Modal */}
      <ConfirmModal
        open={!!deleteTx}
        onClose={() => setDeleteTx(null)}
        onConfirm={() => delTx(deleteTx)}
        title="Delete transaction"
        message={`Delete this ${deleteTx?.type} transaction of ${deleteTx ? formatCurrency(deleteTx.amount) : ''}? This action cannot be undone.`}
        skipKey={SKIP_DELETE_KEY}
      />

      {/* Rename / edit account details */}
      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)}
        eyebrow="Edit" title="Account details" icon={Pencil}>
        <form onSubmit={saveDetails} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Name</label>
            <input type="text" value={details.name}
              onChange={e => setDetails({ ...details, name: e.target.value })}
              className="input-field" placeholder="e.g., HDFC Savings" required autoFocus />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Description</label>
            <input type="text" value={details.description}
              onChange={e => setDetails({ ...details, description: e.target.value })}
              className="input-field" placeholder="Optional note" />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setDetailsOpen(false)}>Cancel</Button>
            <Button type="submit" variant="gold" disabled={savingDetails || !details.name.trim()}>
              {savingDetails ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Import statement modal — pre-targets this account */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accounts={[account, ...allAccounts]}
        defaultAccountId={id}
        onSuccess={() => { setImportOpen(false); load(); setChartKey(k => k + 1); }}
      />

      {/* Sell a holding — this account is the only place it can be sold from here */}
      <SellHoldingModal
        holding={sellHolding}
        accounts={[account, ...allAccounts]}
        defaultAccountId={id}
        onClose={() => setSellHolding(null)}
        onSuccess={() => { setSellHolding(null); load(); setChartKey(k => k + 1); }}
      />

      {/* Add Asset Modal — MarketSearch → AssetTransactionForm */}
      <Modal open={assetModal} onClose={closeAssetModal}
        align="top"
        className={selectedSecurity ? undefined : 'modal-fade-down'}
        onBack={selectedSecurity ? () => setSelectedSecurity(null) : undefined}
        eyebrow={selectedSecurity ? 'Record trade' : 'Add asset'}
        title={selectedSecurity ? selectedSecurity.name : 'Find an asset'}
        subtitle={selectedSecurity
          // Picked out of your own book: say what you already hold, so "add more to it"
          // confirms itself before a figure is typed. Across ALL accounts, and it says
          // so — this dialog can file the trade against any of them.
          ? (selectedSecurity.owned
              ? <span><span className="figure">{+Number(selectedSecurity.qty || 0).toFixed(4)}</span> held across your accounts
                  {!selectedSecurity.isManual && <> · <AssetTicker symbol={selectedSecurity.symbol} exchange={selectedSecurity.exchange} /></>}
                </span>
              : selectedSecurity.isManual ? undefined : <AssetTicker symbol={selectedSecurity.symbol} exchange={selectedSecurity.exchange} />)
          : 'Search your holdings, or add anything from the market.'}
        titleSuffix={selectedSecurity ? <AssetTypePill type={selectedSecurity.type} /> : undefined}
        titlePrefix={selectedSecurity ? <AssetIcon symbol={selectedSecurity.symbol} name={selectedSecurity.name} type={selectedSecurity.type} size={40} /> : undefined}
        wide>
        {!selectedSecurity ? (
          <MarketSearch onSelect={sec => setSelectedSecurity(sec)} />
        ) : (
          <AssetTransactionForm
            security={selectedSecurity}
            accounts={[account, ...allAccounts]}
            defaultAccountId={id}
            onSuccess={() => { closeAssetModal(); load(); setChartKey(k => k + 1); }}
          />
        )}
      </Modal>
    </div>
  );
}
