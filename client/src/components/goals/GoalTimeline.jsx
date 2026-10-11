import { useLayoutEffect, useRef, useState } from 'react';
import { GOAL_TYPES, PRIORITIES } from '../../lib/goals';
import { compactIfLarge, formatCurrency, MONTHS_SHORT } from '../../lib/utils';

const money = (v) => compactIfLarge(Math.round(v || 0));
const monthYear = (iso) => `${MONTHS_SHORT[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;

const RIBBON = 92;          // the monthly plan hangs below it
const GAP = 10;
const LEVELS = [46, 88, 130];
const LABEL_W = 132;
const PAD = 26;
const RING = 16;

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Every goal on one time axis. Above it, each goal stands at its date as a ring that fills with its
 * odds (a spread goal draws its payout years along the axis). Below it hangs the monthly plan,
 * goal by goal, against the monthly cap — so the bands visibly hand over as goals fall due.
 */
export default function GoalTimeline({ rows, phases, cap, today, selected, onSelect }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);

  const end = Math.max(24, ...rows.map(r => r.gm.months + (r.gm.goal.withdrawal?.mode === 'spread' ? 12 * (r.gm.goal.withdrawal.years || 1) : 0)));
  const span = end * 1.04;
  const inner = Math.max(1, W - PAD * 2);
  const x = (m) => PAD + (Math.min(m, span) / span) * inner;

  // Stems take the lowest level whose labels do not collide with the previous one there.
  const placed = [];
  const lastAt = LEVELS.map(() => -Infinity);
  for (const r of [...rows].sort((a, b) => a.gm.months - b.gm.months)) {
    const px = x(r.gm.months);
    const flip = px + LABEL_W > W - 4;
    const from = flip ? px - LABEL_W - RING : px - RING;
    let level = LEVELS.findIndex((_, i) => from > lastAt[i] + 6);
    if (level < 0) level = lastAt.indexOf(Math.min(...lastAt));
    lastAt[level] = flip ? px + RING : px + RING + LABEL_W;
    placed.push({ ...r, px, flip, lift: LEVELS[level] });
  }

  // The lane above the axis is as tall as the tallest stem drawn, plus its ring and a margin.
  const LANE = Math.max(...placed.map(r => r.lift), LEVELS[0]) + RING + 26;

  // The monthly plan per phase, stacked by priority then date, scaled to the larger of cap and plan.
  const order = [...rows].sort((a, b) => (PRIORITIES[a.gm.goal.priority]?.rank ?? 1) - (PRIORITIES[b.gm.goal.priority]?.rank ?? 1) || a.gm.months - b.gm.months);
  const top = Math.max(cap, ...phases.map(p => p.total), 1);
  const h = (v) => (v / top) * RIBBON;

  const startYear = Number(today.slice(0, 4));
  const years = Math.ceil(span / 12);
  const step = years > 30 ? 5 : years > 12 ? 2 : 1;
  const ticks = [];
  for (let y = 0; y <= years; y += step) {
    const m = y * 12 - (Number(today.slice(5, 7)) - 1);
    if (m >= 0 && m <= span) ticks.push({ m, label: startYear + y });
  }
  const H = LANE + GAP + RIBBON + 24;
  const dim = (id) => (hover && hover !== id ? 0.35 : 1);

  return (
    <div ref={ref} className="goal-timeline" style={{ height: H + 30 }}>
      {W > 0 && (
        <>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {/* Year grid, faint, through both lanes. */}
            {ticks.map(t => (
              <g key={t.label}>
                <line x1={x(t.m)} x2={x(t.m)} y1={LANE - 6} y2={LANE + GAP + RIBBON} stroke="var(--color-border-subtle)" />
                <text x={x(t.m)} y={H - 6} textAnchor="middle" className="goal-timeline-tick">{t.label}</text>
              </g>
            ))}
            <line x1={PAD} x2={W - PAD} y1={LANE} y2={LANE} className="goal-timeline-axis" />
            <text x={x(0)} y={LANE - 10} className="goal-timeline-tick" textAnchor="start">Now</text>

            {/* The monthly plan, hanging from the axis. */}
            {phases.map(p => {
              let y = LANE + GAP;
              return order.map(r => {
                const amt = p.byGoal[r.gm.goal._id];
                if (!amt) return null;
                const hh = h(amt), y0 = y;
                y += hh;
                return (
                  <rect key={`${p.from}-${r.gm.goal._id}`} x={x(p.from) + 0.5} y={y0} width={Math.max(1, x(p.to) - x(p.from) - 1)} height={Math.max(0.5, hh - 1)}
                    rx={2} fill={r.tone} opacity={0.62 * dim(r.gm.goal._id)} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                    onMouseEnter={() => setHover(r.gm.goal._id)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(r.gm.goal._id)}>
                    <title>{`${r.gm.goal.name} · ${formatCurrency(Math.round(amt))} a month · ${monthYear(p.start)} – ${monthYear(p.end)}`}</title>
                  </rect>
                );
              });
            })}
            {cap > 0 && <line x1={PAD} x2={W - PAD} y1={LANE + GAP + h(cap)} y2={LANE + GAP + h(cap)} className="goal-timeline-cap" />}

            {/* Payout years of spread goals, along the axis. */}
            {placed.filter(r => r.gm.goal.withdrawal?.mode === 'spread').map(r => (
              <rect key={`pay-${r.gm.goal._id}`} x={r.px} y={LANE - 2} width={Math.max(2, x(r.gm.months + 12 * (r.gm.goal.withdrawal.years || 1)) - r.px)} height={4}
                rx={2} fill={r.tone} opacity={0.5 * dim(r.gm.goal._id)} />
            ))}

            {/* Stems and odds rings. */}
            {placed.map(r => {
              const id = r.gm.goal._id, odds = r.gp?.odds ?? 0;
              const C = 2 * Math.PI * RING;
              return (
                <g key={id} opacity={dim(id)} style={{ transition: 'opacity 0.2s' }}>
                  <line x1={r.px} x2={r.px} y1={LANE - r.lift + RING} y2={LANE} stroke={r.tone} strokeOpacity={0.55} />
                  <circle cx={r.px} cy={LANE} r={3} fill={r.tone} />
                  <circle cx={r.px} cy={LANE - r.lift} r={RING} fill="var(--color-bg-card)" stroke="var(--color-border-hover)" strokeWidth={3} />
                  <circle cx={r.px} cy={LANE - r.lift} r={RING} fill="none" stroke={r.tone} strokeWidth={3} strokeLinecap="round"
                    strokeDasharray={`${C * Math.min(1, odds)} ${C}`} transform={`rotate(-90 ${r.px} ${LANE - r.lift})`} />
                </g>
              );
            })}
          </svg>

          {placed.map(r => {
            const id = r.gm.goal._id, on = selected === id;
            const Icon = GOAL_TYPES[r.gm.goal.type]?.icon || GOAL_TYPES.other.icon;
            return (
              <button key={id} type="button" className={`goal-timeline-pin${r.flip ? ' is-left' : ''}${on ? ' is-on' : ''}`}
                style={{ left: r.px, top: LANE - r.lift, '--tone': r.tone, opacity: dim(id) }}
                onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(id)}
                title={`${r.gm.goal.name} · ${money(r.gp?.futureCost ?? r.gm.futureCost)} · ${monthYear(r.gm.goal.targetDate)}`}>
                <span className="goal-timeline-icon"><Icon size={14} strokeWidth={1.9} /></span>
                <span className="goal-timeline-label">
                  <span className="truncate" style={{ color: on ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontWeight: on ? 600 : 500 }}>{r.gm.goal.name}</span>
                  <span className="figure" style={{ color: 'var(--color-text-muted)' }}>
                    {money(r.gp?.futureCost ?? r.gm.futureCost)}{r.gp && !r.gp.due ? ` · ${Math.round(r.gp.odds * 100)}%` : ''}
                  </span>
                </span>
              </button>
            );
          })}
          <span className="goal-timeline-lane" style={{ top: LANE + GAP + 2 }}>Each month</span>
        </>
      )}
      <div className="goal-timeline-legend" style={{ top: H + 6 }}>
        {order.map(r => (
          <span key={r.gm.goal._id} style={{ opacity: dim(r.gm.goal._id) }}><i style={{ background: r.tone }} />{r.gm.goal.name}</span>
        ))}
        {cap > 0 && <span><i className="is-cap" />{money(cap)} a month for goals</span>}
      </div>
    </div>
  );
}

