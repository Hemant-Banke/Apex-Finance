import { Pencil, Trash2 } from 'lucide-react';
import CardDither from '../accounts/CardDither';
import { compactIfLarge, formatCurrency, MONTHS_SHORT } from '../../lib/utils';
import { GOAL_TYPES, PRIORITIES, addMonths, oddsTone } from '../../lib/goals';

const money = (v) => compactIfLarge(Math.round(v || 0));
const monthYear = (iso) => `${MONTHS_SHORT[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;
const SHADOW = '0 0 10px rgba(11, 13, 16, 0.9), 0 1px 2px rgba(11, 13, 16, 0.9)';

/** What the plan does for this goal, in one line. */
function planLine(gp, today) {
  if (!gp) return 'Planning…';
  if (gp.due) return 'The date has arrived';
  const first = gp.monthly.find(m => m.amount >= 1);
  const parts = [];
  if (gp.earmark >= 1) parts.push(`${money(gp.earmark)} set aside`);
  if (first) parts.push(`${formatCurrency(Math.round(first.amount))}/mo${first.from > 0 ? ` from ${monthYear(addMonths(today, first.from))}` : ''}`);
  return parts.length ? parts.join(' · ') : 'Not funded yet';
}

/**
 * One goal as a card, in the account cards' metal: the face dithered in the goal's colour with the
 * plan's middle path as terrain, the cost when due, what the plan puts in, and its odds.
 */
export default function GoalCard({ gm, gp, tone, today, selected, onSelect, onEdit, onDelete }) {
  const { goal } = gm;
  const Icon = GOAL_TYPES[goal.type]?.icon || GOAL_TYPES.other.icon;
  const terrain = gp?.bands?.map(b => b.p50) || [];
  return (
    <div role="button" tabIndex={0} aria-pressed={selected} onClick={onSelect} onKeyDown={e => e.key === 'Enter' && onSelect()}
      className={`account-card goal-plan-card group${selected ? ' is-selected' : ''}`} style={{ '--tone': tone }}>
      <CardDither tone={tone} values={terrain} />
      <Icon className="account-card-mark" size={132} strokeWidth={1} aria-hidden />

      <div className="flex items-start justify-between" style={{ gap: 10, position: 'relative', textShadow: SHADOW }}>
        <span className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
          <span className="account-card-chip"><Icon size={15} strokeWidth={1.9} /></span>
          <span style={{ minWidth: 0 }}>
            <span className="truncate" style={{ display: 'block', fontSize: '0.92rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{goal.name}</span>
            <span className="truncate" style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {monthYear(goal.targetDate)}{goal.withdrawal?.mode === 'spread' ? ` · over ${goal.withdrawal.years} yrs` : ''}
            </span>
          </span>
        </span>
        <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100" style={{ gap: 2, transition: 'opacity 0.15s' }}>
          <button type="button" className="btn-icon" title="Edit" aria-label={`Edit ${goal.name}`} style={{ width: 26, height: 26 }}
            onClick={e => { e.stopPropagation(); onEdit(); }}><Pencil size={12} /></button>
          <button type="button" className="btn-icon" title="Delete" aria-label={`Delete ${goal.name}`} style={{ width: 26, height: 26 }}
            onClick={e => { e.stopPropagation(); onDelete(); }}><Trash2 size={12} /></button>
        </span>
      </div>

      <div style={{ marginTop: 'auto', position: 'relative', textShadow: SHADOW }}>
        <p className="figure account-card-balance">{money(gp?.futureCost ?? gm.futureCost)}</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>{planLine(gp, today)}</p>
      </div>

      <div className="flex items-center justify-between" style={{ marginTop: 14, position: 'relative', textShadow: SHADOW }}>
        <span className="account-card-network">{PRIORITIES[goal.priority]?.label}</span>
        {gp && !gp.due && (
          <span className="flex items-center" title={`${Math.round(gp.odds * 100)}% odds against a ${Math.round(gp.target * 100)}% target`}
            style={{ gap: 6, fontSize: '0.7rem', color: 'var(--color-text-primary)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: oddsTone(gp) }} />
            <span className="figure">{Math.round(gp.odds * 100)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}
