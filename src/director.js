// The choreography: every visual decision keyed to the beat grid and the LRC word timings.
import { clamp, lerp, smoothstep, hex, upperBound, impulse } from './util.js';

const H = (h) => hex(h);

/** Keyframe track: each key overrides some fields and blends in over `fade` seconds. */
class Track {
  constructor(keys) {
    this.keys = keys.slice().sort((a, b) => a.t - b.t);
    this.times = this.keys.map((k) => k.t);
    this.resolved = [];
    let acc = {};
    for (const k of this.keys) {
      const { t, fade, ...vals } = k;
      acc = { ...acc, ...vals };
      this.resolved.push(acc);
    }
  }
  at(t) {
    const k = Math.max(0, upperBound(this.times, t) - 1);
    const cur = this.resolved[k];
    if (k === 0) return cur;
    const fade = this.keys[k].fade ?? 0;
    const f = fade > 0 ? smoothstep(0, 1, (t - this.keys[k].t) / fade) : 1;
    if (f >= 1) return cur;
    const prev = this.resolved[k - 1], out = {};
    for (const key of Object.keys(cur)) {
      const a = prev[key] ?? cur[key], b = cur[key];
      if (typeof b === 'number') out[key] = lerp(a, b, f);
      else if (Array.isArray(b)) out[key] = b.map((v, i) => lerp(a[i], v, f));
      else out[key] = f < 0.5 ? a : b;
    }
    return out;
  }
}

export const CLASS_NAMES = {
  powerLine: 'PowerLine', shield: 'Shield', board: 'Board', primitives: 'Primitive[4]', dataBars: 'Params',
  globe: 'World', galaxy: 'Simulation', g_cube: 'Cube', g_octa: 'Octahedron', g_torus: 'Torus', g_icosa: 'Icosahedron',
  torusKnot: 'TorusKnot', g_mobius: 'Mobius', g_klein: 'KleinBottle', g_sphere: 'Sphere', pointsSet: 'PointSet',
  tesseract: 'Tesseract', circle: 'Circle', unroll: 'Circumference', sine: 'SineWave', tangents: 'Tangent[]',
  lemniscate: 'Infinity', limit: 'Limit', coil: 'Current', acWave: 'AC', dcLine: 'DC', eye: 'Vision',
  eyeClosed: 'Vision(null)', vortex: 'Vortex', tunnel: 'TimeTunnel', tunnelBack: 'TimeTunnel(-1)', twoSpheres: 'Union',
  onion: 'Depth', spiky: 'Stimulus', rose: 'Rose', play: 'Execution', cage: 'Sandbox', nestedCages: 'Sandbox[3]',
  eggplant: 'Eggplant', tomato: 'Tomato', cat: 'TabbyCat', radiant: 'God', exists: 'Existence', toggle: 'Switch',
  venus: 'F', mars: 'M', scribble: 'Whatever', clock: 'Clock', glyphS: 'S', glyphM: 'M', trance: 'Trance',
  chladni0: 'Vibration', chladniCycle: 'Vibration', progressRing: 'Progress', fibSphere: 'Completion',
  leaving: 'Connection', single: 'Isolation', fragments: 'Fragment[55]', fall: 'Heart(broken)', pillar: 'Ascend',
  radiantRed: 'God', shards: 'IllegalArgumentException', corrupt: '0xDEADBEEF', singularity: 'Singularity',
  reticle: 'Target', digit1: '1', digit2: '2', digit3: '3', digit4: '4', digit5: '5', digit6: '6', execText: 'Execution',
  clones: 'Clone[12]', oneSphere: 'Only', neural: 'Network', question: 'Question', heartLine: 'Love', heart3D: 'Love',
  free: 'Freedom', heartCage: 'Love(trapped)', dissolve: 'Memory', implode: 'null', cursor: '_',
};

export const SECTION_NAMES = [
  'boot', 'simulation.start', 'geometry', 'current', 'execute', 'objects', 'switch',
  'vibration', 'fragments', 'core.dump', 'EXECUTION', 'execute', 'love.expr', 'shutdown', 'exit',
];

