import { useEffect, useRef } from 'react';
import { CELL, paintTone } from '../../lib/dither';

// Resolves a CSS colour (tokens included) to the rgb() the canvas needs.
function resolveColour(el, colour) {
  el.style.color = colour;
  return getComputedStyle(el).color;
}

/**
 * An account card's face in ordered dots: a wash of the type's colour rising from the
 * lower-right corner, and the balance's last ~90 days as dithered terrain along the foot —
 * dense at its ridge, thinning to nothing beneath. Drawn once per size; no animation.
 */
export default function CardDither({ tone, values = [] }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const key = values.join(',');

  useEffect(() => {
    const host = hostRef.current;
    let timer;
    const draw = () => {
      const W = host.offsetWidth, H = host.offsetHeight;
      if (!W || !H) return;
      const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
      const src = document.createElement('canvas');
      src.width = cols; src.height = rows;
      const ctx = src.getContext('2d');
      const colour = resolveColour(host, tone);
      ctx.scale(1 / CELL, 1 / CELL);

      const wash = ctx.createRadialGradient(W * 1.05, H * 1.1, 0, W * 1.05, H * 1.1, Math.hypot(W, H) * 0.85);
      wash.addColorStop(0, colour);
      wash.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);

      if (values.length > 1) {
        const min = Math.min(...values), span = (Math.max(...values) - min) || 1;
        const top = H * 0.52, base = H * 0.86;
        const pts = values.map((v, i) => [(i / (values.length - 1)) * W, base - ((v - min) / span) * (base - top)]);
        const terrain = ctx.createLinearGradient(0, top, 0, H);
        terrain.addColorStop(0, colour);
        terrain.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = terrain;
        ctx.beginPath();
        ctx.moveTo(0, H);
        pts.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colour;
        ctx.lineWidth = CELL * 1.2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }

      paintTone(canvasRef.current, ctx.getImageData(0, 0, cols, rows).data, cols, rows);
    };
    draw();
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 150); });
    ro.observe(host);
    return () => { clearTimeout(timer); ro.disconnect(); };
    // `key` stands in for `values`, which is a fresh array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, key]);

  return (
    <div ref={hostRef} className="account-card-dither" aria-hidden>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />
    </div>
  );
}
