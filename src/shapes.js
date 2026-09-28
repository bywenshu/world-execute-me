// Particle target shapes. Every shape fills N positions (xyz) and colours (rgba).
//  space 'world'  : coordinates in world space around the origin
//  space 'screen' : coordinates in camera-aligned space (x right, y up, z toward viewer)
// Static shapes are built once; dynamic ones are evaluated per frame from local time `lt`.
import { TAU, rng, hash, clamp, lerp, ease, fract, smoothstep } from './util.js';

export const N = 16384;
const PHI = (1 + Math.sqrt(5)) / 2;

export const COL = {
  ink: [0.9, 0.95, 1.0],
  cyan: [0.3, 0.88, 1.0],
  ice: [0.6, 0.84, 1.0],
  violet: [0.55, 0.4, 1.0],
  pink: [1.0, 0.34, 0.62],
  gold: [1.0, 0.74, 0.34],
  red: [1.0, 0.13, 0.18],
  green: [0.4, 1.0, 0.55],
  orange: [1.0, 0.55, 0.2],
  steel: [0.5, 0.58, 0.72],
};

// ---------------------------------------------------------------- per-particle randoms
const R0 = rng(20160615);
export const U0 = new Float32Array(N), U1 = new Float32Array(N), U2 = new Float32Array(N), U3 = new Float32Array(N);
export const G0 = new Float32Array(N), G1 = new Float32Array(N), G2 = new Float32Array(N);
export const DIR = new Float32Array(N * 3); // random unit vectors
export const FIB = new Float32Array(N * 3); // fibonacci sphere directions (index-ordered)
const gauss = (R) => {
  const u = Math.max(1e-9, R()), v = R();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
};
for (let i = 0; i < N; i++) {
  U0[i] = R0(); U1[i] = R0(); U2[i] = R0(); U3[i] = R0();
  G0[i] = gauss(R0); G1[i] = gauss(R0); G2[i] = gauss(R0);
  const z = R0() * 2 - 1, a = R0() * TAU, r = Math.sqrt(1 - z * z);
  DIR[i * 3] = r * Math.cos(a); DIR[i * 3 + 1] = z; DIR[i * 3 + 2] = r * Math.sin(a);
  const y = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - y * y), th = i * TAU / PHI / PHI;
  FIB[i * 3] = rr * Math.cos(th); FIB[i * 3 + 1] = y; FIB[i * 3 + 2] = rr * Math.sin(th);
}

// ---------------------------------------------------------------- helpers
const setP = (P, i, x, y, z) => { const k = i * 3; P[k] = x; P[k + 1] = y; P[k + 2] = z; };
const setC = (C, i, c, a = 1, b = 1) => { const k = i * 4; C[k] = c[0] * b; C[k + 1] = c[1] * b; C[k + 2] = c[2] * b; C[k + 3] = a; };
const mixC = (C, i, c1, c2, t, a = 1, b = 1) => {
  const k = i * 4;
  C[k] = lerp(c1[0], c2[0], t) * b; C[k + 1] = lerp(c1[1], c2[1], t) * b; C[k + 2] = lerp(c1[2], c2[2], t) * b; C[k + 3] = a;
};
const alloc = () => ({ P: new Float32Array(N * 3), C: new Float32Array(N * 4) });

function sortByX({ P, C }) {
  const idx = new Uint32Array(N).map((_, i) => i);
  idx.sort((a, b) => P[a * 3] - P[b * 3]);
  const P2 = new Float32Array(N * 3), C2 = new Float32Array(N * 4);
  for (let j = 0; j < N; j++) {
    const i = idx[j];
    P2.set(P.subarray(i * 3, i * 3 + 3), j * 3);
    C2.set(C.subarray(i * 4, i * 4 + 4), j * 4);
  }
  return { P: P2, C: C2 };
}

function edgesOf(verts) {
  let min = Infinity;
  for (let a = 0; a < verts.length; a++)
    for (let b = a + 1; b < verts.length; b++) min = Math.min(min, dist3(verts[a], verts[b]));
  const e = [];
  for (let a = 0; a < verts.length; a++)
    for (let b = a + 1; b < verts.length; b++) if (dist3(verts[a], verts[b]) < min * 1.01) e.push([a, b]);
  return e;
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function cubeVerts(h) {
  const v = [];
  for (let i = 0; i < 8; i++) v.push([i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h]);
  return v;
}
const CUBE_EDGES = edgesOf(cubeVerts(1));

/** Point i (with random u) on one of the given edges. */
function onEdges(verts, edges, i, u, thick = 0.006) {
  const e = edges[i % edges.length], a = verts[e[0]], b = verts[e[1]];
  return [
    lerp(a[0], b[0], u) + G0[i] * thick,
    lerp(a[1], b[1], u) + G1[i] * thick,
    lerp(a[2], b[2], u) + G2[i] * thick,
  ];
}

function polyShape(verts, scale, cA, cB) {
  const s = alloc(), edges = edgesOf(verts);
  for (let i = 0; i < N; i++) {
    if (U1[i] < 0.18) {
      const v = verts[i % verts.length];
      setP(s.P, i, v[0] * scale + G0[i] * 0.025, v[1] * scale + G1[i] * 0.025, v[2] * scale + G2[i] * 0.025);
      setC(s.C, i, COL.ink, 0.5, 0.9);
    } else {
      const p = onEdges(verts, edges, i, U0[i], 0.012);
      setP(s.P, i, p[0] * scale, p[1] * scale, p[2] * scale);
      mixC(s.C, i, cA, cB, U0[i], 0.85, 0.8);
    }
  }
  return s;
}

/** Parametric surface with a wireframe bias (iso-lines in u and v). */
function surfaceShape(fn, cA, cB, { gu = 32, gv = 12, wire = 0.6, scale = 1 } = {}) {
  const s = alloc();
  for (let i = 0; i < N; i++) {
    let u = U0[i], v = U1[i];
    const k = U2[i];
    let a = 0.35, b = 0.55;
    if (k < wire * 0.5) { u = Math.round(u * gu) / gu; a = 0.8; b = 0.9; }
    else if (k < wire) { v = Math.round(v * gv) / gv; a = 0.8; b = 0.9; }
    const p = fn(u, v);
    setP(s.P, i, p[0] * scale, p[1] * scale, p[2] * scale);
    mixC(s.C, i, cA, cB, v, a, b);
  }
  return s;
}

// Taubin heart, z-up in its own frame.
const heartF = (x, y, z) => {
  const a = x * x + 2.25 * y * y + z * z - 1;
  return a * a * a - x * x * z * z * z - 0.1125 * y * y * z * z * z;
};

// ---------------------------------------------------------------- canvas sampling
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function chamfer(mask, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 1e6 : 0;
  const D = Math.SQRT2;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], d[i - 1] + 1, d[i - w] + 1, d[i - w - 1] + D, d[i - w + 1] + D);
    }
  for (let y = h - 2; y > 0; y--)
    for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], d[i + 1] + 1, d[i + w] + 1, d[i + w + 1] + D, d[i + w - 1] + D);
    }
  return d;
}

/**
 * Rasterise a drawing and turn its visible pixels into N points with colours.
 * Depth comes from a distance transform so flat artwork gets a soft, inflated body.
 */