export class Director {
  constructor(tl, lyrics) {
    this.tl = tl;
    this.lyr = lyrics;
    const B = (n) => tl.timeOf(n);
    this.B = B;
    this.sectionStarts = Array.from({ length: 15 }, (_, k) => B(k * 32));

    // Word timings (read from the LRC at runtime) for the hit-driven sections.
    const execHits = lyrics.wordsBetween(B(320) - 0.1, B(320) + 11).map((w) => w.t);
    const countHits = lyrics.wordsBetween(B(320) + 11, B(320) + 13.8).map((w) => w.t);
    this.execHits = execHits;
    this.countHits = countHits;
    const finalExec = lyrics.wordsBetween(B(446) - 1.5, B(446) + 1.5).map((w) => w.t)[0] ?? 205.96;
    this.finalExec = finalExec;

    // --------------------------------------------------------------------------- shape cues
    const c = (t, shape, dur = 0.6, o = {}) => ({ t, shape, dur, ...o });
    const cues = [
      c(0, 'powerLine', 0.01),
      c(1.83, 'shield', 0.9, { stagger: 0.5, arc: 0.4 }),
      c(3.86, 'board', 0.9, { stagger: 0.5, arc: 0.5 }),
      c(5.5, 'primitives', 0.35, { stagger: 0.2 }),
      c(7.5, 'dataBars', 0.6, { stagger: 0.4 }),
      c(11.14, 'globe', 0.9, { arc: 0.5 }),
      c(B(32), 'galaxy', 0.5, { stagger: 0.15, arc: 1.4, ease: 'outExpo' }),
      c(B(48), 'g_cube', 0.32, { ease: 'outExpo', arc: 0.5 }),
      c(B(50), 'g_octa', 0.32, { ease: 'outExpo', arc: 0.5 }),
      c(B(52), 'g_torus', 0.32, { ease: 'outExpo', arc: 0.5 }),
      c(B(54), 'g_icosa', 0.32, { ease: 'outExpo', arc: 0.5 }),
      c(B(56), 'torusKnot', 0.32, { ease: 'outExpo', arc: 0.5 }),
      c(B(58), 'g_mobius', 0.32, { ease: 'outExpo', arc: 0.5 }),
      c(B(60), 'g_klein', 0.32, { ease: 'outExpo', arc: 0.5 }),
      c(B(62), 'g_sphere', 0.32, { ease: 'outExpo', arc: 0.5 }),
      // verse 1: geometry
      c(B(64), 'pointsSet', 0.5, { stagger: 0.3, arc: 0.3 }),
      c(31.31, 'tesseract', 0.9, { stagger: 0.4, arc: 0.04 }),
      c(B(72), 'circle', 0.35, { stagger: 0.2 }),
      c(34.93, 'unroll', 0.2, { stagger: 0, arc: 0 }),
      c(B(80), 'sine', 0.5, { order: 'index' }),
      c(38.68, 'tangents', 0.15, { stagger: 0, arc: 0 }),
      c(B(88), 'lemniscate', 0.6, { arc: 0.3 }),
      c(42.38, 'limit', 0.6, { order: 'index' }),
      // pre-chorus 1
      c(B(96), 'coil', 0.5),
      c(46.27, 'acWave', 0.3, { order: 'index', stagger: 0.2 }),
      c(47.23, 'dcLine', 0.28, { stagger: 0.1 }),
      c(47.9, 'eye', 0.5, { order: 'index' }),
      c(49.08, 'eyeClosed', 0.3, { stagger: 0.1, arc: 0 }),
      c(49.787, 'vortex', 0.6, { arc: 0.6 }),
      c(51.36, 'tunnel', 0.6),
      c(53.46, 'tunnelBack', 0.4),
      c(55.15, 'twoSpheres', 0.6),
      c(57.15, 'onion', 0.5),
      // chorus 1
      c(B(128), 'spiky', 0.35, { ease: 'outExpo', arc: 0.8 }),
      c(62.88, 'torusKnot', 0.5),
      c(66.58, 'rose', 0.5, { order: 'index' }),
      c(68.44, 'play', 0.4, { order: 'index' }),
      c(70.28, 'cage', 0.5),
      c(71.74, 'nestedCages', 0.6),
      // verse 2: objects
      c(B(160), 'eggplant', 0.6, { order: 'index', stagger: 0.5 }),
      c(77.66, 'tomato', 0.6, { order: 'index', stagger: 0.5 }),
      c(81.33, 'cat', 0.6, { order: 'index', stagger: 0.5 }),
      c(85.09, 'radiant', 0.5),
      c(86.7, 'exists', 0.6, { order: 'index' }),
      // pre-chorus 2: switches
      c(B(192), 'toggle', 0.4),
      c(90.56, 'venus', 0.35, { order: 'index', ease: 'outExpo' }),
      c(91.51, 'mars', 0.35, { order: 'index', ease: 'outExpo' }),
      c(92.1, 'scribble', 0.5),
      c(94.22, 'clock', 0.4),
      c(95.75, 'toggle', 0.4),
      c(97.97, 'glyphS', 0.35, { order: 'index', ease: 'outExpo' }),
      c(98.91, 'glyphM', 0.35, { order: 'index', ease: 'outExpo' }),
      c(99.55, 'trance', 0.8, { arc: 0.5 }),
      // chorus 2
      c(103.44, 'chladni0', 0.4, { order: 'index' }),
      c(B(226), 'chladniCycle', 0.3, { stagger: 0 }),
      c(B(232), 'progressRing', 0.4),
      c(108.13, 'fibSphere', 0.5),
      c(110.9, 'leaving', 0.2, {
        stagger: 0,
        times: [111.859, 112.768, 113.721, 114.615, 115.52].map((x) => x - 110.9),
      }),
      c(117.34, 'single', 0.9, { stagger: 0.2 }),
      // bridge
      c(118.33, 'fragments', 0.8, { stagger: 0.6, arc: 0.3 }),
      c(122.95, 'fall', 0.2, { stagger: 0, arc: 0 }),
      c(125.64, 'pillar', 0.8),
      c(127.44, 'radiantRed', 0.4),
      c(132.55, 'shards', 0.25, { ease: 'outExpo', arc: 1.5 }),
      // instrumental 2
      c(B(288), 'corrupt', 0.2),
      c(B(312), 'singularity', 0.9),
      // execution
      c(B(320), 'reticle', 0.25, { ease: 'outExpo', hits: execHits.map((h) => h - B(320)) }),
      ...countHits.map((h, i) => c(h - 0.02, `digit${i + 1}`, 0.18, { ease: 'outExpo', stagger: 0.15, order: 'index' })),
      c(161.7, 'execText', 0.25, { ease: 'outExpo', order: 'index', stagger: 0.2 }),
      // final chorus
      c(B(352), 'spiky', 0.3, { ease: 'outExpo', arc: 0.8 }),
      c(163.58, 'clones', 0.5),
      c(166.28, 'oneSphere', 0.5),
      c(169.96, 'twoSpheres', 0.6),
      c(171.92, 'play', 0.4, { order: 'index' }),
      c(173.67, 'cage', 0.5),
      c(175.11, 'nestedCages', 0.6),
      // love
      c(177.38, 'neural', 0.8, { stagger: 0.5 }),
      c(180.38, 'heartLine', 0.4),
      c(181.13, 'question', 0.4, { order: 'index' }),
      c(183.33, 'heartLine', 0.4),
      c(184.8, 'heart3D', 0.8, { stagger: 0.5 }),
      c(188.45, 'free', 0.1, { stagger: 0, arc: 0 }),
      c(189.86, 'heartCage', 0.6),
      // outro
      c(B(416), 'dissolve', 0.6, { stagger: 0, arc: 0 }),
      c(B(424), 'globe', 2.2, { stagger: 0.6, arc: 0.6 }),
      c(B(436), 'powerLine', 1.6, { stagger: 0.5 }),
      c(finalExec, 'implode', 0.4, { ease: 'inExpo', stagger: 0.1, arc: 0 }),
      c(finalExec + 0.95, 'cursor', 0.5, { stagger: 0 }),
    ];
    this.cues = cues.sort((a, b) => a.t - b.t);

    // --------------------------------------------------------------------------- camera
    const cam = (t, o, fade = 0.8) => ({ t, fade, ...o });
    this.camTrack = new Track([
      cam(0, { dist: 4.2, pitch: 0.06, yawRate: 0.05, roll: 0, rollWave: 0, fov: 40, tx: 0, ty: 0, tz: 0, shiftX: 0.3, punch: 0.02 }),
      cam(1.83, { dist: 4.5, pitch: 0.18, yawRate: 0.18 }, 1.5),
      cam(3.86, { dist: 4.9, pitch: 0.62, yawRate: 0.12, ty: -0.3 }, 1.2),
      cam(5.5, { dist: 4.3, pitch: 0.28, yawRate: 0.06, ty: 0 }, 1),
      cam(7.5, { dist: 4.2, pitch: 0.04, yawRate: 0 }, 0.8),
      cam(11.14, { dist: 4.7, pitch: 0.22, yawRate: 0.12 }, 1.2),
      cam(12.9, { dist: 3.8, pitch: 0.12, yawRate: 0.55 }, 1.8),
      cam(B(32), { dist: 5.4, pitch: 0.6, yawRate: 0.3, fov: 50, shiftX: 0, punch: 0.04 }, 0),
      cam(B(40), { dist: 4.4, pitch: 0.3, yawRate: 0.45 }, 3),
      cam(B(48), { dist: 4.7, pitch: 0.2, yawRate: 0.3, fov: 40 }, 0),
      cam(B(64), { dist: 4.3, pitch: 0.12, yawRate: 0.1, punch: 0.025 }, 0),
      cam(B(72), { dist: 4.2, pitch: 0.06, yawRate: 0.03 }, 0.6),
      cam(B(88), { dist: 4.3, pitch: 0.15, yawRate: 0.1 }, 0.6),
      cam(B(96), { dist: 4.4, pitch: 0.2, yawRate: 0.18 }, 0),
      cam(46.27, { dist: 4.2, pitch: 0.04, yawRate: 0.02 }, 0.4),
      cam(49.787, { dist: 4.8, pitch: 0.6, yawRate: 1.0, rollWave: 0.22 }, 0.4),
      cam(51.36, { dist: 4.2, pitch: 0.0, yawRate: 0, rollWave: 0.05 }, 0.3),
      cam(55.15, { dist: 4.4, pitch: 0.14, yawRate: 0.22, rollWave: 0 }, 0.5),
      cam(B(128), { dist: 4.9, pitch: 0.32, yawRate: 0.38, fov: 46, punch: 0.05 }, 0),
      cam(62.88, { dist: 4.3, pitch: 0.1, yawRate: 0.3 }, 0.8),
      cam(66.58, { dist: 4.2, pitch: 0.05, yawRate: 0.05, fov: 42 }, 0.5),
      cam(70.28, { dist: 4.7, pitch: 0.32, yawRate: 0.2 }, 0.6),
      cam(B(160), { dist: 4.2, pitch: 0.04, yawRate: 0.04, fov: 40, punch: 0.025 }, 0),
      cam(85.09, { dist: 4.1, pitch: -0.14, yawRate: 0.03 }, 0.6),
      cam(B(192), { dist: 4.2, pitch: 0.05, yawRate: 0.05 }, 0),
      cam(92.1, { dist: 4.4, pitch: 0.3, yawRate: 0.45 }, 0.4),
      cam(94.22, { dist: 4.2, pitch: 0.05, yawRate: 0.04 }, 0.4),
      cam(99.55, { dist: 4.2, pitch: 0.02, yawRate: 0.02, rollWave: 0.1 }, 0.8),
      cam(103.44, { dist: 4.3, pitch: 0.06, yawRate: 0.04, rollWave: 0, punch: 0.04 }, 0),
      cam(108.13, { dist: 4.5, pitch: 0.25, yawRate: 0.2 }, 0.6),
      cam(116.0, { dist: 5.6, pitch: 0.2, yawRate: 0.05 }, 2),
      cam(B(256), { dist: 4.2, pitch: 0.05, yawRate: 0.0, punch: 0.02 }, 0.5),
      cam(125.64, { dist: 4.6, pitch: -0.38, yawRate: 0.25, ty: 0.6 }, 1.2),
      cam(127.44, { dist: 4.3, pitch: -0.1, yawRate: 0.02, ty: 0 }, 0.6),
      cam(132.55, { dist: 5.2, pitch: 0.15, yawRate: 0.5 }, 0.2),
      cam(B(288), { dist: 4.4, pitch: 0.2, yawRate: 0.6, punch: 0.06 }, 0),
      cam(B(312), { dist: 3.6, pitch: 0.1, yawRate: 1.2 }, 3.5),
      cam(B(320), { dist: 4.2, pitch: 0.0, yawRate: 0.0, punch: 0.06 }, 0),
      cam(B(352), { dist: 4.9, pitch: 0.3, yawRate: 0.42, fov: 46, punch: 0.05 }, 0),
      cam(169.96, { dist: 4.4, pitch: 0.12, yawRate: 0.2 }, 0.8),
      cam(175.11, { dist: 5.1, pitch: 0.36, yawRate: 0.3 }, 1.5),
      cam(B(384), { dist: 4.2, pitch: 0.03, yawRate: 0.02, fov: 40, punch: 0.02 }, 0),
      cam(184.8, { dist: 4.9, pitch: 0.1, yawRate: 0.1, ty: 0.25 }, 1),
      cam(189.86, { dist: 4.4, pitch: 0.2, yawRate: 0.15, ty: 0 }, 1),
      cam(B(416), { dist: 5.0, pitch: 0.25, yawRate: 0.1, punch: 0.01 }, 4),
      cam(B(424), { dist: 4.6, pitch: 0.2, yawRate: 0.15 }, 3),
      cam(B(436), { dist: 4.2, pitch: 0.05, yawRate: 0.02 }, 3),
    ]);
    // Integrate yaw rate so orbit speed changes never jump.
    const dt = 1 / 120, n = Math.ceil((tl.duration + 5) / dt);
    this.yaw = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) this.yaw[i + 1] = this.yaw[i] + this.camTrack.at(i * dt).yawRate * dt;
    this.yawDt = dt;

