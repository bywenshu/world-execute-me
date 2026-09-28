// WebGL2 pipeline: particles -> trail feedback -> background + overlay composite -> bloom -> grade.
import { N } from './shapes.js';
import { mat4, perspective, lookAt, multiply, invert } from './mat.js';

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0., 1.); }`;

const PARTICLE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
layout(location=2) in float aSize;
uniform mat4 uVP;
uniform mat4 uView;
uniform float uPx, uFocus, uDof, uMinPx;
out vec4 vCol;
void main(){
  vec4 vp = uView * vec4(aPos, 1.);
  float d = max(0.05, -vp.z);
  gl_Position = uVP * vec4(aPos, 1.);
  float s = aSize * uPx / d;
  float coc = abs(d - uFocus) * uDof * uPx * 0.35;
  float S = max(uMinPx, s + coc);
  gl_PointSize = min(S, 90.);
  float k = clamp(s / S, 0.0, 1.0);
  vCol = vec4(aCol.rgb, aCol.a * k * k * (d < 0.3 ? 0. : 1.));
}`;

const PARTICLE_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord * 2. - 1.;
  float r2 = dot(c, c);
  if (r2 > 1.) discard;
  float a = (exp(-r2 * 3.2) - 0.0407) / 0.9593;
  o = vec4(vCol.rgb * vCol.a * a, 1.);
}`;

const TRAIL_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uPrev;
uniform float uTrail;
void main(){
  vec3 s = texture(uScene, vUv).rgb;
  vec3 p = texture(uPrev, vUv).rgb * uTrail;
  o = vec4(max(s, p), 1.);
}`;

const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uParticles, uOverlay;
uniform mat4 uInvVP;
uniform vec3 uEye, uBg0, uBg1, uGridCol, uAccent;
uniform float uTime, uGrid, uStars, uNebula, uKick, uRing, uFloorY, uBeat, uShiftX;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h31(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3. - 2. * f);
  float a = mix(mix(h31(i), h31(i + vec3(1, 0, 0)), u.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), u.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z); }
