// Ordered (Bayer 8×8) dithering on a 3px lattice — shared by the money garden and the account cards.
export const CELL = 3;   // dot lattice pitch (px)
export const DOT = 2;    // lit dot size inside a cell

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];
export const threshold = (cx, cy) => (BAYER[cy & 7][cx & 7] + 0.5) / 64;

function blit(canvas, cols, rows, lit) {
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const px = img.data, stride = canvas.width * 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rgb = lit(c, r);
      if (!rgb) continue;
      for (let dy = 0; dy < DOT; dy++) {
        let i = (r * CELL + dy) * stride + c * CELL * 4;
        for (let dx = 0; dx < DOT; dx++, i += 4) {
          px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Garden rule: solid cells lit, half-tone cells (0.3–0.7 alpha) on a fixed half pattern; `density` thins further.
export function paintDots(canvas, data, cols, rows, density) {
  blit(canvas, cols, rows, (c, r) => {
    const j = (r * cols + c) * 4, a = data[j + 3] / 255, t = threshold(c, r);
    return (a >= 0.7 || (a > 0.3 && t < 0.5)) && density > t ? [data[j], data[j + 1], data[j + 2]] : null;
  });
}

// Tonal rule: a cell is lit when its alpha beats the Bayer threshold, so alpha reads as dot density.
export function paintTone(canvas, data, cols, rows) {
  blit(canvas, cols, rows, (c, r) => {
    const j = (r * cols + c) * 4;
    return data[j + 3] / 255 > threshold(c, r) ? [data[j], data[j + 1], data[j + 2]] : null;
  });
}
