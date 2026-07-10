import { useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Popover — floating panel anchored to a trigger, rendered in a portal so it
 * always sits ON TOP of everything (modals included) and never grows or gets
 * clipped by an overflow-scrolled ancestor.
 *
 * Positions below the anchor by default, flips above when there's more room,
 * and caps its own height to the available space (scrolls internally).
 *
 * Props:
 *   anchorRef  — ref to the trigger element
 *   open       — visibility
 *   onClose    — called on outside pointerdown / scroll / resize / Escape
 *   width      — panel width (default: match the anchor)
 *   maxHeight  — hard cap before flipping (default 320)
 *   children   — panel content
 */
export default function Popover({ anchorRef, open, onClose, width, maxHeight = 320, children }) {
  const [style, setStyle] = useState(null);
  const panelRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const spaceBelow = window.innerHeight - r.bottom - gap - 8;
      const spaceAbove = r.top - gap - 8;
      const below = spaceBelow >= spaceAbove;
      const avail = Math.max(120, below ? spaceBelow : spaceAbove);
      const w = width ?? r.width;
      // Keep within the viewport horizontally.
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);

      setStyle({
        position: 'fixed',
        left,
        width: w,
        maxHeight: Math.min(maxHeight, avail),
        zIndex: 10000,
        ...(below
          ? { top: r.bottom + gap }
          : { bottom: window.innerHeight - r.top + gap }),
      });
    };

    place();
    // Dismiss when the page/anchor scrolls, but NOT when scrolling inside the
    // panel itself (e.g. a long option list).
    const onScroll = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (e.target?.closest?.('.popover-panel')) return;
      onClose?.();
    };
    const onResize = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, anchorRef, width, maxHeight, onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      // A nested popover (e.g. a date picker inside a range popover) is portaled
      // elsewhere in the DOM — clicks inside it must not dismiss this parent.
      if (e.target.closest?.('.popover-panel')) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !style) return null;

  return createPortal(
    <div ref={panelRef} style={{ ...style, overflowY: 'auto' }} className="popover-panel">
      {children}
    </div>,
    document.body
  );
}
