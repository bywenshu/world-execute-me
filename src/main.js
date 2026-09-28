import { parseLRC, Lyrics } from './lrc.js';
import { Timeline } from './timeline.js';
import { Director } from './director.js';
import { buildShapes, SHAPES } from './shapes.js';
import { ParticleSystem } from './particles.js';
import { Renderer } from './renderer.js';
import { Overlay, ZH } from './overlay.js';
import { clamp } from './util.js';

const SONG = 'world.execute(me); - Mili.mp3';
const LRC = 'world.execute(me); - Mili.lrc';
const asset = (f) => '/' + encodeURIComponent(f);
const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');

async function loadFonts() {
  const faces = [
    new FontFace('JetBrains Mono', 'url(/assets/fonts/JetBrainsMono-latin.woff2)', { weight: '100 800' }),
    new FontFace('JetBrains Mono', 'url(/assets/fonts/JetBrainsMono-greek.woff2)', { weight: '100 800', unicodeRange: 'U+0370-03FF' }),
  ];
  await Promise.all(faces.map((f) => f.load()));
  faces.forEach((f) => document.fonts.add(f));
  await Promise.all(['400 30px', '600 70px'].map((s) => document.fonts.load(`${s} ${ZH}`, '执行')));
}

async function boot() {
  const status = document.getElementById('status');
  const say = (s) => status && (status.textContent = s);
  say('loading fonts…');
  await loadFonts();
  say('loading lyrics + analysis…');
  const [lrcText, analysis] = await Promise.all([
    fetch(asset(LRC)).then((r) => r.text()),
    fetch('/data/analysis.json').then((r) => r.json()),
  ]);
  const lyrics = new Lyrics(parseLRC(lrcText));
  const tl = new Timeline(analysis);
  const director = new Director(tl, lyrics);
  say('allocating 16384 points…');
  await new Promise((r) => setTimeout(r, 0));
  buildShapes();
  const ps = new ParticleSystem(director.cues);

  const canvas = document.getElementById('gl');
  const renderer = new Renderer(canvas, { preserve: EXPORT });
  const overlay = new Overlay({ lyrics, director, timeline: tl });

  const shape = (n) => SHAPES[n].data;
  function renderAt(t, dt = 1 / 60) {
    const f = director.frame(t);
    const cam = renderer.camera(f.camera);
    f.cam = cam;
    ps.update(t, { cam, P: tl.P, kick: f.kick, beat: f.beat, shape }, f.fx);
    overlay.draw(f);
    renderer.draw(f, ps, overlay.canvas, dt);
    return f;
  }

  if (EXPORT) {
    const w = Number(params.get('w') || 1920), h = Number(params.get('h') || 1080);
    renderer.resize(w, h);
    overlay.resize(w, h);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    document.body.classList.add('export');
    window.__mv = {
      duration: tl.duration,
      renderFrame: (t, dt) => { renderAt(t, dt); return true; },
      capture: (type = 'image/jpeg', q = 0.94) => canvas.toDataURL(type, q),
      renderBatch: (i0, n, fps, q = 0.94) => {
        const out = [];
        for (let i = i0; i < i0 + n; i++) {
          renderAt(i / fps, 1 / fps);
          out.push(canvas.toDataURL('image/jpeg', q).slice(23));
        }
        return out;
      },
      debug: { ps, director, renderer },
    };
    window.__mvReady = true;
    say('');
    return;
  }

  // ---------------------------------------------------------------- live player
  const audio = new Audio(asset(SONG));
  audio.preload = 'auto';
  const stage = document.getElementById('stage');
  const scrub = document.getElementById('scrub');
  const fill = document.getElementById('fill');

  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = Math.min(vw, (vh * 16) / 9), ch = (cw * 9) / 16;
    stage.style.width = `${cw}px`;
    stage.style.height = `${ch}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    const cap = Number(params.get('maxw') || 2560);
    if (pw > cap) { ph = Math.round((ph * cap) / pw); pw = cap; }
    renderer.resize(pw, ph);
    overlay.resize(pw, ph);
  }
  fit();
  window.addEventListener('resize', fit);

  let clock = 0, lastNow = performance.now();
  const start = document.getElementById('start');
  let started = false;
  const go = async () => {
    if (started) return;
    started = true;
    start.classList.add('gone');
    const t0 = Number(params.get('t') || 0);
    if (t0) audio.currentTime = t0;
    await audio.play().catch(() => {});
  };
  start.addEventListener('click', go);
  say('ready');
  document.getElementById('hint').textContent = 'click / press Enter to execute';

  window.addEventListener('keydown', (e) => {
    if (!started && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); return; }
    if (e.key === ' ') { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
    if (e.key === 'ArrowRight') audio.currentTime = Math.min(tl.duration, audio.currentTime + (e.shiftKey ? 1 : 5));
    if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - (e.shiftKey ? 1 : 5));
    if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  });
  scrub.addEventListener('pointerdown', (e) => {
    const r = scrub.getBoundingClientRect();
    audio.currentTime = clamp((e.clientX - r.left) / r.width) * tl.duration;
  });
  let idle;
  window.addEventListener('pointermove', () => {
    document.body.classList.add('ui');
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.remove('ui'), 1800);
  });

  function tick(now) {
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    const at = audio.currentTime;
    if (!audio.paused) {
      clock += dt;
      if (Math.abs(clock - at) > 0.05) clock = at;
    } else clock = at;
    renderAt(started ? clock : 0.0, dt);
    fill.style.width = `${(clock / tl.duration) * 100}%`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  console.error(e);
  const s = document.getElementById('status');
  if (s) s.textContent = `error: ${e.message}`;
  window.__mvError = String(e.stack || e);
});
