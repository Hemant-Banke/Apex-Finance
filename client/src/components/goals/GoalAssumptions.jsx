import { RotateCcw } from 'lucide-react';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import { Dial, Field, GroupHead, Choice } from '../ui/AssumptionControls';
import { compactIfLarge } from '../../lib/utils';
import { PRIORITIES, PRIORITY_ORDER, ASSETS, ASSET_KEYS } from '../../lib/goals';
import { PLAN_DEFAULTS } from '../../lib/goalPlan';

const money = (v) => compactIfLarge(Math.round(v || 0));
const pct = (v) => `${+Number(v).toFixed(1)}%`;

/** Every assumption the goal plan rests on, each a control. Kept on this device. */
export default function GoalAssumptions({ settings, onChange, surplus, monthlySpend, sources }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const cap = settings.cap ?? surplus;
  const toggle = (id) => {
    const ex = new Set(settings.excluded);
    if (ex.has(id)) ex.delete(id); else ex.add(id);
    set({ excluded: [...ex] });
  };
  return (
    <Card>
      <SectionHeader eyebrow="Assumptions" size="sm" style={{ marginBottom: 18 }}
        action={<button type="button" className="btn-icon" title="Reset to defaults" aria-label="Reset assumptions"
          onClick={() => onChange({ ...PLAN_DEFAULTS })}><RotateCcw size={14} /></button>} />

      <GroupHead title="Monthly for goals" figure={`${money(cap)}/mo`}
        sub={`Your average surplus is ${money(surplus)} a month — clear the field to use it`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Cap, a month" prefix="₹" value={settings.cap} min={0} placeholder={String(Math.round(surplus))}
          onChange={v => set({ cap: v })} hint="The most the plan may put towards goals each month" />
        <Dial label="Rises each year" value={settings.capGrowth} min={0} max={15} step={0.5} format={pct}
          onChange={v => set({ capGrowth: v })} hint="How fast the monthly amount grows, as income does" />
      </div>

      <GroupHead title="Markets and costs" figure={`${pct(settings.returns.equity)} equity`} sub="Long-run returns a year, before costs" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 22 }}>
        {ASSET_KEYS.map(k => (
          <Dial key={k} label={`${ASSETS[k].label} return`} value={settings.returns[k]} min={2} max={18} step={0.5} format={pct}
            onChange={v => set({ returns: { ...settings.returns, [k]: v } })} />
        ))}
        <Dial label="Costs rise faster by" value={settings.inflationShift} min={-3} max={5} step={0.5}
          format={v => `${v > 0 ? '+' : ''}${+v.toFixed(1)} pts`} onChange={v => set({ inflationShift: v })}
          hint="Added to every goal's own inflation" />
      </div>

      <GroupHead title="Safety" figure={`${settings.reserveMonths} months`}
        sub={`Kept back as a reserve: ${money(settings.reserveMonths * monthlySpend)} of cash no goal may touch`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 22 }}>
        <Dial label="Emergency reserve" value={settings.reserveMonths} min={0} max={24} format={v => `${v} mo`}
          onChange={v => set({ reserveMonths: v })} />
        {PRIORITY_ORDER.map(p => (
          <Dial key={p} label={`${PRIORITIES[p].label} goals, odds`} value={settings.confidence[p]} min={50} max={99} format={v => `${v}%`}
            onChange={v => set({ confidence: { ...settings.confidence, [p]: v } })}
            hint="The plan funds each goal of this priority until its odds reach this, before the next priority gets anything" />
        ))}
      </div>

      <GroupHead title="Money the plan may use" figure={money(sources?.available)}
        sub="Cash and liquid investments; locked holdings (FD, EPF, bonds) never count" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {(sources?.accounts || []).map(a => (
          <Choice key={a.id} check on={a.included} label={a.name} value={money(a.total)} onClick={() => toggle(a.id)}
            title={a.included ? `${money(a.available)} usable after the reserve — click to leave it out` : 'Left out — click to let the plan use it'} />
        ))}
      </div>
    </Card>
  );
}
