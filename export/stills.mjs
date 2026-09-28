// Render still frames at given times (with a short warm-up so trails are realistic).
// usage: node export/stills.mjs 14.95 31.5 60   (or no args for a default contact sheet)
import fs from 'node:fs';
import path from 'node:path';
import { openMV } from './browser.mjs';

const OUT = path.resolve('out/stills');
fs.mkdirSync(OUT, { recursive: true });
const width = Number(process.env.W || 1280), height = Math.round((width * 9) / 16);
const times = process.argv.slice(2).map(Number);
const mv = await openMV({ width, height });
console.log('GPU:', mv.gpu);
const list = times.length ? times : [1.2, 4.6, 9.5, 12, 15.4, 20, 24, 30.5, 32.5, 34.4, 36, 39.5, 41.5, 43.5];
const fps = 30, warm = 0.6;
const t0 = Date.now();
for (const t of list) {
  for (let k = Math.ceil(warm * fps); k >= 0; k--) {
    const tt = Math.max(0, t - k / fps);
    await mv.page.evaluate(([x, dt]) => window.__mv.renderFrame(x, dt), [tt, 1 / fps]);
  }
  const url = await mv.page.evaluate(() => window.__mv.capture('image/jpeg', 0.9));
  const file = path.join(OUT, `t${t.toFixed(2).padStart(7, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', file);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await mv.close();
