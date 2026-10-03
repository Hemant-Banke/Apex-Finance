import { useEffect, useRef } from 'react';

const CELL = 3;            // dot lattice pitch (px); the lens snaps to it
const DOT = 2;             // lit dot size inside a cell
const LENS_R = 216;        // aperture radius, a multiple of CELL
const LERP = 0.12;

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];
const threshold = (cx, cy) => (BAYER[cy & 7][cx & 7] + 0.5) / 64;

const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const noise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x, y, oct = 4) => {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * noise(x * f, y * f); amp *= 0.5; f *= 2; }
  return sum;
};

const GREENS = ['#2f5d3e', '#3f7a4f', '#5c9a64', '#7cb87a'];
const BLOOMS = ['#e07a8b', '#a48ad8', '#ec9a6c', '#ead27e', '#7fb0e0', '#ece6d6', '#d86fb0'];
const GOLD = '#e2bf6e', NOTE = '#9ad8ae', NOTE_DEEP = '#2c5e40', CUT = '#0b0d10';

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const stem = (ctx, x0, y0, x1, y1, color, w) => {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.1, (y0 + y1) / 2, x1, y1);
  ctx.stroke();
};
const blob = (ctx, x, y, rx, ry, angle, color) => {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); ctx.fill();
};
const coin = (ctx, x, y, r) => {
  blob(ctx, x, y, r, r, 0, GOLD);
  ctx.strokeStyle = CUT; ctx.lineWidth = Math.max(3, r * 0.12);
  ctx.beginPath(); ctx.arc(x, y, r * 0.76, 0, Math.PI * 2); ctx.stroke();
  if (r < 14) return;
  ctx.fillStyle = CUT; ctx.font = `800 ${r * 1.1}px Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('₹', x, y + r * 0.08);
};
const note = (ctx, x, y, angle, s) => {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = NOTE; ctx.fillRect(0, -s * 0.27, s, s * 0.54);
  ctx.strokeStyle = CUT; ctx.lineWidth = 3;
  ctx.strokeRect(s * 0.1, -s * 0.15, s * 0.8, s * 0.3);
  ctx.fillStyle = NOTE_DEEP; ctx.font = `800 ${s * 0.3}px Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('₹', s * 0.5, s * 0.02);
  ctx.restore();
};

const PLANTS = {
  daisy(ctx, x, y, s, petal) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      blob(ctx, x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55, s * 0.42, s * 0.18, a, petal);
    }
    blob(ctx, x, y, s * 0.28, s * 0.28, 0, '#c98a4a');
  },
  tulip(ctx, x, y, s, c) {
    blob(ctx, x - s * 0.28, y, s * 0.3, s * 0.55, -0.25, c);
    blob(ctx, x + s * 0.28, y, s * 0.3, s * 0.55, 0.25, c);
    blob(ctx, x, y + s * 0.05, s * 0.3, s * 0.6, 0, c);
  },
  coin(ctx, x, y, s) { coin(ctx, x, y, Math.max(20, s)); },
  stack(ctx, x, y, s) {
    for (let k = 0; k < 4; k++) blob(ctx, x, y + k * 9, s * 0.8, s * 0.3, 0, k % 2 ? '#b8954f' : GOLD);
    coin(ctx, x, y - s * 0.55, s * 0.8);
  },
  lavender(ctx, x, y, s, c) {
    for (let k = 0; k < 9; k++) blob(ctx, x + (k % 2 ? 3 : -3), y + k * s * 0.22, s * 0.16, s * 0.12, 0, c);
  },
};
const KINDS = ['daisy', 'tulip', 'coin', 'daisy', 'lavender', 'stack', 'tulip', 'note', 'coin', 'lavender'];

