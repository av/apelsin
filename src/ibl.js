import { program, use, set, FULLSCREEN_VS, fullscreen, formats } from './gl.js';

const MAX_LIGHTS = 8;

const ENV_GLSL = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec4 uLightDir[${MAX_LIGHTS}];
uniform vec4 uLightUp[${MAX_LIGHTS}];
uniform vec4 uLightColor[${MAX_LIGHTS}];
uniform vec4 uLightShape[${MAX_LIGHTS}];
uniform float uLightStripAt[${MAX_LIGHTS}];
uniform int uLightCount;
uniform int uMode;
uniform float uCubeScale;
vec3 envRadiance(vec3 d) {
  vec3 c = vec3(0);
  if (uMode != 1) {
    float y = d.y;
    c = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.6)) : mix(uHorizon, uBottom, pow(clamp(-y, 0.0, 1.0), 0.4));
  }
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    if ((i == 0) != (uMode == 1) && uMode != 2) continue;
    vec3 f = uLightDir[i].xyz, up = uLightUp[i].xyz;
    vec3 rt = normalize(cross(f, up));
    vec3 u = cross(rt, f);
    float z = dot(d, f);
    if (z <= 0.0) continue;
    vec2 pl = vec2(dot(d, rt), dot(d, u)) / z;
    vec2 half_ = vec2(uLightDir[i].w, uLightUp[i].w);
    vec2 e = abs(pl) / half_;
    float soft = uLightColor[i].w;
    float m = (1.0 - smoothstep(1.0 - soft, 1.0, e.x)) * (1.0 - smoothstep(1.0 - soft, 1.0, e.y));
    vec4 shape = uLightShape[i];
    float profile = 1.0 + 0.25 * (1.0 - dot(e, e) * 0.5);
    profile += shape.x * exp(-dot(e, e) / (shape.y * shape.y));
    float sy = (pl.y / half_.y - uLightStripAt[i]) / max(shape.w, 1e-3);
    profile += shape.z * exp(-sy * sy) * (1.0 - smoothstep(0.55, 0.85, e.x));
    c += uLightColor[i].rgb * m * profile;
  }
  return c;
}
`;

const CUBE_VS = `
uniform mat3 uFace;
out vec3 vDir;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vDir = uFace * vec3(p, 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const ENV_FS = ENV_GLSL + `
in vec3 vDir;
out vec4 outColor;
void main() { outColor = vec4(envRadiance(normalize(vDir)) * uCubeScale, 1.0); }
`;

const IMPORTANCE = `
float radicalInverse(uint b) {
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return float(b) * 2.3283064365386963e-10;
}
vec2 hammersley(uint i, uint n) { return vec2(float(i) / float(n), radicalInverse(i)); }
vec3 importanceGGX(vec2 xi, vec3 N, float a) {
  float phi = 6.2831853 * xi.x;
  float cosT = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  float sinT = sqrt(1.0 - cosT * cosT);
  vec3 h = vec3(cos(phi) * sinT, sin(phi) * sinT, cosT);
  vec3 up = abs(N.z) < 0.999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
  vec3 tx = normalize(cross(up, N)), ty = cross(N, tx);
  return normalize(tx * h.x + ty * h.y + N * h.z);
}
`;

const PREFILTER_FS = IMPORTANCE + `
uniform samplerCube uSource;
uniform float uRoughness;
uniform float uSourceSize;
in vec3 vDir;
out vec4 outColor;
void main() {
  vec3 N = normalize(vDir);
  float a = uRoughness * uRoughness;
  vec3 sum = vec3(0);
  float w = 0.0;
  const uint COUNT = 192u;
  for (uint i = 0u; i < COUNT; i++) {
    vec3 H = importanceGGX(hammersley(i, COUNT), N, a);
    vec3 L = normalize(2.0 * dot(N, H) * H - N);
    float NoL = dot(N, L);
    if (NoL > 0.0) {
      float NoH = max(dot(N, H), 0.0);
      float a2 = a * a;
      float dd = NoH * NoH * (a2 - 1.0) + 1.0;
      float D = a2 / (3.14159265 * dd * dd);
      float pdf = D / 4.0 + 1e-4;
      float saTexel = 4.0 * 3.14159265 / (6.0 * uSourceSize * uSourceSize);
      float saSample = 1.0 / (float(COUNT) * pdf);
      float lod = uRoughness == 0.0 ? 0.0 : max(0.5 * log2(saSample / saTexel) + 1.0, 0.0);
      sum += textureLod(uSource, L, lod).rgb * NoL;
      w += NoL;
    }
  }
  outColor = vec4(sum / max(w, 1e-4), 1.0);
}
`;

const LUT_FS = IMPORTANCE + `
in vec2 vUv;
out vec4 outColor;
void main() {
  float NoV = max(vUv.x, 1e-3), rough = max(vUv.y, 0.02);
  vec3 V = vec3(sqrt(1.0 - NoV * NoV), 0.0, NoV), N = vec3(0, 0, 1);
  float a = rough * rough, A = 0.0, B = 0.0;
  const uint COUNT = 512u;
  for (uint i = 0u; i < COUNT; i++) {
    vec3 H = importanceGGX(hammersley(i, COUNT), N, a);
    vec3 L = normalize(2.0 * dot(V, H) * H - V);
    float NoL = max(L.z, 0.0), NoH = max(H.z, 0.0), VoH = max(dot(V, H), 0.0);
    if (NoL > 0.0) {
      float k = a / 2.0;
      float G = (NoV / (NoV * (1.0 - k) + k)) * (NoL / (NoL * (1.0 - k) + k));
      float Gv = G * VoH / (NoH * NoV);
      float Fc = pow(1.0 - VoH, 5.0);
      A += (1.0 - Fc) * Gv;
      B += Fc * Gv;
    }
  }
  outColor = vec4(A / float(COUNT), B / float(COUNT), 0.0, 1.0);
}
`;

const FACE_BASES = [
  [[0, 0, -1], [0, -1, 0], [1, 0, 0]],
  [[0, 0, 1], [0, -1, 0], [-1, 0, 0]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, -1, 0], [0, 0, -1]],
];