function sampleArt(draw, { w = 512, h = 512, scale = 1, depth = 0.3, seed = 3, cy = 0.1, gain = 1, alpha = 0.8, minLum = 0.05, lift = 0.5 } = {}) {
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  draw(ctx, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  const cand = [];
  for (let p = 0; p < w * h; p++) {
    const a = img[p * 4 + 3];
    if (a < 110) continue;
    const lum = (img[p * 4] * 0.3 + img[p * 4 + 1] * 0.55 + img[p * 4 + 2] * 0.15) / 255;
    mask[p] = 1;
    if (lum > minLum) cand.push(p);
  }
  const dist = chamfer(mask, w, h);
  let maxD = 1;
  for (const p of cand) maxD = Math.max(maxD, dist[p]);
  const R = rng(seed), s = alloc(), half = h / 2;
  for (let i = 0; i < N; i++) {
    const p = cand[Math.floor(R() * cand.length)] ?? 0;
    const px = (p % w) + R(), py = Math.floor(p / w) + R();
    const d = dist[p] / maxD;
    const z = (R() < 0.5 ? -1 : 1) * Math.sqrt(d) * depth;
    setP(s.P, i, ((px - w / 2) / half) * scale, (-(py - half) / half) * scale + cy, z * scale);
    const k = p * 4;
    const lum = (img[k] * 0.3 + img[k + 1] * 0.55 + img[k + 2] * 0.15) / 255;
    const edge = (1 + 0.5 * Math.exp(-dist[p] * 0.6)) * clamp(lift / Math.max(lum, 0.02), 1, 3.2);
    s.C[i * 4] = (img[k] / 255) * gain * edge;
    s.C[i * 4 + 1] = (img[k + 1] / 255) * gain * edge;
    s.C[i * 4 + 2] = (img[k + 2] / 255) * gain * edge;
    s.C[i * 4 + 3] = alpha;
  }
  return sortByX(s);
}

const FONT = '"JetBrains Mono", Menlo, monospace';
function textArt(txt, { size = 380, w = 512, h = 512, scale = 1, color = '#fff', depth = 0.18, weight = 800, font = FONT, cy = 0.1, gain = 0.8 } = {}) {
  return sampleArt((ctx) => {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillText(txt, w / 2, h / 2 + size * 0.04);
  }, { w, h, scale, depth, cy, gain });
}

// ---- original illustrations -----------------------------------------------------------
function drawEggplant(ctx) {
  ctx.save();
  ctx.translate(262, 272);
  ctx.rotate(-0.6);
  const body = new Path2D();
  body.moveTo(0, -178);
  body.bezierCurveTo(52, -178, 66, -96, 92, -14);
  body.bezierCurveTo(128, 92, 88, 186, 0, 190);
  body.bezierCurveTo(-88, 186, -128, 92, -92, -14);
  body.bezierCurveTo(-66, -96, -52, -178, 0, -178);
  const g = ctx.createRadialGradient(-38, 40, 10, 0, 40, 200);
  g.addColorStop(0, '#c38cf0');
  g.addColorStop(0.45, '#7a3cb8');
  g.addColorStop(1, '#3d1766');
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.strokeStyle = 'rgba(235,210,255,0.75)';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-58, -20);
  ctx.bezierCurveTo(-82, 50, -70, 110, -40, 148);
  ctx.stroke();
  // calyx
  ctx.fillStyle = '#5fcf57';
  ctx.beginPath();
  ctx.ellipse(0, -160, 62, 30, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#48b04a';
  for (const x of [-52, -18, 18, 52]) {
    ctx.beginPath();
    ctx.moveTo(x - 20, -160);
    ctx.lineTo(x * 1.1, -100 + Math.abs(x) * 0.35);
    ctx.lineTo(x + 20, -160);
    ctx.fill();
  }
  ctx.strokeStyle = '#6fbf4a';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(0, -175);
  ctx.quadraticCurveTo(-4, -215, -30, -238);
  ctx.stroke();
  ctx.restore();
}

function drawTomato(ctx) {
  const g = ctx.createRadialGradient(196, 236, 12, 256, 292, 190);
  g.addColorStop(0, '#ff9a7a');
  g.addColorStop(0.35, '#f0412c');
  g.addColorStop(1, '#9a1414');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(256, 292, 178, 156, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,10,10,0.55)';
  ctx.lineWidth = 8;
  for (const k of [-1, -0.4, 0.4, 1]) {
    ctx.beginPath();
    ctx.moveTo(256 + k * 18, 160);
    ctx.quadraticCurveTo(256 + k * 150, 250, 256 + k * 60, 440);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,225,210,0.8)';
  ctx.beginPath();
  ctx.ellipse(180, 230, 34, 20, -0.6, 0, TAU);
  ctx.fill();
  // star calyx
  ctx.fillStyle = '#43b64d';
  ctx.beginPath();
  for (let k = 0; k < 12; k++) {
    const a = -Math.PI / 2 + (k * TAU) / 12;
    const r = k % 2 ? 22 : 92;
    const x = 256 + Math.cos(a) * r, y = 150 + Math.sin(a) * r * 0.45;
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2f8a3a';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(256, 150);
  ctx.quadraticCurveTo(258, 118, 274, 100);
  ctx.stroke();
}

function drawCat(ctx) {
  const fur = '#f39a3d', dark = '#a8560f', cream = '#ffe0b0';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // tail
  const tail = new Path2D();
  tail.moveTo(372, 458);
  tail.bezierCurveTo(470, 450, 480, 360, 440, 300);
  ctx.strokeStyle = fur;
  ctx.lineWidth = 36;
  ctx.stroke(tail);
  ctx.strokeStyle = dark;
  ctx.setLineDash([20, 30]);
  ctx.stroke(tail);
  ctx.setLineDash([]);
  // body
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.moveTo(196, 250);
  ctx.bezierCurveTo(150, 300, 100, 420, 130, 470);
  ctx.lineTo(382, 470);
  ctx.bezierCurveTo(412, 420, 362, 300, 316, 250);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.ellipse(256, 372, 56, 90, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 13;
  for (let k = 0; k < 4; k++) {
    const y = 300 + k * 40;
    ctx.beginPath(); ctx.moveTo(138 + k * 4, y + 18); ctx.quadraticCurveTo(160, y, 186, y + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(374 - k * 4, y + 18); ctx.quadraticCurveTo(352, y, 326, y + 4); ctx.stroke();
  }
  // paws
  ctx.fillStyle = '#ffd39a';
  for (const x of [212, 300]) {
    ctx.beginPath(); ctx.ellipse(x, 464, 40, 22, 0, 0, TAU); ctx.fill();
  }
  // ears
  ctx.fillStyle = fur;
  ctx.beginPath(); ctx.moveTo(150, 150); ctx.lineTo(150, 42); ctx.lineTo(232, 104); ctx.fill();
  ctx.beginPath(); ctx.moveTo(362, 150); ctx.lineTo(362, 42); ctx.lineTo(280, 104); ctx.fill();
  ctx.fillStyle = '#ffa9a0';
  ctx.beginPath(); ctx.moveTo(166, 128); ctx.lineTo(166, 74); ctx.lineTo(210, 108); ctx.fill();
  ctx.beginPath(); ctx.moveTo(346, 128); ctx.lineTo(346, 74); ctx.lineTo(302, 108); ctx.fill();
  // head
  ctx.fillStyle = fur;
  ctx.beginPath(); ctx.ellipse(256, 186, 120, 100, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 10;
  for (const [x0, x1] of [[234, 238], [256, 256], [278, 274]]) {
    ctx.beginPath(); ctx.moveTo(x0, 106); ctx.lineTo(x1, 146); ctx.stroke();
  }
  for (const s of [-1, 1]) {
    for (const dy of [0, 26]) {
      ctx.beginPath(); ctx.moveTo(256 + s * 118, 186 + dy); ctx.lineTo(256 + s * 84, 192 + dy); ctx.stroke();
    }
  }
  ctx.fillStyle = cream;
  ctx.beginPath(); ctx.ellipse(256, 232, 50, 32, 0, 0, TAU); ctx.fill();
  // eyes
  ctx.fillStyle = '#c4f76a';
  for (const x of [212, 300]) { ctx.beginPath(); ctx.ellipse(x, 184, 25, 18, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#000';
  for (const x of [212, 300]) { ctx.beginPath(); ctx.ellipse(x, 184, 6, 15, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#ff8b9c';
  ctx.beginPath(); ctx.moveTo(244, 214); ctx.lineTo(268, 214); ctx.lineTo(256, 228); ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(256, 228); ctx.quadraticCurveTo(248, 244, 234, 238); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(256, 228); ctx.quadraticCurveTo(264, 244, 278, 238); ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  for (const s of [-1, 1])
    for (const dy of [-8, 4, 16]) {
      ctx.beginPath(); ctx.moveTo(256 + s * 58, 228 + dy * 0.3); ctx.lineTo(256 + s * 150, 214 + dy * 1.6); ctx.stroke();
    }
}

function drawExists(ctx) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(330, 104, 44, 304);
  ctx.fillRect(140, 104, 234, 44);
  ctx.fillRect(170, 234, 204, 42);
  ctx.fillRect(140, 364, 234, 44);
}

function drawVenus(ctx) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 36;
  ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.arc(256, 196, 108, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(256, 304); ctx.lineTo(256, 470); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(186, 400); ctx.lineTo(326, 400); ctx.stroke();
}

function drawMars(ctx) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 36;
  ctx.beginPath(); ctx.arc(218, 300, 108, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(296, 222); ctx.lineTo(420, 98); ctx.stroke();
  ctx.lineCap = 'square';
  ctx.beginPath(); ctx.moveTo(330, 90); ctx.lineTo(428, 90); ctx.lineTo(428, 188); ctx.stroke();
}

function drawPlay(ctx) {
  ctx.strokeStyle = '#7fe8ff';
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.arc(256, 256, 210, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(196, 140); ctx.lineTo(372, 256); ctx.lineTo(196, 372); ctx.closePath(); ctx.fill();
}

// ---------------------------------------------------------------- tesseract
const TESS_EDGE_BITS = [0, 1, 2, 3];
function tessVert(v, a, b, out) {
  const x = v & 1 ? 1 : -1, y = v & 2 ? 1 : -1, z = v & 4 ? 1 : -1, w = v & 8 ? 1 : -1;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const x1 = x * ca - w * sa, w1 = x * sa + w * ca;
  const y1 = y * cb - w1 * sb, w2 = y * sb + w1 * cb;
  const k = (0.62 * 3) / (3 - w2);
  out[0] = x1 * k; out[1] = y1 * k; out[2] = z * k; out[3] = w2;
  return out;
}

// ---------------------------------------------------------------- chladni
const CHLADNI_MODES = [[1, 2], [2, 3], [1, 4], [3, 4], [2, 5], [1, 6], [3, 5], [4, 5], [2, 7], [3, 7]];
function chladni(m, n, seed) {
  const R = rng(seed), s = alloc();
  const f = (x, y) => Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) - Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y);
  let i = 0;
  while (i < N) {
    const x = R(), y = R();
    if (i < N * 0.06) {
      // plate rim
      const e = Math.floor(R() * 4), u = R() * 2 - 1;
      const px = e < 2 ? u : e === 2 ? -1 : 1, py = e < 2 ? (e ? 1 : -1) : u;
      setP(s.P, i, px * 1.2, py * 1.2 + 0.1, 0);
      setC(s.C, i, COL.steel, 0.35, 0.8);
      i++;
      continue;
    }
    const v = Math.abs(f(x, y));
    if (v > 0.07) continue;
    const t = 1 - v / 0.07;
    setP(s.P, i, (x * 2 - 1) * 1.2, (y * 2 - 1) * 1.2 + 0.1, (R() - 0.5) * 0.04);
    mixC(s.C, i, COL.gold, COL.ink, t * t, 0.75, 0.85);
    i++;
  }
  return sortByX(s);
}

// ---------------------------------------------------------------- fragments layout (bridge)
const FR_COLS = 11, FR_ROWS = 5, FR_N = FR_COLS * FR_ROWS, FR_KEEP = 11;
const FR_RANK = (() => {
  const order = Array.from({ length: FR_N }, (_, b) => b).sort((a, b) => hash(a + 77) - hash(b + 77));
  const rank = new Int32Array(FR_N);
  order.forEach((b, r) => (rank[b] = r));
  return rank;
})();
export const fragDeleteAt = (b) => (FR_RANK[b] < FR_N - FR_KEEP ? 0.35 + (FR_RANK[b] / (FR_N - FR_KEEP)) * 2.3 : Infinity);
export const FR_PITCH = 0.33;
function fragBase(i, out) {
  const b = i % FR_N, c = b % FR_COLS, r = Math.floor(b / FR_COLS);
  const gx = Math.floor(U0[i] * 8), gy = Math.floor(U1[i] * 8);
  out[0] = 0.12 + (c - 5) * FR_PITCH + ((gx + 0.5) / 8 - 0.5) * 0.27 + G0[i] * 0.004;
  out[1] = 0.2 + (r - 2) * FR_PITCH + ((gy + 0.5) / 8 - 0.5) * 0.27 + G1[i] * 0.004;
  out[2] = G2[i] * 0.01;
  return b;
}

// ---------------------------------------------------------------- neural net layout
const NN_LAYERS = [4, 6, 6, 4, 1];
const NN_NODES = [];
NN_LAYERS.forEach((n, l) => {
  for (let k = 0; k < n; k++) NN_NODES.push({ l, x: -2.2 + l * 1.1, y: 0.15 + (k - (n - 1) / 2) * 0.44 });
});
const NN_EDGES = [];
for (let a = 0; a < NN_NODES.length; a++)
  for (let b = 0; b < NN_NODES.length; b++) if (NN_NODES[b].l === NN_NODES[a].l + 1) NN_EDGES.push([a, b]);
export const NEURAL = { nodes: NN_NODES, edges: NN_EDGES };

export const clockHours = (lt) => 9 + lt * 3.4;

// ---------------------------------------------------------------- registry
export const SHAPES = {};
const def = (name, spec) => (SHAPES[name] = { space: 'world', ...spec });

def('cloud', {
  build() {
    const s = alloc();
    for (let i = 0; i < N; i++) {
      const r = 2.6 * Math.cbrt(U0[i]);
      setP(s.P, i, DIR[i * 3] * r, DIR[i * 3 + 1] * r, DIR[i * 3 + 2] * r);
      mixC(s.C, i, COL.ink, COL.cyan, U1[i], 0.55, 0.45);
    }
    return s;
  },
});

def('powerLine', {
  space: 'screen',
  build() {
    const s = alloc();
    for (let i = 0; i < N; i++) {
      setP(s.P, i, (U0[i] * 2 - 1) * 2.9, 0.1 + G0[i] * 0.004, G1[i] * 0.01);
      mixC(s.C, i, COL.cyan, COL.ink, Math.exp(-Math.abs(U0[i] * 2 - 1) * 4), 0.7, 0.8);
    }
    return sortByX(s);
  },
});

def('shield', {
  xf: { spin: 0.25, tilt: 0.3 },
  build() {
    const t = PHI;
    let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => (c / l) * 1.25); };
    verts = verts.map(norm);
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!cache.has(key)) {
        verts.push(norm(verts[a].map((c, k) => (c + verts[b][k]) / 2)));
        cache.set(key, verts.length - 1);
      }
      return cache.get(key);
    };
    const f2 = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      f2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = f2;
    const es = new Set(), edges = [];
    for (const [a, b, c] of faces)
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const k = p < q ? `${p}_${q}` : `${q}_${p}`;
        if (!es.has(k)) { es.add(k); edges.push([p, q]); }
      }
    const s = alloc();
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.68) {
        const p = onEdges(verts, edges, i, U0[i], 0.004);
        const l = Math.hypot(...p) / 1.25;
        setP(s.P, i, p[0] / l, p[1] / l, p[2] / l);
        setC(s.C, i, COL.ice, 0.8, 0.85);
      } else {
        setP(s.P, i, DIR[i * 3] * 1.25, DIR[i * 3 + 1] * 1.25, DIR[i * 3 + 2] * 1.25);
        setC(s.C, i, COL.cyan, 0.45, 0.35);
      }
    }
    return s;
  },
});

