import { FRAME_UBO, NOISE, SURFACE, LIGHTING } from '../shaders/common.js';
import { SHAPE_GLSL, GLAND_RADIAL } from './shape.js';
import { ORANGE_UBO } from './glsl.js';
import { RIND_GLSL } from './rind-glsl.js';
import { FIELD_COMMON, FIELD_GLSL } from './field-glsl.js';
import { MAX_PLANES } from './proxy.js';

export const PIECE_VS = FRAME_UBO + `
layout(location = 0) in vec3 aPos;
uniform mat4 uModel;
out vec3 vRest;
void main() {
  vRest = aPos;
  vec4 w = uModel * vec4(aPos, 1.0);
#ifdef SHADOW
  gl_Position = uLightViewProj * w;
#else
  gl_Position = uViewProj * w;
#endif
}`;

const MARCH = `
uniform mat4 uModel;
uniform mat4 uPrevModel;
uniform mat4 uInvModel;
uniform vec4 uEye;
uniform vec4 uPlanes[${MAX_PLANES}];
uniform int uPlaneCount;
uniform vec4 uBound;
uniform float uPieceId;
in vec3 vRest;
const float ENV_K = 0.88;
float envelope(vec3 p) {
  float r = length(p);
  vec3 d = p / max(r, 1e-7);
  float k = p.y > 0.0 && dot(p.xz, p.xz) < 0.0000484 ? 0.3 : ENV_K;
  return (r - shapeAt(d).x - envelopeRelief(p)) * k;
}
vec3 envelopeNormal(vec3 p) {
  float e = 0.00005;
  float c = envelope(p);
  vec3 g = vec3(envelope(p + vec3(e, 0, 0)) - c, envelope(p + vec3(0, e, 0)) - c, envelope(p + vec3(0, 0, e)) - c);
  return dot(g, g) > 1e-20 ? normalize(g) : normalize(p);
}
float coarse(vec3 p, float lift) {
  float d = envelope(p);
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (i >= uPlaneCount) break;
    d = max(d, dot(uPlanes[i].xyz, p) - uPlanes[i].w - lift);
  }
  return d;
}
float ridgeLift(vec3 p, int i) {
  float m = 1.0;
  for (int j = 0; j < ${MAX_PLANES}; j++) {
    if (j >= uPlaneCount) break;
    if (j != i) m = min(m, uPlanes[j].w - dot(uPlanes[j].xyz, p));
  }
  float k = 1.0 - smoothstep(0.0, 0.0012, max(m, 0.0));
  if (k <= 0.0) return 0.0;
  return gPx > 0.00015 ? k * 0.00012 : k * 0.00025 * vnoise(p * 1500.0 + oNoise.zxy);
}
float reliefH(vec3 p, int i) { return cutHeight(p, uPlanes[i]) + ridgeLift(p, i); }
float fine(vec3 p, out int which) {
  float d = envelope(p);
  which = -1;
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (i >= uPlaneCount) break;
    float s = dot(uPlanes[i].xyz, p) - uPlanes[i].w;
    float f = s > H_MIN ? s - reliefH(p, i) : s - H_MIN;
    if (f > d) { d = f; which = i; }
  }
  return d;
}
void setupRay(out vec3 ro, out vec3 rd) {
  if (uEye.w > 1.5) { ro = uEye.xyz; rd = normalize(vRest - uEye.xyz); }
  else if (uEye.w > 0.5) { ro = vRest; rd = normalize(vRest - uEye.xyz); }
  else { ro = vRest; rd = normalize(uEye.xyz); }
}
float tExit(vec3 ro, vec3 rd) {
  vec3 oc = ro - uBound.xyz;
  float b = dot(oc, rd), c = dot(oc, oc) - uBound.w * uBound.w;
  float h = b * b - c;
  return h < 0.0 ? 0.0 : -b + sqrt(h);
}
int tierSteps(int low, int med, int high, int ultra) {
  float t = uFlags.x;
  return t < 0.5 ? low : t < 1.5 ? med : t < 2.5 ? high : ultra;
}
bool marchCoarse(vec3 ro, vec3 rd, float tMax, float eps, int steps, float lift, out float t) {
  t = 0.0;
  float d = 1.0;
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    d = coarse(ro + rd * t, lift);
    if (d < eps) return true;
    t += d;
    if (t > tMax) return false;
  }
  return d < 0.0004;
}
bool refine(vec3 ro, vec3 rd, inout float t, out int which, int steps) {
  vec3 p = ro + rd * t;
  float c = 1.0;
  bool near = false;
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (i >= uPlaneCount) break;
    if (dot(uPlanes[i].xyz, p) - uPlanes[i].w > H_MIN - 0.00005) { near = true; c = min(c, abs(dot(uPlanes[i].xyz, rd))); }
  }
  if (!near) { which = -1; return true; }
  int only = -1, count = 0;
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (i >= uPlaneCount) break;
    if (dot(uPlanes[i].xyz, p) - uPlanes[i].w > H_MIN - 0.0008) { only = i; count++; }
  }
  if (count == 1 && envelope(p) < -0.0015) {
    vec4 pl = uPlanes[only];
    float dn = -dot(pl.xyz, rd);
    if (dn > 0.2) {
      float s0 = dot(pl.xyz, ro) - pl.w;
      float tt = s0 / dn;
      int iters = tierSteps(2, 2, 2, 2);
      for (int k = 0; k < 4; k++) {
        if (k >= iters) break;
        tt = (s0 - cutHeight(ro + rd * tt, pl)) / dn;
      }
      t = max(tt, t);
      which = only;
      return true;
    }
  }
  float f0 = fine(p, which);
  if (f0 <= 0.0) return true;
  float dt = min((H_MAX - H_MIN) / max(c, 0.01), 0.006) / float(steps);
  float t0 = t;
  for (int k = 1; k <= 12; k++) {
    if (k > steps) break;
    float t1 = t + dt * float(k);
    int w1;
    float f1 = fine(ro + rd * t1, w1);
    if (f1 <= 0.0) {
      float a = t0, b = t1, fa = f0, fb = f1;
      for (int s = 0; s < 2; s++) {
        float m = a + (b - a) * fa / max(fa - fb, 1e-9);
        int wm;
        float fm = fine(ro + rd * m, wm);
        if (fm > 0.0) { a = m; fa = fm; } else { b = m; fb = fm; }
      }
      t = b;
      fine(ro + rd * t, which);
      return true;
    }
    t0 = t1; f0 = f1;
  }
  float tp = t;
  which = -1;
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (i >= uPlaneCount) break;
    float dn = dot(uPlanes[i].xyz, rd);
    float s0 = dot(uPlanes[i].xyz, ro) - uPlanes[i].w;
    if (dn < 0.0 && s0 > 0.0) { float ti = -s0 / dn; if (ti > tp) { tp = ti; which = i; } }
  }
  vec3 q = ro + rd * tp;
  if (envelope(q) > 0.00002) return false;
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (i >= uPlaneCount) break;
    if (dot(uPlanes[i].xyz, q) - uPlanes[i].w > 0.00002) return false;
  }
  t = tp;
  return true;
}
float pixelScale() { return 2.0 / (uProj[1][1] * uResolution.y); }
vec3 reliefNormal(vec3 p, int which, float e, float h0) {
  vec4 pl = uPlanes[which];
  vec3 n = pl.xyz;
  vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0, 1, 0)) : cross(n, vec3(1, 0, 0)));
  vec3 t2 = cross(n, t1);
  float h1 = reliefH(p + t1 * e, which);
  float h2 = reliefH(p + t2 * e, which);
  return normalize(n - t1 * (h1 - h0) / e - t2 * (h2 - h0) / e);
}
`;

