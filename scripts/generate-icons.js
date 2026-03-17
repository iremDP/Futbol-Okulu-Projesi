/**
 * PWA ikonları oluşturur - mor gradient daire
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const SIZES = [192, 512];
const THEME = { r: 102, g: 126, b: 234 }; // #667eea

function createIcon(size) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.45;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (size * y + x) << 2;

      if (dist <= r) {
        const t = dist / r;
        const r2 = Math.round(THEME.r + (118 - THEME.r) * t);
        const g2 = Math.round(THEME.g + (75 - THEME.g) * t);
        const b2 = Math.round(THEME.b + (162 - THEME.b) * t);
        png.data[idx] = r2;
        png.data[idx + 1] = g2;
        png.data[idx + 2] = b2;
        png.data[idx + 3] = 255;
      } else {
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 0;
      }
    }
  }

  return png;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  for (const s of SIZES) {
    const png = createIcon(s);
    const outPath = path.join(OUT_DIR, `icon-${s}.png`);
    await new Promise((res, rej) => {
      png.pack()
        .pipe(fs.createWriteStream(outPath))
        .on('finish', res)
        .on('error', rej);
    });
    console.log('Created:', outPath);
  }
})();
