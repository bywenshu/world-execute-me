// Inspect particle statistics at a given time: node export/probe.mjs 52.5
import { openMV } from './browser.mjs';

const t = Number(process.argv[2] ?? 0);
const mv = await openMV({ width: 640, height: 360 });
const out = await mv.page.evaluate((t) => {
  const { ps, director } = window.__mv.debug;
  window.__mv.renderFrame(t, 1 / 60);
  const f = director.frame(t);
  const n = ps.pos.length / 3;
  const st = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], alpha: 0, nan: 0 };
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = ps.pos[i * 3 + a];
      if (!Number.isFinite(v)) st.nan++;
      st.min[a] = Math.min(st.min[a], v); st.max[a] = Math.max(st.max[a], v);
    }
    st.alpha += ps.col[i * 4 + 3];
  }
  st.alpha /= n;
  const k = ps.cueIndex(t);
  return { cue: ps.cues[k], st, cam: f.camera, sizeAvg: ps.size.reduce((a, b) => a + b, 0) / n };
}, t);
console.log(JSON.stringify(out, null, 1));
await mv.close();
