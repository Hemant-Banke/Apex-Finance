import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { accountsAPI } from '../lib/api';
import { formatCurrency, compactIfLarge } from '../lib/utils';
import { ACCOUNT_TYPE_OPTIONS, TYPE_ICON, ACCOUNT_TYPE_STYLE } from '../lib/accountPickerOptions';
import AccountsEmpty from '../components/accounts/AccountsEmpty';
import AccountCard from '../components/accounts/AccountCard';
import AllocationBar from '../components/portfolio/AllocationBar';
import Modal from '../components/ui/Modal';
import TypePicker from '../components/forms/TypePicker';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import SectionHeader from '../components/ui/SectionHeader';
// The same component the dashboard's band uses. This page's composition strip and
// that one are the same idea at two scales, and they were two hand-built copies of
// one block of markup — the kind of pair that drifts the moment either is touched.
import { MastheadFigure } from '../components/ui/Masthead';
import ConfirmModal from '../components/ui/ConfirmModal';
import { Plus } from 'lucide-react';
import { useToast } from '../context/ToastContext';


const EMPTY_FORM = { name: '', type: 'bank', description: '', initialBalance: '0' };

/** One kind of account: a header in its colour, then its accounts as cards. */
function AccountGroup({ type, count, total, share, children }) {
  const { tone, group } = ACCOUNT_TYPE_STYLE[type] || ACCOUNT_TYPE_STYLE.other;
  return (
    <section>
      <div className="flex items-center" style={{ gap: 10, marginBottom: 12, padding: '0 2px' }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: tone }} />
        <span className="col-head" style={{ color: 'var(--color-text-secondary)', fontSize: '0.6875rem' }}>{group}</span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>· {count}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)', margin: '0 6px' }} />
        {share != null && <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>{share.toFixed(0)}%</span>}
        <span className="figure text-sm" style={{ fontWeight: 500, color: type === 'debt' ? 'var(--color-danger)' : 'var(--color-text-primary)', marginLeft: 10 }}>
          {formatCurrency(total)}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {children}
      </div>
    </section>
  );
}

