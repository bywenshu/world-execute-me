// Morph engine: resolves the active shape cue(s) at time t and blends them per particle.
import { N, SHAPES, U0, U1, U2, U3, DIR, G0, G1 } from './shapes.js';
import { clamp, ease, hash, impulse, lerp } from './util.js';

const DEPTH = 3;
const buf = () => ({ P: new Float32Array(N * 3), C: new Float32Array(N * 4) });

/** Apply a shape's transform (spin/tilt for world shapes, camera basis for screen shapes). */
export function transformInto(spec, cue, src, dst, t, cam) {
  const xf = { ...(spec.xf || {}), ...(cue.xf || {}) };
  const sc = xf.scale ?? 1;
  const off = xf.offset ?? [0, 0, 0];
  if (spec.space === 'screen') {
    const k = sc * cam.screenScale;
    const wob = xf.wobble ?? 0;
    const ya = wob * Math.sin(t * 0.9), pa = wob * 0.35 * Math.sin(t * 0.7 + 1);
    const cy = Math.cos(ya), sy = Math.sin(ya), cp = Math.cos(pa), sp = Math.sin(pa);
    const [rx, ry, rz] = cam.right, [ux, uy, uz] = cam.upv, [bx, by, bz] = cam.back, [tx, ty, tz] = cam.target;
    for (let i = 0, j = 0; i < N; i++, j += 3) {
      let x = src[j] + off[0], y = src[j + 1] + off[1], z = src[j + 2] + off[2];
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      x = x1 * k; y = y1 * k; z = z2 * k;
      dst[j] = tx + rx * x + ux * y + bx * z;
      dst[j + 1] = ty + ry * x + uy * y + by * z;
      dst[j + 2] = tz + rz * x + uz * y + bz * z;
    }
    return;
  }
  const ang = (xf.spin ?? 0) * t + (xf.phase ?? 0), tilt = xf.tilt ?? 0;
  const ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let i = 0, j = 0; i < N; i++, j += 3) {
    const x = src[j] * sc, y = src[j + 1] * sc, z = src[j + 2] * sc;
    const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
    const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
    dst[j] = x1 + off[0];
    dst[j + 1] = y2 + off[1];
    dst[j + 2] = z2 + off[2];
  }
}

/** Single-point version of transformInto, used by the overlay to pin labels onto particles. */
export function transformPoint(shapeName, cue, p, t, cam) {
  const spec = SHAPES[shapeName];
  const xf = { ...(spec.xf || {}), ...(cue?.xf || {}) };
  const sc = xf.scale ?? 1, off = xf.offset ?? [0, 0, 0];
  let [x, y, z] = p;
  if (spec.space === 'screen') {
    const k = sc * cam.screenScale, wob = xf.wobble ?? 0;
    const ya = wob * Math.sin(t * 0.9), pa = wob * 0.35 * Math.sin(t * 0.7 + 1);
    x += off[0]; y += off[1]; z += off[2];
    const x1 = x * Math.cos(ya) + z * Math.sin(ya), z1 = -x * Math.sin(ya) + z * Math.cos(ya);
    const y1 = y * Math.cos(pa) - z1 * Math.sin(pa), z2 = y * Math.sin(pa) + z1 * Math.cos(pa);
    x = x1 * k; y = y1 * k; z = z2 * k;
    const { right: r, upv: u, back: b, target: tg } = cam;
    return [tg[0] + r[0] * x + u[0] * y + b[0] * z, tg[1] + r[1] * x + u[1] * y + b[1] * z, tg[2] + r[2] * x + u[2] * y + b[2] * z];
  }
  const ang = (xf.spin ?? 0) * t + (xf.phase ?? 0), tilt = xf.tilt ?? 0;
  x *= sc; y *= sc; z *= sc;
  const x1 = x * Math.cos(ang) + z * Math.sin(ang), z1 = -x * Math.sin(ang) + z * Math.cos(ang);
  return [x1 + off[0], y * Math.cos(tilt) - z1 * Math.sin(tilt) + off[1], y * Math.sin(tilt) + z1 * Math.cos(tilt) + off[2]];
}

