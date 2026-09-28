// Render the MV frame-by-frame (deterministic, not real-time) and mux it with the song.
// usage: node export/export.mjs [--fps 60] [--w 1920] [--from 0] [--to <end>] [--crf 16] [--out out/file.mp4]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openMV } from './browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const fps = Number(arg('fps', 60));
const width = Number(arg('w', 1920)), height = Math.round((width * 9) / 16);
const crf = arg('crf', '16');
const preset = arg('preset', 'slow');
const quality = Number(arg('q', 0.95));
const SONG = path.resolve('world.execute(me); - Mili.mp3');
const out = path.resolve(arg('out', 'out/world.execute(me).mp4'));
fs.mkdirSync(path.dirname(out), { recursive: true });

const mv = await openMV({ width, height });
console.log('GPU:', mv.gpu);
const from = Number(arg('from', 0));
const to = Math.min(Number(arg('to', mv.duration)), mv.duration);
const f0 = Math.round(from * fps), f1 = Math.ceil(to * fps);
const total = f1 - f0;
console.log(`${width}x${height} @ ${fps}fps, frames ${f0}..${f1} (${total}), -> ${out}`);

const grain = Number(arg('grain', 1));
if (grain !== 1) await mv.page.evaluate((g) => { for (const r of window.__mv.debug.director.lookTrack.resolved) r.grain *= g; }, grain);

// Trails need history: run a short warm-up before the first exported frame.
const warm = Math.min(f0, Math.round(fps * 1.5));
for (let i = f0 - warm; i < f0; i++) await mv.page.evaluate(([t, dt]) => window.__mv.renderFrame(t, dt), [i / fps, 1 / fps]);

const ff = spawn('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
  '-ss', String(f0 / fps), '-t', String(total / fps), '-i', SONG,
  '-map', '0:v:0', '-map', '1:a:0',
  '-vf', 'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
  '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high',
  '-x264-params', `keyint=${fps * 2}:min-keyint=${fps}`,
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '320k',
  '-movflags', '+faststart', '-shortest',
  out,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));
const BATCH = 6;
const batch = (i) => mv.page.evaluate(([i0, n, fps, q]) => window.__mv.renderBatch(i0, n, fps, q), [i, Math.min(BATCH, f1 - i), fps, quality]);

const t0 = Date.now();
let done = 0, lastLog = 0;
let pending = batch(f0);
for (let i = f0; i < f1; i += BATCH) {
  const frames = await pending;
  if (i + BATCH < f1) pending = batch(i + BATCH);
  for (const b64 of frames) await write(Buffer.from(b64, 'base64'));
  done += frames.length;
  const now = Date.now();
  if (now - lastLog > 3000 || done === total) {
    lastLog = now;
    const el = (now - t0) / 1000, rate = done / el;
    process.stdout.write(`\r${done}/${total} frames  ${(100 * done / total).toFixed(1)}%  ${rate.toFixed(1)} fps  eta ${((total - done) / rate).toFixed(0)}s   `);
  }
}
ff.stdin.end();
await ffDone;
await mv.close();
const st = fs.statSync(out);
console.log(`\nwrote ${out} (${(st.size / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