def('board', {
  xf: { spin: 0.12 },
  build() {
    const s = alloc(), S = 0.34;
    const back = [0.3, 0.3, 0.34, 0.4, 0.46, 0.34, 0.3, 0.3];
    for (let i = 0; i < N; i++) {
      if (U3[i] < 0.56) {
        const q = Math.floor(U2[i] * 64), c = q % 8, r = q >> 3;
        const light = (c + r) % 2 === 0;
        setP(s.P, i, (c - 3.5) * S + (U0[i] - 0.5) * S * 0.9, -0.55, (r - 3.5) * S + (U1[i] - 0.5) * S * 0.9);
        setC(s.C, i, light ? COL.ink : COL.steel, 0.8, light ? 0.5 : 0.16);
      } else if (U3[i] < 0.6) {
        const e = Math.floor(U2[i] * 4), u = (U0[i] * 2 - 1) * 4 * S;
        const h = 4 * S + 0.04;
        setP(s.P, i, e < 2 ? u : e === 2 ? -h : h, -0.55, e < 2 ? (e ? h : -h) : u);
        setC(s.C, i, COL.cyan, 0.7, 0.7);
      } else {
        const k = Math.floor(U2[i] * 32), side = k < 16 ? 0 : 1, j = k % 16;
        const row = side ? (j < 8 ? 6 : 7) : j < 8 ? 1 : 0, col = j % 8;
        const pawn = row === 1 || row === 6;
        const H = pawn ? 0.2 : back[col], rad = pawn ? 0.07 : 0.095;
        const cx = (col - 3.5) * S, cz = (row - 3.5) * S;
        let x, y, z;
        if (U0[i] < 0.75) {
          const a = U1[i] * TAU, h = U0[i] / 0.75;
          const rr = rad * (1 - 0.4 * h) * (h < 0.12 ? 1.25 : 1);
          x = cx + Math.cos(a) * rr; y = -0.55 + h * H; z = cz + Math.sin(a) * rr;
        } else {
          const d = [DIR[i * 3], DIR[i * 3 + 1], DIR[i * 3 + 2]];
          x = cx + d[0] * rad * 0.8; y = -0.55 + H + d[1] * rad * 0.8; z = cz + d[2] * rad * 0.8;
        }
        setP(s.P, i, x, y, z);
        setC(s.C, i, side ? COL.pink : COL.cyan, 0.85, 0.85);
      }
    }
    return s;
  },
});

// Four primitives popping into existence one beat apart.
const PRIM_LOCAL = (() => {
  const loc = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const k = i % 4;
    let p;
    if (k === 0) p = onEdges(cubeVerts(0.24), CUBE_EDGES, i, U0[i], 0.004);
    else if (k === 1) p = [FIB[i * 3] * 0.3, FIB[i * 3 + 1] * 0.3, FIB[i * 3 + 2] * 0.3];
    else if (k === 2) {
      const h = U0[i], a = U1[i] * TAU, r = 0.3 * (1 - h);
      p = [Math.cos(a) * r, -0.25 + h * 0.55, Math.sin(a) * r];
    } else {
      const u = U0[i] * TAU, v = U1[i] * TAU;
      p = [(0.24 + 0.09 * Math.cos(v)) * Math.cos(u), 0.09 * Math.sin(v), (0.24 + 0.09 * Math.cos(v)) * Math.sin(u)];
    }
    loc.set(p, i * 3);
  }
  return loc;
})();
const PRIM_COL = [COL.cyan, COL.ink, COL.gold, COL.pink];
def('primitives', {
  dynamic: true,
  gen(P, C, lt, ctx) {
    const beat = ctx.P;
    for (let i = 0; i < N; i++) {
      const k = i % 4;
      const s = ease.outBack(clamp((lt - k * beat) / 0.35));
      const a = lt * 0.9 + k, ca = Math.cos(a), sa = Math.sin(a);
      const lx = PRIM_LOCAL[i * 3], ly = PRIM_LOCAL[i * 3 + 1], lz = PRIM_LOCAL[i * 3 + 2];
      const cx = (k - 1.5) * 0.85;
      setP(P, i, cx + (lx * ca - lz * sa) * s * 1.3, (ly * s + 0.05) * 1.3, (lx * sa + lz * ca) * s * 1.3);
      setC(C, i, PRIM_COL[k], s > 0.02 ? 0.85 : 0, 0.85);
    }
  },
});

export const DATA_BARS = { n: 8, pitch: 0.31, width: 0.2, base: -0.5, cx: 0.14, heights: [1.2, 0.95, 0.7, 0.55, 0.3, 0.8, 0.62, 1.05], delay: 0.42 };
export const dataBarHeight = (k, lt) => DATA_BARS.heights[k] * ease.outCubic(clamp((lt - 0.15 - k * DATA_BARS.delay) / 0.5));
def('dataBars', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const { n, pitch, width, base, cx } = DATA_BARS;
    for (let i = 0; i < N; i++) {
      const k = i % n;
      const h = dataBarHeight(k, lt);
      const x0 = cx + (k - (n - 1) / 2) * pitch - width / 2;
      let x = x0 + U0[i] * width, y = base + U1[i] * h, a = 0.4, b = 0.55;
      if (U2[i] < 0.34) {
        if (U3[i] < 0.5) { y = base + h; a = 0.95; b = 1; }
        else { x = U3[i] < 0.75 ? x0 : x0 + width; a = 0.75; }
      }
      if (U2[i] > 0.965) { x = cx - 1.4 + U0[i] * 2.8; y = base - 0.02; a = 0.55; }
      setP(P, i, x, y, G0[i] * 0.01);
      const t = k / (n - 1);
      mixC(C, i, t < 0.5 ? COL.cyan : COL.violet, t < 0.5 ? COL.violet : COL.pink, (t % 0.5) * 2, h > 0.001 ? a : 0, b);
    }
  },
});

def('globe', {
  xf: { spin: 0.35, tilt: 0.35 },
  build() {
    const s = alloc(), R = 1.1;
    for (let i = 0; i < N; i++) {
      const k = U3[i];
      if (k < 0.45) {
        let lat, lon;
        if (U2[i] < 0.55) { lon = Math.floor(U0[i] * 12) * (TAU / 12); lat = (U1[i] - 0.5) * Math.PI; }
        else { lat = (Math.floor(U0[i] * 7) - 3) * (Math.PI / 8); lon = U1[i] * TAU; }
        setP(s.P, i, R * Math.cos(lat) * Math.cos(lon), R * Math.sin(lat), R * Math.cos(lat) * Math.sin(lon));
        setC(s.C, i, COL.ice, 0.8, 0.8);
      } else if (k < 0.9) {
        setP(s.P, i, FIB[i * 3] * R, FIB[i * 3 + 1] * R, FIB[i * 3 + 2] * R);
        setC(s.C, i, COL.cyan, 0.5, 0.28);
      } else {
        const a = U0[i] * TAU, r = 1.6 + G0[i] * 0.01;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        setP(s.P, i, x, z * Math.sin(0.4), z * Math.cos(0.4));
        setC(s.C, i, COL.gold, 0.8, 0.8);
      }
    }
    return s;
  },
});

def('galaxy', {
  dynamic: true,
  xf: { tilt: -0.62 },
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      if (U3[i] < 0.14) {
        const r = 0.22 * Math.abs(G0[i]);
        setP(P, i, DIR[i * 3] * r, DIR[i * 3 + 1] * r * 0.6, DIR[i * 3 + 2] * r);
        mixC(C, i, COL.gold, COL.ink, U1[i], 0.8, 0.9);
        continue;
      }
      const arm = i % 3, r = 0.12 + 2.4 * Math.pow(U0[i], 1.5);
      const th = (arm * TAU) / 3 + Math.log(r + 0.2) * 2.6 + G0[i] * (0.28 / (r + 0.4)) + (lt * 1.1) / (0.45 + r);
      const y = G1[i] * 0.05 * (1 + 2 * Math.exp(-r));
      setP(P, i, Math.cos(th) * r, y, Math.sin(th) * r);
      const hot = hash(i) < 0.05;
      mixC(C, i, COL.cyan, hot ? COL.pink : COL.violet, clamp(r / 2.4), 0.8, hot ? 1 : 0.7);
    }
  },
});

