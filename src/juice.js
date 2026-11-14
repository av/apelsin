import { program, use, set, fbo, target, formats, FULLSCREEN_VS, fullscreen, bind } from './gl.js';
import { FRAME_UBO, NOISE, SURFACE, LIGHTING } from './shaders/common.js';
import { shapeRadius } from './orange/mesh.js';
import { quat, v3 } from './math.js';
import { worldToRest, restToWorld, restDirToWorld } from './orange/piece.js';

const MAX = 2000;
const WET_SIZE = 1024;
const WET_EXTENT = 0.35;

const DROP_VS = FRAME_UBO + `
layout(location = 0) in vec3 aPos;
layout(location = 3) in vec4 aDrop;
layout(location = 4) in vec3 aVel;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  float sp = length(aVel);
  vec3 dir = sp > 1e-4 ? aVel / sp : vec3(0, 1, 0);
  float stretch = clamp(sp * 0.35, 0.0, 1.2);
  vec3 p = aPos * aDrop.w;
  p += dir * dot(aPos, dir) * aDrop.w * stretch;
  vWorld = aDrop.xyz + p;
  vNormal = aPos;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

const DROP_FS = FRAME_UBO + NOISE + SURFACE + LIGHTING + `
uniform sampler2D uOpaque;
in vec3 vWorld;
in vec3 vNormal;
out vec4 outColor;
void main() {
  vec3 N = normalize(vNormal), V = normalize(uCamPos.xyz - vWorld);
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  vec3 Nv = mat3(uView) * N;
  vec2 uv = gl_FragCoord.xy * uResolution.zw - Nv.xy * 0.035 * (1.0 - NoV * 0.5);
  vec3 behind = texture(uOpaque, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  vec3 absorb = vec3(1.0, 0.62, 0.18);
  vec3 refr = behind * mix(absorb, vec3(1.0), 0.35) * 0.96;
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = envSpec(uEnvCube, R, 0.04) * uEnvParams.x + envSpec(uKeyCube, R, 0.03) * uEnvParams.y;
  float glint = pow(max(dot(R, uKeyDir.xyz), 0.0), 400.0) * 6.0;
  outColor = vec4(refr * (1.0 - F) + refl * F + vec3(glint) * uEnvParams.y, 1.0);
}`;

const SPLAT_VS = `
layout(location = 0) in vec2 aCorner;
layout(location = 3) in vec4 aSplat;
uniform float uExtent;
out vec2 vLocal;
out float vAmount;
void main() {
  vLocal = aCorner;
  vAmount = aSplat.w;
  vec2 c = aSplat.xy / uExtent;
  gl_Position = vec4(c + aCorner * aSplat.z / uExtent, 0.0, 1.0);
}`;

const SPLAT_FS = NOISE + `
in vec2 vLocal;
in float vAmount;
out vec4 outColor;
void main() {
  float r = length(vLocal);
  float wobble = 0.08 * sin(atan(vLocal.y, vLocal.x) * 5.0 + vAmount * 40.0);
  float edge = 1.0 - smoothstep(0.8 + wobble, 1.0 + wobble, r);
  float rim = 1.0 + 0.6 * smoothstep(0.5, 0.95, r) * edge;
  float w = edge * rim * vAmount;
  outColor = vec4(w, w * 0.85, 0.0, 1.0);
}`;

const DRY_FS = `
uniform float uKeep;
out vec4 outColor;
void main() { outColor = vec4(uKeep, uKeep, 1.0, 1.0); }`;

function icosphere() {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v3.norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = new Map();
  const m = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!mid.has(k)) { verts.push(v3.norm(v3.scale(v3.add(verts[a], verts[b]), 0.5))); mid.set(k, verts.length - 1); }
    return mid.get(k);
  };
  faces = faces.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  return new Float32Array(faces.flat().flatMap((i) => verts[i]));
}

export function createJuice(gl, rng = Math.random) {
  const fmt = formats(gl);
  const pos = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3), rad = new Float32Array(MAX), life = new Float32Array(MAX);
  let count = 0;
  const instance = new Float32Array(MAX * 7);
  const splats = [];
  const dropProg = program(gl, DROP_VS, DROP_FS, { label: 'droplets' });
  const splatProg = program(gl, SPLAT_VS, SPLAT_FS, { label: 'splat' });
  const dryProg = program(gl, FULLSCREEN_VS, DRY_FS, { label: 'dry' });
  const sphere = icosphere();
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
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 28, 0);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 28, 16);
  gl.vertexAttribDivisor(4, 1);
  const splatVao = gl.createVertexArray();
  const cornerBuf = gl.createBuffer(), splatBuf = gl.createBuffer();
  gl.bindVertexArray(splatVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, splatBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 4 * 4 * 512, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0);
  gl.vertexAttribDivisor(3, 1);
  gl.bindVertexArray(null);
  const wet = fbo(gl, [target(gl, WET_SIZE, WET_SIZE, fmt.rg)]);
  let wetDirty = true;
  const listeners = { splat: [] };

  function spawn(p, v, r) {
    if (count >= MAX) return;
    pos.set(p, count * 3); vel.set(v, count * 3); rad[count] = r; life[count] = 0;
    count++;
  }

  function kill(i) {
    count--;
    if (i === count) return;
    pos.copyWithin(i * 3, count * 3, count * 3 + 3);
    vel.copyWithin(i * 3, count * 3, count * 3 + 3);
    rad[i] = rad[count]; life[i] = life[count];
  }

  function fleshPoint(piece, cap, params) {
    for (let k = 0; k < 12; k++) {
      let pick = rng() * cap.area, tri = 0;
      for (; tri < cap.tris.length; tri += 4) { pick -= cap.tris[tri + 3]; if (pick <= 0) break; }
      tri = Math.min(tri, cap.tris.length - 4);
      let a = rng(), b = rng();
      if (a + b > 1) { a = 1 - a; b = 1 - b; }
      const [A, B, C] = [cap.tris[tri], cap.tris[tri + 1], cap.tris[tri + 2]];
      const p = v3.add(A, v3.add(v3.scale(v3.sub(B, A), a), v3.scale(v3.sub(C, A), b)));
      const r = v3.len(p);
      if (r < 1e-4) continue;
      const R = shapeRadius(params, v3.scale(p, 1 / r));
      if (R - r > params.flavedo + params.pith + 0.001 && Math.hypot(p[0], p[2]) > params.core) return p;
    }
    return null;
  }

  function emitFromCap(piece, cap, params, n, speed) {
    const nWorld = restDirToWorld(piece, cap.normal);
    for (let i = 0; i < n; i++) {
      const p = fleshPoint(piece, cap, params);
      if (!p) continue;
      const w = restToWorld(piece, v3.add(p, v3.scale(cap.normal, 0.0008)));
      const s = speed * (0.4 + rng() * 0.8);
      const jitter = [(rng() - 0.5) * 0.3, (rng() - 0.2) * 0.3, (rng() - 0.5) * 0.3];
      const v = v3.add(v3.scale(nWorld, s), v3.scale(jitter, speed));
      spawn(w, v, 0.0007 + rng() * 0.0011);
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
      vel.set(v3.add(v3.scale(vt, 0.85), v3.scale(nW, vn < 0 ? -vn * 0.05 : vn)), i * 3);
    }
  }

  function update(dt, pieces, params, floorAt) {
    const drag = Math.exp(-dt * 0.8);
    for (let i = count - 1; i >= 0; i--) {
      life[i] += dt;
      vel[i * 3 + 1] -= 9.81 * dt;
      for (let k = 0; k < 3; k++) { vel[i * 3 + k] *= drag; pos[i * 3 + k] += vel[i * 3 + k] * dt; }
      if (life[i] > 0.04) collidePieces(i, pieces, params);
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const floor = floorAt(x, z);
      if (y - rad[i] < floor) {
        const sp = Math.hypot(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]);
        if (splats.length < 512) splats.push([x, z, rad[i] * (2.2 + sp * 1.5), 0.35 + rng() * 0.3]);
        for (const f of listeners.splat) f(sp);
        kill(i);
      } else if (life[i] > 12 || Math.abs(x) > 3 || Math.abs(z) > 3) kill(i);
    }
  }

  function renderWetness(dt) {
    if (!wetDirty && !splats.length) return;
    bind(gl, wet);
    if (wetDirty) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); wetDirty = false; }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    if (splats.length) {
      gl.blendFunc(gl.ONE, gl.ONE);
      const data = new Float32Array(splats.flat());
      gl.bindBuffer(gl.ARRAY_BUFFER, splatBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      use(splatProg, { uExtent: WET_EXTENT });
      gl.bindVertexArray(splatVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, splats.length);
      gl.bindVertexArray(null);
      splats.length = 0;
    }
    gl.disable(gl.BLEND);
  }

  function dry(dt) {
    bind(gl, wet);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    use(dryProg, { uKeep: Math.exp(-dt / 90) });
    fullscreen(gl);
    gl.disable(gl.BLEND);
  }

  function draw(ctx) {
    if (!count) return;
    for (let i = 0; i < count; i++) {
      instance.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], rad[i], vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]], i * 7);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instance, 0, count * 7);
    use(dropProg, { uOpaque: ctx.targets.hdrCopy });
    set(dropProg, 'uEnvCube', ctx.ibl.env);
    set(dropProg, 'uKeyCube', ctx.ibl.key);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, sphere.length / 3, count);
    gl.bindVertexArray(null);
  }

  let dryTimer = 0;
  return {
    get count() { return count; },
    wetness: wet.colors[0], extent: WET_EXTENT, size: WET_SIZE,
    spawn, emitFromCap, update, draw,
    on(name, f) { listeners[name].push(f); },
    prepare(dt) {
      dryTimer += dt;
      if (dryTimer > 0.25) { dry(dryTimer); dryTimer = 0; }
      renderWetness(dt);
    },
    clear() { count = 0; splats.length = 0; wetDirty = true; },
    hasWet() { return true; },
  };
}
