import { FRAME_UBO, NOISE, SURFACE, LIGHTING } from './common.js';
import { ORANGE_MATERIAL } from '../orange/glsl.js';
import { WINDOW } from '../scenes.js';

export const ATTRIBS = { aPos: 0, aNormal: 1, aCap: 2 };

export const UBER_VS = FRAME_UBO + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aCap;
uniform mat4 uModel;
uniform mat4 uPrevModel;
out vec3 vRest;
out vec3 vRestNormal;
out vec3 vWorld;
out vec3 vNormal;
out float vCap;
out vec4 vClip;
out vec4 vPrevClip;
invariant gl_Position;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vRest = aPos;
  vRestNormal = aNormal;
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  vCap = aCap;
  vClip = uViewProjNJ * w;
  vPrevClip = uPrevViewProjNJ * (uPrevModel * vec4(aPos, 1.0));
#ifdef SHADOW
  gl_Position = uLightViewProj * w;
#else
  gl_Position = uViewProj * w;
#endif
}`;

const WETNESS = `
uniform sampler2D uWetness;
vec2 wetUv(vec3 w) { return w.xz / (2.0 * uWetParams.x) + 0.5; }
void applyWetness(inout Surface s, SurfaceInput si) {
  vec2 uv = wetUv(si.world);
  if (uWetParams.y < 0.5 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return;
  vec2 wt = texture(uWetness, uv).rg;
  float wet = clamp(wt.r, 0.0, 1.0);
  if (wet < 0.002) return;
  float e = 1.5 / uWetParams.z;
  float wx = texture(uWetness, uv + vec2(e, 0.0)).r - texture(uWetness, uv - vec2(e, 0.0)).r;
  float wz = texture(uWetness, uv + vec2(0.0, e)).r - texture(uWetness, uv - vec2(0.0, e)).r;
  float tint = clamp(wt.g / max(wt.r, 1e-3), 0.0, 1.0);
  vec3 juice = vec3(0.98, 0.82, 0.5);
  float film = smoothstep(0.05, 0.5, wet);
  float rim = smoothstep(0.03, 0.1, wet) * (1.0 - smoothstep(0.1, 0.3, wet));
  s.albedo = mix(s.albedo, s.albedo * mix(vec3(0.9), juice, tint), film) * (1.0 - 0.1 * rim);
  s.roughness = mix(s.roughness, 0.12, film);
  s.clearcoat = max(s.clearcoat, film * 0.8);
  s.clearcoatRoughness = mix(s.clearcoatRoughness, 0.05, film);
  s.N = perturb(s.N, vec3(wx, 0.0, wz) * 0.25, 1.0);
}
`;

const COVE = `
Surface materialSurface(SurfaceInput si) {
  Surface s = defaultSurface(normalize(si.normal));
  float n = vnoise(si.world * 900.0);
  s.albedo = uMaterialColor.rgb * (0.985 + 0.03 * n);
  s.roughness = 0.62;
  s.f0 = vec3(0.03);
  applyWetness(s, si);
  return s;
}
`;

const BOARD = `
float knifeScores(vec2 p, float px) {
  float cell = 0.018;
  vec2 c = floor(p / cell);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = c + vec2(i, j);
    for (int k = 0; k < 3; k++) {
      vec3 h = hash33(vec3(id, float(k) + 5.0));
      if (h.z < 0.3) continue;
      vec2 o = (id + h.xy) * cell;
      float family = step(0.75, fract(h.z * 3.7));
      float ang = (h.x - 0.5) * 0.9 + family * 1.5708 + 0.35;
      vec2 d = vec2(cos(ang), sin(ang));
      float len = cell * (0.5 + 2.0 * fract(h.z * 7.13));
      vec2 q = p - o;
      float along = dot(q, d);
      float dist = length(q - d * clamp(along, -len * 0.5, len * 0.5));
      float taper = 1.0 - smoothstep(len * 0.25, len * 0.5, abs(along));
      float wdt = 0.00005 + 0.0001 * fract(h.y * 13.1);
      float line = (1.0 - smoothstep(wdt, wdt + px * 1.5, dist)) * taper * min(1.0, wdt / max(px * 0.7, 1e-6) + 0.25);
      m = max(m, line * (0.35 + 0.65 * fract(h.x * 31.7)));
    }
  }
  return m;
}
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  float px = si.pixel;
  Surface s = defaultSurface(normalize(si.normal));
  float stripW = 0.04;
  float strip = floor((w.z + 0.16) / stripW);
  vec3 sh = hash33(vec3(strip, 4.0, 9.0));
  float lz = w.z + 0.16 - (strip + 0.5) * stripW;
  vec2 axis = vec2(-0.03 - 0.08 * sh.x, (sh.y - 0.5) * 0.08);
  float warp = fbm3(vec3(w.x * 5.0, w.y * 40.0, lz * 40.0) + sh * 10.0);
  float r = length(vec2(w.y, lz) - axis) + 0.005 * warp + 0.0012 * sin(w.x * (6.0 + 6.0 * sh.z) + sh.z * 6.0);
  float ringW = 0.0022 + 0.0022 * sh.z;
  float ring = fract(r / ringW);
  float late = smoothstep(0.5, 0.88, ring) * (1.0 - smoothstep(0.9, 1.0, ring));
  late = mix(late, 0.28, smoothstep(0.25, 0.8, px / ringW));
  vec3 early = mix(vec3(0.26, 0.13, 0.055), vec3(0.4, 0.22, 0.1), sh.x);
  vec3 col = mix(early, early * vec3(0.55, 0.45, 0.38), late * 0.85);
  col *= 0.86 + 0.28 * fbm3(vec3(w.x * 3.0, w.y * 80.0, lz * 80.0) + sh * 3.0);
  float poreDetail = 1.0 - smoothstep(0.00008, 0.0003, px);
  float pores = smoothstep(0.7, 0.86, vnoise(vec3(w.x * 260.0, w.y * 3500.0, lz * 3500.0) + sh * 50.0)) * poreDetail;
  col *= 1.0 - 0.3 * pores - 0.06 * (1.0 - poreDetail);
  float edge = stripW * 0.5 - abs(lz);
  col *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.0003 + px, edge));
  float top = step(0.5, s.N.y);
  float scores = knifeScores(w.xz, px) * top;
  float wear = (1.0 - smoothstep(0.02, 0.2, length(w.xz * vec2(0.9, 1.3)))) * (0.5 + 0.5 * fbm3(w * 45.0)) * top;
  col = mix(col, col * vec3(1.15, 1.12, 1.08) + 0.015, wear * 0.35);
  col = mix(col, col * vec3(1.25, 1.2, 1.12) + 0.03, scores * 0.6);
  s.albedo = col;
  s.roughness = mix(0.5, 0.68, wear) + 0.08 * late;
  s.roughness = mix(s.roughness, 0.75, scores);
  s.f0 = vec3(0.035);
  s.clearcoat = mix(0.18, 0.05, max(wear, scores));
  s.clearcoatRoughness = 0.3;
  float fine = vnoise(vec3(w.x * 150.0, w.y * 1500.0, lz * 1500.0) + sh * 20.0) - 0.5;
  s.N = perturb(s.N, vec3(0.0, 0.0, fine * 0.04 * poreDetail + (late - 0.5) * 0.012), 1.0);
  s.cavity = 1.0 - 0.25 * pores;
  applyWetness(s, si);
  return s;
}
`;

const COUNTER = `
vec3 terrazzoChip(vec3 id) {
  float k = id.y;
  return k < 0.35 ? vec3(0.82, 0.8, 0.76) : k < 0.6 ? vec3(0.3, 0.3, 0.29) : k < 0.75 ? vec3(0.52, 0.24, 0.11) : k < 0.88 ? vec3(0.045, 0.045, 0.045) : vec3(0.42, 0.46, 0.4);
}
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  float px = si.pixel;
  Surface s = defaultSurface(normalize(si.normal));
  float cloud = fbm3(w * 14.0);
  vec3 col = mix(vec3(0.4, 0.385, 0.36), vec3(0.5, 0.48, 0.45), cloud);
  float speck = vnoise(w * 2200.0);
  col *= 0.94 + 0.12 * mix(speck, 0.5, smoothstep(0.0002, 0.0008, px));
  for (int i = 0; i < 3; i++) {
    float scale = i == 0 ? 55.0 : i == 1 ? 140.0 : 380.0;
    float detail = 1.0 - smoothstep(0.2, 0.7, px * scale);
    Cell c = voronoi3(vec3(w.xz * scale, float(i) * 7.3), 1.0);
    float keep = step(i == 0 ? 0.72 : i == 1 ? 0.55 : 0.45, c.id.x);
    float chip = (1.0 - smoothstep(0.1, 0.1 + px * scale * 2.0 + 0.04, c.f2 - c.f1 - 0.18 - 0.2 * c.id.z)) ;
    chip = (1.0 - chip) * keep;
    vec3 cc = terrazzoChip(c.id) * (0.9 + 0.2 * c.id.z);
    col = mix(col, mix(cc, col, 1.0 - detail * 0.85), chip);
  }
  s.albedo = col;
  s.roughness = 0.32 + 0.1 * cloud;
  s.f0 = vec3(0.045);
  s.clearcoat = 0.35;
  s.clearcoatRoughness = 0.14;
  applyWetness(s, si);
  return s;
}
`;

const SLATE = `
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  float px = si.pixel;
  Surface s = defaultSurface(normalize(si.normal));
  vec3 q = vec3(w.x * 1.0 + w.z * 0.35, w.y, w.z * 1.0 - w.x * 0.35);
  float layers = fbm3(vec3(q.x * 14.0, 0.0, q.z * 40.0));
  float terrace = floor(layers * 7.0) / 7.0;
  float step_ = fract(layers * 7.0);
  float ledge = smoothstep(0.85, 1.0, step_) * (1.0 - smoothstep(0.0, 0.002, px));
  float grain = vnoise(w * 2400.0);
  float grainK = 1.0 - smoothstep(0.00006, 0.0003, px);
  float flecks = smoothstep(0.82, 0.92, vnoise(w * 900.0 + 3.0)) * grainK;
  vec3 col = vec3(0.026, 0.028, 0.031) * (0.8 + 0.45 * terrace) * (0.9 + 0.2 * mix(0.5, grain, grainK));
  col += vec3(0.02, 0.021, 0.022) * flecks + vec3(0.025) * ledge;
  s.albedo = col;
  s.roughness = 0.62 + 0.18 * (1.0 - terrace) - 0.12 * flecks + 0.1 * (grain - 0.5) * grainK;
  s.f0 = vec3(0.045);
  float e = 0.0012;
  float lx = fbm3(vec3((q.x + e) * 14.0, 0.0, q.z * 40.0)) - layers;
  float lz = fbm3(vec3(q.x * 14.0, 0.0, (q.z + e) * 40.0)) - layers;
  vec3 g = vec3(lx, 0.0, lz) / e * 0.0009 + vec3(grain - 0.5, 0.0, vnoise(w * 2400.0 + 9.0) - 0.5) * 0.06 * grainK;
  s.N = perturb(s.N, g, 1.0);
  s.clearcoat = 0.12;
  s.clearcoatRoughness = 0.3;
  applyWetness(s, si);
  return s;
}
`;

const WALL = `
const vec2 WINDOW_CENTRE = vec2(${WINDOW.centre[0].toFixed(4)}, ${WINDOW.centre[1].toFixed(4)});
const vec2 WINDOW_HALF = vec2(${WINDOW.half[0].toFixed(4)}, ${WINDOW.half[1].toFixed(4)});
float softBox(vec2 q, vec2 h, float soft) { vec2 d = abs(q) - h; return 1.0 - smoothstep(-soft, soft, max(d.x, d.y)); }
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  Surface s = defaultSurface(normalize(si.normal));
  vec2 q = w.xy - WINDOW_CENTRE;
  float soft = 0.012;
  float opening = softBox(q, WINDOW_HALF, soft);
  float frame = opening * (1.0 - softBox(q, WINDOW_HALF - 0.035, soft));
  float mullion = opening * max(1.0 - smoothstep(0.012 - soft, 0.012 + soft, abs(q.x)), 1.0 - smoothstep(0.012 - soft, 0.012 + soft, abs(q.y - 0.05)));
  float glass = clamp(opening - frame - mullion, 0.0, 1.0);
  float y = (q.y + WINDOW_HALF.y) / (2.0 * WINDOW_HALF.y);
  vec3 sky = mix(vec3(1.0, 0.95, 0.86), vec3(0.85, 0.92, 1.0), y) * 5.5;
  float leaves = smoothstep(0.42, 0.7, fbm3(vec3(w.xy * 9.0, 1.0)) + 0.35 * (1.0 - y) - 0.15);
  vec3 outside = mix(sky, vec3(0.42, 0.5, 0.28) * 1.6, leaves * 0.8);
  float plaster = fbm3(w * 30.0);
  vec3 wallCol = vec3(0.72, 0.68, 0.62) * (0.94 + 0.08 * plaster);
  float splash = 1.0 - smoothstep(0.0, 0.004, w.y - 0.0);
  s.albedo = mix(wallCol, vec3(0.86, 0.85, 0.82), max(frame, mullion));
  s.roughness = 0.85;
  s.f0 = vec3(0.03);
  s.emission = outside * glass;
  s.albedo *= 1.0 - glass;
  float glow = exp(-length(max(abs(q) - WINDOW_HALF, 0.0)) / 0.18) * (1.0 - opening);
  s.emission += s.albedo * vec3(1.0, 0.9, 0.78) * glow * 0.6;
  s.cavity = 1.0 - 0.4 * splash;
  return s;
}
`;

export const MATERIALS = {
  orange: ORANGE_MATERIAL,
  cove: WETNESS + COVE,
  board: WETNESS + BOARD,
  counter: WETNESS + COUNTER,
  slate: WETNESS + SLATE,
  wall: WALL,
};

export const GROUND_RECEIVERS = ['cove', 'board', 'counter', 'slate'];

export const MATERIAL_IDS = Object.fromEntries(Object.keys(MATERIALS).map((k, i) => [k, i]));

export function uberFragment(material, pass) {
  const outputs = pass === 'prepass'
    ? 'layout(location = 0) out vec4 outNormal;\nlayout(location = 1) out vec4 outVelocity;\n'
    : pass === 'shadow' ? 'out vec4 outColor;\n' : 'layout(location = 0) out vec4 outDiffuse;\nlayout(location = 1) out vec4 outSpecular;\nlayout(location = 2) out vec4 outAlbedo;\n';
  const body = pass === 'prepass' ? `
  vec3 Nv = normalize(mat3(uView) * N);
  outNormal = vec4(Nv * 0.5 + 0.5, 1.0);
  vec2 cur = vClip.xy / vClip.w, prev = vPrevClip.xy / vPrevClip.w;
  outVelocity = vec4((cur - prev) * 0.5, 0.0, 1.0);`
    : pass === 'shadow' ? 'outColor = vec4(1);' : `
  Surface s = materialSurface(si);
  vec3 diffuse, specular;
  shadeSurface(s, si, diffuse, specular);
  outDiffuse = vec4(diffuse, encodeProfile(s));
  outSpecular = vec4(specular, 1.0);
  outAlbedo = vec4(s.albedo, 1.0);`;
  return FRAME_UBO + NOISE + SURFACE + (pass === 'main' ? LIGHTING : '') + `
uniform vec4 uMaterialColor;
uniform mat4 uModel;
in vec3 vRest;
in vec3 vRestNormal;
in vec3 vWorld;
in vec3 vNormal;
in float vCap;
in vec4 vClip;
in vec4 vPrevClip;
${outputs}
${pass === 'main' ? MATERIALS[material] : ''}
void main() {
  vec3 N = normalize(vNormal);
  SurfaceInput si;
  si.rest = vRest;
  si.restNormal = normalize(vRestNormal);
  si.world = vWorld;
  si.normal = N;
  si.V = normalize(uCamPos.xyz - vWorld);
  si.cap = vCap;
  si.restToWorld = mat3(uModel);
  si.pixel = length(fwidth(vWorld));
  ${body}
}`;
}