const HEAD = (pass) => '#ifndef OUTPUT_SCALE\n#define OUTPUT_SCALE 1.0\n#endif\n' + FRAME_UBO + NOISE + SURFACE + (pass === 'main' ? LIGHTING : '') + ORANGE_UBO + SHAPE_GLSL + `const float GLAND_RADIAL = ${GLAND_RADIAL.toFixed(3)};\n` + FIELD_COMMON + RIND_GLSL + FIELD_GLSL + MARCH;

const SHADOW_FS = `
out vec4 outColor;
void main() {
  vec3 ro, rd;
  setupRay(ro, rd);
  float tMax = tExit(ro, rd);
  float t;
  float texel = uShadowParams.x * 2.0 * uShadowParams.y;
  if (!marchCoarse(ro, rd, tMax, texel * 0.5, 24, 0.0, t)) discard;
  vec3 p = ro + rd * t;
  vec4 c = uLightViewProj * (uModel * vec4(p, 1.0));
  gl_FragDepth = c.z / c.w * 0.5 + 0.5;
  outColor = vec4(1.0);
}`;

const PREPASS_FS = `
layout(location = 0) out vec4 outNormal;
layout(location = 1) out vec4 outVelocity;
void main() {
  vec3 ro, rd;
  setupRay(ro, rd);
  float tMax = tExit(ro, rd);
  vec3 cam = (uInvModel * vec4(uCamPos.xyz, 1.0)).xyz;
  float k = pixelScale();
  gPx = distance(cam, ro) * k;
  float eps = max(gPx * 0.35, 0.000004);
  float t;
  if (!marchCoarse(ro, rd, tMax, eps, tierSteps(24, 32, 40, 48), H_MAX, t)) discard;
  int which;
  if (!refine(ro, rd, t, which, tierSteps(4, 4, 4, 5))) discard;
  vec3 p = ro + rd * t;
  vec3 Nr = which < 0 ? envelopeNormal(p) : uPlanes[which].xyz;
  vec4 w = uModel * vec4(p, 1.0);
  vec4 clip = uViewProj * w;
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  vec3 N = normalize(mat3(uModel) * Nr);
  outNormal = vec4(normalize(mat3(uView) * N) * 0.5 + 0.5, uPieceId / 255.0);
  vec4 cur = uViewProjNJ * w, prev = uPrevViewProjNJ * (uPrevModel * vec4(p, 1.0));
  outVelocity = vec4((cur.xy / cur.w - prev.xy / prev.w) * 0.5, 0.0, 1.0);
}`;

