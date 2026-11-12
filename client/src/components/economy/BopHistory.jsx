import { useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ChartTooltip from '../charts/ChartTooltip';
import BandCursor from '../charts/BandCursor';
import { CHART_COLORS } from '../../lib/utils';
import { FLOW_TONE, usdBn } from '../../lib/economy';

const AXIS = { fill: '#878D97', fontSize: 11 };

const VIEWS = {
  current: {
    label: 'Current account',
    sub: 'What India earns and pays abroad each quarter, net. The line is the current account itself.',
    bars: [
      { key: 'goods', name: 'Goods trade', color: FLOW_TONE.trade },
      { key: 'services', name: 'Services', color: FLOW_TONE.services },
      { key: 'secondary', name: 'Remittances & transfers', color: FLOW_TONE.transfers },
      { key: 'primary', name: 'Investment income', color: FLOW_TONE.income },
    ],
    line: { key: 'ca', name: 'Current account' },
  },
  capital: {
    label: 'Capital flows',
    sub: 'Foreign money arriving (above zero) or leaving, net, by channel; releases before FY24 give no channels. The line is what the RBI added to reserves.',
    bars: [
      { key: 'di', name: 'FDI', color: CHART_COLORS[0] },
      { key: 'pi', name: 'Portfolio', color: CHART_COLORS[1] },
      { key: 'nri', name: 'NRI deposits', color: CHART_COLORS[2] },
      { key: 'ecb', name: 'Foreign loans', color: CHART_COLORS[3] },
      { key: 'other', name: 'Other', color: 'var(--color-text-muted)' },
    ],
    line: { key: 'reserves', name: 'Added to reserves' },
  },
};

/** The balance of payments quarter by quarter: the current account's parts, or the capital that financed it. */
export default function BopHistory({ quarters }) {
  const [view, setView] = useState('current');
  const v = VIEWS[view];

  const rows = useMemo(() => quarters.map(q => {
    const n = (k) => q.items[k]?.net ?? null;
    const named = ['di', 'pi', 'nri', 'ecb'].reduce((s, k) => s + (n(k) ?? 0), 0);
    const capital = (n('capfin') ?? 0) - (n('reserves') ?? 0) + (n('eo') ?? 0);
    return {
      label: q.short,
      goods: n('goods'), services: n('services'), primary: n('primary'), secondary: n('secondary'), ca: n('ca'),
      di: n('di'), pi: n('pi'), nri: n('nri'), ecb: n('ecb'),
      other: Math.round((capital - named) * 10) / 10,
      reserves: n('reserves') == null ? null : -n('reserves'),
    };
  }), [quarters]);

  if (!rows.length) return null;

  return (
    <Card>
      <SectionHeader eyebrow="Quarter by quarter" size="sm" sub={v.sub}
        action={<SegmentedControl size="sm" ariaLabel="Balance of payments view" value={view} onChange={setView}
          options={Object.entries(VIEWS).map(([key, o]) => ({ key, label: o.label }))} />}
        style={{ marginBottom: 18 }} />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={rows} stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} dy={8} minTickGap={18} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={x => usdBn(x, { digits: 0 })} />
          <ReferenceLine y={0} stroke="var(--color-border-hover)" />
          <Tooltip isAnimationActive={false} cursor={<BandCursor count={rows.length} />}
            content={<ChartTooltip formatValue={x => usdBn(x, { signed: true })} />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
          {v.bars.map(b => <Bar key={b.key} dataKey={b.key} name={b.name} stackId="s" fill={b.color} maxBarSize={22} isAnimationActive={false} />)}
          <Line dataKey={v.line.key} name={v.line.name} stroke="var(--color-text-primary)" strokeWidth={1.5}
            dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--color-text-primary)' }} activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
