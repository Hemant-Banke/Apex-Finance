import { useEffect, useRef } from 'react';

const STEP   = 16;   // grid pitch
const MAX    = 7;    // max square size (gap = 16 - 7 = 9 px — subtle)

const R = 45, G = 212, B = 191;

// Module-level shared period — all CubeGrid instances use this so their
// animation phase is always identical (rAF passes performance.now() which
// is a global clock, so (now % GRID_PERIOD) is the same for every instance
// at any point in time, preserving visual continuity across page mounts).
export const GRID_PERIOD = 9000;

export default function CubeGrid({ style, period = GRID_PERIOD }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setSize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(canvas);

    const ctx = canvas.getContext('2d');
    let animId;

    const render = (now) => {
      const cW = canvas.width, cH = canvas.height;
      if (!cW || !cH) { animId = requestAnimationFrame(render); return; }
      ctx.clearRect(0, 0, cW, cH);

      // ── Permanent background sheen: diagonal gradient, strongest top-left ──
      const bg = ctx.createLinearGradient(0, 0, cW * 0.75, cH * 0.55);
      bg.addColorStop(0.0, `rgba(${R},${G},${B},0.042)`);
      bg.addColorStop(0.5, `rgba(${R},${G},${B},0.010)`);
      bg.addColorStop(1.0, `rgba(${R},${G},${B},0.000)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cW, cH);

      // ── Wave squares ──────────────────────────────────────────────────────
      const slope   = 0.35;
      const maxProj = cW + cH * slope;
      const s0      = -maxProj * 0.12;
      const sr      =  maxProj * 1.25;
      const awBase  = 0.5;              // animation window at full strength
      const cf      = (now % period) / period;

      const cols = Math.ceil(cW / STEP) + 2;
      const rows = Math.ceil(cH / STEP) + 2;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = col * STEP + STEP / 2;
          const cy = row * STEP + STEP / 2;

          // Position-based strength — elliptical falloff from top-left origin.
          // Y has more weight (dominant top-to-bottom fade),
          // X adds secondary right-side fade ("moves forward right → weaker").
          const yR = cy / cH;
          const xR = cx / cW;
          const strength = Math.max(0, 1 - Math.sqrt(yR * yR * 0.5 + xR * xR * 0.1));
          if (strength < 0.02) continue;

          // Band width scales with strength — wide at top, thin at bottom
          const aw = awBase * (0.10 + 0.90 * Math.max(0, 1 - yR * 0.5));

          const proj = cx + cy * slope;
          const hf   = (proj - s0) / sr;
          let   ps   = cf - hf;
          if (ps < 0) ps += 1;
          if (ps >= aw) continue;

          const lp   = ps / aw;
          const arch = Math.sin(Math.PI * lp);

          // Tiny per-square brightness seed for grain texture
          const seed  = (row * 31 + col * 17) & 0xff;
          const bMult = 0.80 + 0.20 * (seed / 255);

          const size  = MAX  * arch * strength;
          const alpha = 0.42 * arch * strength * bMult;

          if (size < 0.4) continue;

          ctx.fillStyle = `rgba(${R},${G},${B},${alpha})`;
          ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, [period]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity: 0.9,
        ...style,
      }}
    />
  );
}
