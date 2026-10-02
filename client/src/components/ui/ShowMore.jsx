import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * A long list, shown short until asked.
 *
 * Every analytics box that lists rows — sectors, stocks, months, holdings, categories —
 * opens with the few rows that carry its answer and keeps the rest one click away. A box
 * that prints all twenty-six sectors states its finding in the first four rows and then
 * buries it under twenty-two more; the page reads as a wall of tables rather than a set
 * of answers.
 *
 * Two shapes, because lists are read two ways:
 *  - **head** (default) — the first `initial` rows. Right for anything ordered by
 *    importance or recency: the biggest holdings, the latest months.
 *  - **ends** — the top and bottom halves of `initial`, with the middle folded. Right for
 *    a RANKING where both ends are the news: the sectors beating the market and the ones
 *    lagging it. Showing only the head would hide every loser.
 *
 * Nothing is hidden when hiding would save less than three rows — "show 2 more" is a
 * button that costs as much space as the rows it hides.
 *
 * Props:
 *   items      — the full list
 *   render     — (item, indexInFullList) => row node. The index is the item's position in
 *                the WHOLE list, so ranking marks and colour rails stay right when folded.
 *   initial    — rows shown while collapsed (default 6)
 *   ends       — fold the middle rather than the tail
 *   noun       — what the rows are, for the toggle ("sectors" → "Show all 26 sectors")
 *   wrap       — (rows) => node, for rows that must sit inside a container (a <tbody>);
 *                the toggle is always rendered OUTSIDE it
 *   renderFold — (hiddenCount, expand) => node, the middle marker in `ends` mode, for
 *                containers where a <div> is not a valid child (a table needs a <tr>)
 *   toggleStyle — extra style for the toggle, e.g. an inset inside a `flush` card,
 *                where the full-width button would otherwise run into the card's edges
 */
export default function ShowMore({
  items = [], render, initial = 6, ends = false, noun = 'rows', wrap, renderFold, toggleStyle,
}) {
  const [open, setOpen] = useState(false);
  const collapsible = items.length > initial + 2;
  const expanded = open || !collapsible;
  const hidden = items.length - initial;

  let rows;
  if (expanded) {
    rows = items.map((it, i) => render(it, i));
  } else if (ends) {
    const top = Math.ceil(initial / 2);
    const bottom = initial - top;
    const fold = renderFold
      ? renderFold(hidden, () => setOpen(true))
      : <FoldMarker key="__fold" hidden={hidden} noun={noun} onClick={() => setOpen(true)} />;
    rows = [
      ...items.slice(0, top).map((it, i) => render(it, i)),
      fold,
      ...items.slice(items.length - bottom).map((it, i) => render(it, items.length - bottom + i)),
    ];
  } else {
    rows = items.slice(0, initial).map((it, i) => render(it, i));
  }

  return (
    <>
      {wrap ? wrap(rows) : rows}
      {collapsible && (
        <button type="button" onClick={() => setOpen(o => !o)} className="show-more text-xs"
          aria-expanded={expanded} style={toggleStyle}>
          {expanded
            ? <>Show fewer <ChevronUp size={13} /></>
            : <>Show all {items.length} {noun} <ChevronDown size={13} /></>}
        </button>
      )}
    </>
  );
}

/** The folded middle of a ranking — says how much is hidden, and opens it. */
function FoldMarker({ hidden, noun, onClick }) {
  return (
    <button type="button" onClick={onClick} className="show-more-fold text-xs">
      <span className="figure">⋯</span> {hidden} more {noun} in between
    </button>
  );
}
