import { useState, useEffect } from 'react';
import { subscriptionsAPI, categoriesAPI, accountsAPI } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../context/ToastContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import TypePicker from '../components/forms/TypePicker';
import EmojiPicker from '../components/forms/EmojiPicker';
import { FREQUENCIES } from '../lib/recurrence';
import { useCategoryNames, invalidateCategories } from '../lib/categoryNames';
import {
  Repeat, Tags, Pause, Play, Trash2, Pencil, Plus, Infinity as InfinityIcon,
} from 'lucide-react';

const TABS = [
  { key: 'subscriptions', label: 'Subscriptions', Icon: Repeat },
  { key: 'categories',    label: 'Categories',    Icon: Tags },
];

const freqLabel = (f) => FREQUENCIES.find(x => x.value === f)?.label || f;

export default function Settings() {
  const [tab, setTab] = useState('subscriptions');

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 12 }}>Settings</p>
        <h1 className="heading-lg">Manage</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
          Recurring transactions and your custom categories.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--color-border-subtle)' }}>
        {TABS.map(({ key, label, Icon }) => {
          const on = tab === key;
          return (
            <button key={key} type="button" onClick={() => setTab(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '10px 14px', background: 'none', cursor: 'pointer',
                border: 'none', borderBottom: `2px solid ${on ? 'var(--color-accent)' : 'transparent'}`,
                color: on ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontSize: '0.8125rem', fontWeight: on ? 600 : 500, fontFamily: 'inherit',
                marginBottom: -1, transition: 'color 0.15s, border-color 0.15s',
              }}>
              <Icon size={15} strokeWidth={1.8} /> {label}
            </button>
          );
        })}
      </div>

      {tab === 'subscriptions' ? <SubscriptionsManager /> : <CategoriesManager />}
    </div>
  );
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