float fbm3(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * noise3(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
void main(){
  vec2 ndc = vUv * 2. - 1.;
  vec4 w = uInvVP * vec4(ndc, 1., 1.);
  vec3 dir = normalize(w.xyz / w.w - uEye);
  vec3 col = mix(uBg0, uBg1, smoothstep(-0.7, 0.9, dir.y));
  vec2 sp = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1., 1.)));
  float n = fbm3(dir * vec3(1.4, 2.0, 1.4) + vec3(uTime * 0.012, 0., uTime * 0.007));
  float n2 = fbm3(dir * 2.7 - vec3(0., uTime * 0.017, 0.) + n * 1.7);
  col += uAccent * pow(n2, 3.2) * uNebula * 0.9;
  vec2 sc = sp * 95.;
  vec2 ci = floor(sc);
  float hs = h21(ci);
  if (hs > 0.982) {
    vec2 f = fract(sc) - 0.5 - (vec2(h21(ci + 3.1), h21(ci + 7.7)) - 0.5) * 0.6;
    float tw = 0.55 + 0.45 * sin(uTime * (2. + hs * 3.) + hs * 80.);
    col += vec3(0.8, 0.88, 1.) * smoothstep(0.09, 0., length(f)) * tw * uStars * (0.4 + 0.6 * fract(hs * 97.));
  }
  if (dir.y < -0.0005) {
    float tt = (uFloorY - uEye.y) / dir.y;
    if (tt > 0.) {
      vec3 p = uEye + dir * tt;
      vec2 g = p.xz * 1.25;
      vec2 fw = max(fwidth(g), vec2(1e-4));
      vec2 gl = abs(fract(g) - 0.5) / fw;
      float line = 1. - min(min(gl.x, gl.y), 1.);
      vec2 g2 = p.xz * 0.3125;
      vec2 fw2 = max(fwidth(g2), vec2(1e-4));
      vec2 gl2 = abs(fract(g2) - 0.5) / fw2;
      float line2 = 1. - min(min(gl2.x, gl2.y), 1.);
      float fade = exp(-tt * 0.085) * smoothstep(0.0, 0.06, -dir.y);
      float lod = clamp(1. - max(fw.x, fw.y) * 1.5, 0., 1.);
      float r = length(p.xz);
      float ring = exp(-pow((r - uRing * 10.) * 2.0, 2.)) * (1. - uRing);
      col += uGridCol * (line * 0.3 * lod + line2 * 0.55) * fade * uGrid * (0.55 + 0.6 * uKick);
      col += uAccent * ring * fade * uGrid * (0.35 + 1.2 * uKick);
      col += uGridCol * exp(-r * 0.6) * fade * uGrid * 0.25;
    }
  }
  vec3 part = texture(uParticles, vUv).rgb;
  col += part;
  vec4 ov = texture(uOverlay, vUv);
  col = col * (1. - ov.a) + ov.rgb;
  o = vec4(col, 1.);
}`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThr;
vec3 pick(vec2 uv){ vec3 c = texture(uTex, uv).rgb; if (uThr > 0.) { float l = max(c.r, max(c.g, c.b)); float k = max(l - uThr, 0.); k = k * k / (l * 0.6 + 1e-4); c *= k / max(l, 1e-4); } return c; }
void main(){
  vec2 h = uTexel * 0.5;
  vec3 s = pick(vUv) * 4.;
  s += pick(vUv - h) + pick(vUv + h) + pick(vUv + vec2(h.x, -h.y)) + pick(vUv - vec2(h.x, -h.y));
  o = vec4(s / 8., 1.);
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex, uAdd; uniform vec2 uTexel;
void main(){
  vec2 h = uTexel * 0.5;
  vec3 s = texture(uTex, vUv + vec2(-h.x * 2., 0.)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, h.y)).rgb * 2.;
  s += texture(uTex, vUv + vec2(0., h.y * 2.)).rgb;
  s += texture(uTex, vUv + vec2(h.x, h.y)).rgb * 2.;
  s += texture(uTex, vUv + vec2(h.x * 2., 0.)).rgb;
  s += texture(uTex, vUv + vec2(h.x, -h.y)).rgb * 2.;
  s += texture(uTex, vUv + vec2(0., -h.y * 2.)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, -h.y)).rgb * 2.;
  o = vec4(s / 12. + texture(uAdd, vUv).rgb, 1.);
}`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uComp, uBloom;
uniform vec2 uRes;
uniform float uTime, uBloomAmt, uChroma, uGlitch, uFlash, uInvert, uFade, uPower, uLid, uSat, uContrast, uVignette, uGrain, uScan;
float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 softclip(vec3 c){ vec3 k = max(c - 0.8, 0.); return min(c, vec3(0.8)) + 0.2 * (1. - exp(-k / 0.2)); }
float gnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 uv = vUv;
  // CRT power-on: a bright line opens horizontally, then vertically
  float px = clamp(uPower * 2.2, 0., 1.), py = clamp(uPower * 1.6 - 0.45, 0., 1.);
  float hy = mix(0.0022, 0.5, py * py * (3. - 2. * py));
  float hx = 0.5 * (1. - pow(1. - px, 3.));
  bool off = abs(uv.y - 0.5) > hy || abs(uv.x - 0.5) > hx;
  uv.y = 0.5 + (uv.y - 0.5) * (0.5 / max(hy, 1e-3)) * mix(1., py, 0.0);
  if (uGlitch > 0.) {
    float tk = floor(uTime * 16.);
    float bl = floor(vUv.y * 32. + h11(tk) * 11.);
    float r = h11(bl * 1.37 + tk);
    if (r < uGlitch * 0.45) uv.x += (h11(bl * 1.7 + tk) - 0.5) * 0.14 * uGlitch;
    float bl2 = floor(vUv.y * 7. + tk * 0.3);
    if (h11(bl2 * 3.1 + tk) < uGlitch * 0.18) uv.y += (h11(bl2 + tk) - 0.5) * 0.04;
  }
  vec2 d = uv - 0.5;
  vec2 off2 = d * (0.0012 + dot(d, d) * 0.006) * uChroma;
  vec3 c;
  c.r = texture(uComp, uv + off2).r;
  c.g = texture(uComp, uv).g;
  c.b = texture(uComp, uv - off2).b;
  vec3 b;
  b.r = texture(uBloom, uv + off2 * 1.5).r;
  b.g = texture(uBloom, uv).g;
  b.b = texture(uBloom, uv - off2 * 1.5).b;
  c += b * uBloomAmt;
  c = softclip(c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c = mix(c, vec3(1.), uFlash);
  c = mix(c, vec3(1.) - c, uInvert);
  float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.5);
  c *= 1. - uScan * 0.12 * scan;
  c *= 1. - uVignette * dot(d, d) * 1.4;
  c += (gnoise(gl_FragCoord.xy / 1.6 + fract(floor(uTime * 30.) * 0.618) * 811.) - 0.5) * uGrain * 1.3;
  if (uPower < 1.) {
    if (off) c = vec3(0.);
    else c = mix(c, vec3(0.85, 0.95, 1.), (1. - py) * 0.9);
  }
  if (uLid > 0.) {
    float e = 0.5 * uLid * (1. + 0.35 * (1. - pow(abs(vUv.x - 0.5) * 2., 2.)));
    float m = smoothstep(0.5 - e - 0.004, 0.5 - e + 0.004, abs(vUv.y - 0.5));
    c *= 1. - m;
  }
  c *= 1. - uFade;
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class Renderer {
  constructor(canvas, { preserve = false } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.half = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');

    this.progs = {
      particle: program(gl, PARTICLE_VS, PARTICLE_FS),
      trail: program(gl, QUAD_VS, TRAIL_FS),
      comp: program(gl, QUAD_VS, COMP_FS),
      down: program(gl, QUAD_VS, DOWN_FS),
      up: program(gl, QUAD_VS, UP_FS),
      final: program(gl, QUAD_VS, FINAL_FS),
    };

    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.pvao = gl.createVertexArray();
    gl.bindVertexArray(this.pvao);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, N * 12, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, N * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    this.sizeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, N * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.overlayTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.view = mat4(); this.proj = mat4(); this.vp = mat4(); this.ivp = mat4();
    this.ping = 0;
    this.w = 0; this.h = 0;
  }

  target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.half ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, this.half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h };
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scene = this.target(w, h);
    this.accum = [this.target(w, h), this.target(w, h)];
    this.comp = this.target(w, h);
    this.down = [];
    let bw = w, bh = h;
    for (let k = 0; k < 6; k++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.down.push(this.target(bw, bh));
    }
    this.up = this.down.slice(0, 5).map((d) => this.target(d.w, d.h));
  }

  /** Build camera matrices + basis used by particles (screen shapes) and the overlay. */
  camera(c) {
    const f = [c.target[0] - c.eye[0], c.target[1] - c.eye[1], c.target[2] - c.eye[2]];
    const fl = Math.hypot(...f);
    f[0] /= fl; f[1] /= fl; f[2] /= fl;
    let r = [-f[2], 0, f[0]];
    const rl = Math.hypot(...r) || 1;
    r = r.map((v) => v / rl);
    const u0 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
    const up = u0.map((v, i) => v * cr + r[i] * sr);
    const right = r.map((v, i) => v * cr - u0[i] * sr);
    lookAt(this.view, c.eye, c.target, up);
    perspective(this.proj, c.fov, this.w / this.h, 0.05, 80);
    this.proj[8] = -c.shiftX;
    multiply(this.vp, this.proj, this.view);
    invert(this.ivp, this.vp);
    const back = [-f[0], -f[1], -f[2]];
    const vp = this.vp;
    return {
      ...c, right, upv: up, back, dist: fl,
      project: (p, W = 1920, Hh = 1080) => {
        const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
        const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
        const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
        return [((x / w) * 0.5 + 0.5) * W, (1 - ((y / w) * 0.5 + 0.5)) * Hh, w];
      },
    };
  }

  draw(frame, particles, overlayCanvas, dt = 1 / 60) {
    const gl = this.gl, { post, bg } = frame, cam = frame.cam;
    gl.disable(gl.DEPTH_TEST);

    // particles
    gl.bindVertexArray(this.pvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles.col);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles.size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const P = this.progs.particle;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.uniformMatrix4fv(P.u.uView, false, this.view);
    gl.uniform1f(P.u.uPx, this.h * 0.0095);
    gl.uniform1f(P.u.uFocus, cam.dist);
    gl.uniform1f(P.u.uDof, post.dof ?? 0.55);
    gl.uniform1f(P.u.uMinPx, Math.max(1.2, this.h / 900));
    gl.drawArrays(gl.POINTS, 0, N);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(this.quad);
    // trails
    const prev = this.accum[this.ping], next = this.accum[1 - this.ping];
    this.ping = 1 - this.ping;
    this.pass(this.progs.trail, next, { uScene: this.scene.tex, uPrev: prev.tex }, (u) => gl.uniform1f(u.uTrail, Math.pow(post.trail, dt * 60)));

    // overlay upload
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // composite with procedural background
    this.pass(this.progs.comp, this.comp, { uParticles: next.tex, uOverlay: this.overlayTex }, (u) => {
      gl.uniformMatrix4fv(u.uInvVP, false, this.ivp);
      gl.uniform3fv(u.uEye, cam.eye);
      gl.uniform3fv(u.uBg0, bg.bg0);
      gl.uniform3fv(u.uBg1, bg.bg1);
      gl.uniform3fv(u.uGridCol, bg.gridCol);
      gl.uniform3fv(u.uAccent, bg.accent);
      gl.uniform1f(u.uTime, frame.t);
      gl.uniform1f(u.uGrid, bg.grid);
      gl.uniform1f(u.uStars, bg.stars);
      gl.uniform1f(u.uNebula, bg.nebula);
      gl.uniform1f(u.uKick, bg.kick);
      gl.uniform1f(u.uRing, bg.ring);
      gl.uniform1f(u.uFloorY, bg.floorY);
      gl.uniform1f(u.uBeat, bg.beat);
      gl.uniform1f(u.uShiftX, cam.shiftX);
    });

    // bloom
    let src = this.comp;
    this.down.forEach((d, k) => {
      this.pass(this.progs.down, d, { uTex: src.tex }, (u) => {
        gl.uniform2f(u.uTexel, 1 / src.w, 1 / src.h);
        gl.uniform1f(u.uThr, k === 0 ? 0.42 : 0);
      });
      src = d;
    });
    let low = this.down[5];
    for (let k = 4; k >= 0; k--) {
      this.pass(this.progs.up, this.up[k], { uTex: low.tex, uAdd: this.down[k].tex }, (u) => gl.uniform2f(u.uTexel, 1 / low.w, 1 / low.h));
      low = this.up[k];
    }

    // final grade to screen
    this.pass(this.progs.final, null, { uComp: this.comp.tex, uBloom: this.up[0].tex }, (u) => {
      gl.uniform2f(u.uRes, this.w, this.h);
      gl.uniform1f(u.uTime, frame.t);
      gl.uniform1f(u.uBloomAmt, post.bloom);
      gl.uniform1f(u.uChroma, post.chroma);
      gl.uniform1f(u.uGlitch, post.glitch);
      gl.uniform1f(u.uFlash, post.flash);
      gl.uniform1f(u.uInvert, post.invert);
      gl.uniform1f(u.uFade, post.fade);
      gl.uniform1f(u.uPower, post.power);
      gl.uniform1f(u.uLid, post.lid);
      gl.uniform1f(u.uSat, post.sat);
      gl.uniform1f(u.uContrast, post.contrast);
      gl.uniform1f(u.uVignette, post.vignette);
      gl.uniform1f(u.uGrain, post.grain);
      gl.uniform1f(u.uScan, post.scan);
    });
  }

  pass(prog, target, textures, setUniforms) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.w, target ? target.h : this.h);
    gl.useProgram(prog.p);
    let unit = 0;
    for (const [name, tex] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.u[name], unit);
      unit++;
    }
    setUniforms?.(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