    // --------------------------------------------------------------------------- look (palette/post)
    const look = (t, o, fade = 0.25) => ({ t, fade, ...o });
    this.lookTrack = new Track([
      look(0, { bg0: H('#020306'), bg1: H('#05070d'), grid: 0, gridCol: H('#1d4a66'), accent: H('#49e3ff'), accent2: H('#9fd6ff'), stars: 0.2, nebula: 0.0, bloom: 0.8, trail: 0.5, chroma: 0.25, sat: 1.0, contrast: 1.04, vignette: 0.55, grain: 0.018, scan: 0.25, intensity: 0.4, hud: 0.75, floorY: -1.2, dof: 0.55 }),
      look(3.86, { grid: 0.45 }, 1.2),
      look(B(32), { bg0: H('#030309'), bg1: H('#0d0a22'), grid: 1.0, gridCol: H('#3a2d8f'), accent: H('#8f7bff'), accent2: H('#49e3ff'), stars: 1, nebula: 0.55, bloom: 1.1, trail: 0.72, chroma: 0.5, intensity: 0.9, floorY: -1.6 }, 0),
      look(B(48), { trail: 0.55 }, 0.5),
      look(B(64), { bg0: H('#02050a'), bg1: H('#061320'), grid: 0.55, gridCol: H('#15506e'), accent: H('#49e3ff'), accent2: H('#ff5aa0'), stars: 0.5, nebula: 0.25, bloom: 0.9, trail: 0.5, chroma: 0.3, intensity: 0.6, floorY: -1.4 }, 0),
      look(B(96), { bg0: H('#06030c'), bg1: H('#140a24'), gridCol: H('#5a2a80'), accent: H('#ff5aa0'), accent2: H('#8f7bff'), nebula: 0.45, intensity: 0.7 }, 0),
      look(49.787, { trail: 0.86, chroma: 0.6 }, 0.3),
      look(51.36, { trail: 0.8, chroma: 0.4, dof: 0.08 }, 0.3),
      look(53.46, { accent: H('#ffbf5a'), gridCol: H('#6e4a1d') }, 0.3),
      look(55.15, { trail: 0.55, accent: H('#ff5aa0'), gridCol: H('#5a2a80'), dof: 0.55 }, 0.5),
      look(B(128), { bg0: H('#050309'), bg1: H('#1a0a1e'), grid: 1, gridCol: H('#7a1f5c'), accent: H('#ff4f9a'), accent2: H('#ffc05a'), stars: 0.9, nebula: 0.65, bloom: 1.2, trail: 0.62, chroma: 0.6, intensity: 1, floorY: -1.6 }, 0),
      look(70.28, { gridCol: H('#44507a'), accent: H('#b9c8ff') }, 0.6),
      look(B(160), { bg0: H('#070504'), bg1: H('#160e08'), grid: 0.4, gridCol: H('#6a4a22'), accent: H('#ffbf5a'), accent2: H('#ff5aa0'), stars: 0.35, nebula: 0.3, bloom: 0.95, trail: 0.5, chroma: 0.3, intensity: 0.8, floorY: -1.4 }, 0),
      look(85.09, { bg1: H('#1d1406'), accent: H('#ffe08a') }, 0.6),
      look(B(192), { bg0: H('#05030b'), bg1: H('#150a26'), grid: 0.6, gridCol: H('#4a2a90'), accent: H('#8f7bff'), accent2: H('#49e3ff'), nebula: 0.6, stars: 0.6, intensity: 0.7 }, 0),
      look(99.55, { trail: 0.85, chroma: 0.55, nebula: 0.9 }, 0.8),
      look(103.44, { bg0: H('#02050a'), bg1: H('#081628'), grid: 0.85, gridCol: H('#1d5a7a'), accent: H('#49e3ff'), accent2: H('#ffc05a'), nebula: 0.4, bloom: 1.1, trail: 0.55, chroma: 0.45, intensity: 1 }, 0),
      look(110.9, { bg1: H('#070b12'), grid: 0.35, accent: H('#8aa0bf'), nebula: 0.15, intensity: 0.6, sat: 0.8 }, 3),
      look(117.34, { bg0: H('#010102'), bg1: H('#030406'), grid: 0.05, stars: 0.1, bloom: 1.5, sat: 0.6, intensity: 0.2, hud: 0.4 }, 0.9),
      look(B(256), { bg0: H('#030304'), bg1: H('#0a0a0f'), grid: 0.3, gridCol: H('#2a3242'), accent: H('#9fb3d1'), accent2: H('#ff5aa0'), stars: 0.2, nebula: 0.1, bloom: 1.0, trail: 0.5, sat: 0.75, intensity: 0.5, hud: 0.7 }, 0.3),
      look(125.64, { bg1: H('#1a1206'), gridCol: H('#6a4a1d'), accent: H('#ffcf6a'), sat: 1, nebula: 0.3 }, 1.2),
      look(127.44, { bg0: H('#080102'), bg1: H('#1e0508'), gridCol: H('#7a1a22'), accent: H('#ff3040'), accent2: H('#ffffff') }, 0.4),
      look(B(288), { bg0: H('#070102'), bg1: H('#1a0306'), grid: 1, gridCol: H('#8a1420'), accent: H('#ff2b3a'), accent2: H('#ffffff'), stars: 0.4, nebula: 0.6, bloom: 1.1, trail: 0.4, chroma: 0.8, intensity: 1, sat: 1.05 }, 0),
      look(B(320), { bg0: H('#080001'), bg1: H('#220006'), grid: 1, gridCol: H('#a0101c'), accent: H('#ff2233'), bloom: 1.15, trail: 0.3, chroma: 0.7, intensity: 1.1, hud: 0.5 }, 0),
      look(B(352), { bg0: H('#05030a'), bg1: H('#180a22'), grid: 1, gridCol: H('#6a2a8a'), accent: H('#ff4f9a'), accent2: H('#49e3ff'), stars: 1, nebula: 0.8, bloom: 1.2, trail: 0.6, chroma: 0.6, intensity: 1.05, hud: 0.75 }, 0),
      look(B(384), { bg0: H('#080307'), bg1: H('#1e0a16'), grid: 0.3, gridCol: H('#6a2a4a'), accent: H('#ff6fae'), accent2: H('#ffc05a'), stars: 0.7, nebula: 0.6, bloom: 1.05, trail: 0.6, chroma: 0.3, intensity: 0.55 }, 0),
      look(B(416), { bg0: H('#040306'), bg1: H('#0c0812'), grid: 0.2, nebula: 0.35, trail: 0.7, intensity: 0.3 }, 4),
      look(B(436), { bg0: H('#020203'), bg1: H('#050507'), grid: 0, stars: 0.15, nebula: 0.05, accent: H('#9fd6ff') }, 4),
    ]);