// Draws the garden in CSS px; seeded, so it is the same on every load.
function drawGarden(ctx, W, H, growth, petals) {
  const R = rng(7);
  const pick = (list) => list[Math.floor(R() * list.length)];

  const row = (spacing, alpha, scale) => {
    ctx.globalAlpha = alpha;
    for (let x = spacing * R() * 0.5; x < W; x += spacing * (0.7 + R() * 0.6)) {
      const edge = Math.min(1, Math.abs(x / W - 0.5) * 2);
      const tall = H * (0.1 + 0.42 * Math.pow(edge, 1.4)) * (0.65 + R() * 0.55) * scale * growth;
      const lean = (R() - 0.5) * 40, tx = x + lean, ty = H - tall;
      const kind = pick(KINDS), green = GREENS[1 + Math.floor(R() * 3)];
      stem(ctx, x, H + 4, tx, ty, green, 3);
      for (let i = 0; i < 3; i++) {
        const k = (i + 1) / 4, side = i % 2 ? -1 : 1, lx = x + lean * k * k, ly = H - tall * k;
        if (kind === 'note') note(ctx, lx, ly, side > 0 ? -0.45 : Math.PI + 0.45, 52 * scale);
        else if (R() > 0.35) blob(ctx, lx + side * 12, ly, 14 * scale, 5 * scale, side * -0.6, green);
      }
      if (kind === 'note') note(ctx, tx - 26 * scale, ty, -0.12, 52 * scale);
      else PLANTS[kind](ctx, tx, ty, (22 + R() * 14) * scale, kind === 'lavender' ? pick(['#a48ad8', '#8b78c8']) : pick(BLOOMS));
    }
  };
  row(52, 0.5, 1.25);
  row(38, 1, 1);

  ctx.globalAlpha = 1;
  for (let x = 0; x < W; x += 3) {
    const edge = Math.min(1, Math.abs(x / W - 0.5) * 2);
    const h = (10 + R() * 26) * (0.7 + edge * 0.8);
    stem(ctx, x, H + 2, x + (R() - 0.5) * 14, H - h, GREENS[Math.floor(R() * 3)], 2);
  }
  for (let k = 0; k < 9; k++) coin(ctx, R() * W, H - 6 - R() * 8, 7 + R() * 4);

  if (petals) drawPetals(ctx, R, W, H * 0.7, 28, 0);
}

// Petals and the odd coin adrift; drawn again `repeat` px lower so a falling layer can loop.
function drawPetals(ctx, R, W, span, count, repeat, bold = false) {
  for (let k = 0; k < count; k++) {
    const x = R() * W, y = 12 + R() * (span - 24), alpha = bold ? 1 : 0.35 + R() * 0.4;
    const isCoin = R() > 0.75, r = 6 + R() * 4, angle = R() * Math.PI, color = BLOOMS[Math.floor(R() * BLOOMS.length)];
    ctx.globalAlpha = alpha;
    for (const dy of repeat ? [0, repeat] : [0]) {
      if (isCoin) coin(ctx, x, y + dy, bold ? r * 0.9 : r);
      else blob(ctx, x, y + dy, bold ? 8 : 6, bold ? 4 : 3, angle, color);
    }
  }
  ctx.globalAlpha = 1;
}

