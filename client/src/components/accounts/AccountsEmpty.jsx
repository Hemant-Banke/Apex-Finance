import { Plus } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { TYPE_ICON, ACCOUNT_TYPE_STYLE } from '../../lib/accountPickerOptions';

const STARTERS = [
  { type: 'bank',       name: 'Bank account', what: 'Salary, savings, spending' },
  { type: 'brokerage',  name: 'Brokerage',    what: 'Stocks, funds, ETFs' },
  { type: 'retirement', name: 'Retirement',   what: 'EPF, NPS, PPF' },
  { type: 'debt',       name: 'Card or loan', what: 'What you owe' },
];

/** No accounts yet: the four kinds as ghost cards, each a one-click start. */
export default function AccountsEmpty({ onCreate }) {
  return (
    <Card gilt flush>
      <div style={{ padding: '44px 32px 36px', textAlign: 'center' }}>
        <p className="eyebrow" style={{ justifyContent: 'center', marginBottom: 14 }}>Accounts</p>
        <h1 className="heading-xl" style={{ color: 'var(--color-text-primary)' }}>Start with where your money lives</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: '10px auto 0', maxWidth: 460, lineHeight: 1.6 }}>
          Every account holds cash, assets, or a debt. Add one and Apex builds your net worth,
          portfolio and cashflow from what happens in it.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, padding: '0 28px 30px' }}>
        {STARTERS.map(({ type, name, what }) => {
          const Icon = TYPE_ICON[type];
          const tone = ACCOUNT_TYPE_STYLE[type].tone;
          return (
            <button key={type} type="button" onClick={() => onCreate(type)} className="starter-card"
              style={{ '--tone': tone }}>
              <span style={{
                width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone,
              }}>
                <Icon size={18} strokeWidth={1.6} />
              </span>
              <span style={{ textAlign: 'left' }}>
                <span className="text-sm" style={{ display: 'block', color: 'var(--color-text-primary)', fontWeight: 500 }}>{name}</span>
                <span className="text-xs" style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 3 }}>{what}</span>
              </span>
              {/* A ghost balance line: what this card becomes once it holds money. */}
              <span aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto', width: '100%' }}>
                <span style={{ height: 8, width: '46%', borderRadius: 4, background: 'var(--color-bg-elevated)' }} />
                <span style={{ height: 3, width: '100%', borderRadius: 4, background: `color-mix(in srgb, ${tone} 30%, transparent)` }} />
              </span>
              <span className="starter-add"><Plus size={14} /></span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 34px' }}>
        <Button variant="gold" icon={Plus} onClick={() => onCreate('bank')}>New account</Button>
      </div>
    </Card>
  );
}