// S1 gallery ----------------------------------------------------------------------------
def('g_cube', { xf: { spin: 0.9, tilt: 0.6 }, build: () => polyShape(cubeVerts(1), 0.7, COL.cyan, COL.ink) });
def('g_octa', { xf: { spin: -0.9, tilt: 0.4 }, build: () => polyShape([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], 1.25, COL.violet, COL.ink) });
def('g_icosa', {
  xf: { spin: 0.8, tilt: 0.5 },
  build: () => polyShape([[0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI], [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1]], 0.66, COL.gold, COL.ink),
});
def('g_torus', {
  xf: { spin: 0.7, tilt: 1.0 },
  build: () => surfaceShape((u, v) => { const a = u * TAU, b = v * TAU; return [(0.8 + 0.34 * Math.cos(b)) * Math.cos(a), 0.34 * Math.sin(b), (0.8 + 0.34 * Math.cos(b)) * Math.sin(a)]; }, COL.pink, COL.violet, { gu: 36, gv: 14 }),
});
def('g_mobius', {
  xf: { spin: 0.8, tilt: 0.7 },
  build: () => surfaceShape((u, v) => { const a = u * TAU, w = v * 2 - 1, r = 1 + (w / 2.2) * Math.cos(a / 2); return [r * Math.cos(a), (w / 2.2) * Math.sin(a / 2), r * Math.sin(a)]; }, COL.violet, COL.cyan, { gu: 48, gv: 6, scale: 0.95 }),
});
def('g_klein', {
  xf: { spin: 0.6, tilt: 0.8 },
  build: () => surfaceShape((u, v) => {
    const a = u * TAU, b = v * TAU, q = 2 + Math.cos(a / 2) * Math.sin(b) - Math.sin(a / 2) * Math.sin(2 * b);
    return [q * Math.cos(a), Math.sin(a / 2) * Math.sin(b) + Math.cos(a / 2) * Math.sin(2 * b), q * Math.sin(a)];
  }, COL.pink, COL.gold, { gu: 40, gv: 16, scale: 0.36 }),
});
def('g_sphere', {
  xf: { spin: 0.5, tilt: 0.3 },
  build: () => surfaceShape((u, v) => { const a = u * TAU, b = (v - 0.5) * Math.PI; return [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)]; }, COL.ink, COL.cyan, { gu: 24, gv: 12, scale: 1.1 }),
});
def('torusKnot', {
  xf: { spin: 0.5, tilt: 0.6 },
  build() {
    const s = alloc(), p = 2, q = 5;
    for (let i = 0; i < N; i++) {
      const t = U0[i] * TAU, r = 0.72 + 0.3 * Math.cos(q * t);
      setP(s.P, i, (r * Math.cos(p * t) + G0[i] * 0.03) * 1.3, (0.3 * Math.sin(q * t) + G1[i] * 0.03) * 1.3, (r * Math.sin(p * t) + G2[i] * 0.03) * 1.3);
      const c = U0[i] * 3, j = Math.floor(c) % 3;
      const cols = [COL.cyan, COL.violet, COL.pink];
      mixC(s.C, i, cols[j], cols[(j + 1) % 3], c - Math.floor(c), 0.8, 0.8);
    }
    return s;
  },
});

// Verse 1 --------------------------------------------------------------------------------
def('pointsSet', {
  xf: { spin: 0.3, tilt: 0.45 },
  build() {
    const s = alloc(), v4 = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      tessVert(i % 16, 0, 0, v4);
      setP(s.P, i, v4[0] + G0[i] * 0.028, v4[1] + G1[i] * 0.028, v4[2] + G2[i] * 0.028);
      setC(s.C, i, COL.ink, 0.28, 0.9);
    }
    return s;
  },
});

def('tesseract', {
  dynamic: true,
  xf: { spin: 0.3, tilt: 0.45 },
  gen(P, C, lt) {
    const a = lt * 0.75, b = lt * 0.48;
    const A = [0, 0, 0, 0], B = [0, 0, 0, 0];
    const cache = new Float32Array(16 * 4);
    for (let v = 0; v < 16; v++) cache.set(tessVert(v, a, b, A), v * 4);
    for (let i = 0; i < N; i++) {
      const v = i % 16, mode = (i >> 4) % 8;
      if (mode < 2) {
        setP(P, i, cache[v * 4] + G0[i] * 0.025, cache[v * 4 + 1] + G1[i] * 0.025, cache[v * 4 + 2] + G2[i] * 0.025);
        setC(C, i, COL.ink, 0.35, 0.9);
      } else {
        const nb = v ^ (1 << TESS_EDGE_BITS[mode % 4]), u = U0[i];
        for (let k = 0; k < 4; k++) B[k] = lerp(cache[v * 4 + k], cache[nb * 4 + k], u);
        setP(P, i, B[0] + G0[i] * 0.005, B[1] + G1[i] * 0.005, B[2] + G2[i] * 0.005);
        mixC(C, i, COL.cyan, COL.pink, clamp((B[3] + 1.4) / 2.8), 0.85, 0.8);
      }
    }
  },
});

const CIRC_R = 1.05, CIRC_CY = 0.12;
def('circle', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const head = TAU * ease.outCubic(clamp(lt / 1.1));
    const hx = Math.cos(Math.PI / 2 - head) * CIRC_R, hy = Math.sin(Math.PI / 2 - head) * CIRC_R + CIRC_CY;
    for (let i = 0; i < N; i++) {
      const m = U1[i];
      if (m < 0.8) {
        const th = U0[i] * TAU;
        if (th <= head) {
          const a = Math.PI / 2 - th, r = CIRC_R + G0[i] * 0.006;
          setP(P, i, Math.cos(a) * r, Math.sin(a) * r + CIRC_CY, G1[i] * 0.01);
          setC(C, i, COL.cyan, 0.8, 0.85);
        } else {
          setP(P, i, hx + G0[i] * 0.02, hy + G1[i] * 0.02, G2[i] * 0.02);
          setC(C, i, COL.ink, 0.05, 1);
        }
      } else if (m < 0.92) {
        const u = U0[i];
        setP(P, i, hx * u + G0[i] * 0.003, CIRC_CY + (hy - CIRC_CY) * u + G1[i] * 0.003, 0);
        setC(C, i, COL.ink, 0.55, 0.7);
      } else {
        setP(P, i, G0[i] * 0.012, CIRC_CY + G1[i] * 0.012, 0);
        setC(C, i, COL.ink, 0.12, 1);
      }
    }
  },
});

def('unroll', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const q = lt / 1.5;
    for (let i = 0; i < N; i++) {
      const s = U0[i];
      const a = Math.PI / 2 - s * TAU;
      const cx = Math.cos(a) * CIRC_R, cy = Math.sin(a) * CIRC_R + CIRC_CY;
      if (U1[i] < 0.14) {
        setP(P, i, cx, cy, 0);
        setC(C, i, COL.cyan, 0.2, 0.5);
        continue;
      }
      const e = ease.inOutCubic(clamp((q - s * 0.55) / 0.45));
      const lx = -2.6 + s * 5.2, ly = -0.72;
      setP(P, i, lerp(cx, lx, e) + G0[i] * 0.005, lerp(cy, ly, e) + Math.sin(Math.PI * e) * 0.3 + G1[i] * 0.005, G2[i] * 0.01);
      mixC(C, i, COL.cyan, COL.gold, e, 0.85, 0.85);
    }
  },
});

const SIN_A = 0.55, SIN_K = 2.3, SIN_CY = 0.12;
// Phase uses global time so that switching sine -> tangents keeps the wave continuous.
export const sineAt = (x, t) => SIN_CY + SIN_A * Math.sin(SIN_K * x - t * 2.2);
export const sineSlope = (x, t) => SIN_A * SIN_K * Math.cos(SIN_K * x - t * 2.2);
export const tangentXs = (t) => {
  const out = [];
  const sh = (t * 0.35) % 0.96;
  for (let j = 0; j < 7; j++) out.push(-2.88 + j * 0.96 + sh);
  return out;
};
function sineGen(P, C, lt, ctx, withTangents) {
  const T = ctx.t;
  const tx = withTangents ? tangentXs(T) : null;
  for (let i = 0; i < N; i++) {
    const m = U1[i];
    if (withTangents && m < 0.28) {
      const j = i % tx.length, x0 = tx[j];
      const y0 = sineAt(x0, T), sl = sineSlope(x0, T), l = Math.hypot(1, sl);
      const u = U0[i] * 2 - 1, reach = 0.55 * ease.outCubic(clamp(lt / 0.4));
      setP(P, i, x0 + (u / l) * reach, y0 + ((u * sl) / l) * reach, 0);
      const edgeFade = smoothstep(2.9, 2.4, Math.abs(x0));
      setC(C, i, COL.pink, 0.9 * Math.sqrt(1 - Math.abs(u)) * edgeFade, 0.9);
      continue;
    }
    if (m > 0.93) {
      const x = -2.8 + U0[i] * 5.6;
      setP(P, i, x, SIN_CY, 0);
      setC(C, i, COL.steel, fract(x * 3) < 0.5 ? 0.4 : 0, 0.8);
      continue;
    }
    const x = -2.8 + U0[i] * 5.6, ph = SIN_K * x - T * 2.2;
    setP(P, i, x, SIN_CY + SIN_A * Math.sin(ph) + G0[i] * 0.008, G1[i] * 0.01);
    mixC(C, i, COL.cyan, COL.ink, 0.5 + 0.5 * Math.sin(ph), 0.85, 0.85);
  }
}
def('sine', { space: 'screen', dynamic: true, gen: (P, C, lt, ctx) => sineGen(P, C, lt, ctx, false) });
def('tangents', { space: 'screen', dynamic: true, gen: (P, C, lt, ctx) => sineGen(P, C, lt, ctx, true) });

def('lemniscate', {
  dynamic: true,
  xf: { spin: 0.15, tilt: 0.2 },
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      const s = U0[i] * TAU + lt * 0.9, sn = Math.sin(s), cs = Math.cos(s), den = 1 + sn * sn;
      const a = 1.8;
      setP(P, i, (a * cs) / den + G0[i] * 0.03, (a * sn * cs) / den + G1[i] * 0.03 + 0.1, 0.25 * Math.sin(s) + G2[i] * 0.03);
      mixC(C, i, COL.violet, COL.cyan, 0.5 + 0.5 * cs, 0.8, 0.8);
    }
  },
});

export const LIMIT_O = [-1.7, -0.62];
def('limit', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const [ox, oy] = LIMIT_O;
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.24) {
        const horiz = U2[i] < 0.6, u = U0[i];
        const x = horiz ? -2.8 + u * 5.6 : ox, y = horiz ? oy : -1.1 + u * 2.6;
        const dash = fract((horiz ? x : y) * 5 - lt * 0.8) < 0.5;
        setP(P, i, x, y, 0);
        setC(C, i, COL.ink, dash ? 0.4 : 0, 0.7);
        continue;
      }
      const f = fract(U0[i] + lt * 0.12);
      const d = 0.24 + f * f * 4.4;
      setP(P, i, ox + d + G0[i] * 0.006, oy + 0.36 / d + G1[i] * 0.006, 0);
      setC(C, i, COL.gold, 0.85 * smoothstep(1, 0.7, f), 0.9);
    }
  },
});

