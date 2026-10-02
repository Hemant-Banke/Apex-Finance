import { compactIfLarge, formatDate } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ShowMore from '../ui/ShowMore';
import SpendCalendar, { CalendarLegend } from '../transactions/SpendCalendar';

const THIRDS = ['1st – 10th', '11th – 20th', '21st – end'];
const DAY_MS = 86_400_000;
const money = (v) => compactIfLarge(Math.round(v));

const cadence = (r) => {
  if (!r.nextDate) return 'recurring';
  const gap = (Date.parse(r.nextDate) - Date.parse(r.lastDate)) / DAY_MS;
  return gap <= 10 ? 'weekly' : gap <= 45 ? 'monthly' : gap <= 120 ? 'quarterly' : 'yearly';
};

function Row({ name, sub, value, valueSub }) {
  return (
    <div className="flex items-center" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{name}</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</p>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>{value}</p>
        {valueSub && <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{valueSub}</p>}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="text-sm" style={{ color: 'var(--color-text-muted)', padding: '18px 0' }}>{text}</p>;
}

/** Calendar and time-of-month spending, recurring commitments, and what leaner months would keep. */
export default function SpendingPatterns({ data, label, isDebt }) {
  const thirdsTotal = data.timeOfMonth.reduce((s, v) => s + v, 0);
  const maxThird = Math.max(...data.timeOfMonth);
  const sp = data.savingPotential;
  const trims = sp.items.filter(i => i.potential >= 100);
  const trimTotal = trims.reduce((s, i) => s + i.potential, 0);
  const income = data.averages.income, spend = data.averages.expense;
  const rateNow  = income > 0 ? ((income - spend) / income) * 100 : null;
  const rateThen = income > 0 ? ((income - spend + trimTotal) / income) * 100 : null;
  const name = (code) => label(code).split(' · ').pop() || 'Uncategorised';

  return (
    <>
      {data.daily.length > 0 && (
        <Card>
          <SectionHeader eyebrow="Spending patterns" size="sm"
            sub="Each day against your typical spending day · weekday averages beside each row"
            action={<CalendarLegend measure="out" />} style={{ marginBottom: 20 }} />
          <SpendCalendar daily={data.daily} from={data.window.from} to={data.window.to} measure="out" />

          {thirdsTotal > 0 && (
            <div style={{ marginTop: 26 }}>
              <p className="col-head" style={{ marginBottom: 12 }}>When in the month it goes</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18 }}>
                {data.timeOfMonth.map((v, i) => {
                  const share = (v / thirdsTotal) * 100;
                  return (
                    <div key={i} style={{ minWidth: 0 }}>
                      <div className="flex items-baseline justify-between" style={{ gap: 8, marginBottom: 8 }}>
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{THIRDS[i]}</span>
                        <span className="figure text-sm" style={{ color: v === maxThird ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
                          {share.toFixed(0)}%
                        </span>
                      </div>
                      <div style={{ height: 4, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${maxThird ? (v / maxThird) * 100 : 0}%`, borderRadius: 99, background: 'var(--color-accent)', opacity: v === maxThird ? 1 : 0.5 }} />
                      </div>
                      <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>{money(v)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card>
          <SectionHeader eyebrow="Recurring" size="sm" style={{ marginBottom: 12 }}
            sub="Payments that return at about the same size — the floor under every month" />
          {data.recurring.length ? (
            <ShowMore items={data.recurring} initial={5} noun="payments" render={(r, i) => (
              <Row key={i}
                name={r.label || name(r.category)}
                sub={`${cadence(r)} · ${r.months} months seen${r.nextDate ? ` · next ~${formatDate(r.nextDate)}` : ''}`}
                value={money(r.typical)}
                valueSub={cadence(r) !== 'monthly' ? `${money(r.monthly)}/mo` : null} />
            )} />
          ) : <Empty text="Nothing has repeated at a steady size yet" />}
        </Card>

        <Card>
          <SectionHeader eyebrow="Saving potential" size="sm" style={{ marginBottom: 12 }}
            sub="Each discretionary category at its own leaner months — spending you have already lived without" />
          {trims.length ? (
            <>
              <div className="flex items-baseline" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <span className="figure" style={{ fontSize: '1.15rem', fontWeight: 500, color: 'var(--color-accent)' }}>
                  {money(trimTotal)}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  a month{!isDebt && rateNow != null && <> · savings rate <span className="figure">{rateNow.toFixed(0)}%</span> → <span className="figure">{rateThen.toFixed(0)}%</span></>}
                </span>
              </div>
              <ShowMore items={trims} initial={4} noun="categories" render={(c) => (
                <Row key={c._id}
                  name={name(c._id)}
                  sub={<>typical <span className="figure">{money(c.typical)}</span> · lean <span className="figure">{money(c.lean)}</span> a month</>}
                  value={money(c.potential)}
                  valueSub="a month" />
              )} />
            </>
          ) : <Empty text="Needs three months of discretionary spending to compare against" />}
        </Card>
      </div>
    </>
  );
}
