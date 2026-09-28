// Canvas2D layer: bilingual kinetic lyrics, HUD, and scene annotations (logical 1920x1080).
import { clamp, lerp, ease, css, hash, fmtTime, smoothstep, TAU, fract } from './util.js';
import { CLASS_NAMES } from './director.js';
import { transformPoint } from './particles.js';
import {
  tangentXs, sineAt, sineSlope, uniteSep, toggleK, clockHours, progressK, chladniMode, fragDeleteAt, LIMIT_O,
  NEURAL, DATA_BARS, dataBarHeight, FR_PITCH,
} from './shapes.js';

export const MONO = '"JetBrains Mono", Menlo, monospace';
export const ZH = '"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Noto Sans SC", sans-serif';
const W = 1920, H = 1080;
const INK = [0.92, 0.95, 1.0];

export class Overlay {
  constructor({ lyrics, director, timeline }) {
    this.lyr = lyrics;
    this.dir = director;
    this.tl = timeline;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.heartPlot = null;
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.s = w / W;
  }

  // ------------------------------------------------------------------ primitives
  font(size, weight = 400, family = MONO) {
    this.ctx.font = `${weight} ${size}px ${family}`;
  }
  text(str, x, y, { size = 16, weight = 400, family = MONO, color = INK, alpha = 1, align = 'left', base = 'alphabetic', spacing = 0 } = {}) {
    const c = this.ctx;
    if (alpha <= 0.002 || !str) return 0;
    this.font(size, weight, family);
    c.letterSpacing = `${spacing}px`;
    c.textAlign = align;
    c.textBaseline = base;
    c.fillStyle = typeof color === 'string' ? color : css(color, alpha);
    if (typeof color === 'string') c.globalAlpha = alpha;
    c.fillText(str, x, y);
    c.globalAlpha = 1;
    const w = c.measureText(str).width;
    c.letterSpacing = '0px';
    return w;
  }
  line(x0, y0, x1, y1, color, alpha = 1, width = 1, dash = null) {
    const c = this.ctx;
    c.strokeStyle = css(color, alpha);
    c.lineWidth = width;
    c.setLineDash(dash || []);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.setLineDash([]);
  }
  typed(str, lt, cps = 45) {
    if (lt <= 0) return '';
    return str.slice(0, Math.ceil(lt * cps));
  }
  proj(cam, p) {
    return cam.project(p, W, H);
  }
  cueAt(t, shape) {
    const cues = this.dir.cues;
    for (let k = cues.length - 1; k >= 0; k--) if (cues[k].t <= t && (!shape || cues[k].shape === shape)) return cues[k];
    return cues[0];
  }

