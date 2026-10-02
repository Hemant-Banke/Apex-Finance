import { BarChart2, Plus, Upload } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

// Illustrative month heights for the ghosted preview — not data.
const GHOST = [[0.55, 0.35], [0.7, 0.5], [0.6, 0.62], [0.82, 0.44], [0.66, 0.38], [0.9, 0.52]];
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

/** A brand-new account: what will appear here, a ghost of the chart to come, and the way to start it. */
export default function AccountEmpty({ isDebt, invest, onAdd, onAddAsset, onImport }) {
  const title = isDebt ? 'No charges or payments yet' : invest ? 'Nothing in this account yet' : 'Nothing has moved through this account yet';
  return (
    <Card flush>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'stretch' }}>
        <div style={{ padding: '28px 28px 30px' }}>
          <h3 className="heading-lg" style={{ color: 'var(--color-text-primary)', maxWidth: 380 }}>
            {title}
          </h3>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6, maxWidth: 420 }}>
            {invest ? 'Add an asset, record a deposit or import a statement' : 'Record a transaction or import a statement'}, and this page fills in on its own.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, margin: '22px 0 26px' }}>
            {FEATURES[invest ? 'invest' : 'cash'].map(([name, what]) => (
              <div key={name} className="flex" style={{ gap: 11, alignItems: 'baseline' }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--color-accent)', flexShrink: 0, transform: 'translateY(-2px)' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
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
        </div>

        {/* A ghost of the chart this becomes, recessed into the card. */}
        <div aria-hidden style={{
          position: 'relative', minHeight: 240, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          gap: 18, padding: '40px 32px 44px', background: 'var(--color-bg-secondary)',
          borderLeft: '1px solid var(--color-border-subtle)', overflow: 'hidden',
        }}>
          <span style={{ position: 'absolute', left: 32, right: 32, bottom: 44, borderTop: '1px dashed var(--color-border-hover)' }} />
          {GHOST.map(([inH, outH], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150 }}>
              <span style={{ width: 14, height: `${inH * 100}%`, borderRadius: '4px 4px 0 0', background: 'color-mix(in srgb, var(--color-success) 22%, transparent)' }} />
              <span style={{ width: 14, height: `${outH * 100}%`, borderRadius: '4px 4px 0 0', background: 'color-mix(in srgb, var(--color-danger) 20%, transparent)' }} />
            </div>
          ))}
          <span style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(180deg, var(--color-bg-secondary) 0%, transparent 35%, transparent 75%, var(--color-bg-secondary) 100%)',
          }} />
        </div>
      </div>
    </Card>
  );
}