// Pre-chorus 1 ---------------------------------------------------------------------------
def('coil', {
  dynamic: true,
  xf: { spin: 0.2, tilt: 0.25 },
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.72) {
        const u = U0[i], th = u * 9 * TAU;
        setP(P, i, -1.7 + u * 3.4, Math.cos(th) * 0.55 + G0[i] * 0.01, Math.sin(th) * 0.55 + G1[i] * 0.01);
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(u * 60 - lt * 9), 6);
        mixC(C, i, COL.gold, COL.ink, pulse, 0.5 + 0.5 * pulse, 0.6 + 0.6 * pulse);
      } else {
        const m = i % 6, a = 1.95 + m * 0.26, b = 0.72 + m * 0.24, ph = U0[i] * TAU;
        setP(P, i, Math.cos(ph) * a, Math.sin(ph) * b, 0);
        setC(C, i, COL.violet, 0.35 * (fract(ph * 3 - lt * 1.5) < 0.6 ? 1 : 0.2), 0.8);
      }
    }
  },
});

def('acWave', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      const x = -2.8 + U0[i] * 5.6;
      if (U1[i] < 0.1) { setP(P, i, x, 0.1, 0); setC(C, i, COL.steel, 0.3, 0.7); continue; }
      const ph = x * 3.4 - lt * 7;
      setP(P, i, x, 0.1 + 0.72 * Math.sin(ph) + G0[i] * 0.01, G1[i] * 0.01);
      mixC(C, i, COL.pink, COL.ink, Math.abs(Math.cos(ph)), 0.85, 0.85);
    }
  },
});

def('dcLine', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      const x = -2.8 + U0[i] * 5.6;
      if (U1[i] < 0.1) { setP(P, i, x, 0.1, 0); setC(C, i, COL.steel, 0.3, 0.7); continue; }
      if (U1[i] < 0.3) { setP(P, i, x, 0.1 + U2[i] * 0.5, 0); setC(C, i, COL.cyan, 0.07, 0.8); continue; }
      const rip = 0.05 * Math.sin(x * 18 - lt * 25) * Math.exp(-lt * 3);
      setP(P, i, x, 0.6 + rip + G0[i] * 0.006, G1[i] * 0.01);
      setC(C, i, COL.cyan, 0.85, 0.9);
    }
  },
});

const EYE_CY = 0.15, EYE_W = 1.55;
const lid = (x) => 0.62 * Math.cos((Math.PI * x) / (2 * EYE_W));
def('eye', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const px = 0.12 * Math.sin(lt * 1.3), py = 0.04 * Math.sin(lt * 1.9);
    for (let i = 0; i < N; i++) {
      const m = U1[i];
      if (m < 0.4) {
        const x = (U0[i] * 2 - 1) * EYE_W, up = U2[i] < 0.5 ? 1 : -1;
        setP(P, i, x, EYE_CY + up * lid(x) + G0[i] * 0.006, 0);
        setC(C, i, COL.ink, 0.85, 0.85);
      } else if (m < 0.92) {
        const a = U0[i] * TAU, r = 0.18 + 0.28 * Math.sqrt(U2[i]);
        const x = px + Math.cos(a) * r, y = EYE_CY + py + Math.sin(a) * r;
        const inside = Math.abs(y - EYE_CY) < lid(x) - 0.02;
        const streak = 0.5 + 0.5 * Math.sin(a * 23);
        setP(P, i, x, y, 0.05);
        mixC(C, i, COL.cyan, COL.violet, streak, inside ? 0.75 : 0, 0.6 + 0.4 * (r / 0.46));
      } else {
        setP(P, i, px - 0.12 + G0[i] * 0.03, EYE_CY + py + 0.13 + G1[i] * 0.03, 0.08);
        setC(C, i, COL.ink, 0.2, 1);
      }
    }
  },
});

def('eyeClosed', {
  space: 'screen',
  build() {
    const s = alloc();
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.84) {
        const x = (U0[i] * 2 - 1) * EYE_W;
        setP(s.P, i, x, EYE_CY - 0.16 * lid(x) + G0[i] * 0.006, 0);
        setC(s.C, i, COL.ink, 0.8, 0.8);
      } else {
        const j = i % 9, x = (j - 4) * 0.3, u = U0[i], dir = x * 0.25;
        const y0 = EYE_CY - 0.16 * lid(x);
        setP(s.P, i, x + dir * u * 0.5, y0 - u * 0.2, 0);
        setC(s.C, i, COL.ink, 0.7, 0.7);
      }
    }
    return sortByX(s);
  },
});

def('vortex', {
  dynamic: true,
  xf: { tilt: 0.25 },
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      const arm = i % 4, r = 0.04 + 1.95 * Math.pow(U0[i], 0.9);
      const th = (arm * TAU) / 4 + Math.log(r + 0.08) * 3.1 + G0[i] * 0.09 + (lt * 2.6) / (r + 0.25);
      setP(P, i, Math.cos(th) * r, -0.95 / (r + 0.35) + 1.1 + G1[i] * 0.02, Math.sin(th) * r);
      const cols = [COL.violet, COL.pink, COL.cyan];
      const c = (r * 1.4 + lt * 0.8) % 3, j = Math.floor(c);
      mixC(C, i, cols[j], cols[(j + 1) % 3], c - j, 0.95, 0.9);
    }
  },
});

function tunnelGen(P, C, lt, speed, cA, cB) {
  const L = 11, D = 4.2, R = 0.78;
  for (let i = 0; i < N; i++) {
    const ring = U2[i] < 0.78;
    const z0 = (ring ? Math.floor(U0[i] * 22) / 22 : U0[i]) * L + lt * speed;
    const z = (((z0 % L) + L) % L) - (L - D + 1.2);
    const th = U1[i] * TAU + z * 0.35 + lt * 0.4;
    const r = R * (1 + 0.08 * Math.sin(th * 6 + z * 1.3)) + (ring ? 0 : G0[i] * 0.05);
    setP(P, i, Math.cos(th) * r, Math.sin(th) * r + 0.05, z);
    const far = clamp((z + L - D + 1.2) / 3), near = smoothstep(D - 1.0, D - 2.4, z);
    mixC(C, i, cA, cB, 0.5 + 0.5 * Math.sin(z * 0.9), (ring ? 0.95 : 0.6) * far * near, ring ? 0.95 : 0.7);
  }
}
def('tunnel', { space: 'screen', dynamic: true, gen: (P, C, lt) => tunnelGen(P, C, lt, 5.5, COL.cyan, COL.violet) });
def('tunnelBack', { space: 'screen', dynamic: true, gen: (P, C, lt) => tunnelGen(P, C, lt, -7, COL.gold, COL.orange) });

export const uniteSep = (lt) => 2.1 * (1 - ease.inOutCubic(clamp(lt / 1.7)));
def('twoSpheres', {
  dynamic: true,
  xf: { spin: 0.2 },
  gen(P, C, lt) {
    const sep = uniteSep(lt);
    const r = lerp(0.8, 0.62, clamp(sep / 0.6));
    const sw = (1 - sep / 2.1) * Math.PI;
    for (let i = 0; i < N; i++) {
      const side = i & 1 ? 1 : -1;
      let dx = FIB[i * 3], dy = FIB[i * 3 + 1], dz = FIB[i * 3 + 2];
      const a = sw * side * (0.5 + dy * 0.5), ca = Math.cos(a), sa = Math.sin(a);
      const x = dx * ca - dz * sa;
      dz = dx * sa + dz * ca;
      dx = x;
      setP(P, i, (side * sep) / 2 + dx * r, dy * r + 0.05, dz * r);
      setC(C, i, side < 0 ? COL.cyan : COL.pink, 0.75, 0.8);
    }
  },
});

def('onion', {
  xf: { spin: 0.3, tilt: 0.3 },
  build() {
    const s = alloc(), radii = [0.3, 0.55, 0.8, 1.08];
    const w = radii.map((r) => r * r), tot = w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < N; i++) {
      let u = U3[i] * tot, k = 0;
      while (k < 3 && u > w[k]) { u -= w[k]; k++; }
      const r = radii[k];
      setP(s.P, i, DIR[i * 3] * r, DIR[i * 3 + 1] * r, DIR[i * 3 + 2] * r);
      mixC(s.C, i, COL.gold, COL.violet, k / 3, 0.75, 0.9 - k * 0.12);
    }
    return s;
  },
});

// Chorus ---------------------------------------------------------------------------------
const SPIKES = 72;
const SPIKE_DIR = (() => {
  const d = new Float32Array(SPIKES * 3);
  for (let k = 0; k < SPIKES; k++) {
    const y = 1 - (2 * (k + 0.5)) / SPIKES, r = Math.sqrt(1 - y * y), th = (k * TAU) / PHI / PHI;
    d[k * 3] = r * Math.cos(th); d[k * 3 + 1] = y; d[k * 3 + 2] = r * Math.sin(th);
  }
  return d;
})();
def('spiky', {
  dynamic: true,
  xf: { spin: 0.6, tilt: 0.4 },
  gen(P, C, lt, ctx) {
    const L = 1 + 0.9 * ctx.kick;
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.35) {
        const r = 0.42;
        setP(P, i, FIB[i * 3] * r, FIB[i * 3 + 1] * r, FIB[i * 3 + 2] * r);
        setC(C, i, COL.ink, 0.6, 0.7);
        continue;
      }
      const k = i % SPIKES, u = Math.pow(U0[i], 0.7);
      const len = (0.5 + 0.4 * hash(k)) * L * (1 + 0.2 * Math.sin(lt * 6 + k));
      const r = 0.42 + u * len, th = 0.012 * (1 - u);
      setP(P, i, SPIKE_DIR[k * 3] * r + G0[i] * th, SPIKE_DIR[k * 3 + 1] * r + G1[i] * th, SPIKE_DIR[k * 3 + 2] * r + G2[i] * th);
      mixC(C, i, COL.pink, COL.gold, u, 0.85, 0.9);
    }
  },
});

def('rose', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const b = ease.outCubic(clamp(lt / 0.9)), rot = lt * 0.3;
    for (let i = 0; i < N; i++) {
      const th = U0[i] * TAU, R = 1.15 * b * Math.abs(Math.cos(4 * th));
      const outline = U1[i] < 0.6;
      const r = outline ? R : R * Math.sqrt(U2[i]);
      const a = th + rot;
      setP(P, i, Math.cos(a) * r, Math.sin(a) * r + 0.12, 0.35 * (r / 1.15) ** 2);
      mixC(C, i, COL.gold, COL.pink, clamp(r / 0.5), outline ? 0.85 : 0.25, 0.9);
    }
  },
});

