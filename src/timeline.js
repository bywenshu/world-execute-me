// Beat grid + audio feature lookups built from data/analysis.json.
import { upperBound, clamp } from './util.js';

export class Timeline {
  constructor(a) {
    this.a = a;
    this.duration = a.duration;
    this.bpm = a.bpm;
    this.P = a.beatPeriod;
    this.B0 = a.firstBeat;
    this.fps = a.fps;
    this.env = {};
    for (const k of Object.keys(a.env)) this.env[k] = Float32Array.from(a.env[k]);
    this.kicks = Float64Array.from(a.kicks.t);
    this.kickV = Float32Array.from(a.kicks.v);
    this.snares = Float64Array.from(a.snares.t);
    this.snareV = Float32Array.from(a.snares.v);
    this.hats = Float64Array.from(a.hats.t);
  }

  beat(t) { return (t - this.B0) / this.P; }
  timeOf(b) { return this.B0 + b * this.P; }
  /** Section = 32 beats (8 bars); every lyric block of this song starts on one. */
  section(t) { return Math.max(0, Math.floor(this.beat(t) / 32)); }

  sample(name, t) {
    const e = this.env[name];
    const x = clamp(t * this.fps, 0, e.length - 1);
    const i = Math.floor(x), f = x - i;
    return e[i] * (1 - f) + (e[Math.min(i + 1, e.length - 1)] ?? 0) * f;
  }

  /** Exponentially decaying pulse triggered by the most recent event in `times`. */
  decay(times, vals, t, k = 8) {
    const i = upperBound(times, t) - 1;
    if (i < 0) return 0;
    const v = vals ? vals[i] : 1;
    return v * Math.exp(-(t - times[i]) * k);
  }

  kick(t, k = 9) { return this.decay(this.kicks, this.kickV, t, k); }
  snare(t, k = 10) { return this.decay(this.snares, this.snareV, t, k); }
  hat(t, k = 18) { return this.decay(this.hats, null, t, k); }

  /** Pulse on every grid beat (0..1), strongest on bar downbeats when `bar` is set. */
  beatPulse(t, k = 7) {
    const b = this.beat(t);
    if (b < 0) return 0;
    return Math.exp(-(b - Math.floor(b)) * this.P * k);
  }

  barPulse(t, k = 4) {
    const b = this.beat(t) / 4;
    if (b < 0) return 0;
    return Math.exp(-(b - Math.floor(b)) * this.P * 4 * k);
  }
}
