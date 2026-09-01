import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { accountsAPI } from '../lib/api';
import { formatCurrency, compactIfLarge } from '../lib/utils';
import { ACCOUNT_TYPE_OPTIONS } from '../lib/accountPickerOptions';
import { accountTypeLabel } from '../lib/constants';
import Modal from '../components/ui/Modal';
import TypePicker from '../components/forms/TypePicker';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import Sparkline from '../components/ui/Sparkline';
import SectionHeader from '../components/ui/SectionHeader';
// The same component the dashboard's band uses. This page's composition strip and
// that one are the same idea at two scales, and they were two hand-built copies of
// one block of markup — the kind of pair that drifts the moment either is touched.
import { MastheadFigure } from '../components/ui/Masthead';
import ConfirmModal from '../components/ui/ConfirmModal';
import {
  Plus, Wallet, TrendingUp, Shield, CreditCard,
  Landmark, Briefcase, Pencil,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const iconMap = { bank: Landmark, brokerage: TrendingUp, retirement: Shield, debt: CreditCard, wallet: Wallet, other: Briefcase };

const EMPTY_FORM = { name: '', type: 'bank', description: '', initialBalance: '0' };

/**
 * One account, in the list.
 *
 * The list is read the way a statement is read: down the figures. So the row is built
 * as a ledger line — identity on the left, the number on the right — and everything
 * that is not one of those two things has to earn its place.
 *
 * THE SIGNATURE is the share line beneath each balance: a bar whose LENGTH is that
 * account's share and whose SEGMENTS are cash versus invested, then the percentage it
 * draws. Bar first, then its value — the order the eye reads them in. The number is the
 * precise answer and the bar is the comparable one; a percentage alone makes you compare
 * by reading, and a bar alone makes you guess. Together they replace the three devices
 * this used to take: a "38% of assets" caption, a split micro-bar, and a "₹3.2L cash ·
 * ₹9.3L in assets" line repeating the bar in words.
 *
 * The bar's ZERO is at its right, against the percentage, growing leftward — one shared
 * baseline, which is the only way lengths compare, and the bar always touches the figure
 * it produces. Rows are sorted biggest-first, so the bars reach further left down the
 * column and the list reads as a chart without trying.
 *
 * All rules end flush right on a common baseline and grow leftward, because lengths are
 * only comparable from a shared edge.
 *
 * What was removed matters as much. The coloured left rail was a stock device saying
 * what the section header above it already said. The icon's 38px bordered tile put a
 * heavy box on every line of something that wants to read as a ruled page; the glyph
 * alone does the recognition. Balances print exactly as stored — a debt holds a
 * negative balance of its own, so nothing is negated for display.
 */
const RULE_TRACK = 104;   // px the longest share bar can occupy
const PCT_COL    = 32;    // fixed box for the share percentage, so it stays a column
const GAP        = 8;

function AccountRow({ acc, first, share, shareLabel = 'of assets', onEdit }) {
  const Icon = iconMap[acc.type] || Briefcase;
  const negative = acc.balance < 0;

  const cash   = acc.cashBalance  ?? 0;
  const assets = acc.assetBalance ?? 0;
  const gross     = Math.abs(cash) + Math.abs(assets);
  // Only an account holding both has a split worth drawing; a debt has no asset side.
  const showSplit = !acc.isDebt && gross > 0 && assets > 0;
  const cashPct   = gross ? (Math.abs(cash) / gross) * 100 : 0;

  const tone = acc.isDebt ? 'var(--color-danger)' : 'var(--color-accent)';
  // A hair of width even at a fraction of a percent — a row that owns something should
  // never draw as nothing.
  const ruleWidth = share == null ? null : Math.max(3, (Math.abs(share) / 100) * RULE_TRACK);

  const ruleTitle = [
    share != null && `${Math.abs(share).toFixed(1)}% ${shareLabel}`,
    showSplit && `${formatCurrency(cash)} cash`,
    showSplit && `${formatCurrency(assets)} invested`,
  ].filter(Boolean).join(' · ');

  return (
    <Link to={`/accounts/${acc._id}`} className="data-row group"
      style={{
        textDecoration: 'none', alignItems: 'center', gap: 16,
        borderTop: first ? 'none' : '1px solid var(--color-border-subtle)',
      }}>
      {/* The glyph alone, no tile. It brightens with the row rather than announcing
          itself at rest. */}
      <Icon size={17} strokeWidth={1.6} aria-hidden
        className="group-hover:!opacity-100"
        style={{ color: 'var(--color-text-secondary)', flexShrink: 0, opacity: 0.6, transition: 'opacity 0.15s ease' }} />

      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="truncate" style={{
          fontFamily: 'var(--font-display)', fontOpticalSizing: 'auto',
          fontSize: '0.9375rem', fontWeight: 500, letterSpacing: '-0.01em',
          color: 'var(--color-text-primary)',
        }}>
          {acc.name}
        </p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>
          {accountTypeLabel(acc.type)}
          {acc.description && ` · ${acc.description}`}
        </p>
      </div>

      {/* Where this account has been. First to go when the row runs out of room — the
          figure beside it is what you came for. */}
      {acc.spark?.length > 1 && (
        <span className="hidden sm:block" style={{ flexShrink: 0 }}>
          <Sparkline values={acc.spark} tone={tone} title={`${acc.name} — balance over the last 90 days`} />
        </span>
      )}

      <div style={{ flexShrink: 0, minWidth: PCT_COL + GAP + RULE_TRACK }}>
        <p className="figure" style={{
          fontSize: '0.9375rem', fontWeight: 500, textAlign: 'right',
          whiteSpace: 'nowrap',
          color: negative ? 'var(--color-danger)' : 'var(--color-text-primary)',
        }}>
          {formatCurrency(acc.balance)}
        </p>

        {/* The share: the bar draws it, the number names it — bar first, then its
            value, which is the order the eye reads them in.

            ZERO IS AT THE RIGHT. The bar's origin is pinned against its own percentage
            and it grows leftward, so every row measures from one baseline and the bar
            always meets the number it produces — no gap opening up between a small
            account's stub and its figure. Sorted biggest-first, the bars reach further
            and further left down the column. The percentage keeps a fixed-width box so
            it stays a column instead of drifting with the bar's length. */}
        {share != null && (
          <div title={ruleTitle}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: GAP, marginTop: 7 }}>
            <span style={{ display: 'flex', justifyContent: 'flex-end', width: RULE_TRACK, flexShrink: 0 }}>
              <span style={{ display: 'flex', gap: 1, width: ruleWidth, height: 3, borderRadius: 99, overflow: 'hidden' }}>
                {showSplit ? (
                  <>
                    <span style={{ width: `${cashPct}%`, background: 'var(--color-text-muted)', opacity: 0.55 }} />
                    <span style={{ width: `${100 - cashPct}%`, background: tone }} />
                  </>
                ) : (
                  <span style={{ width: '100%', background: tone, opacity: acc.isDebt ? 0.8 : 0.55 }} />
                )}
              </span>
            </span>
            <span className="figure" style={{
              width: PCT_COL, textAlign: 'right', flexShrink: 0,
              fontSize: '0.6875rem', color: 'var(--color-text-muted)',
            }}>
              {Math.abs(share).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* The pencil, as everywhere else a name is editable. */}
      <button onClick={(e) => onEdit(acc, e)}
        title={`Edit ${acc.name}`} aria-label={`Edit ${acc.name}`}
        className="opacity-0 group-hover:!opacity-100 transition-opacity"
        style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4, flexShrink: 0 }}>
        <Pencil size={13} />
      </button>
    </Link>
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

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setError(''); setModal(true); };
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

  // Share of the asset side that is sitting as cash. Magnitudes, so an overdrawn
  // account cannot make the bar exceed its own width.
  const grossAssets = Math.abs(cashSum) + Math.abs(investSum);
  const cashPct     = grossAssets ? (Math.abs(cashSum) / grossAssets) * 100 : 0;

  /** A figure as a share of the asset side. Magnitudes, so a debt reads as a size. */
  const pctOfAssets = (v) => (assetsSum ? (Math.abs(v) / Math.abs(assetsSum)) * 100 : null);

  // Biggest first. The server returns creation order, which is a fact about when you
  // signed up, not about where your money is — and it made the "% of total" column
  // read as noise instead of a ranking.
  const byBalance = (a, b) => Math.abs(b.balance) - Math.abs(a.balance);
  const assetRows = [...assetAccounts].sort(byBalance);
  const debtRows  = [...debtAccounts].sort(byBalance);

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
          <Button variant="gold" icon={Plus} onClick={openNew}>New account</Button>
        </div>

        {accounts.length > 0 && (
          <div style={{
            padding: '18px 24px 22px',
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
          }}>
            {/* How much is liquid versus at work — the one thing a sum of balances
                cannot tell you, and the same split the per-account bar shows below. */}
            {assetsSum > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                  <p className="heading-sm" style={{ letterSpacing: '0.12em' }}>Assets</p>
                  <p className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                    {formatCurrency(assetsSum)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 99, overflow: 'hidden' }}>
                  <div title={`Cash · ${formatCurrency(cashSum)}`}
                    style={{ width: `${cashPct}%`, background: 'var(--color-text-muted)', opacity: 0.55 }} />
                  <div title={`Investments · ${formatCurrency(investSum)}`}
                    style={{ width: `${100 - cashPct}%`, background: 'var(--color-accent)' }} />
                </div>
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

      {accounts.length > 0 ? (
        <>
          {/* Both groups carry a header and their own total. Only Liabilities had one
              before, which made the asset list look like the page's default state and
              the debts like a footnote appended to it. They are two halves of the net
              position above and should announce themselves the same way. */}
          {assetRows.length > 0 && (
            <div>
              <SectionHeader
                eyebrow="Accounts"
                size="sm"
                style={{ marginBottom: 12 }}
                action={
                  <span className="figure text-sm" style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {formatCurrency(assetsSum)}
                  </span>
                }
              />
              <Card flush>
                {assetRows.map((acc, i) => (
                  <AccountRow
                    key={acc._id}
                    acc={acc}
                    first={i === 0}
                    share={assetsSum > 0 ? (acc.balance / assetsSum) * 100 : null}
                    onEdit={openEdit}
                  />
                ))}
              </Card>
            </div>
          )}

          {debtRows.length > 0 && (
            <div>
              <SectionHeader
                eyebrow="Liabilities"
                size="sm"
                style={{ marginBottom: 12 }}
                action={
                  <span className="figure text-sm" style={{ fontWeight: 500, color: 'var(--color-danger)' }}>
                    {formatCurrency(debtTotal)}
                  </span>
                }
              />
              <Card flush>
                {debtRows.map((acc, i) => (
                  <AccountRow
                    key={acc._id}
                    acc={acc}
                    first={i === 0}
                    // Symmetric with the accounts above: how much of what you owe is
                    // this one. A debt with no context is just a number to dread.
                    share={debtTotal !== 0 ? (acc.balance / debtTotal) * 100 : null}
                    shareLabel="of liabilities"
                    onEdit={openEdit}
                  />
                ))}
              </Card>
            </div>
          )}
        </>
      ) : (
        <Card className="flex flex-col items-center justify-center" style={{ padding: '64px 24px' }}>
          <Wallet size={28} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 12 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>No accounts yet</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: '6px 0 18px', maxWidth: 320, textAlign: 'center' }}>
            An account holds cash and assets — a bank, a broker, a wallet, or something you owe.
          </p>
          <Button variant="gold" icon={Plus} onClick={openNew}>Create your first account</Button>
        </Card>
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