const MAIN_FS = `
uniform sampler2D uSceneDepth;
uniform sampler2D uSceneNormal;
layout(location = 0) out vec4 outDiffuse;
layout(location = 1) out vec4 outSpecular;
layout(location = 2) out vec4 outAlbedo;
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  if (abs(texelFetch(uSceneNormal, ij, 0).a * 255.0 - uPieceId) > 0.5) discard;
  float z = texelFetch(uSceneDepth, ij, 0).r;
  vec4 ndc = vec4(gl_FragCoord.xy * uResolution.zw * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vec4 wp = uInvViewProj * ndc;
  vec3 world = wp.xyz / wp.w;
  vec3 p = (uInvModel * vec4(world, 1.0)).xyz;
  int which = -1;
  float best = envelope(p), hw = 0.0;
  Anat Aw;
  Sac Sw = noSac();
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    if (i >= uPlaneCount) break;
    float s = dot(uPlanes[i].xyz, p) - uPlanes[i].w;
    if (s <= H_MIN) continue;
    vec3 q = onPlane(p, uPlanes[i]);
    Anat A = anatomy(q);
    Sac S = noSac();
    if (fleshy(A)) S = sacsAt(A);
    float h = heightAt(A, S, q, uPlanes[i]) + ridgeLift(p, i);
    if (s - h > best) { best = s - h; which = i; hw = h; Aw = A; Sw = S; }
  }
  vec3 Nr = which < 0 ? envelopeNormal(p) : uPlanes[which].xyz;
  SurfaceInput si;
  si.rest = p;
  si.restNormal = Nr;
  si.world = world;
  si.normal = normalize(mat3(uModel) * Nr);
  si.V = normalize(uCamPos.xyz - world);
  si.cap = which < 0 ? 0.0 : 1.0;
  si.restToWorld = mat3(uModel);
  si.pixel = distance(uCamPos.xyz, world) * pixelScale();
  gPx = si.pixel;
  Surface s;
  if (which < 0) s = rindSurface(si);
  else s = cutSurface(si, uPlanes[which], reliefNormal(p, which, max(si.pixel * 0.7, 0.00003), hw), Aw, Sw);
  vec3 diffuse, specular;
  shadeSurface(s, si, diffuse, specular);
  outDiffuse = vec4(diffuse * OUTPUT_SCALE, encodeProfile(s));
  outSpecular = vec4(specular * OUTPUT_SCALE, 1.0);
  outAlbedo = vec4(s.albedo, 1.0);
}`;

export function pieceFragment(pass) {
  return HEAD(pass) + (pass === 'shadow' ? SHADOW_FS : pass === 'prepass' ? PREPASS_FS : MAIN_FS);
}
