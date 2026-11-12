import { useState } from 'react';
import { ArrowDownRight, ChevronDown } from 'lucide-react';
import Card from '../ui/Card';
import Sparkline from '../ui/Sparkline';
import { CHART_COLORS, formatCrore } from '../../lib/utils';
import { usdBn } from '../../lib/economy';

const scrollTo = (id) => document.getElementById(`econ-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

const SPARK_FMT = {
  pct: v => `${v.toFixed(1)}%`,
  usd: v => usdBn(v, { signed: true }),
  inr: v => `₹${v.toFixed(2)}`,
};
const BAR_FMT = { usd: v => usdBn(v, { signed: true }), cr: v => formatCrore(v, { signed: true }) };

// Money amounts, percentages and multiples in the lede; everything else is prose.
const FIGURE = /([₹$][\d,.]+(?:L Cr| Cr|B)?|\d[\d,.]*(?:%|×))/g;

/** The findings joined into one paragraph, with its figures lifted out of the prose. */
export function StoryLede({ text }) {
  if (!text) return null;
  return (
    <p className="text-sm" style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)', margin: 0 }}>
      {text.split(FIGURE).map((part, i) => i % 2
        ? <span key={i} style={{ color: 'var(--color-text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{part}</span>
        : part)}
    </p>
  );
}

function Trend({ spark }) {
  const v = spark.values;
  const fmt = SPARK_FMT[spark.fmt] || String;
  return (
    <div>
      <div className="flex items-baseline justify-between" style={{ gap: 8, marginBottom: 6 }}>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{spark.label}</span>
        <span className="figure text-xs" style={{ color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>{fmt(v[v.length - 1])}</span>
      </div>
      <Sparkline values={v} width={220} height={36} tone={CHART_COLORS[1]} zero={spark.zero} title={spark.label} />
    </div>
  );
}

// Signed amounts from one shared zero, so in and out read apart without a gain/loss colour.
function Bars({ bars }) {
  const max = Math.max(...bars.rows.map(r => Math.abs(r.v)), 1e-9);
  const fmt = BAR_FMT[bars.fmt] || String;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bars.rows.map(r => {
        const w = (Math.abs(r.v) / max) * 50;
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between" style={{ gap: 8, marginBottom: 3 }}>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.label}</span>
              <span className="figure text-xs" style={{ color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>{fmt(r.v)}</span>
            </div>
            <div style={{ position: 'relative', height: 6, background: 'var(--color-bg-input)', borderRadius: 3 }}>
              <span style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--color-border-hover)' }} />
              <span style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 3, left: r.v >= 0 ? '50%' : `${50 - w}%`, width: `${Math.max(w, 0.8)}%`, background: r.v >= 0 ? CHART_COLORS[1] : 'var(--color-text-muted)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Finding({ f, first }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="story-row" style={{ borderTop: first ? 'none' : '1px solid var(--color-border-subtle)' }}>
      <div>
        <p className="col-head" style={{ marginBottom: 6 }}>{f.theme}</p>
        {f.stat && <p className="figure" style={{ fontSize: '1.25rem', color: 'var(--color-text-primary)', lineHeight: 1.15 }}>{f.stat.value}</p>}
        {f.stat && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>{f.stat.label}</p>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p className="text-sm" style={{ fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>{f.title}</p>
        {open && <p className="text-xs" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{f.detail}</p>}
        <div className="flex" style={{ gap: 16 }}>
          <button type="button" onClick={() => setOpen(o => !o)} className="story-link text-xs" aria-expanded={open}>
            {open ? 'Less' : 'Why'} <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>
          {f.anchor !== 'top' && (
            <button type="button" onClick={() => scrollTo(f.anchor)} className="story-link text-xs">
              See the chart <ArrowDownRight size={12} />
            </button>
          )}
        </div>
      </div>
      <div>{f.bars ? <Bars bars={f.bars} /> : f.spark?.values?.length > 1 && <Trend spark={f.spark} />}</div>
    </div>
  );
}

/** The page's findings, one ruled row each: the figure, the headline, and its shape; the reasoning opens on request. */
export default function StoryGrid({ story }) {
  if (!story?.length) return null;
  return (
    <Card style={{ padding: '4px 24px' }}>
      {story.map((f, i) => <Finding key={f.key} f={f} first={i === 0} />)}
    </Card>
  );
}
