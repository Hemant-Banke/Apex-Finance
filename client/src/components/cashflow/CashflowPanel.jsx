import { useEffect, useRef, useState } from 'react';
import { accountsAPI } from '../../lib/api';
import { useCategoryNames } from '../../lib/categoryNames';
import Card from '../ui/Card';
import Divider from '../ui/Divider';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import CashflowChart from '../charts/CashflowChart';
import CategoryBreakdown from '../charts/CategoryBreakdown';
import MonthlyLedger from '../charts/MonthlyLedger';
import CashflowProfile from './CashflowProfile';
import SpendingPatterns from './SpendingPatterns';

const RANGES = [3, 6, 12, 24];

/**
 * A cash or debt account's counterpart to `AllocationPanel`: its profile, monthly flows,
 * categories against the window before, spending patterns and saving potential.
 * `refreshKey` refetches after a transaction changes.
 */
export default function CashflowPanel({ accountId, balance, isDebt, refreshKey }) {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);
  const req = useRef(0);
  const { label, describe } = useCategoryNames();

  useEffect(() => {
    const id = ++req.current;
    accountsAPI.getCashflow(accountId, months)
      .then(r => { if (id === req.current) setData(r.data); })
      .catch(() => { if (id === req.current) setData(null); });
  }, [accountId, months, refreshKey]);

  if (!data || !data.window.activeMonths) return null;

  // On a card, payments into it are the money in; a savings rate means nothing there.
  const rows = isDebt
    ? data.months.map(m => ({ ...m, income: m.income + m.transferIn, net: m.income + m.transferIn - m.expense, savingsRate: null }))
    : data.months;
  const active = rows.filter(m => m.income || m.expense);
  // Ranges past the account's own history would all show the same months, so they go.
  const { available, months: span } = data.window;
  const ranges = RANGES.filter((m, i) => i === 0 || RANGES[i - 1] < available)
    .map(m => ({ key: String(m), label: `${m}M` }));
  const picked = String(RANGES.find(m => m >= span) ?? months);
  const t = data.totals;
  const named = (rows) => rows.map(r => ({
    ...r,
    name:  r._id ? describe(r._id).label : 'Uncategorised',
    emoji: r._id ? describe(r._id).emoji : '',
  }));

  return (
    <>
      <Card>
        <SectionHeader
          eyebrow="Cashflow"
          size="sm"
          sub={isDebt
            ? 'What was charged to this account, what paid it off, and how the spending behaves'
            : 'What this account earns and spends, where the rest goes, and what kind of account that makes it'}
          style={{ marginBottom: 24 }}
          action={ranges.length > 1 && <SegmentedControl options={ranges} value={picked} onChange={k => setMonths(Number(k))} ariaLabel="Months" />}
        />

        <CashflowProfile data={data} balance={balance} isDebt={isDebt} label={label} />

        {active.length > 0 && (
          <>
            <Divider gilt margin={26} />
            <p className="eyebrow" style={{ marginBottom: 14 }}>{isDebt ? 'Charges and inflows' : 'Income and spending'}</p>
            <CashflowChart rows={rows} height={240} incomeLabel={isDebt ? 'Inflows' : 'Income'} />
            <Divider margin={22} />
            <p className="eyebrow" style={{ marginBottom: 14 }}>Month by month</p>
            <MonthlyLedger
              rows={active}
              avgIncome={active.reduce((s, m) => s + m.income, 0) / active.length}
              avgExpense={t.expense / active.length}
              overallRate={!isDebt && t.income > 0 ? ((t.income - t.expense) / t.income) * 100 : null}
            />
          </>
        )}
      </Card>

      {(data.categories.expense.length > 0 || data.categories.income.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <CategoryBreakdown title="Where it goes" rows={named(data.categories.expense)} months={span} invert
            emptyText="Nothing spent in this period" />
          {data.categories.income.length > 0 && (
            <CategoryBreakdown title={isDebt ? 'Inflows' : 'Where it comes from'} rows={named(data.categories.income)} months={span}
              emptyText={isDebt ? 'No inflows in this period' : 'No income in this period'} />
          )}
        </div>
      )}

      <SpendingPatterns data={data} label={label} isDebt={isDebt} />
    </>
  );
}
