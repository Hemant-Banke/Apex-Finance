import { useMemo, useRef, useState } from 'react';
import { Sankey, ResponsiveContainer } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import { TooltipPanel } from '../charts/ChartTooltip';
import { bopFlows, usdBn } from '../../lib/economy';

const LABEL_GUTTER = 230;
// Sentence case inside a sentence, keeping acronyms: "Foreign loans (ECB)" → "foreign loans (ECB)".
const lower = (l) => (/^[A-Z][a-z]/.test(l) ? l[0].toLowerCase() + l.slice(1) : l);

/** A node: its bar, and its name and amount outside it (left column to the left, right column to the right). */
function FlowNode({ x, y, width, height, payload }) {
  if (payload.centre) {
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} rx={2} fill="var(--color-text-secondary)" />
        <text x={x + width / 2} y={y - 10} textAnchor="middle" fontSize={12} fill="var(--color-text-primary)" fontWeight={500}>India</text>
        <text x={x + width / 2} y={y + height + 18} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)" fontFamily="var(--font-mono)">
          {usdBn(payload.value)}
        </text>
      </g>
    );
  }
  const left = payload.side === 'in';
  const tx = left ? x - 10 : x + width + 10;
  const anchor = left ? 'end' : 'start';
  const cy = y + height / 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 1.5)} rx={1.5} fill={payload.tone} fillOpacity={payload.net ? 1 : 0.85} />
      <text x={tx} y={cy + 4} textAnchor={anchor} fontSize={11.5} fill="var(--color-text-secondary)">
        {left ? <><tspan fill="var(--color-text-muted)" fontFamily="var(--font-mono)" fontSize={11}>{usdBn(payload.value)}</tspan>{'  '}{payload.name}</>
          : <>{payload.name}{'  '}<tspan fill="var(--color-text-muted)" fontFamily="var(--font-mono)" fontSize={11}>{usdBn(payload.value)}</tspan></>}
      </text>
    </g>
  );
}

function FlowLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }) {
  const outer = payload.source.centre ? payload.target : payload.source;
  return (
    <path d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none" stroke={outer.tone} strokeOpacity={0.28} strokeWidth={Math.max(linkWidth, 1)} />
  );
}

// Drawn by us at whole pixels: Recharts places a Sankey tooltip at the link's fractional midpoint, which blurs its text.
function FlowTip({ hover }) {
  if (!hover) return null;
  return (
    <div style={{ position: 'absolute', left: hover.x + 14, top: hover.y + 14, pointerEvents: 'none', zIndex: 5 }}>
      <TooltipPanel minWidth={0}>
        <div style={{ padding: '8px 12px', display: 'flex', gap: 18, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{hover.name}</span>
          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{usdBn(hover.value)}</span>
        </div>
      </TooltipPanel>
    </div>
  );
}

/** What the quarter says, in one sentence: the current account, what paid for it, and the reserves. */
function summary(q, flows) {
  const ca = q.items.ca?.net;
  if (ca == null) return null;
  const capIn = flows.inflows.filter(r => r.net && r.key !== 'reserves').sort((a, b) => b.value - a.value);
  const res = q.items.reserves?.net;
  const parts = [
    ca < 0 ? `India paid out ${usdBn(-ca)} more than it earned abroad` : `India earned ${usdBn(ca)} more abroad than it paid out`,
  ];
  if (capIn.length) parts.push(`${ca < 0 ? 'financed mostly by' : 'while'} ${capIn.slice(0, 2).map(r => lower(r.label)).join(' and ')}${ca < 0 ? '' : ' also came in'}`);
  const tail = res == null || Math.abs(res) < 0.05 ? '' : res < 0 ? `; ${usdBn(-res)} went into reserves` : `; reserves were drawn down by ${usdBn(res)}`;
  return `In ${q.months}, ${parts.join(', ')}${tail}.`;
}

/** The balance of payments for one quarter as a flow: money earned and borrowed on the left, spent and sent on the right. */
export default function BopFlow({ quarters }) {
  const recent = quarters.slice(-6);
  const [date, setDate] = useState(recent[recent.length - 1]?.date);
  const q = recent.find(r => r.date === date) || recent[recent.length - 1];
  const boxRef = useRef(null);
  const [hover, setHover] = useState(null);

  const at = (e) => {
    const r = boxRef.current?.getBoundingClientRect();
    return r ? { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) } : { x: 0, y: 0 };
  };
  const enter = (item, type, e) => {
    const p = item?.payload;
    const outer = type === 'link' ? (p?.source?.centre ? p.target : p?.source) : p;
    if (outer && !outer.centre) setHover({ name: outer.name, value: outer.value, ...at(e) });
  };

  const { data, flows, total } = useMemo(() => {
    if (!q) return {};
    const f = bopFlows(q.items);
    const nodes = [
      ...f.inflows.map(r => ({ ...r, name: r.label, side: 'in' })),
      { name: 'India', centre: true },
      ...f.outflows.map(r => ({ ...r, name: r.label, side: 'out' })),
    ];
    const mid = f.inflows.length;
    const links = [
      ...f.inflows.map((r, i) => ({ source: i, target: mid, value: r.value })),
      ...f.outflows.map((r, i) => ({ source: mid, target: mid + 1 + i, value: r.value })),
    ];
    return { data: { nodes, links }, flows: f, total: f.inflows.reduce((s, r) => s + r.value, 0) };
  }, [q]);

  if (!q || !data) return null;
  const rows = Math.max(flows.inflows.length, flows.outflows.length);

  return (
    <Card>
      <SectionHeader eyebrow="Balance of payments" size="sm"
        sub={`${q.short} (${q.months}) · ${usdBn(total)} through the quarter`}
        action={recent.length > 1 && (
          <SegmentedControl size="sm" ariaLabel="Quarter" value={q.date} onChange={setDate}
            options={recent.map(r => ({ key: r.date, label: r.short }))} />
        )}
        style={{ marginBottom: 14 }} />
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 8, maxWidth: 760 }}>{summary(q, flows)}</p>
      <div ref={boxRef} style={{ position: 'relative' }}
        onMouseMove={e => hover && setHover(h => h && { ...h, ...at(e) })}>
      <ResponsiveContainer width="100%" height={Math.max(360, rows * 44)}>
        <Sankey data={data} sort={false} nodeWidth={8} nodePadding={22} iterations={0} linkCurvature={0.5}
          margin={{ top: 28, bottom: 28, left: LABEL_GUTTER, right: LABEL_GUTTER }}
          node={<FlowNode />} link={<FlowLink />}
          onMouseEnter={enter} onMouseLeave={() => setHover(null)} />
      </ResponsiveContainer>
      <FlowTip hover={hover} />
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
        Earnings and payments are gross; investment and loans are net for the quarter, on whichever side they fell.
        Errors and omissions are folded into other capital, so the two sides balance. Source: RBI, US$ billion.
      </p>
    </Card>
  );
}