function SubscriptionsManager() {
  const toast = useToast();
  const { label: categoryLabel } = useCategoryNames();
  const [subs, setSubs] = useState([]);
  const [accounts, setAccounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState(null);

  const load = async () => {
    try {
      const [s, a] = await Promise.all([subscriptionsAPI.getAll(), accountsAPI.getAll()]);
      setSubs(s.data);
      setAccounts(Object.fromEntries(a.data.map(x => [x._id, x.name])));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load subscriptions');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (sub) => {
    try {
      await subscriptionsAPI.setActive(sub._id, !sub.active);
      toast.success(sub.active ? 'Paused' : 'Resumed');
      load();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to update'); }
  };

  const remove = async (sub) => {
    try {
      await subscriptionsAPI.delete(sub._id);
      toast.success('Subscription removed');
      setToDelete(null);
      load();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to remove'); }
  };

  if (loading) return <Spinner height={200} />;

  if (!subs.length) return (
    <Card className="flex flex-col items-center justify-center" style={{ padding: '56px 24px' }}>
      <Repeat size={26} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 12 }} />
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No recurring transactions yet</p>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6, opacity: 0.75 }}>
        Tick “Repeat this transaction” when adding one — a SIP, rent, a subscription.
      </p>
    </Card>
  );

  return (
    <>
      <Card flush>
        {subs.map((s, i) => {
          const isAsset = s.type === 'buy' || s.type === 'sell';
          const fixed = s.invariant === 'units'
            ? `${s.units} units`
            : formatCurrency(s.amount);
          return (
            <div key={s._id} className="data-row"
              style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none', opacity: s.active ? 1 : 0.5 }}>
              <div className="flex items-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                <div className="flex-shrink-0" style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Repeat size={14} style={{ color: 'var(--color-text-secondary)' }} strokeWidth={1.6} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isAsset ? (s.assetName || s.assetSymbol) : (s.notes || categoryLabel(s.category) || s.type)}
                    </p>
                    <Badge variant={s.type === 'income' ? 'success' : s.type === 'expense' ? 'danger' : 'default'}>
                      {s.type}
                    </Badge>
                    {!s.active && <Badge variant="default">Paused</Badge>}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                    <span className="figure">{fixed}</span> · {freqLabel(s.frequency)} · {accounts[s.account] || 'Account'}
                    {' · '}
                    <span className="figure">{formatDate(s.startDate)}</span>
                    {s.endDate
                      ? <> → <span className="figure">{formatDate(s.endDate)}</span></>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 3 }}>
                          <InfinityIcon size={10} /> ongoing
                        </span>}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                {s.lastRunDate && (
                  <span className="text-xs figure" style={{ color: 'var(--color-text-muted)' }}>
                    last {formatDate(s.lastRunDate)}
                  </span>
                )}
                <button type="button" onClick={() => toggle(s)}
                  title={s.active ? 'Pause' : 'Resume'} aria-label={s.active ? 'Pause' : 'Resume'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 6 }}>
                  {s.active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button type="button" onClick={() => setToDelete(s)}
                  title="Remove" aria-label="Remove"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 6 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </Card>

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => remove(toDelete)}
        title="Remove subscription"
        message="This stops all FUTURE occurrences. Transactions it has already recorded are real and stay — delete those individually if you want them gone."
      />
    </>
  );
}

// ─── Categories ──────────────────────────────────────────────────────────────

/**
 * The taxonomy is two levels: a PRIMARY group (Food) holding SECONDARY categories
 * (Bakery). A user-defined one is any whose code carries the `tpu_`/`tsu_` prefix —
 * that is what makes it deletable; the built-ins are shared and are not.
 */
const isCustom = (c) => /^t[ps]u_/.test(c.code || '');

const APPLIES_TO = [
  { value: 'expense', label: 'Expense' },
  { value: 'income',  label: 'Income' },
  { value: 'both',    label: 'Both' },
];

const EMPTY_CAT_FORM = { level: 'secondary', parent: '', name: '', emoji: '📋', applicableTo: 'expense' };



function CategoriesManager() {
  const toast = useToast();
  const [primary, setPrimary]     = useState([]);
  const [secondary, setSecondary] = useState({});
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(false);
  const [saving, setSaving]       = useState(false);
  const [toDelete, setToDelete]   = useState(null);
  // Non-null while editing an existing custom category (its `code`).
  const [editing, setEditing]     = useState(null);
  const [form, setForm] = useState(EMPTY_CAT_FORM);

  const load = async () => {
    try {
      const { data } = await categoriesAPI.getAll();
      setPrimary(data.primary || []);
      setSecondary(data.secondary || {});
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load categories');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditing(null); setForm(EMPTY_CAT_FORM); setModal(true); };

  const openEdit = (c) => {
    setEditing(c.code);
    // Only the label and the emoji are editable — moving a category between groups, or
    // flipping income↔expense, would strand transactions already filed under its code.
    setForm({ level: c.level, parent: c.parent || '', name: c.name, emoji: c.emoji || '', applicableTo: 'expense' });
    setModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await categoriesAPI.update(editing, {
          name:  form.name.trim(),
          emoji: form.emoji || undefined,
        });
        toast.success('Category updated');
      invalidateCategories();
      } else {
        await categoriesAPI.create({
          name:  form.name.trim(),
          emoji: form.emoji || undefined,
          level: form.level,
          parent: form.level === 'secondary' ? form.parent : undefined,
          applicableTo: form.applicableTo === 'both' ? ['income', 'expense'] : [form.applicableTo],
        });
        toast.success('Category added');
        invalidateCategories();
      }
      setModal(false);
      setEditing(null);
      setForm(EMPTY_CAT_FORM);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${editing ? 'update' : 'add'} category`);
    } finally { setSaving(false); }
  };

  const remove = async (c) => {
    try {
      await categoriesAPI.delete(c.code);
      toast.success('Category removed');
      invalidateCategories();
      setToDelete(null);
      load();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to remove'); }
  };

  if (loading) return <Spinner height={200} />;

  const customCount = primary.filter(isCustom).length
    + Object.values(secondary).flat().filter(isCustom).length;

  const primaryOptions = primary.map(p => ({ value: p.code, label: `${p.emoji || ''} ${p.name}`.trim() }));

  return (
    <>
      <div className="flex items-center justify-between" style={{ gap: 16 }}>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {customCount} custom · <span style={{ opacity: 0.7 }}>the rest are built in</span>
        </p>
        <Button variant="gold" icon={Plus} onClick={openNew}>New category</Button>
      </div>

      {/* Every group, with its children. Custom ones carry a gilt pill and can be
          edited or removed; the built-ins are shown for context so a new one has
          somewhere obvious to live (they are shared, so they are not editable). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {primary.map(p => {
          const kids = secondary[p.code] || [];
          return (
            <div key={p.code}>
              <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>{p.emoji}</span>
                <p className="eyebrow" style={{ margin: 0 }}>{p.name}</p>
                {isCustom(p) && <Badge variant="gold">Custom</Badge>}
                {isCustom(p) && (
                  <>
                    <button type="button" onClick={() => openEdit(p)}
                      title="Edit group" aria-label="Edit group"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" onClick={() => setToDelete(p)}
                      title="Remove group" aria-label="Remove group"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}>
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>

              {kids.length > 0 && (
                <Card flush>
                  {kids.map((c, i) => (
                    <div key={c.code} className="data-row"
                      style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none', padding: '10px 16px' }}>
                      <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13 }}>{c.emoji}</span>
                        <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{c.name}</p>
                        {isCustom(c) && <Badge variant="gold">Custom</Badge>}
                      </div>
                      {isCustom(c) && (
                        <div className="flex items-center" style={{ gap: 2, flexShrink: 0 }}>
                          <button type="button" onClick={() => openEdit(c)}
                            title="Edit" aria-label="Edit"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 6 }}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => setToDelete(c)}
                            title="Remove" aria-label="Remove"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 6 }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </Card>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={modal} onClose={() => { setModal(false); setEditing(null); }}
        eyebrow={editing ? 'Edit' : 'New'}
        title={editing ? 'Edit category' : 'Custom category'}
        subtitle={editing
          ? 'Rename it or change its emoji. Where it lives is fixed — moving it would strand the transactions already filed under it.'
          : 'A category lives inside a group — “Bakery” inside “Food”. You can add either.'}>
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Kind and group are set at creation only — see the subtitle. */}
          {!editing && (
            <div className="field">
              <label className="label">Kind</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { k: 'secondary', label: 'Category', hint: 'inside a group' },
                  { k: 'primary',   label: 'Group',    hint: 'a new top-level group' },
                ].map(({ k, label, hint }) => {
                  const on = form.level === k;
                  return (
                    <button key={k} type="button" onClick={() => setForm({ ...form, level: k })}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start',
                        padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        fontFamily: 'inherit', textAlign: 'left',
                        border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        background: on ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
                      }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: on ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>{label}</span>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>{hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!editing && form.level === 'secondary' && (
            <div className="field">
              <label className="label">Group</label>
              <TypePicker options={primaryOptions} value={form.parent}
                onChange={v => setForm({ ...form, parent: v })}
                placeholder="Select a group…" searchable={primaryOptions.length > 6} />
            </div>
          )}

          <div className="field">
            <label className="label">Name</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <EmojiPicker value={form.emoji} onChange={v => setForm({ ...form, emoji: v })} size={42} />
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="input-field" placeholder={form.level === 'primary' ? 'e.g. Hobbies' : 'e.g. Bakery'} required autoFocus />
            </div>
          </div>

          {!editing && (
            <div className="field">
              <label className="label">Applies to</label>
              <TypePicker options={APPLIES_TO} value={form.applicableTo}
                onChange={v => setForm({ ...form, applicableTo: v })} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => { setModal(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit" variant="gold"
              disabled={saving || !form.name.trim() || (!editing && form.level === 'secondary' && !form.parent)}>
              {saving ? 'Saving…' : (editing ? 'Save changes' : 'Add category')}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => remove(toDelete)}
        title="Remove category"
        message="Transactions already filed under it keep their category — only future use is removed."
      />
    </>
  );
}
