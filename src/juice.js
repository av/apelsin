import { program, use, set, fbo, target, formats, FULLSCREEN_VS, fullscreen, bind } from './gl.js';
import { FRAME_UBO, NOISE, SURFACE, LIGHTING } from './shaders/common.js';
import { shapeRadius } from './orange/mesh.js';
import { v3 } from './math.js';
import { worldToRest, restToWorld, restDirToWorld } from './orange/piece.js';

const MAX = 2400;
const MAX_MIST = 600;
const WET_SIZE = 2048;
const WET_EXTENT = 0.3;
const SPLAT_FLOATS = 8;
const MAX_SPLATS = 1024;
const WATER_LIFE = 50;
const FILM_LIFE = 1500;

export const JUICE = {
  navel: { absorb: [0.02, 0.15, 0.85], tint: [0.94, 0.76, 0.38] },
  valencia: { absorb: [0.02, 0.12, 0.95], tint: [0.95, 0.8, 0.36] },
  blood: { absorb: [0.07, 1.5, 1.2], tint: [0.86, 0.42, 0.36] },
  caracara: { absorb: [0.015, 0.4, 0.55], tint: [0.95, 0.64, 0.5] },
  mandarin: { absorb: [0.02, 0.22, 1.1], tint: [0.95, 0.7, 0.3] },
};

