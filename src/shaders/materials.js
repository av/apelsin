import { FRAME_UBO, NOISE, SURFACE, LIGHTING } from './common.js';
import { ORANGE_MATERIAL } from '../orange/glsl.js';

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
uniform vec3 uJuiceTint;
vec2 wetUv(vec3 w) { return w.xz / (2.0 * uWetParams.x) + 0.5; }
vec2 wetBicubic(vec2 uv) {
  vec2 px = uv * uWetParams.z - 0.5;
  vec2 f = fract(px), i = floor(px);
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / uWetParams.z, h1 = (i + 1.5 + w3 / g1) / uWetParams.z;
  return (texture(uWetness, vec2(h0.x, h0.y)).rg * g0.x + texture(uWetness, vec2(h1.x, h0.y)).rg * g1.x) * g0.y
       + (texture(uWetness, vec2(h0.x, h1.y)).rg * g0.x + texture(uWetness, vec2(h1.x, h1.y)).rg * g1.x) * g1.y;
}
void applyWetness(inout Surface s, SurfaceInput si) {
  vec2 uv = wetUv(si.world);
  if (uWetParams.y < 0.5 || any(lessThan(uv, vec2(0.002))) || any(greaterThan(uv, vec2(0.998)))) return;
  vec2 f = wetBicubic(uv);
  if (f.g < 0.12) return;
  float grain = vnoise(vec3(si.world.xz * 3000.0, 3.1)) - 0.5;
  float grain2 = vnoise(vec3(si.world.xz * 900.0, 7.7)) - 0.5;
  float dep = f.g + (grain * 0.035 + grain2 * 0.05) * smoothstep(0.05, 0.25, f.g);
  float aa = max(fwidth(dep), 0.004);
  float foot = smoothstep(0.24 - aa, 0.24 + aa, dep);
  if (foot <= 0.0) return;
  float e = 1.0 / uWetParams.z;
  vec2 gx = wetBicubic(uv + vec2(e, 0.0)) - wetBicubic(uv - vec2(e, 0.0));
  vec2 gz = wetBicubic(uv + vec2(0.0, e)) - wetBicubic(uv - vec2(0.0, e));
  float texel = 2.0 * uWetParams.x / uWetParams.z;
  vec2 grad = vec2(gx.g, gz.g) / (2.0 * texel);
  float water = clamp(f.r / max(f.g, 1e-3), 0.0, 1.0);
  float depth = smoothstep(0.24, 1.2, dep);
  float rim = foot * (1.0 - smoothstep(0.25, 0.33, dep));
  float edge = foot * (1.0 - smoothstep(0.26, 0.6, dep));
  vec3 tint = dot(uJuiceTint, vec3(1.0)) > 0.01 ? uJuiceTint : vec3(0.94, 0.76, 0.38);
  float soak = 0.55 + 0.45 * water;
#if defined(MATERIAL_SLATE)
  vec3 stain = mix(vec3(0.82), tint * 0.9, 0.45 * depth);
  float darken = 0.75;
#elif defined(MATERIAL_BOARD)
  vec3 stain = mix(vec3(0.62), tint * 0.6, 0.35 + 0.35 * depth);
  float darken = 1.0;
#else
  vec3 stain = mix(vec3(0.97, 0.95, 0.9), tint, 0.5 + 0.45 * depth);
  float darken = 1.0;
#endif
  s.albedo = mix(s.albedo, s.albedo * stain, foot * soak * darken);
  s.albedo *= 1.0 - (0.18 + 0.22 * (1.0 - water)) * rim * darken;
  float h = 0.00035 * water + 0.00006;
  vec3 slope = vec3(grad.x, 0.0, grad.y) * h * edge;
  s.N = perturb(s.N, slope, foot);
  float wetGloss = foot * water;
  s.roughness = mix(mix(s.roughness, 0.32, foot * 0.6), 0.05, wetGloss);
  s.clearcoat = max(s.clearcoat, wetGloss * 0.95 + foot * (1.0 - water) * 0.25);
  s.clearcoatRoughness = mix(0.2, 0.015, water);
  s.f0 = mix(s.f0, vec3(0.022), foot);
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
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  Surface s = defaultSurface(normalize(si.normal));
  float stripId = floor(w.z / 0.045);
  vec3 sh = hash33(vec3(stripId, 1.0, 2.0));
  float n1 = fbm3(vec3(w.x * 4.0 + sh.x * 10.0, w.y * 40.0, w.z * 40.0));
  float gc = w.z * (60.0 + 80.0 * sh.y) + n1 * (2.0 + 4.0 * sh.z) + sin(w.x * (3.0 + 6.0 * sh.x) + n1 * 5.0) * (0.4 + sh.y) + w.y * 40.0 + sh.x * 7.0;
  float ring = fract(gc);
  float late = smoothstep(0.55, 0.85, ring) * (1.0 - smoothstep(0.92, 1.0, ring));
  vec3 col = mix(vec3(0.5, 0.29, 0.135), vec3(0.3, 0.15, 0.065), late * (0.4 + 0.4 * sh.z));
  col *= mix(vec3(0.85, 0.82, 0.8), vec3(1.12, 1.05, 0.95), sh.x) * (0.85 + 0.25 * fbm3(w * vec3(3.0, 30.0, 10.0)));
  col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.0012, abs(fract(w.z / 0.045) - 0.5) * 0.045 - 0.0215));
  float pores = vnoise(vec3(w.x * 90.0, w.y * 2500.0, w.z * 2500.0));
  col *= 0.9 + 0.12 * pores;
  float marks = 0.0;
  for (int i = 0; i < 7; i++) {
    vec3 h = hash33(vec3(float(i), 3.0, 7.0));
    float ang = (h.x - 0.5) * 1.4;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 o = (h.yz - 0.5) * vec2(0.3, 0.2);
    float dist = abs(dot(w.xz - o, vec2(-dir.y, dir.x)));
    float along = abs(dot(w.xz - o, dir));
    marks = max(marks, (1.0 - smoothstep(0.0, 0.0002, dist)) * (1.0 - smoothstep(0.03, 0.08, along)) * step(0.5, h.x + 0.3));
  }
  s.albedo = mix(col, col * 1.3 + 0.02, marks * 0.7);
  s.roughness = mix(0.5, 0.75, marks) + 0.1 * late;
  s.f0 = vec3(0.035);
  s.clearcoat = 0.15;
  s.clearcoatRoughness = 0.35;
  s.N = perturb(s.N, vec3(0.0, 0.0, (late - 0.5) * 0.03 + (pores - 0.5) * 0.02), 1.0);
  applyWetness(s, si);
  return s;
}
`;

const COUNTER = `
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  Surface s = defaultSurface(normalize(si.normal));
  float speck = vnoise(w * 900.0), cloud = fbm3(w * 18.0);
  vec3 col = mix(vec3(0.62, 0.6, 0.56), vec3(0.78, 0.76, 0.72), cloud);
  col = mix(col, vec3(0.18, 0.17, 0.16), smoothstep(0.78, 0.86, speck));
  s.albedo = col;
  s.roughness = 0.28 + 0.1 * cloud;
  s.f0 = vec3(0.045);
  s.clearcoat = 0.4;
  s.clearcoatRoughness = 0.12;
  applyWetness(s, si);
  return s;
}
`;

const SLATE = `
Surface materialSurface(SurfaceInput si) {
  vec3 w = si.world;
  Surface s = defaultSurface(normalize(si.normal));
  float layers = fbm3(vec3(w.x * 14.0, w.y * 300.0, w.z * 40.0));
  float fine = vnoise(w * 1800.0);
  s.albedo = vec3(0.03, 0.032, 0.035) * (0.85 + 0.3 * layers) * (0.92 + 0.16 * fine);
  s.roughness = 0.6 + 0.12 * layers;
  s.f0 = vec3(0.04);
  s.N = perturb(s.N, vec3(fine - 0.5, 0.0, layers - 0.5) * 0.05, 1.0);
  applyWetness(s, si);
  return s;
}
`;

const STEEL = `
Surface materialSurface(SurfaceInput si) {
  vec3 p = si.rest;
  vec3 rn = si.restNormal;
  Surface s = defaultSurface(normalize(si.normal));
  if (si.cap > 0.5) {
    float grain = fbm3(vec3(p.x * 50.0, p.y * 700.0 + sin(p.x * 90.0) * 1.5, p.z * 700.0));
    s.albedo = mix(vec3(0.03, 0.017, 0.012), vec3(0.085, 0.045, 0.026), smoothstep(0.3, 0.75, grain));
    s.roughness = 0.42;
    s.clearcoat = 0.55;
    s.clearcoatRoughness = 0.16;
    vec2 c = vec2(p.x, p.y - 0.0155);
    float rivet = min(min(length(c - vec2(-0.032, 0.0)), length(c - vec2(-0.07, 0.0))), length(c - vec2(-0.108, 0.0)));
    if (rivet < 0.0027 && abs(rn.z) > 0.6) { s.albedo = vec3(0.0); s.f0 = vec3(0.6, 0.59, 0.57); s.roughness = 0.12; s.clearcoat = 0.0; }
    return s;
  }
  float brush = vnoise(vec3(p.x * 25.0, p.y * 9000.0, p.z * 9000.0)) * 0.6 + vnoise(vec3(p.x * 3.0, p.y * 2400.0, 1.0)) * 0.4;
  float bevel = smoothstep(-0.12, -0.25, rn.y);
  float spine = smoothstep(0.7, 0.95, rn.y);
  float haze = vnoise(vec3(p.x * 160.0, p.y * 220.0, 3.0));
  s.albedo = vec3(0.0);
  s.f0 = mix(vec3(0.56, 0.56, 0.55), vec3(0.66, 0.66, 0.64), bevel);
  s.roughness = mix(mix(0.07 + 0.06 * brush + 0.04 * haze, 0.035, bevel), 0.22, spine);
  s.N = perturb(s.N, si.restToWorld * vec3(0.0, (brush - 0.5) * 0.05, 0.0), 1.0 - bevel);
  vec3 R = reflect(-si.V, s.N);
  float flag = smoothstep(0.02, 0.3, abs(R.y - 0.1)) * (0.85 + 0.15 * smoothstep(-0.6, 0.2, R.x));
  s.f0 *= mix(0.42, 1.0, flag) * (0.9 + 0.2 * brush);
  return s;
}
`;

export const MATERIALS = {
  orange: ORANGE_MATERIAL,
  cove: WETNESS + COVE,
  board: WETNESS + BOARD,
  counter: WETNESS + COUNTER,
  slate: WETNESS + SLATE,
  steel: STEEL,
};

export const MATERIAL_IDS = Object.fromEntries(Object.keys(MATERIALS).map((k, i) => [k, i]));

export function uberFragment(material, pass) {
  const outputs = pass === 'prepass'
    ? 'layout(location = 0) out vec4 outNormal;\nlayout(location = 1) out vec4 outVelocity;\n'
    : pass === 'shadow' ? 'out vec4 outColor;\n' : 'layout(location = 0) out vec4 outDiffuse;\nlayout(location = 1) out vec4 outSpecular;\n';
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
  outSpecular = vec4(specular, 1.0);`;
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