const faceMat = (i) => new Float32Array(FACE_BASES[i].flat());

function cubeTexture(gl, size, fmt, mips) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
  const levels = mips ? Math.floor(Math.log2(size)) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, fmt.internal, size, size);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, p, gl.CLAMP_TO_EDGE);
  return { tex, cube: true, size, levels };
}

function renderFaces(gl, fb, cube, level, size, prog, extra = {}) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, size, size);
  for (let f = 0; f < 6; f++) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, cube.tex, level);
    use(prog, { uFace: faceMat(f), ...extra });
    fullscreen(gl);
  }
}

function projectSH(gl, fb, prog, size, scale, readFloat) {
  const tmp = cubeTexture(gl, size, readFloat ? { internal: gl.RGBA16F } : { internal: gl.RGBA8 }, false);
  renderFaces(gl, fb, tmp, 0, size, prog);
  const sh = new Float32Array(36);
  const px = readFloat ? new Float32Array(size * size * 4) : new Uint8Array(size * size * 4);
  for (let f = 0; f < 6; f++) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tmp.tex, 0);
    gl.readPixels(0, 0, size, size, gl.RGBA, readFloat ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
    const [a, b, c] = FACE_BASES[f];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1, v = ((j + 0.5) / size) * 2 - 1;
      let x = a[0] * u + b[0] * v + c[0], y = a[1] * u + b[1] * v + c[1], z = a[2] * u + b[2] * v + c[2];
      const l2 = x * x + y * y + z * z, l = Math.sqrt(l2);
      x /= l; y /= l; z /= l;
      const dw = (4 / (size * size)) / (l2 * l);
      const k = (j * size + i) * 4;
      const div = readFloat ? scale : 255 * scale;
      const col = [px[k] / div, px[k + 1] / div, px[k + 2] / div];
      const basis = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
      for (let n = 0; n < 9; n++) for (let ch = 0; ch < 3; ch++) sh[n * 4 + ch] += col[ch] * basis[n] * dw;
    }
  }
  gl.deleteTexture(tmp.tex);
  return sh;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function profileMean(soft, [core, coreW, strip, stripW], stripAt = 0.62) {
  let sum = 0;
  const n = 48;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * 2.2 - 1.1, y = ((j + 0.5) / n) * 2.2 - 1.1;
    const ex = Math.abs(x), ey = Math.abs(y), e2 = x * x + y * y;
    const m = (1 - smooth(1 - soft, 1, ex)) * (1 - smooth(1 - soft, 1, ey));
    const sy = (y - stripAt) / Math.max(stripW, 1e-3);
    sum += m * (1 + 0.25 * (1 - e2 * 0.5) + core * Math.exp(-e2 / (coreW * coreW)) + strip * Math.exp(-sy * sy) * (1 - smooth(0.55, 0.85, ex)));
  }
  return sum / (n * n);
}