// Dots straight onto a full-size canvas: solid cells lit, half-tone cells (back row, petals)
// on a fixed half pattern, faint edges dark. `density` thins further on the same pattern.
function paint(canvas, data, cols, rows, density) {
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const px = img.data, stride = canvas.width * 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const j = (r * cols + c) * 4, a = data[j + 3] / 255, t = threshold(c, r);
      if (!((a >= 0.7 || (a > 0.3 && t < 0.5)) && density > t)) continue;
      for (let dy = 0; dy < DOT; dy++) {
        let i = (r * CELL + dy) * stride + c * CELL * 4;
        for (let dx = 0; dx < DOT; dx++, i += 4) {
          px[i] = data[j]; px[i + 1] = data[j + 1]; px[i + 2] = data[j + 2]; px[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// The aperture: dense at the pointer, thinning to an fbm-ragged edge, punched on the same lattice.
let lensMask = null;
function getLensMask() {
  if (lensMask) return lensMask;
  const size = LENS_R * 2, n = size / CELL;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dx = (c + 0.5) * CELL - LENS_R, dy = (r + 0.5) * CELL - LENS_R;
      const edge = LENS_R * (0.62 + 0.38 * fbm(dx * 0.011 + 5, dy * 0.011 + 5, 3));
      const f = 1 - Math.hypot(dx, dy) / edge;
      if (f > 0 && Math.pow(f, 0.7) > threshold(c, r)) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }
  lensMask = cv.toDataURL();
  return lensMask;
}

// Rendered once per size, no animation loop. `full` shows the whole garden at `vivid` with
// no lens (sign-in pages); otherwise it rests at `rest` and the cursor lens reveals it.
// `fall` adds the CSS-driven petal fall — on by default with `full`, opt-in under a lens.
export default function DitherField({ rest = 0.18, vivid = 0.9, full = false, fall: falling = full, growth = 1, style }) {
  const hostRef = useRef(null);
  const restRef = useRef(null);
  const vividRef = useRef(null);
  const fallRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer;
    const draw = () => {
      const W = host.offsetWidth, H = host.offsetHeight;
      if (!W || !H) return;
      const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
      const src = document.createElement('canvas');
      src.width = cols; src.height = rows;
      const ctx = src.getContext('2d');
      ctx.scale(1 / CELL, 1 / CELL);
      drawGarden(ctx, W, H, growth, !falling);
      const data = ctx.getImageData(0, 0, cols, rows).data;
      paint(restRef.current, data, cols, rows, full ? 1 : 0.5);
      if (vividRef.current) paint(vividRef.current, data, cols, rows, 1);

      // A separate petal layer, two identical bands tall, that CSS slides down
      // one whole cell per step — the dots never resample, so the fall cannot flicker.
      const fall = fallRef.current;
      if (fall) {
        const fsrc = document.createElement('canvas');
        fsrc.width = cols; fsrc.height = rows * 2;
        const fctx = fsrc.getContext('2d');
        fctx.scale(1 / CELL, 1 / CELL);
        drawPetals(fctx, rng(11), W, rows * CELL, Math.round((W * H) / 16000), rows * CELL, true);
        paint(fall, fctx.getImageData(0, 0, cols, rows * 2).data, cols, rows * 2, 1);
        fall.style.setProperty('--fall', `${rows * CELL}px`);
        fall.style.animation = reduce ? 'none' : `garden-fall ${Math.round(rows / 8)}s steps(${rows}) infinite`;
      }
    };
    draw();
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 200); });
    ro.observe(host);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, [full, falling, growth]);

  useEffect(() => {
    const host = hostRef.current, lens = vividRef.current;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (full || !lens || !fine || reduce) return;

    const mask = `url(${getLensMask()})`;
    lens.style.maskImage = lens.style.webkitMaskImage = mask;

    let tx = -9999, ty = -9999, lx = tx, ly = ty, frame = 0, armed = false;
    const snap = (v) => Math.round(v / CELL) * CELL;
    const render = () => {
      frame = 0;
      lx += (tx - lx) * LERP;
      ly += (ty - ly) * LERP;
      const settled = Math.abs(tx - lx) < 0.4 && Math.abs(ty - ly) < 0.4;
      if (settled) { lx = tx; ly = ty; }
      const pos = `${snap(lx) - LENS_R}px ${snap(ly) - LENS_R}px`;
      lens.style.maskPosition = lens.style.webkitMaskPosition = pos;
      if (!settled) frame = requestAnimationFrame(render);
    };
    const onMove = (e) => {
      if (e.pointerType === 'touch') return;
      const rect = host.getBoundingClientRect();
      tx = e.clientX - rect.left;
      ty = e.clientY - rect.top;
      if (!armed) { armed = true; lx = tx; ly = ty; lens.style.opacity = vivid; }
      if (!frame) frame = requestAnimationFrame(render);
    };
    const onLeave = () => { armed = false; lens.style.opacity = 0; };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [vivid, full]);

  const layer = { position: 'absolute', top: 0, left: 0 };
  return (
    <div ref={hostRef} aria-hidden="true"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', ...style }}>
      <canvas ref={restRef} style={{ ...layer, opacity: full ? vivid : rest }} />
      {falling && (
        <div className="garden-sway" style={{ ...layer, opacity: full ? vivid : Math.min(1, rest * 2.4) }}>
          <canvas ref={fallRef} style={{ display: 'block', willChange: 'transform' }} />
        </div>
      )}
      {!full && (
        <canvas ref={vividRef} style={{
          ...layer,
          opacity: 0,
          transition: 'opacity 0.5s ease',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskSize: `${LENS_R * 2}px ${LENS_R * 2}px`,
          WebkitMaskSize: `${LENS_R * 2}px ${LENS_R * 2}px`,
          maskPosition: '-9999px -9999px',
          WebkitMaskPosition: '-9999px -9999px',
        }} />
      )}
    </div>
  );
}