const DROP_VS = FRAME_UBO + `
layout(location = 0) in vec3 aPos;
layout(location = 3) in vec4 aDrop;
layout(location = 4) in vec4 aStretch;
out vec3 vWorld;
out vec3 vNormal;
out float vAlpha;
out float vKind;
out float vRadius;
void main() {
  float len = length(aStretch.xyz);
  vec3 dir = len > 1e-6 ? aStretch.xyz / len : vec3(0.0, 1.0, 0.0);
  vec4 centre = uViewProj * vec4(aDrop.xyz, 1.0);
  float pxPerM = uProj[1][1] * uResolution.y * 0.5 / max(centre.w, 1e-4);
  float r = aDrop.w;
  float rpx = r * pxPerM;
  float minPx = aStretch.w > 0.5 ? 1.1 : 0.8;
  float grow = max(1.0, minPx / max(rpx, 1e-4));
  vAlpha = 1.0 / (grow * grow);
  r *= grow;
  float along = dot(aPos, dir);
  vec3 side = aPos - dir * along;
  float taper = aStretch.w > 1.5 ? clamp(-along, 0.0, 1.0) * 0.55 : 0.0;
  vec3 p = (side * (1.0 - taper) + dir * along) * r + dir * along * len;
  vWorld = aDrop.xyz + p;
  vNormal = normalize(side / max(1.0 - taper, 0.2) + dir * along * r / (r + len));
  vKind = aStretch.w;
  vRadius = r + len;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

const DROP_FS = FRAME_UBO + NOISE + SURFACE + LIGHTING + `
uniform sampler2D uOpaque;
uniform vec3 uAbsorb;
in vec3 vWorld;
in vec3 vNormal;
in float vAlpha;
in float vKind;
in float vRadius;
out vec4 outColor;
void main() {
  vec3 N = normalize(vNormal), V = normalize(uCamPos.xyz - vWorld);
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  vec3 Nv = mat3(uView) * N;
  float dist = length(uCamPos.xyz - vWorld);
  float screenR = vRadius * uProj[1][1] * uResolution.y * 0.5 / dist;
  vec2 uv = gl_FragCoord.xy * uResolution.zw - Nv.xy * uResolution.zw * screenR * (2.2 - 1.4 * NoV) - Nv.xy * 0.01;
  vec3 behind = texture(uOpaque, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  float pathMm = max(vRadius * 1000.0, 0.15) * (0.9 + 1.6 * (1.0 - NoV));
  vec3 trans = exp(-uAbsorb * pathMm);
  vec3 cloud = shEnv(N) * uEnvParams.x * 0.55 + shKey(N) * uEnvParams.y * 0.35;
  vec3 body = behind * trans * mix(0.5, 1.0, smoothstep(0.05, 0.55, NoV));
  body = mix(body, cloud * trans * vec3(1.0, 0.82, 0.5), 0.14);
  float F = 0.021 + 0.979 * pow(1.0 - NoV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = envSpec(uEnvCube, R, 0.02) * uEnvParams.x + envSpec(uKeyCube, R, 0.02) * uEnvParams.y;
  float glint = pow(max(dot(R, uKeyDir.xyz), 0.0), 900.0) * 14.0 + pow(max(dot(R, uKeyDir.xyz), 0.0), 60.0) * 0.6;
  vec3 col = body * (1.0 - F) + refl * F + vec3(glint) * uEnvParams.y;
  float small = 1.0 - smoothstep(1.5, 7.0, screenR);
  vec3 golden = cloud * exp(-uAbsorb * 1.2) * 1.15 + vec3(glint) * uEnvParams.y;
  col = mix(col, golden, small * 0.65);
  float a = vAlpha;
  if (vKind > 0.5 && vKind < 1.5) { col = refl * 0.5 + vec3(glint) * uEnvParams.y + cloud * trans * 0.4; a *= 0.55; }
  outColor = vec4(col * a, a);
}`;

const SPLAT_VS = `
layout(location = 0) in vec2 aCorner;
layout(location = 3) in vec4 aSplat;
layout(location = 4) in vec4 aShape;
uniform float uExtent;
out vec2 vLocal;
out float vAmount;
out float vSeed;
out float vWater;
void main() {
  vec2 dir = aShape.xy;
  float e = length(dir);
  vec2 d = e > 1e-4 ? dir / e : vec2(1.0, 0.0);
  vec2 q = aCorner * 1.35;
  vLocal = q;
  vAmount = aSplat.w;
  vSeed = aShape.z;
  vWater = aShape.w;
  vec2 stretched = d * dot(q, d) * (1.0 + e) + vec2(-d.y, d.x) * dot(q, vec2(-d.y, d.x));
  vec2 world = aSplat.xy + stretched * aSplat.z;
  gl_Position = vec4(world / uExtent, 0.0, 1.0);
}`;

const SPLAT_FS = NOISE + `
in vec2 vLocal;
in float vAmount;
in float vSeed;
in float vWater;
out vec4 outColor;
void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  vec2 ring = vec2(cos(ang), sin(ang));
  float lobes = vnoise(vec3(ring * 1.6, vSeed * 13.1)) - 0.5;
  float fine = vnoise(vec3(vLocal * 4.0, vSeed * 7.3)) - 0.5;
  float rr = r * (1.0 - 0.2 * lobes) * (1.0 - 0.06 * fine);
  float x = clamp(1.0 - rr * rr, 0.0, 1.0);
  float f = x * x * vAmount;
  outColor = vec4(f * vWater, f, 0.0, 1.0);
}`;

const DRY_FS = `
uniform vec2 uKeep;
out vec4 outColor;
void main() { outColor = vec4(uKeep, 1.0, 1.0); }`;

function icosphere(levels = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v3.norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = new Map();
  const m = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!mid.has(k)) { verts.push(v3.norm(v3.scale(v3.add(verts[a], verts[b]), 0.5))); mid.set(k, verts.length - 1); }
    return mid.get(k);
  };
  for (let l = 0; l < levels; l++) faces = faces.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  return new Float32Array(faces.flat().flatMap((i) => verts[i]));
}

export function createJuice(gl, rng = Math.random) {
  const fmt = formats(gl);
  const pos = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3), rad = new Float32Array(MAX), life = new Float32Array(MAX), ttl = new Float32Array(MAX);
  const kind = new Uint8Array(MAX), anchorRest = new Float32Array(MAX * 3), growTo = new Float32Array(MAX), growRate = new Float32Array(MAX);
  const anchor = new Array(MAX).fill(null);
  let count = 0, mist = 0;
  const instance = new Float32Array(MAX * 8);
  const splats = [];
  const emitters = [];
  const POOL = 64;
  const pool = new Float32Array(POOL * POOL);
  const poolCell = (x, z) => {
    const i = Math.floor((x / WET_EXTENT * 0.5 + 0.5) * POOL), j = Math.floor((z / WET_EXTENT * 0.5 + 0.5) * POOL);
    return i < 0 || j < 0 || i >= POOL || j >= POOL ? -1 : j * POOL + i;
  };
  const stats = { splats: 0, drips: 0 };
  let time = 0;
  let absorb = JUICE.navel.absorb;
  const dropProg = program(gl, DROP_VS, DROP_FS, { label: 'droplets' });
  const splatProg = program(gl, SPLAT_VS, SPLAT_FS, { label: 'splat' });
  const dryProg = program(gl, FULLSCREEN_VS, DRY_FS, { label: 'dry' });
  const sphere = icosphere(2);
  const vao = gl.createVertexArray();
  const sphereBuf = gl.createBuffer(), instBuf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sphere, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instance.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 16);
  gl.vertexAttribDivisor(4, 1);
  const splatVao = gl.createVertexArray();
  const cornerBuf = gl.createBuffer(), splatBuf = gl.createBuffer();
  gl.bindVertexArray(splatVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, splatBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 4 * SPLAT_FLOATS * MAX_SPLATS, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 4 * SPLAT_FLOATS, 0);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 4 * SPLAT_FLOATS, 16);
  gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);
  const wet = fbo(gl, [target(gl, WET_SIZE, WET_SIZE, fmt.rg)]);
  let wetDirty = true;
  const listeners = { splat: [], drip: [] };

  function spawn(p, v, r, k = 0, maxLife = 14) {
    if (count >= MAX || (k === 1 && mist >= MAX_MIST)) return -1;
    const i = count++;
    pos.set(p, i * 3); vel.set(v, i * 3); rad[i] = r; life[i] = 0; ttl[i] = maxLife; kind[i] = k; anchor[i] = null;
    if (k === 1) mist++;
    return i;
  }

  function kill(i) {
    if (kind[i] === 1) mist--;
    count--;
    if (i === count) { anchor[i] = null; return; }
    pos.copyWithin(i * 3, count * 3, count * 3 + 3);
    vel.copyWithin(i * 3, count * 3, count * 3 + 3);
    anchorRest.copyWithin(i * 3, count * 3, count * 3 + 3);
    rad[i] = rad[count]; life[i] = life[count]; ttl[i] = ttl[count]; kind[i] = kind[count];
    growTo[i] = growTo[count]; growRate[i] = growRate[count]; anchor[i] = anchor[count]; anchor[count] = null;
  }

  function capPoint(cap) {
    let pick = rng() * cap.area, tri = 0;
    for (; tri < cap.tris.length; tri += 4) { pick -= cap.tris[tri + 3]; if (pick <= 0) break; }
    tri = Math.min(tri, cap.tris.length - 4);
    let a = rng(), b = rng();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const [A, B, C] = [cap.tris[tri], cap.tris[tri + 1], cap.tris[tri + 2]];
    return v3.add(A, v3.add(v3.scale(v3.sub(B, A), a), v3.scale(v3.sub(C, A), b)));
  }

  function depthBelowPeel(params, p) {
    const r = v3.len(p);
    if (r < 1e-4) return { inside: 0, r };
    return { inside: shapeRadius(params, v3.scale(p, 1 / r)) - r, r };
  }

  function fleshPoint(cap, params) {
    for (let k = 0; k < 14; k++) {
      const p = capPoint(cap);
      const { inside } = depthBelowPeel(params, p);
      if (inside > params.flavedo + params.pith + 0.0008 && Math.hypot(p[0], p[2]) > params.core * 0.8) return p;
    }
    return null;
  }

  function rimPoint(cap, params) {
    for (let k = 0; k < 10; k++) {
      const p = capPoint(cap);
      const r = v3.len(p);
      if (r < 1e-4) continue;
      const d = v3.scale(p, 1 / r);
      const flat = v3.norm(v3.sub(d, v3.scale(cap.normal, v3.dot(d, cap.normal))));
      const R = shapeRadius(params, flat);
      const along = Math.sqrt(Math.max(0, R * R - cap.d * cap.d));
      const centre = v3.scale(cap.normal, cap.d);
      const q = v3.add(centre, v3.scale(flat, along - params.flavedo * 0.6));
      if (Number.isFinite(q[0])) return q;
    }
    return null;
  }

  function emitFromCap(piece, cap, params, n, speed, { spread = 0.3, size = [0.0006, 0.0011], up = 0.2 } = {}) {
    const nWorld = restDirToWorld(piece, cap.normal);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const p = fleshPoint(cap, params);
      if (!p) continue;
      const w = restToWorld(piece, v3.add(p, v3.scale(cap.normal, 0.0006)));
      const s = speed * (0.4 + rng() * 0.8);
      const jitter = [(rng() - 0.5) * spread, (rng() - 0.5) * spread + up, (rng() - 0.5) * spread];
      const v = v3.add(v3.scale(nWorld, s), v3.scale(jitter, speed));
      if (spawn(w, v, size[0] + rng() * (size[1] - size[0])) >= 0) made++;
    }
    return made;
  }

  function cutBurst(piece, cap, params, amount = 1) {
    const n = Math.round(Math.min(60, 10 + cap.area * 9000) * amount);
    emitFromCap(piece, cap, params, n, 0.28, { spread: 0.7, size: [0.00025, 0.0009], up: 0.35 });
    const nWorld = restDirToWorld(piece, cap.normal);
    const misty = Math.round(70 * amount);
    for (let i = 0; i < misty; i++) {
      const p = rimPoint(cap, params);
      if (!p) continue;
      const out = v3.norm(v3.sub(p, v3.scale(cap.normal, cap.d)));
      const w = restToWorld(piece, p);
      const dir = v3.norm(v3.add(v3.add(restDirToWorld(piece, out), v3.scale(nWorld, (rng() - 0.5) * 1.2)), [(rng() - 0.5) * 0.8, rng() * 0.8, (rng() - 0.5) * 0.8]));
      spawn(w, v3.scale(dir, 0.25 + rng() * 0.7), 0.00003 + rng() * 0.00006, 1, 0.5 + rng() * 0.7);
    }
  }

  function fresh(piece, cap, seconds = 6) {
    for (const e of emitters) if (e.piece === piece && e.cap === cap) { e.until = Math.max(e.until, time + seconds); return; }
    emitters.push({ piece, cap, start: time, until: time + seconds, next: time + 0.35 + rng() * 0.5, boost: 0 });
  }

  function lowestEdge(piece, cap) {
    let best = null, lo = Infinity;
    const t = cap.tris;
    for (let i = 0; i < t.length; i += 4) for (let k = 0; k < 3; k++) {
      const w = restToWorld(piece, t[i + k]);
      if (w[1] < lo) { lo = w[1]; best = t[i + k]; }
    }
    return best;
  }

  function startDrip(piece, cap, params, floorAt, big = 1) {
    const nWorld = restDirToWorld(piece, cap.normal);
    const edge = lowestEdge(piece, cap);
    if (!edge) return;
    const centre = cap.centroid;
    const inward = v3.norm(v3.sub(centre, edge));
    const rest = v3.add(v3.add(edge, v3.scale(inward, 0.0012)), v3.scale(cap.normal, 0.0007));
    const w = restToWorld(piece, rest);
    if (w[1] - floorAt(w[0], w[2]) < 0.0025) {
      addSplat(w[0], w[2], 0.0035 + rng() * 0.003 * big, 0.5 + 0.3 * rng(), [0, 0], 1);
      return;
    }
    if (nWorld[1] > 0.55) return;
    for (let i = 0; i < count; i++) if (kind[i] === 2 && anchor[i] === piece && v3.len(v3.sub(anchorRest.subarray(i * 3, i * 3 + 3), rest)) < 0.003) return;
    const i = spawn(w, [0, 0, 0], 0.0004, 2, 20);
    if (i < 0) return;
    anchor[i] = piece;
    anchorRest.set(rest, i * 3);
    growTo[i] = (0.0015 + rng() * 0.0006) * Math.min(1.25, big);
    growRate[i] = growTo[i] / (0.5 + rng() * 0.9) * big;
    stats.drips++;
  }

  function squeeze(piece, cap, params, dt, hold, state) {
    if (!state.jets) {
      state.jets = [];
      for (let k = 0; k < 4; k++) { const p = fleshPoint(cap, params); if (p) state.jets.push({ p, tilt: [(rng() - 0.5) * 0.5, rng() * 0.4, (rng() - 0.5) * 0.5] }); }
      state.acc = 0;
    }
    const h = Math.min(hold, 1.6);
    const rate = 30 + 170 * h;
    state.acc += rate * dt;
    const nWorld = restDirToWorld(piece, cap.normal);
    while (state.acc >= 1) {
      state.acc -= 1;
      const jet = state.jets.length && rng() < 0.75 ? state.jets[Math.floor(rng() * state.jets.length)] : null;
      const p = jet ? jet.p : fleshPoint(cap, params);
      if (!p) continue;
      const w = restToWorld(piece, v3.add(p, v3.scale(cap.normal, 0.0007)));
      const tilt = jet ? jet.tilt : [(rng() - 0.5) * 1.4, rng() * 0.4, (rng() - 0.5) * 1.4];
      const dir = v3.norm(v3.add(nWorld, v3.add(tilt, [(rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25])));
      const speed = (0.18 + 0.42 * h) * (jet ? 0.75 + rng() * 0.5 : 0.25 + rng() * 0.35);
      spawn(w, v3.scale(dir, speed), 0.00035 + rng() * (0.0004 + 0.0004 * h));
    }
    state.runoff = (state.runoff || 0) + dt * (6 + 30 * h);
    while (state.runoff >= 1) {
      state.runoff -= 1;
      const p = rimPoint(cap, params);
      if (!p) break;
      const out = v3.norm(v3.sub(p, v3.scale(cap.normal, cap.d)));
      const w = restToWorld(piece, v3.sub(p, v3.scale(cap.normal, 0.0025)));
      spawn(w, v3.scale(restDirToWorld(piece, out), 0.01 + rng() * 0.02), 0.0008 + rng() * 0.0007);
    }
    if (rng() < dt * (4 + 10 * h)) {
      const p = rimPoint(cap, params);
      if (p) spawn(restToWorld(piece, p), v3.scale(v3.norm(v3.add(nWorld, [(rng() - 0.5), rng(), (rng() - 0.5)])), 0.3 + rng() * 0.5), 0.00004 + rng() * 0.00005, 1, 0.6);
    }
    fresh(piece, cap, 5);
    for (const e of emitters) if (e.piece === piece && e.cap === cap) { e.boost = Math.min(1, e.boost + dt * 2); if (e.next > time + 0.35) e.next = time + 0.1; }
  }

  function addSplat(x, z, radius, amount, stretch, water) {
    if (Math.abs(x) > WET_EXTENT * 1.05 || Math.abs(z) > WET_EXTENT * 1.05) return;
    if (splats.length >= MAX_SPLATS) return;
    splats.push([x, z, radius, amount, stretch[0], stretch[1], rng() * 100, water]);
    stats.splats++;
  }

  function impact(x, z, r, v) {
    const speed = Math.hypot(v[0], v[1], v[2]);
    const cell = poolCell(x, z);
    let spread = 1;
    if (cell >= 0) {
      pool[cell] += (r / 0.001) ** 3;
      spread = Math.min(3.2, 1 + 0.28 * Math.sqrt(pool[cell]));
    }
    const h = Math.hypot(v[0], v[2]);
    const dir = h > 1e-4 ? [v[0] / h, v[2] / h] : [1, 0];
    const elong = Math.min(1.6, h / (Math.abs(v[1]) + 0.35));
    const radius = Math.min(0.016, r * (2.0 + 0.9 * Math.min(speed, 3)) * spread);
    const shift = radius * elong * 0.35;
    addSplat(x + dir[0] * shift, z + dir[1] * shift, radius, 0.9 + 0.3 * rng(), [dir[0] * elong, dir[1] * elong], 1);
    const sats = speed > 1.1 ? Math.min(7, Math.floor((speed - 0.9) * 4 * Math.min(1, r / 0.0006))) : 0;
    for (let k = 0; k < sats; k++) {
      const a = Math.atan2(dir[1], dir[0]) + (rng() - 0.5) * (elong > 0.3 ? 1.6 : 6.28);
      const d = radius * (1.25 + rng() * 1.8);
      addSplat(x + Math.cos(a) * d, z + Math.sin(a) * d, radius * (0.18 + rng() * 0.3), 0.8 + 0.4 * rng(), [0, 0], 1);
    }
  }

  function collidePieces(i, pieces, params) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    for (const piece of pieces) {
      const dc = v3.sub(p, piece.position);
      if (v3.dot(dc, dc) > piece.radius * piece.radius) continue;
      const rest = worldToRest(piece, p);
      const r = v3.len(rest);
      if (r < 1e-5) continue;
      const R = shapeRadius(params, v3.scale(rest, 1 / r));
      let depth = R - r, normal = v3.scale(rest, 1 / r);
      if (depth < 0) continue;
      let inside = true;
      for (const cap of piece.caps) {
        const d = -v3.dot(v3.sub(rest, cap.centroid), cap.normal);
        if (d < 0) { inside = false; break; }
        if (d < depth) { depth = d; normal = cap.normal; }
      }
      if (!inside) continue;
      const out = restToWorld(piece, v3.add(rest, v3.scale(normal, depth + 0.0002)));
      pos.set(out, i * 3);
      const nW = restDirToWorld(piece, normal);
      const v = [vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]];
      const vn = v3.dot(v, nW);
      const vt = v3.sub(v, v3.scale(nW, vn));
      const stick = nW[1] < 0.2 ? 0.06 : 0.02;
      vel.set(v3.add(v3.scale(vt, 0.8), v3.scale(nW, (vn < 0 ? -vn * 0.03 : vn * 0.3) - stick)), i * 3);
      return true;
    }
  }

  function updateEmitters(pieces, params, floorAt) {
    for (let k = emitters.length - 1; k >= 0; k--) {
      const e = emitters[k];
      if (!pieces.includes(e.piece) || time > e.until) { emitters.splice(k, 1); continue; }
      if (time < e.next) continue;
      const age = (time - e.start) / Math.max(0.1, e.until - e.start);
      startDrip(e.piece, e.cap, params, floorAt, 1 + e.boost * 0.25);
      e.next = time + (0.45 + 1.6 * age) * (0.6 + 0.8 * rng()) * (1 - 0.6 * e.boost);
      e.boost = Math.max(0, e.boost - 0.2);
    }
  }

  function update(dt, pieces, params, floorAt) {
    if (dt <= 0) return;
    time += dt;
    if (params) updateEmitters(pieces, params, floorAt);
    const dropDrag = Math.exp(-dt * 0.6);
    for (let i = count - 1; i >= 0; i--) {
      life[i] += dt;
      if (kind[i] === 2) {
        const piece = anchor[i];
        if (!piece || !pieces.includes(piece)) { kind[i] = 0; anchor[i] = null; continue; }
        rad[i] = Math.min(growTo[i], rad[i] + growRate[i] * dt);
        const a = restToWorld(piece, anchorRest.subarray(i * 3, i * 3 + 3));
        const sag = rad[i] * 0.85;
        pos.set([a[0], a[1] - sag, a[2]], i * 3);
        const pv = piece.body ? [piece.body.linvel().x, piece.body.linvel().y, piece.body.linvel().z] : [0, 0, 0];
        vel.set(pv, i * 3);
        if (rad[i] >= growTo[i] || v3.len(pv) > 0.4) {
          kind[i] = 0;
          anchor[i] = null;
          vel[i * 3 + 1] -= 0.05;
          for (const f of listeners.drip) f(rad[i]);
        }
        continue;
      }
      if (kind[i] === 1) {
        const d = Math.exp(-dt * 9);
        vel[i * 3] *= d; vel[i * 3 + 2] *= d;
        vel[i * 3 + 1] = vel[i * 3 + 1] * d - 9.81 * dt * 0.05;
        for (let c = 0; c < 3; c++) pos[i * 3 + c] += vel[i * 3 + c] * dt;
        if (life[i] > ttl[i] || pos[i * 3 + 1] < floorAt(pos[i * 3], pos[i * 3 + 2])) kill(i);
        continue;
      }
      vel[i * 3 + 1] -= 9.81 * dt;
      for (let c = 0; c < 3; c++) { vel[i * 3 + c] *= dropDrag; pos[i * 3 + c] += vel[i * 3 + c] * dt; }
      if (life[i] > 0.03) collidePieces(i, pieces, params);
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const floor = floorAt(x, z);
      if (y - rad[i] < floor) {
        const v = [vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]];
        impact(x, z, rad[i], v);
        for (const f of listeners.splat) f(Math.hypot(...v), rad[i]);
        kill(i);
      } else if (life[i] > ttl[i] || Math.abs(x) > 3 || Math.abs(z) > 3) kill(i);
    }
  }

  function renderWetness() {
    if (!wetDirty && !splats.length) return;
    bind(gl, wet);
    if (wetDirty) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); wetDirty = false; }
    gl.disable(gl.DEPTH_TEST);
    if (splats.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const data = new Float32Array(splats.flat());
      gl.bindBuffer(gl.ARRAY_BUFFER, splatBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      use(splatProg, { uExtent: WET_EXTENT });
      gl.bindVertexArray(splatVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, splats.length);
      gl.bindVertexArray(null);
      splats.length = 0;
      gl.disable(gl.BLEND);
    }
  }

  function dry(dt) {
    bind(gl, wet);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    use(dryProg, { uKeep: [Math.exp(-dt / WATER_LIFE), Math.exp(-dt / FILM_LIFE)] });
    const keep = Math.exp(-dt / WATER_LIFE);
    for (let i = 0; i < pool.length; i++) pool[i] *= keep;
    fullscreen(gl);
    gl.disable(gl.BLEND);
  }

  function draw(ctx) {
    if (!count) return;
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      instance[o] = pos[i * 3]; instance[o + 1] = pos[i * 3 + 1]; instance[o + 2] = pos[i * 3 + 2]; instance[o + 3] = rad[i];
      if (kind[i] === 2) {
        const g = rad[i] / Math.max(growTo[i], 1e-6);
        instance[o + 4] = 0; instance[o + 5] = -rad[i] * 0.45 * g * g; instance[o + 6] = 0;
      } else {
        const s = Math.min(0.006, 0.0035 * Math.hypot(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]));
        const sp = Math.hypot(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]) || 1;
        instance[o + 4] = vel[i * 3] / sp * s; instance[o + 5] = vel[i * 3 + 1] / sp * s; instance[o + 6] = vel[i * 3 + 2] / sp * s;
      }
      instance[o + 7] = kind[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instance, 0, count * 8);
    use(dropProg, { uOpaque: ctx.targets.hdrCopy, uAbsorb: absorb });
    set(dropProg, 'uEnvCube', ctx.ibl.env);
    set(dropProg, 'uKeyCube', ctx.ibl.key);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, sphere.length / 3, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  let dryTimer = 0;
  return {
    get count() { return count; },
    get emitting() { return emitters.length; },
    stats, wetness: wet.colors[0], extent: WET_EXTENT, size: WET_SIZE,
    spawn, emitFromCap, cutBurst, fresh, squeeze, update, draw, addSplat,
    setVariety(name) { absorb = (JUICE[name] || JUICE.navel).absorb; return (JUICE[name] || JUICE.navel).tint; },
    on(name, f) { listeners[name].push(f); },
    prepare(dt) {
      dryTimer += dt;
      if (dryTimer > 0.25) { dry(dryTimer); dryTimer = 0; }
      renderWetness();
    },
    clear() { count = 0; mist = 0; anchor.fill(null); splats.length = 0; emitters.length = 0; pool.fill(0); wetDirty = true; },
  };
}