export function createIBL(gl) {
  const fmt = formats(gl);
  const readFloat = gl.caps.floatTargets;
  const cubeFmt = readFloat ? { internal: gl.RGBA16F } : { internal: gl.RGBA8 };
  const envProg = program(gl, CUBE_VS, ENV_FS, { label: 'ibl-env' });
  const prefilterProg = program(gl, CUBE_VS, PREFILTER_FS, { label: 'ibl-prefilter' });
  const lutProg = program(gl, FULLSCREEN_VS, LUT_FS, { label: 'ibl-lut' });
  const fb = gl.createFramebuffer();
  const lut = { tex: gl.createTexture(), width: 128, height: 128 };
  gl.bindTexture(gl.TEXTURE_2D, lut.tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, fmt.rg.internal, 128, 128);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lut.tex, 0);
  gl.viewport(0, 0, 128, 128);
  use(lutProg);
  fullscreen(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const SOURCE = 256, SPEC = 128, SPEC_LEVELS = 6;
  const cubeScale = readFloat ? 1 : 1 / 32;
  const make = () => {
    const spec = cubeTexture(gl, SPEC, cubeFmt, true);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, SPEC_LEVELS - 1);
    return { source: cubeTexture(gl, SOURCE, cubeFmt, true), spec };
  };
  const env = make(), key = make();

  function envUniforms(desc, mode) {
    const lights = desc.lights.slice(0, MAX_LIGHTS);
    const dir = new Float32Array(MAX_LIGHTS * 4), up = new Float32Array(MAX_LIGHTS * 4), col = new Float32Array(MAX_LIGHTS * 4), shape = new Float32Array(MAX_LIGHTS * 4), stripAt = new Float32Array(MAX_LIGHTS);
    lights.forEach((l, i) => {
      const sh = [l.core?.[0] ?? 0, l.core?.[1] ?? 0.4, l.strip?.[0] ?? 0, l.strip?.[1] ?? 0.08];
      shape.set(sh, i * 4);
      stripAt[i] = l.strip?.[2] ?? 0.62;
      const norm = profileMean(l.soft ?? 0.15, [0, 0.4, 0, 0.08]) / profileMean(l.soft ?? 0.15, sh, stripAt[i]);
      dir.set([...l.dir, Math.tan(l.size[0])], i * 4);
      up.set([...l.up, Math.tan(l.size[1])], i * 4);
      col.set([l.color[0] * l.intensity * norm, l.color[1] * l.intensity * norm, l.color[2] * l.intensity * norm, l.soft ?? 0.15], i * 4);
    });
    return { uTop: desc.top, uHorizon: desc.horizon, uBottom: desc.bottom, uLightDir: dir, uLightUp: up, uLightColor: col, uLightShape: shape, uLightStripAt: stripAt, uLightCount: lights.length, uMode: mode, uCubeScale: cubeScale };
  }

  function setInt(prog, name, v) { gl.uniform1i(prog.uniforms[name], v); }

  function bake(target, desc, mode) {
    const u = envUniforms(desc, mode);
    use(envProg);
    for (const [k, v] of Object.entries(u)) {
      if (k === 'uLightCount' || k === 'uMode') setInt(envProg, k, v);
      else set(envProg, k, v);
    }
    renderFaces(gl, fb, target.source, 0, SOURCE, envProg);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, target.source.tex);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    for (let level = 0; level < SPEC_LEVELS; level++) {
      const size = SPEC >> level;
      renderFaces(gl, fb, target.spec, level, size, prefilterProg, { uSource: target.source, uRoughness: level / (SPEC_LEVELS - 1), uSourceSize: SOURCE });
    }
    use(envProg);
    for (const [k, v] of Object.entries(u)) {
      if (k === 'uLightCount' || k === 'uMode') setInt(envProg, k, v);
      else set(envProg, k, v);
    }
    const sh = projectSH(gl, fb, envProg, 32, cubeScale, readFloat);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return sh;
  }

  return {
    lut, env: env.spec, key: key.spec, envSource: env.source, maxMip: SPEC_LEVELS - 1, cubeScale,
    shEnv: new Float32Array(36), shKey: new Float32Array(36),
    bake(desc) {
      this.shEnv = bake(env, desc, 0);
      this.shKey = bake(key, desc, 1);
    },
  };
}
