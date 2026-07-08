import { Landmark, TrendingUp, Shield, CreditCard, Wallet, Briefcase } from 'lucide-react';
import { ACCOUNT_TYPES, accountTypeLabel } from './constants';

// Account type → lucide icon component.
const TYPE_ICON = {
  bank:       Landmark,
  brokerage:  TrendingUp,
  retirement: Shield,
  debt:       CreditCard,
  wallet:     Wallet,
  other:      Briefcase,
};

/** Rendered lucide icon node for an account type (used by TypePicker options). */
export function accountTypeIcon(type, size = 15) {
  const Icon = TYPE_ICON[type] || Briefcase;
  return <Icon size={size} strokeWidth={1.5} />;
}

/** TypePicker options for the account-TYPE vocabulary (bank / brokerage / …). */
export const ACCOUNT_TYPE_OPTIONS = ACCOUNT_TYPES.map(t => ({
  value: t.value,
  label: t.label,
  icon:  accountTypeIcon(t.value),
}));

/** TypePicker options for choosing one of the user's ACCOUNTS, each with its type icon. */
export function accountOptions(accounts = []) {
  return accounts.map(a => ({
    value:    a._id,
    label:    a.name,
    sublabel: accountTypeLabel(a.type),
    icon:     accountTypeIcon(a.type),
  }));
}