    // --------------------------------------------------------------------------- events
    const F = (t, amp, decay = 8) => ({ t, amp, decay });
    this.flashes = [
      F(B(32), 0.95, 5.5), F(B(64), 0.25), F(B(96), 0.25), F(B(128), 0.85, 6), F(B(160), 0.3), F(B(192), 0.25), F(103.44, 0.5, 6),
      F(B(256), 0.15), F(132.55, 0.95, 5), F(B(288), 0.55, 6), F(B(320), 0.95, 5),
      ...execHits.map((h) => F(h, 0.4, 10)), ...countHits.map((h) => F(h, 0.28, 11)),
      F(161.7, 0.85, 5), F(B(352), 0.95, 5.5), F(B(384), 0.35, 6), F(finalExec + 0.38, 1, 3.2),
    ];
    this.inverts = [132.55, ...execHits.filter((_, i) => i % 4 === 3), 161.7].map((t) => ({ t, dur: 0.07 }));
    const Bu = (t, amp, decay = 3) => ({ t, amp, decay });
    this.bursts = [
      Bu(B(32), 1.2, 2.2), Bu(B(128), 0.6), Bu(65.7, 0.3, 4), Bu(75.64, 0.35), Bu(79.28, 0.35), Bu(103.44, 0.35),
      Bu(132.55, 1.4, 1.6), Bu(B(320), 0.9), ...execHits.slice(1).map((h) => Bu(h, 0.22, 6)), Bu(161.7, 0.8),
      Bu(B(352), 0.9), Bu(168.6, 0.5), Bu(B(384), 0.2),
    ];
    this.glitchKeys = [
      [71.74, 73.8, 0.18], [129.4, 131.3, 0.12], [131.39, 132.5, 0.35], [132.55, 133.2, 1.0],
      [B(288), B(312), 0.22], [B(312), B(320), 0.1],
    ];
    this.glitchHits = [
      129.435, 130.395, 131.396, ...execHits, 161.7, finalExec,
    ];
    this.jitterKeys = [[83.95, 85.0, 0.014], [71.74, 73.8, 0.01]];