export default function Accounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const res = await accountsAPI.getAll();
      setAccounts(res.data);
    }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    finally { setLoading(false); }
  };

  const openNew = (type = 'bank') => { setEditing(null); setForm({ ...EMPTY_FORM, type: typeof type === 'string' ? type : 'bank' }); setError(''); setModal(true); };
  const openEdit = (acc, e) => {
    e.preventDefault();
    setEditing(acc);
    setForm({ name: acc.name, type: acc.type, description: acc.description || '', initialBalance: '' });
    setError('');
    setModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await accountsAPI.update(editing._id, { name: form.name, type: form.type, description: form.description });
      } else {
        await accountsAPI.create(form);
      }
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Failed to save account');
    } finally { setSaving(false); }
  };

  // Deleting an account cascades — its transactions, its balance series and its
  // holdings all go with it, and net worth is rebuilt without them. That is far too
  // much to hang off a native `confirm()`, which also broke the tone of every other
  // destructive action in the app. No undo is offered here for the same reason: the
  // cascade cannot be honestly reversed from what the client holds.
  const del = async (acc) => {
    try {
      await accountsAPI.delete(acc._id);
      toast.success(`${acc.name} deleted`);
      load();
    }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete account'); }
  };

  const isDebt = form.type === 'debt';

  // Debt balances are stored negative, so the net position is a plain sum — liabilities
  // pull it down on their own, with no sign forced here.
  const assetAccounts = accounts.filter(a => !a.isDebt);
  const debtAccounts  = accounts.filter(a => a.isDebt);

  const total     = accounts.reduce((s, a) => s + a.balance, 0);
  const assetsSum = assetAccounts.reduce((s, a) => s + a.balance, 0);
  const debtTotal = debtAccounts.reduce((s, a) => s + a.balance, 0);
  const cashSum   = assetAccounts.reduce((s, a) => s + (a.cashBalance ?? 0), 0);
  const investSum = assetAccounts.reduce((s, a) => s + (a.assetBalance ?? 0), 0);


  /** A figure as a share of the asset side. Magnitudes, so a debt reads as a size. */
  const pctOfAssets = (v) => (assetsSum ? (Math.abs(v) / Math.abs(assetsSum)) * 100 : null);

  // Biggest first. The server returns creation order, which is a fact about when you
  // signed up, not about where your money is — and it made the "% of total" column
  // read as noise instead of a ranking.
  const byBalance = (a, b) => Math.abs(b.balance) - Math.abs(a.balance);
  const debtRows  = [...debtAccounts].sort(byBalance);
  // Asset accounts grouped by type, biggest group first, biggest account first within it.
  const assetGroups = Object.values(assetAccounts.reduce((g, a) => {
    const k = ACCOUNT_TYPE_STYLE[a.type] ? a.type : 'other';
    (g[k] ??= { type: k, rows: [], total: 0 }).rows.push(a);
    g[k].total += a.balance;
    return g;
  }, {})).map(g => ({ ...g, rows: g.rows.sort(byBalance) })).sort((a, b) => b.total - a.total);

  if (loading) return <Spinner />;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Masthead ──────────────────────────────────────────────────────────
          The net position and what it is made of, on ONE surface — the same shape the
          account page uses for a single account, so the list and the detail read as
          the same idea at two scales. They were a bare header and a separate card of
          four figures, which put the headline and its own components on equal footing.

          Cash / Investments / Liabilities are mutually exclusive and reconcile to the
          net. The old strip also carried "Assets", which is just Cash + Investments —
          four figures where one was the sum of two others, and the reader had to work
          out which. Assets is now the label ON the composition bar, where being a
          subtotal is the whole point. */}
      {accounts.length === 0 ? <AccountsEmpty onCreate={openNew} /> : (
      <Card gilt flush>
        {/* `center`, not `flex-start`: the button was pinned to the top of a three-line
            block and floated level with the eyebrow, which is the smallest thing there.
            Centred, it reads as belonging to the whole masthead. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '22px 24px 20px' }}>
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow" style={{ marginBottom: 12 }}>Net position</p>
            {/* In full rupees. This is the answer to "how much have I got", read
                against bank apps that print every digit — the same reason the account
                page prints its balance exactly. */}
            <h1 className="display-number" style={{
              fontSize: 'clamp(1.6rem, 4vw, 2rem)',
              color: total < 0 ? 'var(--color-danger)' : 'var(--color-text-primary)',
            }}>
              {formatCurrency(total)}
            </h1>
            {accounts.length > 0 && (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
                across {accounts.length} account{accounts.length !== 1 ? 's' : ''}
                {debtAccounts.length > 0 && ` · ${debtAccounts.length} debt`}
              </p>
            )}
          </div>
          <Button variant="gold" icon={Plus} onClick={() => openNew()}>New account</Button>
        </div>

        {accounts.length > 0 && (
          <div style={{
            padding: '18px 24px 22px',
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
          }}>
            {/* Where the money sits, by kind of account — the same colours as the cards below. */}
            {assetsSum > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <p className="heading-sm" style={{ letterSpacing: '0.12em' }}>Assets by account type</p>
                  <p className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                    {formatCurrency(assetsSum)}
                  </p>
                </div>
                <AllocationBar height={8} items={assetGroups.filter(g => g.total > 0).map(g => ({
                  key: g.type, name: ACCOUNT_TYPE_STYLE[g.type].group, color: ACCOUNT_TYPE_STYLE[g.type].tone,
                  value: g.total, weight: (g.total / assetsSum) * 100,
                }))} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 20 }}>
              {/* Cash and Investments are shares of the ASSET side (they are the two
                  halves of the bar above). Liabilities are measured against those same
                  assets — "you owe 22% of what you own" is the sentence a debt figure
                  is trying to say, and it is not a slice of the same pie. */}
              <MastheadFigure label="Cash" value={compactIfLarge(cashSum)} pct={pctOfAssets(cashSum)} swatch="var(--color-text-muted)" />
              {/* "Investments" is the MARKET value of what is held, not what was paid —
                  cost basis lives on Analytics, beside the P&L that gives it meaning. */}
              <MastheadFigure label="Investments" value={compactIfLarge(investSum)} pct={pctOfAssets(investSum)} swatch="var(--color-accent)" />
              <MastheadFigure
                label="Liabilities"
                value={compactIfLarge(debtTotal)}
                pct={pctOfAssets(debtTotal)}
                accent={debtTotal < 0 ? 'var(--color-danger)' : undefined}
              />
            </div>
          </div>
        )}
      </Card>
      )}

      {accounts.length > 0 ? (
        <>
          {/* Both groups carry a header and their own total. Only Liabilities had one
              before, which made the asset list look like the page's default state and
              the debts like a footnote appended to it. They are two halves of the net
              position above and should announce themselves the same way. */}
          {assetGroups.map(g => (
            <AccountGroup key={g.type} type={g.type} count={g.rows.length} total={g.total}
              share={assetsSum > 0 ? (g.total / assetsSum) * 100 : null}>
              {g.rows.map(acc => (
                <AccountCard
                  key={acc._id}
                  acc={acc}
                  share={assetsSum > 0 ? (acc.balance / assetsSum) * 100 : null}
                  onEdit={openEdit}
                />
              ))}
            </AccountGroup>
          ))}

          {debtRows.length > 0 && (
            <AccountGroup type="debt" count={debtRows.length} total={debtTotal}>
              {debtRows.map(acc => (
                <AccountCard
                  key={acc._id}
                  acc={acc}
                  share={debtTotal !== 0 ? (acc.balance / debtTotal) * 100 : null}
                  shareLabel="of liabilities"
                  onEdit={openEdit}
                />
              ))}
            </AccountGroup>
          )}
        </>
      ) : (
        null
      )}

      {/* Deleting an account is the one destructive action here that cannot be undone,
          so it says exactly what goes with it. */}
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => del(toDelete)}
        title="Delete account"
        confirmLabel="Delete account"
        message={toDelete
          ? `Delete ${toDelete.name}? Its transactions, balance history and holdings go with it, and your net worth is recalculated without them. This cannot be undone.`
          : ''}
      />

      {/* Modal */}
      <Modal open={modal} onClose={() => setModal(false)}
        eyebrow={editing ? 'Edit' : 'New'}
        title={editing ? 'Edit account' : 'Create account'}
        subtitle={editing ? undefined : 'A container for cash and assets — bank, brokerage, wallet, or debt.'}
        icon={Plus}>
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Name</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="input-field" placeholder="e.g., HDFC Savings" required autoFocus />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Type</label>
            <TypePicker
              options={ACCOUNT_TYPE_OPTIONS}
              value={form.type}
              onChange={v => setForm({ ...form, type: v })}
              placeholder="Select account type"
            />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Description</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              className="input-field" placeholder="Optional note" />
          </div>

          {!editing && (
            <div>
              <label className="label block" style={{ marginBottom: 8 }}>Opening balance</label>
              <input type="number" step="any" {...(isDebt ? {} : { min: '0' })}
                value={form.initialBalance}
                onChange={e => setForm({ ...form, initialBalance: e.target.value })}
                className="input-field"
                placeholder={isDebt ? 'e.g. -50000 for ₹50,000 owed' : 'Starting cash balance'} />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
                {isDebt
                  ? 'Enter what you owe as a negative amount — a debt simply holds a negative balance.'
                  : 'Records the current cash in this account as an opening adjustment.'}
              </p>
            </div>
          )}

          {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Button type="submit" disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create account')}
            </Button>
            {editing && (
              <Button type="button" variant="danger" onClick={() => { setToDelete(editing); setModal(false); }}>
                Delete
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
