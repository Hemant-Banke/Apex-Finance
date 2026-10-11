import { Briefcase, Sparkles } from 'lucide-react';
import { TYPE_ICON, ACCOUNT_TYPE_STYLE } from '../../lib/accountPickerOptions';

/** An account in the plan: its type's icon and name, or — for one the plan recommends opening — a dashed "new" tag. */
export default function PlanAccount({ account, sub }) {
  const Icon = account.isNew ? Sparkles : (TYPE_ICON[account.type] || Briefcase);
  const tone = account.isNew ? 'var(--color-text-secondary)' : (ACCOUNT_TYPE_STYLE[account.type] || ACCOUNT_TYPE_STYLE.other).tone;
  return (
    <span className={`plan-account${account.isNew ? ' is-new' : ''}`} style={{ '--tone': tone }}
      title={account.isNew ? 'You hold no account for this yet — the plan recommends opening one' : account.name}>
      <span className="plan-account-icon"><Icon size={12} strokeWidth={1.9} /></span>
      <span className="truncate">{account.name}</span>
      {account.isNew && <span className="plan-account-new">new</span>}
      {sub && <span className="plan-account-sub">{sub}</span>}
    </span>
  );
}
