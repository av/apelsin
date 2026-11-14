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

export const MATERIALS = {
  orange: ORANGE_MATERIAL,
  cove: WETNESS + COVE,
  board: WETNESS + BOARD,
  counter: WETNESS + COUNTER,
  slate: WETNESS + SLATE,
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