    // --------------------------------------------------------------------------- overlay
    this.lyricModes = [
      [0, 'term'], [B(32), 'code'], [110.9, 'stack'], [118.3, 'code'],
      [B(320) - 0.05, 'slam'], [countHits[0] - 0.05, 'count'], [161.68, 'slam'], [B(352), 'code'],
      [finalExec - 0.05, 'slam'],
    ];
    this.widgets = [
      ['boot', 0.2, B(32)], ['params', 7.5, 11.3], ['title', B(32), B(40) + 0.4], ['primLabel', B(48), B(64)],
      ['math', B(64), B(96)], ['scope', B(96), 47.9], ['years', 51.36, 55.15], ['union', 55.15, B(128)],
      ['sandbox', 70.28, B(160)], ['spec', B(160), B(192)], ['purr', 83.95, 85.1],
      ['switchLabel', B(192), 90.55], ['switchLabel', 95.75, 97.95], ['clockText', 94.22, 95.75],
      ['chladniLabel', 103.44, B(232)], ['percent', B(232), 108.9], ['disconnect', 110.9, 117.4], ['isolation', 117.34, B(256)],
      ['rmlog', 118.33, 122.95], ['denied', 125.64, 129.0], ['exception', 131.39, B(292)], ['hexdump', B(288), B(320)],
      ['hazard', B(320), B(352)], ['countSlots', countHits[0] - 0.05, 161.7], ['clonesLabel', 163.58, 166.28],
      ['nn', B(384), 181.1], ['equation', 184.8, 188.45], ['freeLabel', 188.45, 190.75], ['shutdown', B(416), finalExec],
      ['final', finalExec + 0.95, tl.duration + 1],
    ];
  }

  yawAt(t) {
    const x = clamp(t / this.yawDt, 0, this.yaw.length - 1);
    const i = Math.floor(x), f = x - i;
    return this.yaw[i] * (1 - f) + (this.yaw[Math.min(i + 1, this.yaw.length - 1)]) * f;
  }

  lyricMode(t) {
    let m = 'code';
    for (const [s, mode] of this.lyricModes) if (t >= s) m = mode;
    return m;
  }

  activeWidgets(t) {
    return this.widgets.filter(([, a, b]) => t >= a && t < b).map(([name, a, b]) => ({ name, lt: t - a, a, b }));
  }

  frame(t) {
    const tl = this.tl;
    const kick = tl.kick(t), snare = tl.snare(t), beat = tl.beatPulse(t), low = tl.sample('low', t), loud = tl.sample('loud', t);
    const look = this.lookTrack.at(t);
    const ci = look.intensity;
    const c = this.camTrack.at(t);

    // camera
    let shake = 0;
    for (const h of this.glitchHits) shake += impulse(t, h, 9) * 0.05;
    for (const b of this.bursts) shake += impulse(t, b.t, 6) * b.amp * 0.04;
    const yaw = this.yawAt(t) + 0.035 * Math.sin(t * 0.37) + shake * Math.sin(t * 71);
    const pitch = c.pitch + 0.02 * Math.sin(t * 0.29) + shake * Math.sin(t * 57) * 0.5;
    const dist = c.dist * (1 - c.punch * kick * 1.2);
    const target = [c.tx, c.ty, c.tz];
    const eye = [
      target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[1] + dist * Math.sin(pitch),
      target[2] + dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    const fov = (c.fov * Math.PI) / 180;
    const camera = {
      eye, target, fov, shiftX: c.shiftX,
      roll: c.roll + c.rollWave * Math.sin(t * 1.7),
      screenScale: (c.dist / 4.2) * (Math.tan(fov / 2) / Math.tan((20 * Math.PI) / 180)),
    };

    // flashes / inverts / glitch
    let flash = 0;
    for (const f of this.flashes) flash = Math.max(flash, impulse(t, f.t, f.decay, 80) * f.amp);
    let invert = 0;
    for (const v of this.inverts) if (t >= v.t && t < v.t + v.dur) invert = 1;
    let glitch = 0;
    for (const [a, b, g] of this.glitchKeys) if (t >= a && t < b) glitch = Math.max(glitch, g * (t < a + 0.6 && g >= 1 ? 1 - (t - a) / 0.7 : 1));
    if (t >= this.B(288) && t < this.B(320)) glitch += snare * 0.5;
    for (const h of this.glitchHits) glitch = Math.max(glitch, impulse(t, h, 10) * 0.7);
    let jitter = 0;
    for (const [a, b, j] of this.jitterKeys) if (t >= a && t < b) jitter = j;

    // CRT power-on, eyelids, fade
    const power = t < 0.279 ? 0 : clamp((t - 0.279) / 0.9);
    const lid = t < 49.08 ? 0 : t < 49.787 ? smoothstep(49.08, 49.4, t) : 1 - smoothstep(49.787, 50.05, t);
    const fade = smoothstep(209.4, 211.6, t);

    const fx = {
      breath: (0.02 + 0.05 * ci) * kick + 0.02 * ci * low,
      bursts: this.bursts,
      turb: t > 92.1 && t < 94.2 ? 0.05 : t > this.B(416) && t < this.B(424) ? 0.03 : 0,
      jitter,
      glitch: glitch * 0.6,
      alpha: 1,
      gain: 0.92 + 0.25 * ci * kick + 0.1 * loud,
    };

    const post = {
      bloom: look.bloom * (1 + 0.35 * ci * kick),
      trail: look.trail,
      dof: look.dof,
      chroma: look.chroma * (0.6 + 1.4 * ci * kick) + glitch * 1.5,
      glitch,
      flash: flash * 0.85,
      invert,
      fade,
      power,
      lid,
      sat: look.sat,
      contrast: look.contrast,
      vignette: look.vignette,
      grain: look.grain,
      scan: look.scan,
    };

    const bg = {
      bg0: look.bg0, bg1: look.bg1, grid: look.grid, gridCol: look.gridCol, accent: look.accent,
      stars: look.stars, nebula: look.nebula, kick: kick * ci, floorY: look.floorY,
      ring: (tl.beat(t) % 4 + 4) % 4 / 4, beat,
    };

    const section = clamp(tl.section(t), 0, 14);
    return {
      t, kick, snare, beat, low, loud, section,
      sectionName: SECTION_NAMES[section],
      camera, fx, post, bg, look,
      lyricMode: this.lyricMode(t),
      widgets: this.activeWidgets(t),
    };
  }
}
