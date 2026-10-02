import { Landmark, TrendingUp, Shield, CreditCard, Wallet, Briefcase } from 'lucide-react';
import { ACCOUNT_TYPES, accountTypeLabel } from './constants';
import { CHART_COLORS } from './utils';

// Account type → lucide icon component.
export const TYPE_ICON = {
  bank:       Landmark,
  brokerage:  TrendingUp,
  retirement: Shield,
  debt:       CreditCard,
  wallet:     Wallet,
  other:      Briefcase,
};

// Account type → identity colour and the group name a list of them goes under.
export const ACCOUNT_TYPE_STYLE = {
  bank:       { tone: CHART_COLORS[1], group: 'Bank accounts' },
  brokerage:  { tone: CHART_COLORS[0], group: 'Brokerage' },
  retirement: { tone: CHART_COLORS[2], group: 'Retirement' },
  wallet:     { tone: CHART_COLORS[3], group: 'Wallets' },
  other:      { tone: CHART_COLORS[6], group: 'Other' },
  debt:       { tone: 'var(--color-danger)', group: 'Liabilities' },
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
