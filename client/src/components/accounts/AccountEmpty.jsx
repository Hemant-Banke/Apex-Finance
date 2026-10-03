import { BarChart2, Plus, Upload } from 'lucide-react';
import GardenEmpty from '../ui/GardenEmpty';
import Button from '../ui/Button';

const FEATURES = {
  cash: [
    ['Account profile', 'what kind of account this is, and how much of what comes in is kept'],
    ['Monthly flows', 'income against spending, month by month'],
    ['Spending patterns', 'which days and which part of the month the money goes'],
    ['Saving potential', 'what your own leaner months say you could keep'],
  ],
  invest: [
    ['Holdings', 'every position marked to market, with its return and today\'s move'],
    ['Allocation', 'what the book is made of, and what kind of portfolio that makes it'],
    ['Balance history', 'how the account has grown, deposits taken out'],
    ['Activity', 'every buy, sell and transfer, newest first'],
  ],
};

/** A brand-new account: what will appear here, and the way to start it, over the garden. */
export default function AccountEmpty({ isDebt, invest, onAdd, onAddAsset, onImport }) {
  const title = isDebt ? 'No charges or payments yet' : invest ? 'Nothing in this account yet' : 'Nothing has moved through this account yet';
  return (
    <GardenEmpty align="left" title={title} compact
      text={`${invest ? 'Add an asset, record a deposit or import a statement' : 'Record a transaction or import a statement'}, and this page fills in on its own.`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '9px 24px', maxWidth: 760, marginBottom: 22 }}>
        {FEATURES[invest ? 'invest' : 'cash'].map(([name, what]) => (
          <div key={name} className="flex" style={{ gap: 10, alignItems: 'baseline' }}>
            <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--color-accent)', flexShrink: 0, transform: 'translateY(-2px)' }} />
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>{name}</span> — {what}
            </p>
          </div>
        ))}
      </div>
      <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
        {onAddAsset && <Button variant="gold" icon={BarChart2} onClick={onAddAsset}>Add asset</Button>}
        {onAdd && <Button variant={onAddAsset ? 'secondary' : 'gold'} icon={Plus} onClick={onAdd}>Add transaction</Button>}
        {onImport && <Button variant="secondary" icon={Upload} onClick={onImport}>Import statement</Button>}
      </div>
    </GardenEmpty>
  );
}
