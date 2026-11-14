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
  float fine = 1.0 - smoothstep(0.0001, 0.0004, si.pixel);
  float n = mix(0.5, vnoise(si.world * 2600.0), fine);
  s.albedo = uMaterialColor.rgb * (0.99 + 0.02 * n);
  s.roughness = 0.62;
  s.f0 = vec3(0.03);
  applyWetness(s, si);
  return s;
}
`;

const BOARD = `
float knifeScores(vec2 p, float px, out vec2 groove) {
  float cell = 0.012;
  vec2 c = floor(p / cell);
  float m = 0.0;
  groove = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = c + vec2(i, j);
    for (int k = 0; k < 2; k++) {
      vec3 h = hash33(vec3(id, float(k) + 5.0));
      if (h.z < 0.3) continue;
      vec2 o = (id + h.xy) * cell;
      float ang = 1.5708 + (h.x - 0.5) * 2.0 + step(0.8, fract(h.y * 7.3)) * 0.9;
      vec2 d = vec2(cos(ang), sin(ang));
      float len = cell * (0.3 + 1.2 * fract(h.z * 7.13));
      vec2 q = p - o;
      float along = dot(q, d);
      vec2 nrm = vec2(-d.y, d.x);
      float across = dot(q, nrm);
      float taper = 1.0 - smoothstep(len * 0.2, len * 0.5, abs(along));
      float wdt = 0.00003 + 0.00008 * fract(h.y * 13.1);
      float line = (1.0 - smoothstep(wdt, wdt + px * 1.2, abs(across))) * taper * min(1.0, wdt / max(px * 0.6, 1e-6) + 0.2);
      float k2 = line * (0.2 + 0.5 * fract(h.x * 31.7));
      if (k2 > m) { m = k2; groove = nrm * sign(across) * taper; }
    }
  }
  return m;
}
float woodRing(vec3 w, vec3 sh, float lz, out float r, out vec2 gradYZ) {
  vec2 axis = vec2(-0.03 - 0.09 * sh.x + w.x * (sh.z - 0.5) * 0.035, (sh.y - 0.5) * 0.06 + w.x * (sh.x - 0.5) * 0.02);
  vec2 d = vec2(w.y, lz) - axis;
  float warp = vnoise(vec3(w.x * 4.0, w.y * 30.0, lz * 30.0) + sh * 10.0) - 0.5;
  r = length(d) + 0.0012 * warp;
  gradYZ = d / max(length(d), 1e-5);
  return r;
}
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  float px = si.pixel;
  vec3 Ng = normalize(si.normal);
  Surface s = defaultSurface(Ng);
  float stripW = 0.046;
  float strip = floor((w.z + 0.16) / stripW);
  vec3 sh = hash33(vec3(strip, 4.0, 9.0));
  float lz = w.z + 0.16 - (strip + 0.5) * stripW;
  float r;
  vec2 gYZ;
  woodRing(w, sh, lz, r, gYZ);
  float period = 0.0018 + 0.0014 * sh.z + 0.0004 * (vnoise(vec3(r * 300.0, sh.xy * 9.0)) - 0.5);
  float ringId = floor(r / period);
  float t = fract(r / period);
  float ringFilter = smoothstep(0.2, 0.7, px / period);
  float late = smoothstep(0.5, 0.68, t) * (1.0 - smoothstep(0.86, 0.97, t));
  float early = 1.0 - smoothstep(0.08, 0.35, t);
  late = mix(late, 0.38, ringFilter);
  early = mix(early, 0.25, ringFilter);
  float ringTone = hash12(vec2(ringId, strip)) - 0.5;
  vec3 base = mix(vec3(0.32, 0.15, 0.055), vec3(0.42, 0.21, 0.085), sh.x) * (1.0 + 0.15 * (sh.y - 0.5));
  vec3 lateCol = base * vec3(0.5, 0.38, 0.3);
  vec3 col = mix(base * (1.0 + 0.08 * ringTone), lateCol, late * (0.8 + 0.2 * sh.z));
  float streak = vnoise(vec3(w.x * 6.0, w.y * 160.0, lz * 160.0) + sh * 20.0);
  col *= 0.86 + 0.28 * streak;
  col *= 1.0 + 0.1 * (vnoise(vec3(w.x * 1.5, w.y * 12.0, lz * 12.0) + sh * 5.0) - 0.5);
  float poreK = 1.0 - smoothstep(0.00012, 0.0004, px);
  vec2 pc = vec2(w.x / 0.0022, r / 0.0002);
  vec2 pcell = floor(pc);
  vec3 ph = hash33(vec3(pcell, ringId + strip * 31.0));
  vec2 pq = (fract(pc) - 0.5 - (ph.xy - 0.5) * 0.5) * vec2(1.0, 1.0);
  float pore = (1.0 - smoothstep(0.3, 0.45, length(pq * vec2(1.1 + ph.z, 2.2)))) * step(0.5, ph.z) * early;
  float poreAvg = early * 0.12;
  pore = mix(poreAvg, pore, poreK);
  col *= 1.0 - 0.4 * pore;
  float endGrain = smoothstep(0.6, 0.9, abs(Ng.x));
  col = mix(col, col * vec3(0.72, 0.66, 0.6), endGrain);
  float seam = 1.0 - smoothstep(0.0, 0.00025 + px, stripW * 0.5 - abs(lz));
  col *= 1.0 - 0.18 * seam;
  float top = step(0.5, Ng.y);
  vec2 groove;
  float scores = top > 0.5 && px < 0.0012 ? knifeScores(w.xz, px, groove) * (1.0 - smoothstep(0.0005, 0.0012, px)) : 0.0;
  float use = (1.0 - smoothstep(0.03, 0.17, length(w.xz * vec2(0.85, 1.25)))) * (0.6 + 0.4 * vnoise(w * 35.0)) * top;
  col = mix(col, col * vec3(1.22, 1.18, 1.1) + 0.012, scores * 0.6);
  col = mix(col, col * 1.06, use * 0.4);
  s.albedo = col;
  float oil = fbm3(vec3(w.x * 8.0, 0.0, w.z * 8.0) + sh * 3.0);
  s.roughness = clamp(mix(0.4, 0.58, oil) + 0.1 * early - 0.06 * late + 0.18 * use + 0.25 * scores + 0.15 * endGrain, 0.25, 0.85);
  s.f0 = vec3(0.032);
  s.clearcoat = clamp(0.22 * (1.0 - use * 0.7) * smoothstep(0.3, 0.7, oil + 0.2) * (1.0 - scores) * (1.0 - endGrain * 0.6), 0.0, 1.0);
  s.clearcoatRoughness = 0.18 + 0.12 * oil;
  float reliefK = 1.0 - smoothstep(0.0002, 0.001, px);
  float dLate = (smoothstep(0.42, 0.72, t + 0.04) - smoothstep(0.42, 0.72, t - 0.04)) / (0.08 * period);
  vec3 gRing = vec3(0.0, gYZ.x, gYZ.y) * dLate * 0.000008 * (1.0 - ringFilter);
  vec3 gGroove = vec3(groove.x, 0.0, groove.y) * scores * 0.12;
  s.N = perturb(Ng, (gRing + gGroove) * reliefK + vec3(0.0, 0.0, (streak - 0.5) * 0.02), 1.0);
  s.cavity = 1.0 - 0.35 * pore - 0.2 * scores;
  applyWetness(s, si);
  return s;
}
`;

const COUNTER = `
vec4 voronoi2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0;
  vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 h = hash33(vec3(i + g, 3.0)).xy;
    vec2 r = g + h - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h; } else if (d < f2) f2 = d;
  }
  return vec4(sqrt(f1), sqrt(f2), id);
}
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
    if (detail <= 0.0) continue;
    vec4 c = voronoi2(w.xz * scale + float(i) * 17.3);
    vec3 cid = vec3(c.zw, fract(c.z * 7.7 + c.w * 3.1));
    float keep = step(i == 0 ? 0.72 : i == 1 ? 0.55 : 0.45, cid.x);
    float chip = smoothstep(0.1, 0.1 + px * scale * 2.0 + 0.04, c.y - c.x - 0.18 - 0.2 * cid.z) * keep;
    vec3 cc = terrazzoChip(cid) * (0.9 + 0.2 * cid.z);
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
float slateHeight(vec2 p, vec2 warp) {
  float h = fbm3(vec3((p + warp * 0.03) * vec2(22.0, 30.0), 0.0));
  return floor(h * 6.0) / 6.0 + smoothstep(0.75, 1.0, fract(h * 6.0)) / 6.0;
}
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  float px = si.pixel;
  Surface s = defaultSurface(normalize(si.normal));
  vec2 p = vec2(w.x * 0.94 + w.z * 0.34, w.z * 0.94 - w.x * 0.34);
  vec2 warp = vec2(vnoise(vec3(p * 6.0, 1.3)), vnoise(vec3(p * 6.0, 7.1))) - 0.5;
  float h = slateHeight(p, warp);
  vec2 dpx = dFdx(p), dpy = dFdy(p);
  float dhx = dFdx(h), dhy = dFdy(h);
  float det = dpx.x * dpy.y - dpx.y * dpy.x;
  vec2 g = abs(det) > 1e-14 ? clamp(vec2(dhx * dpy.y - dhy * dpx.y, dpx.x * dhy - dpy.x * dhx) / det, -60.0, 60.0) : vec2(0.0);
  float grainK = 1.0 - smoothstep(0.00006, 0.0003, px);
  float grain = vnoise(w * 2600.0);
  float grain2 = vnoise(w * 2600.0 + 9.0);
  float mottle = vnoise(w * 9.0);
  float flecks = smoothstep(0.86, 0.94, vnoise(w * 1100.0 + 3.0)) * grainK;
  vec3 col = vec3(0.028, 0.03, 0.033) * (0.75 + 0.5 * h) * (0.85 + 0.3 * mottle) * (0.9 + 0.2 * mix(0.5, grain, grainK));
  col += vec3(0.018, 0.019, 0.02) * flecks;
  s.albedo = col;
  s.roughness = clamp(0.72 - 0.12 * h + 0.08 * (mottle - 0.5) - 0.15 * flecks, 0.4, 0.9);
  s.f0 = vec3(0.04);
  vec3 grad = vec3(g.x, 0.0, g.y) * 0.00025 + vec3(grain - 0.5, 0.0, grain2 - 0.5) * 0.08 * grainK;
  s.N = perturb(s.N, grad, 1.0);
  s.cavity = 0.85 + 0.15 * h;
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
  outDiffuse = vec4(diffuse * OUTPUT_SCALE, encodeProfile(s));
  outSpecular = vec4(specular * OUTPUT_SCALE, 1.0);
  outAlbedo = vec4(s.albedo, 1.0);`;
  return '#ifndef OUTPUT_SCALE\n#define OUTPUT_SCALE 1.0\n#endif\n' + FRAME_UBO + NOISE + SURFACE + (pass === 'main' ? LIGHTING : '') + `
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