export class ParticleSystem {
  constructor(cues) {
    this.cues = cues;
    this.starts = cues.map((c) => c.t);
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4);
    this.size = new Float32Array(N);
    for (let i = 0; i < N; i++) this.size[i] = 0.85 + 0.55 * U3[i] ** 2 + (hash(i + 99) < 0.012 ? 1.6 : 0);
    this.shapeBuf = Array.from({ length: DEPTH }, buf);
    this.xfBuf = Array.from({ length: DEPTH }, buf);
    this.blendBuf = Array.from({ length: DEPTH }, buf);
  }

  cueIndex(t) {
    let lo = 0, hi = this.starts.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.starts[m] <= t) lo = m + 1;
      else hi = m;
    }
    return lo - 1;
  }

  shapeAt(k, t, depth, env) {
    const cue = this.cues[k], spec = SHAPES[cue.shape];
    if (!spec) throw new Error(`unknown shape ${cue.shape}`);
    const lt = t - cue.t;
    let P, C;
    if (spec.dynamic) {
      const b = this.shapeBuf[depth];
      spec.gen(b.P, b.C, lt, { ...env, cue, t, lt });
      P = b.P; C = b.C;
    } else {
      P = spec.data.P; C = spec.data.C;
    }
    const x = this.xfBuf[depth];
    transformInto(spec, cue, P, x.P, t, env.cam);
    return { P: x.P, C };
  }

  resolve(k, t, depth, env) {
    const cur = this.shapeAt(k, t, depth, env);
    const cue = this.cues[k];
    const p = (t - cue.t) / Math.max(1e-3, cue.dur ?? 0.6);
    if (k === 0 || p >= 1) return cur;
    const prev = depth + 1 < DEPTH ? this.resolve(k - 1, t, depth + 1, env) : this.shapeAt(k - 1, t, depth + 1 < DEPTH ? depth + 1 : depth, env);
    const out = this.blendBuf[depth];
    const st = cue.stagger ?? 0.35, arc = cue.arc ?? 0.25, fn = ease[cue.ease ?? 'inOutCubic'];
    const order = cue.order ?? 'random';
    const A = prev.P, B = cur.P, CA = prev.C, CB = cur.C, O = out.P, OC = out.C;
    for (let i = 0; i < N; i++) {
      const r = order === 'index' ? i / N : order === 'reverse' ? 1 - i / N : U2[i];
      const e = fn(clamp((p - r * st) / (1 - st)));
      const s = Math.sin(Math.PI * e) * arc * (0.4 + U0[i]);
      const j = i * 3, q = i * 4;
      O[j] = lerp(A[j], B[j], e) + DIR[j] * s;
      O[j + 1] = lerp(A[j + 1], B[j + 1], e) + DIR[j + 1] * s;
      O[j + 2] = lerp(A[j + 2], B[j + 2], e) + DIR[j + 2] * s;
      OC[q] = lerp(CA[q], CB[q], e);
      OC[q + 1] = lerp(CA[q + 1], CB[q + 1], e);
      OC[q + 2] = lerp(CA[q + 2], CB[q + 2], e);
      OC[q + 3] = lerp(CA[q + 3], CB[q + 3], e);
    }
    return out;
  }

  /** Evaluate positions/colours for time t. `fx` carries audio-driven modulation. */
  update(t, env, fx) {
    const k = Math.max(0, this.cueIndex(t));
    const r = this.resolve(k, t, 0, env);
    const P = this.pos, C = this.col, [cx, cy, cz] = env.cam.target;
    const breath = 1 + fx.breath;
    const bursts = fx.bursts.filter((b) => t >= b.t && t - b.t < 6).map((b) => ({ ...b, f: impulse(t, b.t, b.decay ?? 3, 40) * b.amp }));
    const turb = fx.turb, jit = fx.jitter, gl = fx.glitch, alpha = fx.alpha, gain = fx.gain;
    const gk = Math.floor(t * 12);
    for (let i = 0; i < N; i++) {
      const j = i * 3, q = i * 4;
      let x = (r.P[j] - cx) * breath + cx, y = (r.P[j + 1] - cy) * breath + cy, z = (r.P[j + 2] - cz) * breath + cz;
      for (const b of bursts) {
        const s = b.f * (0.35 + U0[i] * 0.9);
        x += (DIR[j] + (x - cx) * 0.4) * s;
        y += (DIR[j + 1] + (y - cy) * 0.4) * s;
        z += (DIR[j + 2] + (z - cz) * 0.4) * s;
      }
      if (turb > 0) {
        x += turb * Math.sin(y * 2.1 + t * 1.3 + U0[i] * 6);
        y += turb * Math.sin(z * 1.7 + t * 1.1 + U1[i] * 6);
        z += turb * Math.sin(x * 1.9 + t * 0.9 + U2[i] * 6);
      }
      if (jit > 0) {
        const w = Math.sin(t * 95 + U0[i] * 40);
        x += G0[i] * jit * w;
        y += G1[i] * jit * w;
      }
      if (gl > 0) {
        const band = Math.floor(y * 10 + gk * 3.7);
        if (hash(band * 13 + gk) < gl * 0.35) x += (hash(band + gk * 5) - 0.5) * gl * 0.9;
      }
      P[j] = x; P[j + 1] = y; P[j + 2] = z;
      C[q] = r.C[q] * gain; C[q + 1] = r.C[q + 1] * gain; C[q + 2] = r.C[q + 2] * gain;
      C[q + 3] = r.C[q + 3] * alpha;
    }
    return { cue: this.cues[k], index: k };
  }
}