def('play', { space: 'screen', build: () => sampleArt(drawPlay, { scale: 1.15, depth: 0.12, gain: 0.85 }) });

function cageGen(P, C, lt, inner = true) {
  const v = cubeVerts(1.05);
  for (let i = 0; i < N; i++) {
    if (U1[i] < 0.5 || !inner) {
      const p = onEdges(v, CUBE_EDGES, i, U0[i], 0.006);
      setP(P, i, p[0], p[1], p[2]);
      setC(C, i, COL.ink, 0.75, 0.7);
      continue;
    }
    const side = i & 1, a = lt * 1.6 + side * Math.PI;
    const cx = Math.cos(a) * 0.3, cz = Math.sin(a) * 0.3, r = 0.2;
    setP(P, i, cx + FIB[i * 3] * r, FIB[i * 3 + 1] * r, cz + FIB[i * 3 + 2] * r);
    setC(C, i, side ? COL.pink : COL.cyan, 0.7, 0.8);
  }
}
def('cage', { dynamic: true, xf: { spin: 0.35, tilt: 0.45 }, gen: (P, C, lt) => cageGen(P, C, lt) });

def('nestedCages', {
  dynamic: true,
  xf: { tilt: 0.4 },
  gen(P, C, lt) {
    const sizes = [1.25, 0.8, 0.45], v = cubeVerts(1);
    for (let i = 0; i < N; i++) {
      const m = U1[i] < 0.3 ? 0 : U1[i] < 0.55 ? 1 : U1[i] < 0.75 ? 2 : 3;
      if (m === 3) {
        const side = i & 1, a = lt * 2 + side * Math.PI, r = 0.1;
        setP(P, i, Math.cos(a) * 0.14 + FIB[i * 3] * r, FIB[i * 3 + 1] * r, Math.sin(a) * 0.14 + FIB[i * 3 + 2] * r);
        setC(C, i, side ? COL.pink : COL.cyan, 0.7, 0.9);
        continue;
      }
      const p = onEdges(v, CUBE_EDGES, i, U0[i], 0.005);
      const s = sizes[m], ang = lt * (0.4 + 0.35 * m) * (m % 2 ? -1 : 1);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      let x = p[0] * s, y = p[1] * s, z = p[2] * s;
      const x1 = x * ca - z * sa, z1 = x * sa + z * ca;
      const y1 = y * Math.cos(ang * 0.7) - z1 * Math.sin(ang * 0.7), z2 = y * Math.sin(ang * 0.7) + z1 * Math.cos(ang * 0.7);
      setP(P, i, x1, y1, z2);
      setC(C, i, m === 0 ? COL.ink : m === 1 ? COL.ice : COL.violet, 0.7, 0.75);
    }
  },
});

// Verse 2 --------------------------------------------------------------------------------
def('eggplant', { space: 'screen', xf: { wobble: 0.35 }, build: () => sampleArt(drawEggplant, { scale: 1.2, depth: 0.45, gain: 1.05 }) });
def('tomato', { space: 'screen', xf: { wobble: 0.35 }, build: () => sampleArt(drawTomato, { scale: 1.15, depth: 0.5, gain: 1.0 }) });
def('cat', { space: 'screen', xf: { wobble: 0.25 }, build: () => sampleArt(drawCat, { scale: 1.2, depth: 0.35, gain: 1.0 }) });

function radiantGen(P, C, lt, ctx, red) {
  const cA = red ? COL.red : COL.gold, cB = COL.ink, pul = 1 + 0.18 * ctx.beat;
  for (let i = 0; i < N; i++) {
    const m = U1[i];
    if (m < 0.25) {
      const a = U0[i] * TAU, r = 0.32 * Math.sqrt(U2[i]);
      setP(P, i, Math.cos(a) * r, Math.sin(a) * r + 0.12, 0);
      setC(C, i, cB, 0.5, 0.8);
    } else if (m < 0.45) {
      const ring = i % 3, rr = [0.44, 0.52, 1.28][ring] * (ring === 2 ? pul : 1), a = U0[i] * TAU;
      setP(P, i, Math.cos(a) * rr, Math.sin(a) * rr + 0.12, 0);
      setC(C, i, ring === 2 ? cA : cB, 0.7, 0.8);
    } else {
      const k = i % 36, a = (k * TAU) / 36 + lt * 0.15, u = U0[i];
      const r = 0.62 + u * (k % 2 ? 0.5 : 0.85) * pul;
      setP(P, i, Math.cos(a) * r + G0[i] * 0.004, Math.sin(a) * r + 0.12 + G1[i] * 0.004, 0);
      mixC(C, i, cB, cA, u, 0.85 * (1 - u * 0.6), 0.9);
    }
  }
}
def('radiant', { space: 'screen', dynamic: true, gen: (P, C, lt, ctx) => radiantGen(P, C, lt, ctx, false) });
def('radiantRed', { space: 'screen', dynamic: true, gen: (P, C, lt, ctx) => radiantGen(P, C, lt, ctx, true) });
def('exists', { space: 'screen', xf: { wobble: 0.3 }, build: () => sampleArt(drawExists, { scale: 1.0, depth: 0.25, gain: 0.8 }) });

// Pre-chorus 2 ---------------------------------------------------------------------------
export const toggleK = (lt) => ease.inOutCubic(clamp((lt - 0.35) / 0.35));
def('toggle', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const k = toggleK(lt), W = 2.1, H = 0.9, r = H / 2, st = W - H;
    const per = 2 * st + TAU * r;
    for (let i = 0; i < N; i++) {
      const m = U1[i];
      let x, y, a, col;
      if (m < 0.35) {
        let s = U0[i] * per;
        if (s < st) { x = -st / 2 + s; y = r; }
        else if ((s -= st) < Math.PI * r) { const an = Math.PI / 2 - s / r; x = st / 2 + Math.cos(an) * r; y = Math.sin(an) * r; }
        else if ((s -= Math.PI * r) < st) { x = st / 2 - s; y = -r; }
        else { s -= st; const an = -Math.PI / 2 - s / r; x = -st / 2 + Math.cos(an) * r; y = Math.sin(an) * r; }
        a = 0.8; col = [lerp(COL.steel[0], COL.cyan[0], k), lerp(COL.steel[1], COL.cyan[1], k), lerp(COL.steel[2], COL.cyan[2], k)];
      } else if (m < 0.8) {
        const an = U0[i] * TAU, rr = 0.33 * Math.sqrt(U2[i]);
        x = lerp(-0.6, 0.6, k) + Math.cos(an) * rr; y = Math.sin(an) * rr;
        a = 0.7; col = COL.ink;
      } else {
        x = (U0[i] - 0.5) * st * 1.2; y = (U2[i] - 0.5) * H * 0.8;
        a = 0.05 + 0.25 * k; col = COL.cyan;
      }
      setP(P, i, x, y + 0.12, G0[i] * 0.01);
      setC(C, i, col, a, 0.85);
    }
  },
});
def('venus', { space: 'screen', xf: { wobble: 0.3 }, build: () => sampleArt((c) => drawVenus(c), { scale: 1.05, depth: 0.2, gain: 0.8 }) });
def('mars', { space: 'screen', xf: { wobble: 0.3 }, build: () => sampleArt((c) => drawMars(c), { scale: 1.05, depth: 0.2, gain: 0.8 }) });

const SCRIB = (() => {
  const R = rng(99), f = [];
  for (let k = 0; k < 9; k++) f.push([1 + Math.floor(R() * 7), R() * TAU, 0.2 + R() * 0.4, k % 3]);
  return f;
})();
def('scribble', {
  dynamic: true,
  xf: { spin: 0.5 },
  gen(P, C, lt) {
    const head = clamp(lt / 1.4);
    for (let i = 0; i < N; i++) {
      const s = Math.min(U0[i], head) * TAU;
      const p = [0, 0, 0];
      for (const [fr, ph, a, ax] of SCRIB) p[ax] += a * Math.sin(fr * s + ph + lt * 0.3 * fr);
      setP(P, i, p[0] * 1.3 + G0[i] * 0.01, p[1] * 1.3 + G1[i] * 0.01, p[2] * 1.3);
      const cols = [COL.cyan, COL.pink, COL.gold, COL.violet];
      const c = U0[i] * 4, j = Math.floor(c) % 4;
      mixC(C, i, cols[j], cols[(j + 1) % 4], c - Math.floor(c), U0[i] <= head ? 0.8 : 0.1, 0.8);
    }
  },
});

def('clock', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const H = clockHours(lt), mA = fract(H) * TAU, hA = ((H % 12) / 12) * TAU;
    for (let i = 0; i < N; i++) {
      const m = U1[i];
      let x, y, col = COL.ink, a = 0.8;
      if (m < 0.35) {
        const an = U0[i] * TAU, r = 1.1 + G0[i] * 0.005;
        x = Math.cos(an) * r; y = Math.sin(an) * r;
      } else if (m < 0.55) {
        const k = i % 60, big = k % 5 === 0, an = (k / 60) * TAU;
        const r = 1.0 - U0[i] * (big ? 0.14 : 0.05);
        x = Math.cos(an) * r; y = Math.sin(an) * r; a = big ? 0.85 : 0.4;
      } else if (m < 0.72) {
        const r = U0[i] * 0.58;
        x = Math.sin(hA) * r; y = Math.cos(hA) * r; col = COL.gold;
      } else if (m < 0.94) {
        const r = U0[i] * 0.9;
        x = Math.sin(mA) * r; y = Math.cos(mA) * r; col = COL.cyan;
      } else {
        x = G0[i] * 0.03; y = G1[i] * 0.03;
      }
      setP(P, i, x, y + 0.12, 0);
      setC(C, i, col, a, 0.85);
    }
  },
});
def('glyphS', { space: 'screen', xf: { wobble: 0.3 }, build: () => textArt('S', { gain: 0.8 }) });
def('glyphM', { space: 'screen', xf: { wobble: 0.3 }, build: () => textArt('M', { gain: 0.8 }) });

def('trance', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      const th = U0[i] * 5 * TAU, arm = i & 1;
      const r = 0.046 * th + G0[i] * 0.012 * (1 + th * 0.05);
      const a = th + arm * Math.PI - lt * 2.2;
      setP(P, i, Math.cos(a) * r, Math.sin(a) * r + 0.12, 0.15 * Math.sin(r * 6 - lt * 4));
      const cols = [COL.violet, COL.pink, COL.cyan];
      const c = (((r * 3 - lt * 1.5) % 3) + 3) % 3, j = Math.floor(c);
      mixC(C, i, cols[j], cols[(j + 1) % 3], c - j, 0.8, 0.8);
    }
  },
});