  // ------------------------------------------------------------------ frame
  draw(f) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.s, 0, 0, this.s, 0, 0);
    this.acc = f.look.accent;
    this.acc2 = f.look.accent2;
    for (const w of f.widgets) {
      const fn = this[`w_${w.name}`];
      if (fn) fn.call(this, f, w.lt, w);
    }
    this.drawLyrics(f);
    this.drawHUD(f);
  }

  // ------------------------------------------------------------------ lyrics
  wordState(line, t) {
    let shown = 0, active = -1;
    line.words.forEach((w, k) => {
      if (t < w.t) return;
      const td = clamp((w.end - w.t) * 0.45, 0.04, 0.14);
      const n = Math.ceil(w.text.length * clamp((t - w.t) / td));
      shown = Math.max(shown, w.c0 + n);
      if (t < w.end) active = k;
    });
    return { shown: Math.min(shown, line.en.length), active };
  }

  codeLine(line, t, o = {}) {
    const { y = 905, size = 46, alpha = 1, dy = 0, zh = true, gutter = true, cx = 960, zhSize = 30, caret = true, glitch = 0 } = o;
    if (alpha <= 0.002) return;
    const c = this.ctx;
    this.font(size, 500);
    let cw = c.measureText('M').width, s = size;
    const len = line.en.length;
    if (len * cw > 1560) {
      s = (size * 1560) / (len * cw);
      this.font(s, 500);
      cw = c.measureText('M').width;
    }
    const x0 = cx - (len * cw) / 2;
    const { shown, active } = this.wordState(line, t);
    const acc = this.acc;
    line.words.forEach((w, k) => {
      if (w.c0 >= shown) return;
      let str = line.en.slice(w.c0, Math.min(w.c1, shown));
      if (glitch > 0) str = scramble(str, glitch, Math.floor(t * 30) + k);
      const pop = Math.exp(-(t - w.t) * 16);
      const col = k === active ? acc : INK;
      this.text(str, x0 + w.c0 * cw, y + dy - 7 * pop, { size: s, weight: k === active ? 700 : 500, color: col, alpha: alpha * (k === active ? 1 : 0.92) });
      if (k === active) {
        const trimmed = w.text.replace(/\s+$/, '').length;
        const p = clamp((t - w.t) / (w.end - w.t));
        const ux = x0 + w.c0 * cw, uw = trimmed * cw;
        c.fillStyle = css(INK, 0.18 * alpha);
        c.fillRect(ux, y + dy + s * 0.28, uw, 3);
        c.fillStyle = css(acc, 0.95 * alpha);
        c.fillRect(ux, y + dy + s * 0.28, uw * p, 3);
      }
    });
    if (caret && t < line.end + 0.25 && Math.floor(t * 4) % 2 === 0) {
      c.fillStyle = css(acc, 0.85 * alpha);
      c.fillRect(x0 + shown * cw + 4, y + dy - s * 0.74, cw * 0.55, s * 0.9);
    }
    if (gutter) {
      this.text(String(line.index + 1).padStart(3, '0'), x0 - 28, y + dy, { size: s * 0.4, color: INK, alpha: 0.35 * alpha, align: 'right' });
      this.text('▸', x0 - 20, y + dy - s * 0.05, { size: s * 0.42, color: acc, alpha: 0.7 * alpha });
    }
    if (zh && line.zh) this.zhLine(line, t, { y: y + dy + zhSize * 1.9, size: zhSize, alpha, cx, glitch });
  }

  zhLine(line, t, { y, size = 30, alpha = 1, cx = 960, glitch = 0 }) {
    const c = this.ctx;
    const chars = Array.from(line.zh);
    const dur = Math.max(0.35, (line.end - line.start) * 0.85);
    const prog = clamp((t - line.start) / dur);
    const nf = prog * chars.length;
    const n = Math.ceil(nf);
    this.font(size, 400, ZH);
    const full = c.measureText(line.zh).width;
    this.font(size * 0.8, 400, MONO);
    const pre = '// ';
    const pw = c.measureText(pre).width;
    const x0 = cx - (full + pw) / 2;
    this.text(pre, x0, y, { size: size * 0.8, color: this.acc2, alpha: 0.55 * alpha });
    let str = chars.slice(0, Math.max(0, n - 1)).join('');
    if (glitch > 0) str = scramble(str, glitch, Math.floor(t * 30), true);
    this.font(size, 400, ZH);
    const w0 = c.measureText(str).width;
    this.text(str, x0 + pw, y, { size, family: ZH, color: [0.8, 0.85, 0.94], alpha: 0.9 * alpha });
    if (n > 0) {
      const lastA = n - nf >= 1 ? 1 : 1 - (n - nf);
      this.text(chars[n - 1], x0 + pw + w0, y, { size, family: ZH, color: this.acc2, alpha: alpha * clamp(lastA * 1.5) });
    }
  }

  drawLyrics(f) {
    const t = f.t, L = this.lyr.lines, i = this.lyr.lineAt(t);
    if (i < 0) return;
    const mode = f.lyricMode;
    if (mode === 'term') return this.termLyrics(f, i);
    if (mode === 'slam') return this.slamLyrics(f, i);
    if (mode === 'count') return this.countLyrics(f, i);
    const cur = L[i], next = L[i + 1], prev = L[i - 1];
    if (cur.start < this.dir.B(32)) return;
    const hideAt = Math.min(next ? next.start : Infinity, cur.end + 1.6);
    const out = clamp((t - hideAt) / 0.3);
    if (mode === 'stack') {
      const first = this.lyr.lineAt(110.9);
      for (let k = i - 1; k >= Math.max(first, i - 5); k--) {
        const d = i - k;
        const a = (1 - d * 0.19) * (1 - out);
        const e = ease.outCubic(clamp((t - cur.start) / 0.3));
        this.codeLine(L[k], t, { y: 905 - (d - 1 + e) * 64, size: 46 - d * 4, alpha: a * 0.7, dy: 0, zh: false, gutter: false, caret: false, cx: 960 + d * 16 });
      }
      this.codeLine(cur, t, { alpha: 1 - out, dy: 18 * (1 - ease.outCubic(clamp((t - cur.start) / 0.25))), glitch: out });
      return;
    }
    if (prev && Math.min(cur.start, prev.end + 1.6) >= cur.start - 0.01 && f.lyricMode === 'code') {
      const e = clamp((t - cur.start) / 0.35);
      if (e < 1) this.codeLine(prev, t, { dy: -74 * ease.outCubic(e), alpha: (1 - e) * 0.55, zh: false, caret: false });
    }
    if (out < 1) this.codeLine(cur, t, { alpha: 1 - out, dy: 18 * (1 - ease.outCubic(clamp((t - cur.start) / 0.25))), glitch: out });
  }

  termLyrics(f, i) {
    const t = f.t, L = this.lyr.lines;
    let row = 0;
    for (let k = 0; k <= i; k++) {
      const l = L[k];
      if (l.start > this.dir.B(32)) break;
      const y = 300 + row * 76;
      row++;
      const age = t - l.start;
      const a = clamp(age / 0.15) * (k === i ? 1 : 0.55);
      this.text('$', 100, y, { size: 28, color: this.acc, alpha: a });
      const { shown, active } = this.wordState(l, t);
      this.font(28, 500);
      const cw = this.ctx.measureText('M').width;
      l.words.forEach((w, j) => {
        if (w.c0 >= shown) return;
        this.text(l.en.slice(w.c0, Math.min(w.c1, shown)), 134 + w.c0 * cw, y, { size: 28, weight: j === active ? 700 : 500, color: j === active ? this.acc : INK, alpha: a });
      });
      if (k === i && t < l.end + 0.2 && Math.floor(t * 4) % 2 === 0) {
        this.ctx.fillStyle = css(this.acc, 0.8);
        this.ctx.fillRect(134 + shown * cw + 3, y - 22, cw * 0.55, 26);
      }
      if (l.zh) {
        const chars = Array.from(l.zh);
        const n = Math.ceil(chars.length * clamp(age / Math.max(0.3, (l.end - l.start) * 0.8)));
        this.text('//', 134, y + 32, { size: 20, color: this.acc2, alpha: a * 0.6 });
        this.text(chars.slice(0, n).join(''), 170, y + 33, { size: 22, family: ZH, color: [0.78, 0.84, 0.94], alpha: a * 0.9 });
      }
      if (t > l.end) {
        const ok = t - l.end;
        this.text('[ OK ]', 760, y, { size: 22, weight: 700, color: [0.45, 1, 0.65], alpha: clamp(ok / 0.1) * (k === i ? 0.95 : 0.5), align: 'right' });
      }
    }
  }

  slamLyrics(f, i) {
    const t = f.t, l = this.lyr.lines[i];
    const words = l.words.filter((w) => w.text.trim());
    let k = -1;
    words.forEach((w, j) => { if (t >= w.t) k = j; });
    if (k < 0) return;
    const w = words[k], tau = t - w.t;
    const str = w.text.trim().toUpperCase();
    const lineIdx = this.lyr.lines.indexOf(l);
    const g = lineIdx * 7 + k;
    const size = Math.min(230, 1750 / (str.length * 0.6));
    let fadeEnd = Math.min(this.lyr.lines[i + 1]?.start ?? Infinity, l.end + 0.5);
    if (l.start >= this.dir.finalExec - 0.05) fadeEnd = Math.min(fadeEnd, this.dir.finalExec + 0.5);
    const alpha = 1 - clamp((t - fadeEnd) / 0.25);
    if (alpha <= 0) return;
    const c = this.ctx;
    const red = g % 2 === 1;
    for (let e = 2; e >= 0; e--) {
      const sc = 1 + 0.28 * Math.exp(-tau * 14) + e * 0.09;
      const a = e === 0 ? alpha : alpha * (0.14 / e) * Math.exp(-tau * 3);
      c.save();
      c.translate(960 + (hash(g) - 0.5) * 40, 560);
      c.rotate((hash(g + 3) - 0.5) * 0.07);
      c.scale(sc, sc);
      this.text(str, 0, 0, { size, weight: 800, color: e === 0 && red ? this.acc : INK, alpha: a, align: 'center', base: 'middle', spacing: 4 });
      c.restore();
    }
    // vertical translation on the right
    const chars = Array.from(l.zh.replace(/\s+/g, ''));
    const prog = clamp((t - l.start) / Math.max(0.3, l.end - l.start));
    const n = Math.ceil(prog * chars.length);
    chars.slice(0, n).forEach((ch, j) => {
      const a = j === n - 1 ? clamp((prog * chars.length - j) * 2) : 1;
      this.text(ch, 1750, 250 + j * 84, { size: 70, weight: 600, family: ZH, color: j % 2 ? INK : this.acc, alpha: a * alpha * 0.95, align: 'center' });
    });
    const total = this.dir.execHits.length;
    const n2 = this.dir.execHits.filter((h) => h <= t + 0.01).length;
    if (t < this.dir.countHits[0]) this.text(`execute[${String(n2).padStart(2, '0')}/${total}]`, 100, 980, { size: 20, weight: 700, color: this.acc, alpha: 0.85 });
  }

  countLyrics(f, i) {
    const t = f.t, l = this.lyr.lines[i];
    const words = l.words.filter((w) => w.text.trim());
    let k = -1;
    words.forEach((w, j) => { if (t >= w.t) k = j; });
    if (k < 0) return;
    const tau = t - words[k].t, pop = 1 + 0.3 * Math.exp(-tau * 14);
    const c = this.ctx;
    c.save();
    c.translate(430, 560);
    c.scale(pop, pop);
    this.text(words[k].text.trim(), 0, 0, { size: 150, weight: 800, color: INK, align: 'center', base: 'middle' });
    c.restore();
    const zh = l.zhPerWord ? l.zhPerWord[k] : '';
    if (zh) {
      c.save();
      c.translate(1490, 560);
      c.scale(pop, pop);
      this.text(zh, 0, 0, { size: 220, weight: 600, family: ZH, color: this.acc, align: 'center', base: 'middle' });
      c.restore();
    }
    for (let j = 0; j < words.length; j++) {
      const x = 960 - ((words.length - 1) / 2) * 90 + j * 90, on = j <= k;
      c.strokeStyle = css(on ? this.acc : INK, on ? 0.95 : 0.3);
      c.lineWidth = 2;
      c.strokeRect(x - 30, 940, 60, 60);
      if (on) { c.fillStyle = css(this.acc, j === k ? 0.9 : 0.35); c.fillRect(x - 30, 940, 60, 60); }
      this.text(String(j + 1), x, 971, { size: 30, weight: 800, color: on ? [0.05, 0, 0] : INK, alpha: on ? 1 : 0.5, align: 'center', base: 'middle' });
    }
  }

  // ------------------------------------------------------------------ HUD
  drawHUD(f) {
    const t = f.t, a = f.look.hud, c = this.ctx, tl = this.tl;
    if (a <= 0.01) return;
    const fadeIn = clamp((t - 0.6) / 1.0) * (1 - f.post.fade);
    const A = a * fadeIn;
    if (A <= 0.01) return;
    // corner brackets
    c.strokeStyle = css(INK, 0.35 * A);
    c.lineWidth = 1.5;
    for (const [x, y, sx, sy] of [[36, 36, 1, 1], [1884, 36, -1, 1], [36, 1044, 1, -1], [1884, 1044, -1, -1]]) {
      c.beginPath();
      c.moveTo(x, y + sy * 28); c.lineTo(x, y); c.lineTo(x + sx * 28, y);
      c.stroke();
    }
    // title + section
    c.fillStyle = css(this.acc, (0.5 + 0.5 * f.beat) * A);
    c.beginPath(); c.arc(70, 57, 5, 0, TAU); c.fill();
    this.text('world.execute(me);', 86, 63, { size: 17, weight: 600, color: INK, alpha: 0.85 * A });
    const sec = String(f.section).padStart(2, '0');
    const secAge = t - (this.dir.sectionStarts[f.section] ?? 0);
    const secName = secAge < 0.4 ? scramble(f.sectionName, 1 - secAge / 0.4, Math.floor(t * 40)) : f.sectionName;
    this.text(`§${sec}  ${secName}`, 86, 88, { size: 14, weight: 500, color: this.acc, alpha: 0.9 * A, spacing: 1 });
    // clock + bar/beat
    const b = tl.beat(t), bar = Math.max(0, Math.floor(b / 4)) + 1, bi = ((Math.floor(b) % 4) + 4) % 4;
    this.text(`T+ ${fmtTime(t)}`, 1856, 63, { size: 17, weight: 600, color: INK, alpha: 0.85 * A, align: 'right' });
    this.text(`BAR ${String(bar).padStart(3, '0')}  ·  ${tl.bpm.toFixed(1)} BPM`, 1784, 88, { size: 14, color: INK, alpha: 0.6 * A, align: 'right' });
    for (let k = 0; k < 4; k++) {
      const on = b >= 0 && k === bi;
      c.fillStyle = css(on ? this.acc : INK, (on ? 0.95 : 0.2) * A);
      c.fillRect(1800 + k * 15, 78, 10, 10);
    }
    // energy meters
    const bands = ['sub', 'low', 'mid', 'high'];
    bands.forEach((n, k) => {
      const v = tl.sample(n, t);
      const x = 1848 - k * 12, h = 90 * v;
      c.fillStyle = css(INK, 0.12 * A);
      c.fillRect(x, 470, 5, 90);
      c.fillStyle = css(this.acc, 0.75 * A);
      c.fillRect(x, 560 - h, 5, h);
    });
    // progress line with section ticks
    const p = clamp(t / tl.duration);
    c.fillStyle = css(INK, 0.15 * A);
    c.fillRect(64, 1030, 1792, 1);
    c.fillStyle = css(this.acc, 0.85 * A);
    c.fillRect(64, 1029, 1792 * p, 3);
    for (const s of this.dir.sectionStarts) {
      const x = 64 + 1792 * clamp(s / tl.duration);
      c.fillStyle = css(INK, 0.35 * A);
      c.fillRect(x, 1024, 1, 12);
    }
    this.text(`f ${String(Math.floor(t * 60)).padStart(5, '0')}`, 1856, 1015, { size: 12, color: INK, alpha: 0.4 * A, align: 'right' });
    // object log
    const cues = this.dir.cues;
    let k = cues.length - 1;
    while (k > 0 && cues[k].t > t) k--;
    const rows = [];
    for (let j = k; j >= 0 && rows.length < 3; j--) {
      if (j > 0 && CLASS_NAMES[cues[j].shape] === CLASS_NAMES[cues[j - 1].shape] && cues[j].shape === cues[j - 1].shape) continue;
      rows.push(cues[j]);
    }
    rows.forEach((cue, r) => {
      const str = `[${fmtTime(cue.t)}] me = new ${CLASS_NAMES[cue.shape] ?? cue.shape}();`;
      const s2 = r === 0 ? this.typed(str, t - cue.t, 70) : str;
      this.text(s2, 64, 1008 - r * 20, { size: 13, color: r === 0 ? this.acc : INK, alpha: (r === 0 ? 0.85 : 0.4 - r * 0.1) * A });
    });
  }

  // ------------------------------------------------------------------ widgets
  w_boot(f, lt) {
    const rows = [
      'SIMULATION KERNEL  build 2016.miracle',
      `tempo ${this.tl.bpm.toFixed(3)} bpm · grid ${Math.round(this.tl.P * 1000)} ms · n = 16384`,
    ];
    rows.forEach((r, k) => this.text(this.typed(r, lt - 0.6 - k * 0.5, 60), 100, 190 + k * 26, { size: 15, color: k ? INK : this.acc, alpha: 0.6 }));
    this.line(100, 244, 760, 244, INK, 0.15 * clamp(lt - 1));
  }

  w_params(f, lt) {
    const tl = this.tl, cam = f.cam, cue = this.cueAt(f.t, 'dataBars');
    const rows = [
      ['points', '16384'], ['tempo', tl.bpm.toFixed(3)], ['beat_ms', (tl.P * 1000).toFixed(2)], ['seed', '0x2016'],
      ['dim', '3'], ['fps', '60'], ['blocks', '14'], ['world', lt > 3.3 ? 'new' : 'null'],
    ];
    const a = 1 - clamp((lt - 3.5) / 0.3);
    const { n, pitch, base, cx } = DATA_BARS;
    rows.forEach(([k, v], j) => {
      const x = cx + (j - (n - 1) / 2) * pitch;
      const lj = lt - 0.15 - j * DATA_BARS.delay;
      const pb = this.proj(cam, transformPoint('dataBars', cue, [x, base - 0.1, 0], f.t, cam));
      this.text(k, pb[0], pb[1], { size: 14, color: INK, alpha: 0.55 * a * clamp(lj / 0.2 + 1), align: 'center' });
      if (lj < 0) return;
      const pt = this.proj(cam, transformPoint('dataBars', cue, [x, base + dataBarHeight(j, lt) + 0.07, 0], f.t, cam));
      this.text(this.typed(v, lj, 30), pt[0], pt[1], { size: 16, weight: 700, color: j === 7 ? this.acc : INK, alpha: a, align: 'center' });
    });
    const ph = this.proj(cam, transformPoint('dataBars', cue, [cx, base + 1.5, 0], f.t, cam));
    this.text('params.init()', ph[0], ph[1], { size: 18, weight: 700, color: this.acc, alpha: a * clamp(lt / 0.2), align: 'center' });
  }

  w_title(f, lt, w) {
    const dur = w.b - w.a;
    const out = clamp((lt - (dur - 0.45)) / 0.45);
    const a = 1 - out;
    const title = this.lyr.meta.ti || 'world.execute(me);';
    const str = this.typed(title, lt, 50);
    const g = out > 0 ? out : Math.exp(-lt * 6);
    const c = this.ctx;
    for (let k = 0; k < 3; k++) {
      const dx = k ? (hash(Math.floor(f.t * 20) + k) - 0.5) * 60 * g : 0;
      this.text(str, 960 + dx, 520, { size: 112, weight: 700, color: k === 1 ? this.acc : k === 2 ? this.acc2 : INK, alpha: (k ? 0.35 * g : 1) * a, align: 'center', base: 'middle' });
    }
    const wl = 700 * ease.outCubic(clamp((lt - 0.3) / 0.6));
    c.fillStyle = css(this.acc, 0.8 * a);
    c.fillRect(960 - wl / 2, 596, wl, 2);
    const artist = (this.lyr.meta.ar || 'Mili').split(/\s*\(/)[0];
    this.text(artist, 960, 650, { size: 34, weight: 600, color: INK, alpha: clamp((lt - 0.6) / 0.3) * a, align: 'center', spacing: 14 });
    const credits = this.lyr.header.slice(1);
    credits.forEach((cr, k) => this.text(cr, 960, 710 + k * 28, { size: 16, color: INK, alpha: 0.55 * clamp((lt - 1 - k * 0.2) / 0.3) * a, align: 'center' }));
    if (this.lyr.meta.al) this.text(`album · ${this.lyr.meta.al}`, 960, 710 + credits.length * 28 + 10, { size: 14, color: this.acc2, alpha: 0.5 * clamp((lt - 1.6) / 0.3) * a, align: 'center', spacing: 3 });
  }

  w_primLabel(f) {
    const cue = this.cueAt(f.t);
    const info = {
      g_cube: 'V 8 · E 12 · F 6', g_octa: 'V 6 · E 12 · F 8', g_torus: 'genus 1 · χ = 0', g_icosa: 'V 12 · E 30 · F 20',
      torusKnot: 'knot (2, 5)', g_mobius: 'non-orientable · 1 side', g_klein: 'χ = 0 · no inside', g_sphere: 'genus 0 · χ = 2',
    }[cue.shape];
    if (!info) return;
    const lt = f.t - cue.t;
    const name = `new ${CLASS_NAMES[cue.shape]}()`;
    this.text(this.typed(name, lt, 60), 960, 910, { size: 40, weight: 700, color: INK, align: 'center' });
    this.text(info, 960, 950, { size: 18, color: this.acc, alpha: clamp(lt / 0.2) * 0.85, align: 'center', spacing: 2 });
  }

  w_math(f) {
    const t = f.t, cam = f.cam, cue = this.cueAt(t), lt = t - cue.t, c = this.ctx;
    const acc = this.acc, a = clamp(lt / 0.3);
    const label = (s, x, y, o = {}) => this.text(s, x, y, { size: 18, color: INK, alpha: 0.75 * a, ...o });
    if (cue.shape === 'pointsSet' || cue.shape === 'tesseract') {
      const v4 = (v) => [v & 1 ? 1 : -1, v & 2 ? 1 : -1, v & 4 ? 1 : -1];
      if (cue.shape === 'pointsSet') {
        for (let v = 0; v < 16; v++) {
          const k = (0.62 * 3) / (3 - (v & 8 ? 1 : -1));
          const p = v4(v).map((q) => q * k);
          const wp = transformPoint('pointsSet', cue, p, t, cam);
          const [sx, sy] = this.proj(cam, wp);
          label(`p${v}`, sx + 10, sy - 8, { size: 13, alpha: 0.6 * clamp((lt - v * 0.05) / 0.2) });
        }
        label('P = { p₀ … p₁₅ } ⊂ ℝ⁴', 140, 200, { size: 26, weight: 600, color: acc });
      } else {
        label('dim(P) = 4', 140, 200, { size: 26, weight: 600, color: acc });
        label('ℝ⁴ → ℝ³ → ℝ²   perspective projection', 140, 232, { size: 16, alpha: 0.55 * a });
      }
    } else if (cue.shape === 'circle' || cue.shape === 'unroll') {
      const o = this.proj(cam, transformPoint('circle', cue, [0, 0.12, 0], t, cam));
      const r = this.proj(cam, transformPoint('circle', cue, [1.05, 0.12, 0], t, cam));
      const R = r[0] - o[0];
      if (cue.shape === 'circle') {
        const head = TAU * ease.outCubic(clamp(lt / 1.1));
        label('O', o[0] - 26, o[1] + 24);
        label(`θ = ${Math.round((head / TAU) * 360)}°`, o[0] + 16, o[1] + 30, { size: 16, color: acc });
        label('C = 2πr', o[0] + R * 0.8, o[1] - R * 0.85, { size: 30, weight: 600, color: acc });
        label('r', o[0] + Math.sin(head) * R * 0.5 + 10, o[1] - Math.cos(head) * R * 0.5, { size: 20, weight: 700 });
      } else {
        const y = this.proj(cam, transformPoint('unroll', cue, [0, -0.72, 0], t, cam))[1];
        const xl = this.proj(cam, transformPoint('unroll', cue, [-2.6, -0.72, 0], t, cam))[0];
        const xr = this.proj(cam, transformPoint('unroll', cue, [2.6, -0.72, 0], t, cam))[0];
        const e = clamp(lt / 1.6);
        this.line(xl, y + 26, lerp(xl, xr, e), y + 26, acc, 0.8 * a, 1.5);
        this.line(xl, y + 18, xl, y + 34, acc, 0.8 * a, 1.5);
        if (e >= 1) this.line(xr, y + 18, xr, y + 34, acc, 0.8 * a, 1.5);
        label('2πr ≈ 6.2832 r', (xl + xr) / 2, y + 60, { size: 22, weight: 600, color: acc, align: 'center' });
      }
    } else if (cue.shape === 'sine' || cue.shape === 'tangents') {
      const o = this.proj(cam, transformPoint('sine', cue, [-2.6, 0.12 + 0.75, 0], t, cam));
      label('y = sin(kx − ωt)', o[0], o[1], { size: 26, weight: 600, color: acc });
      if (cue.shape === 'tangents') {
        const xs = tangentXs(t);
        xs.slice(2, 5).forEach((x0) => {
          const p = this.proj(cam, transformPoint('tangents', cue, [x0, sineAt(x0, t), 0], t, cam));
          const m = sineSlope(x0, t);
          c.fillStyle = css(this.acc2 ?? acc, 0.9 * a);
          c.beginPath(); c.arc(p[0], p[1], 4, 0, TAU); c.fill();
          label(`m = ${m >= 0 ? '+' : ''}${m.toFixed(2)}`, p[0] + 12, p[1] - 14, { size: 15, color: [1, 0.5, 0.75] });
        });
        label("dy/dx = kA·cos(kx − ωt)", o[0], o[1] + 30, { size: 17, alpha: 0.6 * a });
      }
    } else if (cue.shape === 'lemniscate') {
      label('(x² + y²)² = a²(x² − y²)', 960, 250, { size: 28, weight: 600, color: acc, align: 'center' });
      label('lim  n → ∞', 960, 800, { size: 20, alpha: 0.6 * a, align: 'center' });
    } else if (cue.shape === 'limit') {
      const o = this.proj(cam, transformPoint('limit', cue, [LIMIT_O[0], LIMIT_O[1], 0], t, cam));
      label('lim   1/x = 0', o[0] + 420, o[1] - 250, { size: 34, weight: 600, color: acc });
      label('x→∞', o[0] + 452, o[1] - 222, { size: 16, color: acc });
      label('asymptote', o[0] + 30, o[1] - 12, { size: 14, alpha: 0.5 * a });
      label('asymptote', o[0] + 12, o[1] - 400, { size: 14, alpha: 0.5 * a });
    }
  }

  w_scope(f) {
    const t = f.t;
    if (t < 46.27) return;
    const lt = t - 46.27, a = clamp(lt / 0.2), c = this.ctx;
    const x0 = 200, y0 = 250, x1 = 1720, y1 = 760;
    c.strokeStyle = css(this.acc, 0.35 * a);
    c.lineWidth = 1;
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    for (let k = 1; k < 10; k++) this.line(x0 + ((x1 - x0) * k) / 10, y0, x0 + ((x1 - x0) * k) / 10, y1, INK, 0.07 * a, 1, [2, 6]);
    for (let k = 1; k < 8; k++) this.line(x0, y0 + ((y1 - y0) * k) / 8, x1, y0 + ((y1 - y0) * k) / 8, INK, 0.07 * a, 1, [2, 6]);
    const dc = t >= 47.23;
    this.text(`CH1  ${dc ? 'DC' : 'AC'}  ${dc ? '0.00 Hz' : (this.tl.bpm / 60).toFixed(3) + ' Hz'}`, x0 + 16, y0 + 30, { size: 18, weight: 700, color: this.acc, alpha: a });
    this.text(dc ? 'V = const' : 'Vpp 1.44', x1 - 16, y0 + 30, { size: 18, color: INK, alpha: 0.7 * a, align: 'right' });
    this.text(dc ? '⎓' : '∿', x1 - 16, y1 - 20, { size: 40, color: this.acc, alpha: 0.8 * a, align: 'right' });
  }

  w_years(f, lt) {
    const t = f.t;
    let y;
    if (t < 53.46) y = Math.round(lerp(2016, 2999, ease.inCubic(clamp((t - 51.36) / 2.1))));
    else y = Math.round(lerp(2999, -3000, ease.inOutCubic(clamp((t - 53.46) / 1.5))));
    const era = y > 0 ? 'A.D.' : 'B.C.';
    const a = clamp(lt / 0.2) * (1 - clamp((t - 54.95) / 0.2));
    this.text(String(Math.abs(y) || 1).padStart(4, '0'), 960, 555, { size: 120, weight: 800, color: INK, alpha: a, align: 'center', base: 'middle', spacing: 6 });
    this.text(era, 960, 640, { size: 30, weight: 700, color: this.acc, alpha: a, align: 'center', spacing: 10 });
    this.text(t < 53.46 ? 'Δt > 0' : 'Δt < 0', 960, 470, { size: 18, color: INK, alpha: 0.5 * a, align: 'center' });
  }

  w_union(f) {
    const t = f.t, cam = f.cam;
    const cue = this.cueAt(t, 'twoSpheres');
    if (!cue) return;
    const lt = t - cue.t, sep = uniteSep(lt), a = clamp(lt / 0.3);
    if (sep > 0.2) {
      for (const [s, name] of [[-1, 'me'], [1, 'you']]) {
        const p = this.proj(cam, transformPoint('twoSpheres', cue, [(s * sep) / 2, 0.95, 0], t, cam));
        this.text(name, p[0], p[1], { size: 26, weight: 700, color: s < 0 ? [0.4, 0.9, 1] : [1, 0.45, 0.7], alpha: a * clamp((sep - 0.2) / 0.3), align: 'center' });
      }
    }
    const u = clamp((0.4 - sep) / 0.3);
    if (u > 0) this.text('me ∪ you', 960, 230, { size: 40, weight: 700, color: INK, alpha: u * (1 - clamp((t - 58.9) / 0.3)), align: 'center', spacing: 4 });
  }

  w_sandbox(f) {
    const t = f.t, cue = this.cueAt(t), a = clamp((t - cue.t) / 0.3);
    const s = cue.shape === 'nestedCages' ? 'sandbox { sandbox { sandbox { … } } }' : 'sandbox://simulation';
    this.text(this.typed(s, t - cue.t, 50), 960, 190, { size: 22, weight: 600, color: this.acc, alpha: a, align: 'center' });
    this.text('escape: false', 960, 220, { size: 15, color: INK, alpha: 0.5 * a, align: 'center' });
  }

  w_spec(f) {
    const t = f.t, cue = this.cueAt(t), lt = t - cue.t;
    const spec = {
      eggplant: ['Eggplant', 'Solanum melongena', [['class', 'Vegetable'], ['energy', '25 kcal/100 g'], ['colour', '#7A3CB8']]],
      tomato: ['Tomato', 'Solanum lycopersicum', [['class', 'Fruit (botanically)'], ['energy', '18 kcal/100 g'], ['lycopene', 'true']]],
      cat: ['TabbyCat', 'Felis catus', [['pattern', 'tabby'], ['purr', '25–150 Hz'], ['lives', '9 (unverified)']]],
      radiant: ['God', 'singleton', [['instances', '1'], ['scope', 'global'], ['parent', 'null']]],
      exists: ['∃ me', 'existence proof', [['given', 'you'], ['therefore', 'me'], ['status', '∎ Q.E.D.']]],
    }[cue.shape];
    if (!spec) return;
    const [title, sub, rows] = spec;
    const x = 1420, y = 330, a = clamp(lt / 0.2), c = this.ctx;
    c.fillStyle = css([0.02, 0.02, 0.04], 0.55 * a);
    c.fillRect(x, y, 400, 70 + rows.length * 34);
    c.strokeStyle = css(this.acc, 0.6 * a);
    c.strokeRect(x, y, 400, 70 + rows.length * 34);
    c.fillStyle = css(this.acc, 0.85 * a);
    c.fillRect(x, y, 6, 70 + rows.length * 34);
    this.text(this.typed(title, lt, 40), x + 24, y + 34, { size: 22, weight: 700, color: INK, alpha: a });
    this.text(sub, x + 24, y + 58, { size: 14, color: this.acc, alpha: 0.9 * clamp((lt - 0.2) / 0.2) });
    rows.forEach(([k, v], j) => {
      const lj = lt - 0.35 - j * 0.18;
      this.text(k, x + 24, y + 96 + j * 34, { size: 15, color: INK, alpha: 0.5 * clamp(lj / 0.1) });
      this.text(this.typed(v, lj, 40), x + 380, y + 96 + j * 34, { size: 15, weight: 600, color: INK, alpha: clamp(lj / 0.1), align: 'right' });
    });
  }

  w_purr(f, lt) {
    const c = this.ctx;
    for (let k = 0; k < 4; k++) {
      const ph = fract(lt * 2.2 - k * 0.25);
      for (const s of [-1, 1]) {
        c.strokeStyle = css(this.acc, 0.6 * (1 - ph));
        c.lineWidth = 2;
        c.beginPath();
        c.arc(960 + s * 330, 520, 40 + ph * 120, s < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, s < 0 ? Math.PI * 1.25 : Math.PI * 0.25);
        c.stroke();
      }
    }
    this.text('prrr~', 1360, 400, { size: 22, weight: 600, color: this.acc, alpha: 0.8 * clamp(lt / 0.2), align: 'center' });
  }

  w_switchLabel(f, lt) {
    const on = toggleK(lt) > 0.5;
    this.text(on ? 'true' : 'false', 960, 770, { size: 34, weight: 700, color: on ? this.acc : INK, alpha: 0.9 * clamp(lt / 0.2), align: 'center' });
    this.text('switch()', 960, 250, { size: 20, color: INK, alpha: 0.5 * clamp(lt / 0.2), align: 'center' });
  }

  w_clockText(f, lt) {
    const Hh = clockHours(lt), h24 = Math.floor(Hh) % 24, m = Math.floor(fract(Hh) * 60);
    const pm = h24 >= 12, h12 = h24 % 12 || 12;
    const a = clamp(lt / 0.2) * (1 - clamp((lt - 1.35) / 0.2));
    this.text(`${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}`, 1520, 540, { size: 76, weight: 700, color: INK, alpha: a, align: 'center', base: 'middle' });
    this.text(pm ? 'PM' : 'AM', 1520, 610, { size: 34, weight: 800, color: this.acc, alpha: a, align: 'center', spacing: 8 });
  }

  w_chladniLabel(f) {
    const t = f.t, B = this.dir.B(226);
    const k = t < B ? -1 : Math.floor((t - B) / this.tl.P);
    const [m, n] = k < 0 ? [1, 2] : chladniMode(k);
    const a = clamp((t - 103.44) / 0.3);
    this.text(`mode (m, n) = (${m}, ${n})`, 1500, 300, { size: 24, weight: 700, color: this.acc, alpha: a });
    this.text('cos(nπx)cos(mπy) − cos(mπx)cos(nπy) = 0', 1500, 332, { size: 14, color: INK, alpha: 0.55 * a });
    this.text(`f ∝ m² + n² = ${m * m + n * n}`, 1500, 360, { size: 16, color: INK, alpha: 0.7 * a });
  }

  w_percent(f, lt) {
    const q = progressK(lt), a = clamp(lt / 0.15) * (1 - clamp((lt - 1.4) / 0.25));
    this.text(`${Math.round(q * 100)}%`, 960, 480, { size: 96, weight: 800, color: INK, alpha: a, align: 'center', base: 'middle' });
    if (q >= 1) this.text('COMPLETE', 960, 550, { size: 20, weight: 700, color: this.acc, alpha: a, align: 'center', spacing: 8 });
  }

  w_disconnect(f) {
    const t = f.t, times = [111.859, 112.768, 113.721, 114.615, 115.52], c = this.ctx;
    times.forEach((tt, k) => {
      const lt = t - tt;
      if (lt < 0) return;
      const e = ease.outCubic(clamp(lt / 0.25)), a = e * (1 - clamp((t - 117.1) / 0.3));
      const x = 1860 - 380 * e, y = 150 + k * 50;
      c.fillStyle = css([0.03, 0.03, 0.05], 0.6 * a);
      c.fillRect(x, y, 360, 38);
      c.fillStyle = css([1, 0.4, 0.65], 0.9 * a);
      c.fillRect(x, y, 4, 38);
      this.text(`peer disconnected  (${k + 1}/5)`, x + 18, y + 25, { size: 15, color: INK, alpha: 0.85 * a });
    });
  }

  w_isolation(f, lt) {
    const a = clamp((lt - 0.4) / 0.4);
    this.text('objects: 1', 960, 620, { size: 16, color: INK, alpha: 0.55 * a, align: 'center', spacing: 3 });
  }

  w_rmlog(f) {
    const t = f.t, cam = f.cam, cue = this.cueAt(t, 'fragments'), lt = t - cue.t;
    const del = [];
    for (let b = 0; b < 55; b++) {
      const d = fragDeleteAt(b);
      if (d !== Infinity && lt >= d) del.push([d, b]);
    }
    del.sort((x, y) => x[0] - y[0]);
    del.slice(-9).forEach(([d, b], k, arr) => {
      const age = lt - d;
      const col = b % 11, row = Math.floor(b / 11);
      const p = this.proj(cam, transformPoint('fragments', cue, [0.12 + (col - 5) * FR_PITCH, 0.2 + (row - 2) * FR_PITCH, 0], t, cam));
      if (age < 0.5 && t < 122.95) this.text('rm', p[0], p[1] + 6, { size: 16, weight: 700, color: this.acc2, alpha: 1 - age / 0.5, align: 'center' });
      const r = arr.length - 1 - k;
      this.text(`rm -f fragment_0x${(b * 37 + 16).toString(16).padStart(3, '0')}`, 100, 300 + (8 - r) * 24, { size: 14, color: INK, alpha: 0.5 * (1 - r / 9) * (1 - clamp((t - 122.6) / 0.3)) });
    });
  }

  w_denied(f, lt) {
    const t = f.t;
    this.text(this.typed('$ sudo challenge --target=god', lt, 30), 100, 200, { size: 22, weight: 600, color: INK, alpha: 0.85 });
    if (t > 127.44) this.text('permission denied: you are not root', 100, 234, { size: 20, weight: 700, color: [1, 0.25, 0.3], alpha: clamp((t - 127.44) / 0.1) });
  }

  w_exception(f, lt) {
    const t = f.t, c = this.ctx;
    const big = t > 132.55;
    const a = clamp(lt / 0.08) * (1 - clamp((t - 134.3) / 0.6));
    const flick = big && Math.floor(t * 24) % 5 === 0 ? 0.3 : 1;
    const w = big ? 1000 : 760, h = big ? 300 : 210;
    const x = 960 - w / 2 + (big ? (hash(Math.floor(t * 20)) - 0.5) * 20 : 0), y = big ? 340 : 400;
    c.fillStyle = css([0.06, 0.0, 0.01], 0.82 * a);
    c.fillRect(x, y, w, h);
    c.strokeStyle = css([1, 0.2, 0.25], 0.9 * a * flick);
    c.lineWidth = 2;
    c.strokeRect(x, y, w, h);
    c.fillStyle = css([1, 0.15, 0.2], 0.9 * a * flick);
    c.fillRect(x, y, w, 36);
    this.text('⚠  Uncaught exception', x + 16, y + 25, { size: 17, weight: 700, color: [0.05, 0, 0], alpha: a });
    this.text('IllegalArgumentException', x + 24, y + 80, { size: big ? 40 : 30, weight: 800, color: [1, 0.3, 0.35], alpha: a * flick });
    const trace = ['at god.validate(args)        heaven.js:0', 'at world.execute(me)         simulation.js:130', 'at <anonymous>                love.js:∞'];
    trace.forEach((s, k) => this.text(this.typed(s, lt - 0.3 - k * 0.2, 80), x + 40, y + 130 + k * 30 + (big ? 20 : 0), { size: 16, color: INK, alpha: 0.7 * a }));
  }

  w_hexdump(f, lt) {
    const t = f.t, c = this.ctx, scroll = Math.floor(this.tl.beat(t) * 2);
    const rows = 26;
    for (let side = 0; side < 2; side++) {
      for (let r = 0; r < rows; r++) {
        const n = scroll + r + side * 1000;
        let s = `0x${(0x7ff3a000 + n * 16).toString(16)}:`;
        for (let k = 0; k < 6; k++) s += ' ' + Math.floor(hash(n * 17 + k) * 256).toString(16).padStart(2, '0');
        const hot = hash(n * 3 + Math.floor(t * 8)) < 0.06;
        this.text(s, side ? 1480 : 90, 150 + r * 30, { size: 14, color: hot ? INK : this.acc, alpha: (hot ? 0.9 : 0.35) * clamp(lt / 0.3) });
      }
    }
    if (lt < 2.5 && Math.floor(t * 3) % 2 === 0) this.text('SEGMENTATION FAULT (core dumped)', 960, 860, { size: 26, weight: 800, color: this.acc, align: 'center', spacing: 3 });
    const B = this.dir.B(312);
    if (t > B) {
      const depth = Math.floor(Math.pow(2, 4 + (t - B) * 3.3));
      this.text(`recursion depth ${depth.toLocaleString('en-US')}`, 960, 900, { size: 22, weight: 700, color: INK, alpha: 0.8, align: 'center' });
    }
  }

  w_hazard(f, lt) {
    const c = this.ctx, off = (f.t * 120) % 60;
    const a = clamp(lt / 0.1) * (1 - f.post.fade);
    for (const y of [0, 1052]) {
      c.save();
      c.beginPath();
      c.rect(0, y, W, 28);
      c.clip();
      c.fillStyle = css([0.1, 0, 0.01], 0.9 * a);
      c.fillRect(0, y, W, 28);
      c.fillStyle = css(this.acc, 0.85 * a);
      for (let x = -60 + off; x < W + 60; x += 60) {
        c.beginPath();
        c.moveTo(x, y + 28); c.lineTo(x + 28, y); c.lineTo(x + 52, y); c.lineTo(x + 24, y + 28);
        c.fill();
      }
      c.restore();
    }
  }

  w_clonesLabel(f) {
    const t = f.t, cam = f.cam, cue = this.cueAt(t, 'clones'), lt = t - cue.t, a = clamp(lt / 0.3);
    for (let k = 0; k < 12; k++) {
      const col = k % 4, row = Math.floor(k / 4);
      const p = this.proj(cam, transformPoint('clones', cue, [(col - 1.5) * 0.85, (row - 1) * 0.78 + 0.45, 0], t, cam));
      this.text(`them[${k}]`, p[0], p[1], { size: 13, color: INK, alpha: 0.6 * a * clamp((lt - k * 0.04) / 0.2), align: 'center' });
    }
  }

  w_nn(f, lt) {
    const c = this.ctx, x0 = 1480, y0 = 150, w = 360, h = 150;
    const a = clamp(lt / 0.3) * (1 - clamp((lt - 3.4) / 0.3));
    c.strokeStyle = css(INK, 0.25 * a);
    c.strokeRect(x0, y0, w, h);
    c.strokeStyle = css(this.acc, 0.9 * a);
    c.lineWidth = 2;
    c.beginPath();
    const steps = 60, prog = clamp(lt / 3.2);
    for (let k = 0; k <= steps * prog; k++) {
      const u = k / steps, loss = 0.08 + 0.85 * Math.exp(-u * 4) + 0.04 * Math.sin(u * 40) * (1 - u);
      const x = x0 + u * w, y = y0 + h - loss * h * 0.95;
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    const epoch = Math.floor(prog * 1000), loss = 0.08 + 0.85 * Math.exp(-prog * 4);
    this.text('train(love.model)', x0, y0 - 14, { size: 15, weight: 700, color: this.acc, alpha: a });
    this.text(`epoch ${String(epoch).padStart(4, '0')}   loss ${loss.toFixed(4)}`, x0, y0 + h + 24, { size: 14, color: INK, alpha: 0.7 * a });
    const cam = f.cam, cue = this.cueAt(f.t, 'neural');
    const out = NEURAL.nodes[NEURAL.nodes.length - 1];
    const p = this.proj(cam, transformPoint('neural', cue, [out.x, out.y, 0], f.t, cam));
    this.text('♡', p[0] + 30, p[1] + 8, { size: 26, color: this.acc, alpha: a * clamp((lt - 2) / 0.5) });
  }

  w_equation(f, lt) {
    const a = clamp(lt / 0.2) * (1 - clamp((lt - 3.4) / 0.25));
    this.text(this.typed('(x² + y² − 1)³ − x²y³ = 0', lt, 22), 960, 158, { size: 46, weight: 700, color: INK, alpha: a, align: 'center' });
    this.text('(x² + 9⁄4 y² + z² − 1)³ − x²z³ − 9⁄80 y²z³ = 0', 960, 198, { size: 17, color: this.acc, alpha: 0.7 * a * clamp((lt - 1.2) / 0.3), align: 'center' });
    if (!this.heartPlot) this.heartPlot = makeHeartPlot();
    const c = this.ctx, x0 = 1520, y0 = 380, S = 280;
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = css(INK, 0.3);
    c.strokeRect(x0, y0, S, S);
    this.line(x0, y0 + S / 2 + 20, x0 + S, y0 + S / 2 + 20, INK, 0.2);
    this.line(x0 + S / 2, y0, x0 + S / 2, y0 + S, INK, 0.2);
    c.beginPath();
    c.rect(x0, y0, S * ease.inOutCubic(clamp((lt - 0.3) / 1.4)), S);
    c.clip();
    c.drawImage(this.heartPlot, x0, y0, S, S);
    c.restore();
  }

  w_freeLabel(f) {
    const t = f.t, cam = f.cam, cue = this.cueAt(t, 'free'), lt = t - cue.t;
    const k = ease.inCubic(clamp(lt / 1.6));
    const p = this.proj(cam, transformPoint('free', cue, [2.9 * k, 0.12 + 2.0 * k + 0.25, -1.0 * k], t, cam));
    const a = clamp(lt / 0.3) * (1 - clamp((lt - 1.2) / 0.5));
    this.text('you.free = true', p[0], p[1], { size: 18, weight: 700, color: [0.7, 0.9, 1], alpha: a, align: 'center' });
    if (t > 189.86) this.text('me.free = false', 960, 250, { size: 22, weight: 700, color: this.acc, alpha: clamp((t - 189.86) / 0.2) * (1 - clamp((t - 190.5) / 0.25)), align: 'center' });
  }

  w_shutdown(f, lt) {
    const bar = this.tl.P * 4;
    const rows = [
      'saving memories .............. done',
      'releasing 16384 points ....... done',
      'closing world ................ done',
      'gc: love is not collectible',
      'halt()',
    ];
    rows.forEach((r, k) => {
      const lk = lt - k * bar * 1.5 - 0.5;
      if (lk < 0) return;
      this.text(this.typed(r, lk, 28), 100, 300 + k * 30, { size: 17, color: k === 3 ? this.acc : INK, alpha: 0.6 });
    });
  }

  w_final(f, lt) {
    const a = clamp(lt / 0.2);
    const s = this.typed('> world.execute(me);', lt - 0.3, 18);
    this.text(s, 930, 500, { size: 40, weight: 600, color: INK, alpha: a, align: 'right' });
    this.text('// simulation terminated', 960, 580, { size: 20, color: this.acc, alpha: 0.6 * clamp((lt - 2) / 0.4), align: 'center' });
  }
}

const GLYPHS = '01<>/\\{}[]#$%&*+=?';
function scramble(str, amt, seed, keepCJK = false) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const r = hash(seed * 131 + i);
    if (ch === ' ' || r > amt) out += ch;
    else if (r < amt * 0.5) out += keepCJK ? '' : '';
    else out += GLYPHS[Math.floor(hash(seed + i * 7) * GLYPHS.length)];
  }
  return out;
}

function makeHeartPlot() {
  const S = 280, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const img = c.createImageData(S, S);
  const f = (x, y) => (x * x + y * y - 1) ** 3 - x * x * y * y * y;
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const x = ((px - S / 2) / S) * 3.2, y = -((py - S / 2 - 20) / S) * 3.2;
      const v = f(x, y);
      const e = 3.2 / S;
      const gx = (f(x + e, y) - f(x - e, y)) / (2 * e), gy = (f(x, y + e) - f(x, y - e)) / (2 * e);
      const d = Math.abs(v) / (Math.hypot(gx, gy) + 1e-6) / e;
      const k = (py * S + px) * 4;
      const line = clamp(1.6 - d);
      const fill = v < 0 ? 0.12 : 0;
      img.data[k] = 255;
      img.data[k + 1] = 90 + 60 * line;
      img.data[k + 2] = 150 + 50 * line;
      img.data[k + 3] = 255 * Math.max(line, fill);
    }
  c.putImageData(img, 0, 0);
  return cv;
}
