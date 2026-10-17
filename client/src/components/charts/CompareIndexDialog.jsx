import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import SegmentedControl from '../ui/SegmentedControl';
import MarketSearch from '../market/MarketSearch';
import { BENCHMARKS, isSelfPricedHolding } from '../../lib/constants';
import { INDICATOR_TYPES, indicatorTypeOf, newIndicator, clampParam } from '../../lib/indicators';

const ADDED = 'Your additions';

// One body height for every tab, so switching never resizes the dialog.
const BODY_H = 'min(48vh, 360px)';

// Common yardsticks for a fixed return; a preset is just a filled-in rate.
const PRESETS = [
  { key: '6',   label: 'Inflation', hint: '6%' },
  { key: '7',   label: 'FD',        hint: '7%' },
  { key: '7.1', label: 'PPF',       hint: '7.1%' },
  { key: '12',  label: 'Equity',    hint: '12%' },
];

// Anything with a market price can be a yardstick; a self-valued holding (an FD, a flat) cannot.
const priceable = (s) => !(s.owned && isSelfPricedHolding(s));

/**
 * One benchmark row — a colour swatch (the line it renders as) plus its name. An
 * unpicked row has no colour yet and shows a neutral swatch.
 */
function Row({ label, note, color, checked, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '7px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--color-bg-elevated)' : 'transparent',
        textAlign: 'left',
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: 3, flexShrink: 0,
        background: color || 'var(--color-text-muted)', opacity: checked ? 1 : 0.3,
      }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm truncate" style={{ display: 'block', color: checked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
          {label}
        </span>
        {note && <span className="text-xs truncate" style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 2 }}>{note}</span>}
      </span>
      <span style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        border: `2px solid ${checked ? 'var(--color-text-primary)' : 'var(--color-border-hover)'}`,
        background: checked ? 'var(--color-text-primary)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <Check size={12} strokeWidth={3} color="var(--color-bg-primary)" />}
      </span>
    </button>
  );
}

/** "Doubles in about 10.2 years" — what a rate means, in the one figure people remember. */
const doublingYears = (r) => Math.log(2) / Math.log(1 + r / 100);

function FixedReturn({ onAdd }) {
  const [rate, setRate] = useState('7');
  const r = Number(rate);
  const ok = rate !== '' && r > 0 && r <= 100;
  const add = () => ok && onAdd({ symbol: `RATE:${+r.toFixed(2)}`, label: `${+r.toFixed(2)}% a year`, group: ADDED });

  return (
    <form onSubmit={(e) => { e.preventDefault(); add(); }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22 }}>
      <div style={{ textAlign: 'center' }}>
        <p className="col-head" style={{ marginBottom: 12 }}>A steady return, compounded daily</p>
        <label style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 8, padding: '10px 22px',
          borderRadius: 'var(--radius)', background: 'var(--color-bg-input)',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)', border: '1px solid var(--color-border)',
        }}>
          <input
            className="figure txn-amount-input" type="number" inputMode="decimal" min="0.1" max="100" step="0.1"
            value={rate} onChange={e => setRate(e.target.value)} aria-label="Annual return, percent"
            style={{
              width: `${Math.max(2, rate.length) + 0.5}ch`, background: 'none', border: 'none', outline: 'none',
              fontSize: '2.25rem', fontWeight: 500, color: 'var(--color-text-primary)', textAlign: 'right',
            }}
          />
          <span style={{ fontSize: '1.1rem', color: 'var(--color-text-secondary)' }}>% a year</span>
        </label>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, minHeight: 16 }}>
          {ok ? `Money at this rate doubles in about ${doublingYears(r).toFixed(1)} years` : 'Enter a rate between 0.1% and 100%'}
        </p>
      </div>

      <SegmentedControl block options={PRESETS} value={PRESETS.some(p => Number(p.key) === r) ? PRESETS.find(p => Number(p.key) === r).key : null}
        onChange={setRate} ariaLabel="Common rates" />

      <Button type="submit" variant="secondary" icon={Plus} disabled={!ok} style={{ width: '100%' }}>
        {ok ? `Add ${+r.toFixed(2)}% a year to the chart` : 'Add to the chart'}
      </Button>
    </form>
  );
}