// Chorus 2 -------------------------------------------------------------------------------
CHLADNI_MODES.forEach(([m, n], k) => def(`chladni${k}`, { space: 'screen', build: () => chladni(m, n, 500 + k) }));
export const CHLADNI_COUNT = CHLADNI_MODES.length;
export const chladniMode = (k) => CHLADNI_MODES[((k % CHLADNI_COUNT) + CHLADNI_COUNT) % CHLADNI_COUNT];
def('chladniCycle', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt, ctx) {
    const beat = ctx.P, k = Math.floor(lt / beat), f = (lt - k * beat) / beat;
    const A = ctx.shape(`chladni${(((k - 1) % CHLADNI_COUNT) + CHLADNI_COUNT) % CHLADNI_COUNT}`);
    const B = ctx.shape(`chladni${k % CHLADNI_COUNT}`);
    const jit = 0.03 * Math.exp(-f * 5);
    for (let i = 0; i < N; i++) {
      const e = ease.outCubic(clamp((f - U2[i] * 0.25) / 0.45));
      const j = i * 3;
      setP(P, i, lerp(A.P[j], B.P[j], e) + G0[i] * jit, lerp(A.P[j + 1], B.P[j + 1], e) + G1[i] * jit, lerp(A.P[j + 2], B.P[j + 2], e));
      const q = i * 4;
      C[q] = B.C[q] * (1 + jit * 20); C[q + 1] = B.C[q + 1] * (1 + jit * 12); C[q + 2] = B.C[q + 2]; C[q + 3] = B.C[q + 3];
    }
  },
});

export const progressK = (lt) => ease.inOutCubic(clamp(lt / 0.85));
def('progressRing', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const q = progressK(lt);
    for (let i = 0; i < N; i++) {
      const a = U0[i], an = Math.PI / 2 - a * TAU, on = a <= q;
      const r = on ? 1.0 + (U1[i] - 0.5) * 0.09 : 1.0 + G0[i] * 0.004;
      setP(P, i, Math.cos(an) * r, Math.sin(an) * r + 0.12, 0);
      mixC(C, i, COL.cyan, COL.gold, q, on ? 0.8 : 0.12, 0.85);
    }
  },
});

def('fibSphere', {
  xf: { spin: 0.4, tilt: 0.3 },
  build() {
    const s = alloc();
    for (let i = 0; i < N; i++) {
      setP(s.P, i, FIB[i * 3] * 1.1, FIB[i * 3 + 1] * 1.1, FIB[i * 3 + 2] * 1.1);
      mixC(s.C, i, COL.cyan, COL.ink, 0.5 + 0.5 * FIB[i * 3 + 1], 0.75, 0.8);
    }
    return s;
  },
});

def('leaving', {
  dynamic: true,
  xf: { spin: 0.4, tilt: 0.3 },
  gen(P, C, lt, ctx) {
    const times = ctx.cue.times ?? [0, 1, 2, 3, 4];
    for (let i = 0; i < N; i++) {
      let x = FIB[i * 3] * 1.1, y = FIB[i * 3 + 1] * 1.1, z = FIB[i * 3 + 2] * 1.1;
      const g = Math.floor(U3[i] * 6);
      let a = 0.75, col = COL.cyan;
      if (g < 5) {
        const tau = lt - times[g] - U2[i] * 0.25;
        if (tau > 0) {
          const d = tau * tau * 2.2 + tau * 0.5;
          x += d * 1.0; y += d * (0.3 + 0.4 * hash(i)); z += d * (hash(i + 7) - 0.5);
          a = 0.75 * Math.max(0, 1 - tau / 1.4);
          col = COL.pink;
        }
      }
      setP(P, i, x, y, z);
      setC(C, i, col, a, 0.8);
    }
  },
});

def('single', {
  build() {
    const s = alloc();
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.04) {
        const a = U0[i] * TAU;
        setP(s.P, i, Math.cos(a) * 0.6, Math.sin(a) * 0.6 * 0.3, Math.sin(a) * 0.6);
        setC(s.C, i, COL.steel, 0.25, 0.6);
      } else {
        setP(s.P, i, G0[i] * 0.012, G1[i] * 0.012, G2[i] * 0.012);
        setC(s.C, i, COL.ink, 0.0022, 1);
      }
    }
    return s;
  },
});

// Bridge ---------------------------------------------------------------------------------
def('fragments', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const p = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const b = fragBase(i, p);
      const corrupt = hash(b + 5) < 0.18;
      let a = 0.75, boost = 1;
      const tau = lt - fragDeleteAt(b);
      if (tau > 0) {
        const e = clamp(tau / 0.35);
        a *= 1 - e;
        p[1] -= e * e * 0.4;
        p[0] += G0[i] * e * 0.08;
        boost = 1 + 2 * Math.exp(-tau * 14);
      }
      setP(P, i, p[0], p[1], p[2]);
      setC(C, i, corrupt ? COL.pink : COL.cyan, a, 0.8 * boost);
    }
  },
});

def('fall', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const p = [0, 0, 0], k = clamp(lt / 1.5);
    const sad = [lerp(COL.cyan[0], COL.steel[0], k), lerp(COL.cyan[1], COL.steel[1], k), lerp(COL.cyan[2], COL.steel[2], k)];
    for (let i = 0; i < N; i++) {
      const b = fragBase(i, p);
      const alive = fragDeleteAt(b) === Infinity;
      const tau = Math.max(0, lt - 0.1 - hash(b + 3) * 0.6);
      const floor = -0.9 + 0.3 * Math.exp(-(p[0] * p[0]) / 1.6) * (0.3 + 0.7 * U2[i]);
      let y = p[1] - 1.6 * tau * tau;
      let x = p[0];
      if (y < floor) { y = floor; x += G0[i] * 0.04; }
      setP(P, i, x, y, p[2]);
      setC(C, i, sad, alive ? 0.7 : 0.05, 0.7);
    }
  },
});

def('pillar', {
  dynamic: true,
  gen(P, C, lt) {
    for (let i = 0; i < N; i++) {
      const m = U1[i];
      if (m < 0.55) {
        const y = -1.6 + fract(U0[i] + lt * 0.35) * 8, a = U2[i] * TAU, r = 0.22 * Math.sqrt(U3[i]);
        setP(P, i, Math.cos(a) * r, y, Math.sin(a) * r);
        mixC(C, i, COL.ink, COL.gold, U3[i], 0.6, 0.8);
      } else if (m < 0.88) {
        const y = -1.6 + fract(U0[i] + lt * 0.25) * 8, a = y * 1.8 + lt * 2 + ((i % 3) * TAU) / 3, r = 0.55 + 0.1 * Math.sin(y);
        setP(P, i, Math.cos(a) * r, y, Math.sin(a) * r);
        mixC(C, i, COL.gold, COL.red, fract(y * 0.2), 0.7, 0.8);
      } else {
        const a = U0[i] * TAU, r = 0.8 + Math.floor(U2[i] * 4) * 0.22;
        setP(P, i, Math.cos(a) * r, -1.6, Math.sin(a) * r);
        setC(C, i, COL.gold, 0.5, 0.7);
      }
    }
  },
});

def('shards', {
  xf: { spin: 0.2, tilt: 0.2 },
  build() {
    const s = alloc(), R = rng(404), K = 260, sh = [];
    for (let k = 0; k < K; k++) {
      const d = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1], l = Math.hypot(...d) || 1, r = 0.6 + 2.6 * Math.cbrt(R());
      const c = d.map((v) => (v / l) * r);
      const sz = 0.18 + R() * 0.3;
      const tri = [0, 1, 2].map(() => [c[0] + (R() - 0.5) * sz * 2, c[1] + (R() - 0.5) * sz * 2, c[2] + (R() - 0.5) * sz * 2]);
      sh.push(tri);
    }
    for (let i = 0; i < N; i++) {
      const [a, b, c] = sh[i % K];
      let u = U0[i], v = U1[i];
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      setP(s.P, i, a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v);
      mixC(s.C, i, COL.red, COL.ink, hash(i % K) < 0.3 ? 1 : 0, 0.8, 0.75);
    }
    return s;
  },
});

// Instrumental 2 -------------------------------------------------------------------------
const CORRUPT_LIST = ['torusKnot', 'g_cube', 'cat', 'globe', 'g_klein', 'eggplant', 'g_icosa', 'heart3D', 'tomato', 'g_torus', 'shield', 'onion', 'venus', 'glyphS', 'g_mobius', 'exists'];
def('corrupt', {
  dynamic: true,
  gen(P, C, lt, ctx) {
    const beat = ctx.P, k = Math.floor(lt / beat), f = (lt - k * beat) / beat;
    const A = ctx.shape(CORRUPT_LIST[(k + CORRUPT_LIST.length - 1) % CORRUPT_LIST.length]);
    const B = ctx.shape(CORRUPT_LIST[k % CORRUPT_LIST.length]);
    const e = ease.outExpo(clamp(f / 0.3));
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      let x = lerp(A.P[j], B.P[j], e), y = lerp(A.P[j + 1], B.P[j + 1], e);
      const z = lerp(A.P[j + 2], B.P[j + 2], e);
      const band = Math.floor(y * 9 + k * 3.1);
      if (hash(band * 31 + k) < 0.22) x += (hash(band + k * 7) - 0.5) * 0.9 * Math.exp(-f * 3);
      setP(P, i, x, y, z);
      const q = i * 4, lum = B.C[q] * 0.3 + B.C[q + 1] * 0.55 + B.C[q + 2] * 0.15;
      const hot = lum > 0.62;
      C[q] = hot ? 1.0 : 0.95; C[q + 1] = hot ? 0.9 : 0.12; C[q + 2] = hot ? 0.9 : 0.16; C[q + 3] = 0.8;
    }
  },
});

def('singularity', {
  dynamic: true,
  gen(P, C, lt) {
    const tr = 0.012 * (1 + lt * 3);
    const R = 0.34 * (1 - 0.55 * clamp(lt / 3.6));
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.22) {
        const f = fract(U0[i] + lt * 0.8), r = 3.2 * (1 - f) ** 2 + R;
        setP(P, i, DIR[i * 3] * r, DIR[i * 3 + 1] * r, DIR[i * 3 + 2] * r);
        setC(C, i, COL.red, 0.7 * f, 0.9);
        continue;
      }
      const r = R * Math.cbrt(U0[i]);
      setP(P, i, DIR[i * 3] * r + G0[i] * tr, DIR[i * 3 + 1] * r + G1[i] * tr, DIR[i * 3 + 2] * r + G2[i] * tr);
      mixC(C, i, COL.ink, COL.red, U2[i] * 0.6, 0.18, 1);
    }
  },
});

