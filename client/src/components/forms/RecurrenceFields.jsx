import DatePicker from './DatePicker';
import TypePicker from './TypePicker';
import { Repeat, Check } from 'lucide-react';
import { FREQUENCIES, emptyRecurrence } from '../../lib/recurrence';

/**
 * RecurrenceFields — the "make this recurring" block, shared by the cash and asset
 * transaction forms so a subscription is set up the same way everywhere.
 *
 * When enabled, the form's date becomes the schedule's START date; this block adds
 * the end (or Ongoing), the frequency, and — for an asset only — the INVARIANT: what
 * stays fixed each period. A ₹5,000 SIP buys however many units the NAV allows that
 * day; a 10-unit schedule costs whatever 10 units cost. Cash flows are always
 * fixed-amount, so they are never asked.
 *
 * Props:
 *   value    — { recurring, frequency, endDate, ongoing, invariant }
 *   onChange — patch merged into value
 *   isAsset  — show the invariant toggle
 *   fromDate — the form's date, echoed as the schedule's start
 */

/**
 * The checkbox alone, for forms that want it inline beside another toggle (the asset
 * form pairs it with "Settle against account cash" to save a row).
 */
export function RecurrenceToggle({ value, onChange, isAsset = false, compact = false }) {
  const v = value || emptyRecurrence();
  return (
    <button type="button" onClick={() => onChange({ ...v, recurring: !v.recurring })}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '11px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        border: `1px solid ${v.recurring ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: v.recurring ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
        transition: 'background 0.15s, border-color 0.15s',
      }}>
      <span style={{
        width: 15, height: 15, borderRadius: 4, flexShrink: 0,
        border: `2px solid ${v.recurring ? 'var(--color-accent)' : 'var(--color-border-hover)'}`,
        background: v.recurring ? 'var(--color-accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {v.recurring && <Check size={10} style={{ color: 'var(--color-bg-primary)', strokeWidth: 3 }} />}
      </span>
      <Repeat size={13} style={{ color: v.recurring ? 'var(--color-accent)' : 'var(--color-text-muted)', flexShrink: 0 }} />
      <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>Repeat</span>
      {!compact && (
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
          {isAsset ? '(SIP, STP…)' : '(rent, subscriptions…)'}
        </span>
      )}
    </button>
  );
}

export default function RecurrenceFields({ value, onChange, isAsset = false, fromDate, hideToggle = false, showInvariant = true }) {
  const v = value || emptyRecurrence();
  const set = (patch) => onChange({ ...v, ...patch });

  // Body-only mode: the host form renders the toggle itself (inline elsewhere), and
  // this contributes nothing at all until it is switched on — so no wasted rows.
  if (hideToggle && !v.recurring) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: v.recurring ? 12 : 0,
      padding: v.recurring ? '12px 14px' : '10px 14px',
      borderRadius: 'var(--radius-sm)',
      background: v.recurring ? 'var(--color-accent-muted)' : 'var(--color-bg-elevated)',
      border: `1px solid ${v.recurring ? 'var(--color-accent-dim)' : 'var(--color-border)'}`,
      transition: 'background 0.15s, border-color 0.15s',
    }}>
      {/* Toggle */}
      {!hideToggle && (
        <button type="button" onClick={() => set({ recurring: !v.recurring })}
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
          }}>
          <span style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            border: `2px solid ${v.recurring ? 'var(--color-accent)' : 'var(--color-border-hover)'}`,
            background: v.recurring ? 'var(--color-accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {v.recurring && <Check size={11} style={{ color: 'var(--color-bg-primary)', strokeWidth: 3 }} />}
          </span>
          <Repeat size={13} style={{ color: v.recurring ? 'var(--color-accent)' : 'var(--color-text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            Repeat this transaction
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            {isAsset ? '(SIP, STP…)' : '(rent, subscriptions…)'}
          </span>
        </button>
      )}

      {v.recurring && (
        <>
          {/* The form's own date is the schedule's anchor — say so, rather than
              asking for the same date twice. */}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Repeats from <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>{fromDate || '—'}</span>.
            Everything already due is recorded immediately.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label className="label">Frequency</label>
              <TypePicker options={FREQUENCIES} value={v.frequency} onChange={f => set({ frequency: f })} />
            </div>
            <div className="field">
              <label className="label">Until</label>
              {v.ongoing ? (
                <button type="button" onClick={() => set({ ongoing: false })}
                  className="input-field"
                  style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                  Ongoing
                </button>
              ) : (
                <DatePicker value={v.endDate} onChange={d => set({ endDate: d })} min={fromDate} />
              )}
            </div>
          </div>

          <button type="button" onClick={() => set({ ongoing: !v.ongoing, endDate: '' })}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>
            <span style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              border: `2px solid ${v.ongoing ? 'var(--color-accent)' : 'var(--color-border-hover)'}`,
              background: v.ongoing ? 'var(--color-accent)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {v.ongoing && <Check size={9} style={{ color: 'var(--color-bg-primary)', strokeWidth: 3 }} />}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Ongoing (no end date)</span>
          </button>

          {/* Assets only: which side stays fixed each period. A balance asset (EPF/NPS)
              has no units, so there is nothing to choose — it is always amount. */}
          {isAsset && showInvariant && (
            <div className="field">
              <label className="label">Keep constant each time</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { k: 'amount', label: 'Amount', hint: 'units vary with price' },
                  { k: 'units',  label: 'Units',  hint: 'cost varies with price' },
                ].map(({ k, label, hint }) => {
                  const on = v.invariant === k;
                  return (
                    <button key={k} type="button" onClick={() => set({ invariant: k })}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start',
                        padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        fontFamily: 'inherit', textAlign: 'left',
                        border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        background: on ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
                      }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: on ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
                        {label}
                      </span>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>{hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