/** A number field that commits on Enter or blur, clamped to its param — typing "1" on the way to "150" draws nothing. */
function ParamInput({ param, value, onCommit }) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) { setSeen(value); setText(String(value)); }
  const commit = () => {
    const v = clampParam(param, text);
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={`${param.label}: ${param.min}–${param.max}`}>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{param.label}</span>
      <input className="figure param-input" type="number" inputMode="decimal" min={param.min} max={param.max} step={param.step}
        value={text} onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        style={{
          width: 58, height: 28, padding: '0 8px', borderRadius: 7, boxSizing: 'border-box',
          background: 'var(--color-bg-input)', border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)', fontSize: 12, textAlign: 'right', outline: 'none',
        }} />
    </label>
  );
}

/** The indicators on the chart, each editable, then the types to add another from. */
function IndicatorEditor({ indicators, onChange, colorOf }) {
  const update = (id, key, v) => onChange(indicators.map(i => (i.id === id ? { ...i, [key]: v } : i)));
  return (
    <div style={{
      height: '100%', overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
      margin: '0 -6px', padding: '0 6px', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {indicators.length > 0 && (
        <div>
          <p className="col-head" style={{ padding: '6px 12px' }}>On the chart</p>
          {indicators.map(ind => {
            const t = indicatorTypeOf(ind.type);
            return (
              <div key={ind.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '7px 8px 7px 12px',
                borderRadius: 9, background: 'var(--color-bg-elevated)', marginBottom: 4,
              }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: colorOf(ind.id) || 'var(--color-text-muted)' }} />
                <span className="text-sm" style={{ flex: 1, minWidth: 0, color: 'var(--color-text-primary)' }}>{t.label}</span>
                {t.params.map(p => (
                  <ParamInput key={p.key} param={p} value={ind[p.key]} onCommit={v => update(ind.id, p.key, v)} />
                ))}
                <button type="button" onClick={() => onChange(indicators.filter(i => i.id !== ind.id))}
                  aria-label={`Remove ${t.label}`} title="Remove"
                  style={{ display: 'inline-flex', padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div>
        <p className="col-head" style={{ padding: '6px 12px' }}>Add an indicator</p>
        {INDICATOR_TYPES.map(t => (
          <button key={t.type} type="button" onClick={() => onChange([...indicators, newIndicator(t.type, indicators)])}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '8px 12px',
              borderRadius: 9, border: 'none', cursor: 'pointer', background: 'transparent', textAlign: 'left',
            }}
            className="indicator-add">
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="text-sm" style={{ display: 'block', color: 'var(--color-text-secondary)' }}>{t.name}</span>
              <span className="text-xs" style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 2 }}>{t.note}</span>
            </span>
            <Plus size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rows filed under their `group` headings, in the list's own order. */
function grouped(list) {
  const groups = [];
  for (const b of list) {
    const last = groups[groups.length - 1];
    if (last && last[0] === (b.group || '')) last[1].push(b);
    else groups.push([b.group || '', [b]]);
  }
  return groups;
}

/**
 * A scrolling list in the dialog's fixed body. The current group's heading is pinned OVER
 * the scroller rather than `position: sticky` inside it: Safari placed a sticky heading a
 * few pixels below the edge, and rows showed above it. The next heading pushes it out.
 */
function GroupedList({ groups, render }) {
  const scrollRef = useRef(null);
  const pinRef = useRef(null);

  const sync = useCallback(() => {
    const sc = scrollRef.current, pin = pinRef.current;
    if (!sc || !pin) return;
    const heads = [...sc.querySelectorAll('[data-group]')];
    const i = heads.findLastIndex(h => h.offsetTop <= sc.scrollTop);
    const next = heads[i + 1];
    const shift = next ? Math.min(0, next.offsetTop - sc.scrollTop - pin.offsetHeight) : 0;
    pin.style.transform = `translateY(${shift}px)`;
    pin.style.right = `${sc.offsetWidth - sc.clientWidth}px`;
    // A visual copy of a heading already in the list, so it is written directly rather than through state.
    pin.textContent = i >= 0 ? heads[i].dataset.group : '';
    pin.hidden = i < 0;
  }, []);
  useLayoutEffect(sync, [sync, groups]);

  return (
    <div style={{ position: 'relative', height: '100%', margin: '0 -6px', overflow: 'hidden' }}>
      <div ref={scrollRef} onScroll={sync} style={{
        position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
        overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '0 6px',
      }}>
        {groups.map(([group, rows], gi) => (
          <div key={group || gi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {group && <p className="col-head group-head" data-group={group}>{group}</p>}
            {rows.map(render)}
          </div>
        ))}
      </div>
      <p ref={pinRef} aria-hidden className="col-head group-head group-head-pinned" />
    </div>
  );
}

/**
 * Multi-select dialog for what a price chart draws besides its own line: benchmarks to
 * compare against (the catalogue, any listed instrument, or a fixed annual return —
 * growth view) and technical indicators on the line itself (either view).
 *
 * Props:
 *   open, onClose
 *   selected     — array of selected symbols (controlled)
 *   onChange     — (nextSymbols[]) => void
 *   colorOf(sym) — the line colour of a picked symbol; null when not picked
 *   options      — the catalogue to pick from (default: BENCHMARKS)
 *   onAdd        — ({symbol, label, group}) => void; adds a new line and selects it
 *   indicators / onIndicatorsChange — the chart's indicator instances (controlled); omit to hide the tab
 *   indicatorColorOf(id) — an indicator's line colour
 *   initialTab   — the tab each opening starts on ('list' | 'rate' | 'indicators')
 */
export default function CompareIndexDialog({
  open, onClose, selected, onChange, colorOf, options = BENCHMARKS, onAdd,
  indicators, onIndicatorsChange, indicatorColorOf = () => null, initialTab = 'list',
}) {
  const [tab, setTab] = useState(initialTab);
  const [finding, setFinding] = useState(false);
  // Each opening starts on the tab the chart asks for (derived in render, not an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTab(initialTab);
  }

  const toggle = (symbol) => {
    onChange(selected.includes(symbol)
      ? selected.filter(s => s !== symbol)
      : [...selected, symbol]);
  };
  const add = (b) => { onAdd(b); setTab('list'); };

  const hasIndicators = !!onIndicatorsChange;
  const tabs = [
    { key: 'list', label: 'Benchmarks', count: selected.length || undefined },
    onAdd && { key: 'rate', label: 'Fixed return' },
    hasIndicators && { key: 'indicators', label: 'Indicators', count: indicators.length || undefined },
  ].filter(Boolean);
  const subtitle = tab === 'indicators'
    ? 'Drawn on the line, in either view — any period'
    : 'Every line starts level, so the gap between them is the difference in return';

  return (
    <Modal
      open={open}
      onClose={onClose}
      align="top"
      eyebrow="Chart"
      title={tab === 'indicators' ? 'Indicators' : 'Compare against'}
      subtitle={subtitle}
    >
      {tabs.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <SegmentedControl block options={tabs} value={tab} onChange={setTab} ariaLabel="Add to the chart" style={{ flex: 1 }} />
          {onAdd && (
            <button type="button" onClick={() => setFinding(true)} className="btn-icon btn-icon-circle"
              aria-label="Find an asset" title="Find any asset to compare against" style={{ width: 38, height: 38, flexShrink: 0 }}>
              <Search size={15} />
            </button>
          )}
        </div>
      )}

      <div style={{ height: BODY_H, marginBottom: 18 }}>
        {tab === 'list' && (
          <GroupedList groups={grouped(options)} render={b => (
            <Row
              key={b.symbol}
              label={b.label}
              color={colorOf(b.symbol)}
              checked={selected.includes(b.symbol)}
              onToggle={() => toggle(b.symbol)}
            />
          )} />
        )}

        {tab === 'indicators' && (
          <IndicatorEditor indicators={indicators} onChange={onIndicatorsChange} colorOf={indicatorColorOf} />
        )}

        {tab === 'rate' && <FixedReturn onAdd={add} />}
      </div>

      <Button variant="gold" onClick={onClose} style={{ width: '100%' }}>Done</Button>

      {/* The app's own Find-an-asset dialog, nested; a pick lands ticked under "Your additions". */}
      <Modal open={finding} onClose={() => setFinding(false)}
        align="top" wide className="modal-fade-down"
        eyebrow="Compare against" title="Find an asset"
        subtitle="Any company, index, ETF, fund, metal or coin with a market price.">
        <MarketSearch browse filter={priceable}
          placeholder="Search a company, index, metal, coin or fund…"
          onSelect={(sec) => { setFinding(false); add({ symbol: sec.symbol, label: sec.name || sec.symbol, group: ADDED }); }} />
      </Modal>
    </Modal>
  );
}