// Execution ------------------------------------------------------------------------------
def('reticle', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt, ctx) {
    const hits = ctx.cue.hits ?? [];
    let n = 0, last = -1e9;
    for (const h of hits) if (h <= lt) { n++; last = h; }
    const tau = lt - last;
    const rot = (n - 1 + ease.outExpo(clamp(tau / 0.14))) * (Math.PI / 4);
    const sc = 1 + 0.2 * Math.exp(-tau * 9);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < N; i++) {
      const m = U1[i];
      let x, y, col = COL.red, a = 0.85, rotate = true;
      if (m < 0.3) {
        let an = U0[i] * TAU;
        const gap = Math.abs(fract(an / (Math.PI / 2)) - 0.5) < 0.07;
        const r = 1.25;
        x = Math.cos(an) * r; y = Math.sin(an) * r; a = gap ? 0 : 0.85;
      } else if (m < 0.55) {
        const an = U0[i] * TAU, r = 0.62;
        x = Math.cos(an) * r; y = Math.sin(an) * r; col = COL.ink;
      } else if (m < 0.7) {
        const k = i % 4, r = 0.72 + U0[i] * 0.36, an = (k * Math.PI) / 2;
        x = Math.cos(an) * r; y = Math.sin(an) * r;
      } else if (m < 0.75) {
        x = G0[i] * 0.02; y = G1[i] * 0.02; col = COL.ink;
      } else if (m < 0.88) {
        rotate = false;
        const hz = U2[i] < 0.6, u = U0[i] * 2 - 1;
        x = hz ? u * 2.9 : 0; y = hz ? 0 : u * 1.6; a = Math.abs(u) > 0.3 / (hz ? 2.9 : 1.6) ? 0.3 : 0; col = COL.red;
      } else {
        const k = i % 4, sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, u = U0[i] * 0.35, h = U2[i] < 0.5;
        x = sx * (0.95 - (h ? u : 0)); y = sy * (0.95 - (h ? 0 : u)); col = COL.ink; a = 0.7;
      }
      if (rotate) { const xx = x * cr - y * sr; y = (x * sr + y * cr) * sc; x = xx * sc; }
      setP(P, i, x, y + 0.12, 0);
      setC(C, i, col, a, 0.9);
    }
  },
});
for (let d = 1; d <= 6; d++) def(`digit${d}`, { space: 'screen', xf: { wobble: 0.2 }, build: () => textArt(String(d), { size: 420, gain: 0.85 }) });
def('execText', { space: 'screen', build: () => textArt('EXECUTION', { w: 1800, h: 400, size: 300, scale: 0.62, gain: 0.8 }) });

// Final chorus ---------------------------------------------------------------------------
def('clones', {
  dynamic: true,
  xf: { tilt: 0.15 },
  gen(P, C, lt) {
    const cols = [COL.cyan, COL.violet, COL.pink, COL.gold];
    for (let i = 0; i < N; i++) {
      const k = i % 12, c = k % 4, r = Math.floor(k / 4);
      const a = lt * 1.2 + k, ca = Math.cos(a), sa = Math.sin(a);
      const dx = FIB[i * 3], dz = FIB[i * 3 + 2];
      const R = 0.27;
      setP(P, i, (c - 1.5) * 0.85 + (dx * ca - dz * sa) * R, (r - 1) * 0.78 + 0.12 + FIB[i * 3 + 1] * R + 0.05 * Math.sin(lt * 3 + k), (dx * sa + dz * ca) * R);
      setC(C, i, cols[(k + r) % 4], 0.8, 0.8);
    }
  },
});
def('oneSphere', {
  xf: { spin: 0.6, tilt: 0.3 },
  build() {
    const s = alloc();
    for (let i = 0; i < N; i++) {
      const r = 1.2 * (U1[i] < 0.85 ? 1 : Math.cbrt(U2[i]));
      setP(s.P, i, FIB[i * 3] * r, FIB[i * 3 + 1] * r, FIB[i * 3 + 2] * r);
      mixC(s.C, i, COL.red, COL.ink, U1[i] < 0.85 ? 0.3 + 0.7 * U0[i] ** 3 : 1, U1[i] < 0.85 ? 0.8 : 0.3, 0.85);
    }
    return s;
  },
});

// Love -----------------------------------------------------------------------------------
def('neural', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const nodes = NN_NODES, edges = NN_EDGES, outGrow = clamp(lt / 3);
    for (let i = 0; i < N; i++) {
      if (U1[i] < 0.3) {
        const n = nodes[i % nodes.length], out = n.l === NN_LAYERS.length - 1;
        const r = out ? 0.04 + 0.1 * outGrow : 0.04;
        setP(P, i, n.x + G0[i] * r, n.y + G1[i] * r, G2[i] * r);
        setC(C, i, out ? COL.pink : COL.ink, out ? 0.5 : 0.35, 0.9);
        continue;
      }
      const [a, b] = edges[i % edges.length], A = nodes[a], B = nodes[b], u = U0[i];
      setP(P, i, lerp(A.x, B.x, u), lerp(A.y, B.y, u), 0);
      const ph = fract(lt * 0.9 - A.l * 0.3 - u * 0.3 + hash(i % edges.length) * 0.15);
      const pulse = Math.exp(-((ph - 0.5) ** 2) * 90);
      mixC(C, i, COL.violet, COL.pink, pulse, 0.18 + 0.8 * pulse, 0.7 + 0.5 * pulse);
    }
  },
});
def('question', { space: 'screen', xf: { wobble: 0.3 }, build: () => textArt('?', { size: 440, gain: 0.85 }) });
export const heartXY = (s) => [
  16 * Math.sin(s) ** 3 * 0.068,
  (13 * Math.cos(s) - 5 * Math.cos(2 * s) - 2 * Math.cos(3 * s) - Math.cos(4 * s)) * 0.068 + 0.2,
];
def('heartLine', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const head = clamp(lt / 1.0);
    const [hx, hy] = heartXY(head * TAU);
    for (let i = 0; i < N; i++) {
      const u = U0[i];
      if (U1[i] < 0.25) {
        const [x, y] = heartXY(u * TAU), k = Math.sqrt(U2[i]);
        setP(P, i, x * k, 0.2 + (y - 0.2) * k, 0);
        setC(C, i, COL.pink, 0.1 * head, 0.8);
        continue;
      }
      if (u <= head) {
        const [x, y] = heartXY(u * TAU);
        setP(P, i, x + G0[i] * 0.008, y + G1[i] * 0.008, 0);
        setC(C, i, COL.pink, 0.85, 0.9);
      } else {
        setP(P, i, hx + G0[i] * 0.02, hy + G1[i] * 0.02, 0);
        setC(C, i, COL.ink, 0.05, 1);
      }
    }
  },
});
def('heart3D', {
  xf: { spin: 0.5 },
  build() {
    const s = alloc(), R = rng(1314);
    let i = 0;
    while (i < N) {
      const x = (R() * 2 - 1) * 1.3, y = (R() * 2 - 1) * 0.9, z = (R() * 2 - 1) * 1.3;
      if (heartF(x, y, z) < 0 && heartF(x * 1.04, y * 1.04, z * 1.04) >= 0) {
        setP(s.P, i, x * 0.95, z * 0.95 + 0.12, y * 0.95);
        mixC(s.C, i, COL.pink, COL.red, clamp(0.5 - z * 0.5), 0.8, 0.9);
        if (R() < 0.06) setC(s.C, i, COL.ink, 0.8, 0.9);
        i++;
      }
    }
    return s;
  },
});
def('free', {
  dynamic: true,
  xf: { spin: 0.5 },
  gen(P, C, lt, ctx) {
    const H = ctx.shape('heart3D');
    const k = ease.inCubic(clamp(lt / 1.6));
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      if (U3[i] < 0.07) {
        const r = 0.12;
        setP(P, i, 2.9 * k + FIB[j] * r, 0.12 + 2.0 * k + FIB[j + 1] * r, -1.0 * k + FIB[j + 2] * r);
        setC(C, i, COL.ice, 0.8 * (1 - clamp((lt - 1.1) / 0.6)), 0.9);
      } else {
        setP(P, i, H.P[j], H.P[j + 1], H.P[j + 2]);
        C.set(H.C.subarray(i * 4, i * 4 + 4), i * 4);
      }
    }
  },
});
function heartCageGen(P, C, lt, ctx) {
  const H = ctx.shape('heart3D'), v = cubeVerts(1.05), pul = 0.72 * (1 + 0.06 * ctx.beat);
  for (let i = 0; i < N; i++) {
    const j = i * 3;
    if (U3[i] < 0.2) {
      const p = onEdges(v, CUBE_EDGES, i, U0[i], 0.006);
      setP(P, i, p[0], p[1] + 0.1, p[2]);
      setC(C, i, COL.ink, 0.7, 0.7);
    } else {
      setP(P, i, H.P[j] * pul, (H.P[j + 1] - 0.12) * pul + 0.12, H.P[j + 2] * pul);
      C.set(H.C.subarray(i * 4, i * 4 + 4), i * 4);
    }
  }
}
def('heartCage', { dynamic: true, xf: { spin: 0.35, tilt: 0.25 }, gen: heartCageGen });
def('dissolve', {
  dynamic: true,
  xf: { spin: 0.2, tilt: 0.25 },
  gen(P, C, lt, ctx) {
    heartCageGen(P, C, 0, { ...ctx, beat: 0 });
    const fade = 1 - clamp(lt / 14) * 0.8;
    for (let i = 0; i < N; i++) {
      const j = i * 3, sp = 0.4 + U0[i];
      P[j] += Math.sin(lt * 0.4 + U1[i] * TAU) * lt * 0.05;
      P[j + 1] += (lt * 0.07 + lt * lt * 0.004) * sp;
      P[j + 2] += Math.cos(lt * 0.35 + U2[i] * TAU) * lt * 0.05;
      C[i * 4 + 3] *= fade;
    }
  },
});
def('implode', {
  build() {
    const s = alloc();
    for (let i = 0; i < N; i++) {
      setP(s.P, i, G0[i] * 0.01, G1[i] * 0.01 + 0.12, G2[i] * 0.01);
      setC(s.C, i, COL.ink, 0.0025, 1);
    }
    return s;
  },
});
def('cursor', {
  space: 'screen',
  dynamic: true,
  gen(P, C, lt) {
    const on = Math.floor(lt / 0.53) % 2 === 0 ? 1 : 0;
    for (let i = 0; i < N; i++) {
      setP(P, i, (U0[i] - 0.5) * 0.2, (U1[i] - 0.5) * 0.36 + 0.12, 0);
      setC(C, i, COL.ink, 0.012 * on, 1);
    }
  },
});

/** Build all static shapes (text shapes need fonts loaded first). */
export function buildShapes() {
  for (const [name, s] of Object.entries(SHAPES)) {
    if (!s.dynamic && !s.data) s.data = s.build();
    s.name = name;
  }
}
