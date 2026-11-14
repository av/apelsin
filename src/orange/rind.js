import { program, use, set } from '../gl.js';
import { NOISE } from '../shaders/common.js';
import { SHAPE_GLSL } from './shape.js';
import { shapeOf } from './mesh.js';
import { mulberry32 } from '../math.js';
import { RIND_GMAX } from './rind-glsl.js';

export const RIND_SIZE = 1024;
const LEMON_PX_PER_MM = 46;
const PATCH_PX = 384;

const BAKE_VS = `
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BAKE_FS = NOISE + SHAPE_GLSL + `
uniform sampler2D uLemon;
uniform sampler2D uTone;
uniform int uFace;
uniform float uSize;
uniform vec4 uSeed;
uniform vec3 uBase;
uniform vec4 uStemCol;
uniform vec4 uPal;
uniform vec4 uUndul;
uniform vec4 uCushion;
uniform vec4 uCalyx;
uniform vec4 uStem;
uniform vec4 uNavel;
uniform vec4 uScar[3];
uniform vec4 uSmudge;
uniform vec4 uSepal[6];
uniform float uLemonOn;
layout(location = 0) out vec4 outN;
layout(location = 1) out vec4 outC;
const float GMAX = ${RIND_GMAX.toFixed(3)};
const float PATCH_MM = ${(PATCH_PX / LEMON_PX_PER_MM).toFixed(4)};
const float HEX_MM = 7.0;
vec3 faceDir(int f, vec2 st) {
  if (f == 0) return vec3(1.0, -st.y, -st.x);
  if (f == 1) return vec3(-1.0, -st.y, st.x);
  if (f == 2) return vec3(st.x, 1.0, st.y);
  if (f == 3) return vec3(st.x, -1.0, -st.y);
  if (f == 4) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}
void tangents(vec3 d, out vec3 t1, out vec3 t2) {
  t1 = normalize(cross(abs(d.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0), d));
  t2 = cross(d, t1);
}
float pitHeight(vec3 d, float R, vec4 g, out float core, out vec3 gid) {
  vec3 u = normalize(g.xyz);
  vec3 e = (d - u * dot(d, u)) * R;
  vec3 a1, a2;
  tangents(u, a1, a2);
  gid = hash33(g.xyz * 1.0e5 + 17.0);
  vec3 gid2 = hash33(g.xyz * 1.0e5 + 59.0);
  float ang = gid.x * 6.2831853;
  vec2 x = vec2(dot(e, a1), dot(e, a2));
  x = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * x;
  float ell = 1.0 + 0.35 * gid.y;
  x *= vec2(1.0 / sqrt(ell), sqrt(ell));
  float th = atan(x.y, x.x);
  float lobes = 1.0 + 0.12 * gid2.y * cos(2.0 * th + gid2.z * 6.28) + 0.08 * gid.z * cos(3.0 * th + gid2.x * 6.28);
  float rr = length(x) / lobes;
  float s = g.w * mix(1.1, 1.6, gid2.x);
  float vis = uCushion.z * (0.65 + 0.7 * vnoise(d * R * 1000.0 / 6.5 + uSeed.yzx * 20.0));
  float depth = uCushion.x * mix(0.5, 1.3, gid2.z) * vis * sqrt(g.w / 0.00033);
  float sc = g.w * mix(0.35, 0.55, gid.y);
  float cd = uCushion.y * mix(0.3, 1.4, gid2.z * gid2.z) * vis;
  core = exp(-pow(rr / (sc * 1.4), 2.0));
  return -depth * exp(-pow(rr / s, 2.0)) - cd * exp(-pow(rr / sc, 2.0));
}
struct Pits { float h; float k; vec3 id; };
Pits pitsAt(vec3 d, float R, vec4 gs[13], int n) {
  Pits P; P.h = 0.0; P.k = 0.0; P.id = vec3(0.5);
  float best = 0.0;
  for (int i = 0; i < 13; i++) {
    if (i >= n) break;
    float core; vec3 id;
    P.h += pitHeight(d, R, gs[i], core, id);
    if (core > best) { best = core; P.id = id; }
  }
  P.k = best;
  return P;
}
float undulation(vec3 p) {
  vec3 q = p * 1000.0 + uSeed.xyz * 40.0;
  return uUndul.x * (vnoise(q / 5.5) - 0.5) + uUndul.y * (vnoise(q / 2.6 + 7.1) - 0.5) + uUndul.z * (vnoise(q / 1.3 + 3.7) - 0.5);
}
void triangleGrid(vec2 st, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
  st *= 3.4641016;
  vec2 sk = vec2(st.x, -0.57735027 * st.x + 1.15470054 * st.y);
  vec2 base = floor(sk);
  vec3 t = vec3(fract(sk), 0.0);
  t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
  w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  v1 = base + vec2(s, s); v2 = base + vec2(s, 1.0 - s); v3 = base + vec2(1.0 - s, s);
}
vec2 latticePos(vec2 v) { return vec2(v.x, 0.5 * v.x + 0.8660254 * v.y) / 3.4641016 * HEX_MM; }
vec4 lemonTap(vec2 uv, vec2 v, float axis, float lod, out float tone) {
  vec3 h = hash33(vec3(v, axis * 31.0 + uSeed.w * 97.0));
  vec3 h2 = hash33(vec3(v.yx + 11.0, axis * 7.0 + uSeed.w * 13.0));
  float ang = h.y * 6.2831853;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  vec2 c = vec2(0.5 * PATCH_MM) + (h2.xy - 0.5) * (PATCH_MM - HEX_MM * 0.75);
  vec2 q = rot * (uv - latticePos(v)) + c;
  float pi = floor(h.x * 4.0);
  vec2 base = vec2(mod(pi, 2.0), floor(pi * 0.5)) * 0.5;
  vec2 at = base + clamp(q / PATCH_MM, vec2(0.004), vec2(0.996)) * 0.5;
  vec4 s = textureLod(uLemon, at, lod);
  tone = textureLod(uTone, at, lod).r - 0.5;
  vec2 slope = (s.xy - 0.5) * 2.0;
  return vec4(transpose(rot) * slope, s.z - 0.5, 0.0);
}
vec4 lemonPlanar(vec2 uv, float axis, float lod, out float tone) {
  vec3 w; vec2 v1, v2, v3;
  triangleGrid(uv / HEX_MM, w, v1, v2, v3);
  float t1, t2, t3;
  vec4 a = lemonTap(uv, v1, axis, lod, t1), b = lemonTap(uv, v2, axis, lod, t2), c = lemonTap(uv, v3, axis, lod, t3);
  w = w * w;
  w /= dot(w, vec3(1.0));
  float k = inversesqrt(dot(w, w));
  tone = (t1 * w.x + t2 * w.y + t3 * w.z) * k;
  return (a * w.x + b * w.y + c * w.z) * k;
}
vec4 lemon(vec3 p, vec3 d, float lod, out float tone) {
  vec3 mm = p * 1000.0 + uSeed.xyz * 300.0;
  vec3 W = pow(abs(d), vec3(4.0));
  W /= dot(W, vec3(1.0));
  float tx, ty, tz;
  vec4 lx = lemonPlanar(mm.zy, 0.0, lod, tx), ly = lemonPlanar(mm.xz, 1.0, lod, ty), lz = lemonPlanar(mm.xy, 2.0, lod, tz);
  vec3 g = (lx.x * vec3(0, 0, 1) + lx.y * vec3(0, 1, 0)) * W.x + (ly.x * vec3(1, 0, 0) + ly.y * vec3(0, 0, 1)) * W.y + (lz.x * vec3(1, 0, 0) + lz.y * vec3(0, 1, 0)) * W.z;
  float k = inversesqrt(dot(W, W));
  tone = (tx * W.x + ty * W.y + tz * W.z) * k;
  return vec4(g * k, (lx.z * W.x + ly.z * W.y + lz.z * W.z) * k);
}
float sepalAngle(float psi, out float lift, out float width, out float along) {
  float best = 9.0; lift = 0.0; width = 1.0; along = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 s = uSepal[i];
    if (s.z <= 0.0) continue;
    float x = psi - s.x;
    x -= 6.2831853 * floor(x / 6.2831853 + 0.5);
    if (abs(x) / s.z < abs(best)) { best = x / s.z; lift = s.w; width = s.z; along = s.y; }
  }
  return best;
}
float calyxHeight(vec3 d, float poleR, out float sep, out float stub, out float vein) {
  float rho = atan(length(d.xz), d.y) * poleR;
  float psi = atan(d.z, d.x);
  float lift, width, along;
  float x = sepalAngle(psi, lift, width, along);
  float rel = envelopeRelief(d) * 1000.0;
  sep = smoothstep(0.02, 0.08, rel);
  vec2 P = vec2(cos(psi), sin(psi)) * rho - uStem.xy;
  stub = smoothstep(uCalyx.z * 1.02, uCalyx.z * 0.96, length(P));
  vein = (1.0 - smoothstep(0.0, 0.12, abs(x))) * smoothstep(uCalyx.z * 1.2, uCalyx.x * 0.9, rho);
  vec3 wq = vec3(cos(psi), sin(psi), 0.0) * rho * 1000.0;
  float wr = vnoise(wq / 0.35 + 5.0) * 0.6 + vnoise(wq / 0.12 + 9.0) * 0.4;
  return sep * (0.00005 * wr - 0.00003 * vein) * (1.0 - stub);
}
float extraHeight(vec3 d, float poleR, out float sep, out float stub, out float vein, out float hole, out float crease, out float furrow) {
  float h = 0.0;
  sep = 0.0; stub = 0.0; vein = 0.0; hole = 0.0; crease = 0.0; furrow = 0.0;
  float th = acos(clamp(d.y, -1.0, 1.0));
  float psi = atan(d.z, d.x);
  float rho = th * poleR;
  if (rho < 0.018) {
    float rc = uCalyx.x;
    h += calyxHeight(d, poleR, sep, stub, vein);
    float fade = smoothstep(rc * 0.95, rc * 1.25, rho) * (1.0 - smoothstep(rc * 1.6, 0.015, rho));
    float fp = psi * uStem.w + 2.2 * vnoise(vec3(rho * 250.0, psi * 1.3, uSeed.x * 10.0)) + 0.8 * vnoise(vec3(rho * 900.0, psi * 4.0, 3.0));
    furrow = pow(0.5 + 0.5 * cos(fp), 2.5) * fade * (0.4 + 0.6 * vnoise(vec3(psi * 2.0, rho * 120.0, 9.0)));
    h -= 0.0004 * furrow;
  }
  float tn = 3.14159265 - th;
  if (uNavel.x > 0.0 && tn < uNavel.x * 3.5) {
    float open = uNavel.x;
    hole = 1.0 - smoothstep(open * 0.7, open * 0.95, tn);
    float folds = smoothstep(open * 0.8, open * 1.05, tn) * (1.0 - smoothstep(open * 1.3, open * 2.6, tn));
    float fp = psi * uNavel.z + 2.4 * vnoise(vec3(tn * 60.0, psi * 1.5, uSeed.y * 10.0));
    h -= 0.00026 * folds * pow(0.5 + 0.5 * cos(fp), 4.0) * (0.5 + 0.5 * vnoise(vec3(psi * 4.0, tn * 30.0, 5.0)));
    vec3 cq = vec3(psi * 2.5, tn / max(open, 1e-3) * 3.0, uSeed.z * 7.0);
    float cr = vnoise(cq) * 0.55 + vnoise(cq * 2.3 + 3.0) * 0.3 + vnoise(cq * 6.0 + 1.0) * 0.15;
    crease = smoothstep(0.12, 0.02, abs(cr - 0.5)) * hole;
    h += hole * (0.0005 * cr - 0.0003 * crease);
  }
  return h;
}
float totalHeight(vec3 d, float R, vec4 gs[13], int n, float poleR, out Pits P) {
  P = pitsAt(d, R, gs, n);
  float sep, stub, vein, hole, crease, furrow;
  float e = extraHeight(d, poleR, sep, stub, vein, hole, crease, furrow);
  float calm = 1.0 - max(sep, hole);
  return P.h * calm + undulation(d * R) * (1.0 - sep) + e;
}
void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 d = normalize(faceDir(uFace, st));
  vec4 sh = shapeAt(d);
  float R = sh.x;
  vec3 p = d * R;
  vec3 t1, t2;
  tangents(d, t1, t2);
  float texel = 2.0 / uSize * pow(max(max(abs(d.x), abs(d.y)), abs(d.z)), 1.5);
  vec4 gs[13];
  int n = 0;
  for (int i = 0; i < 13; i++) {
    float a = float(i) * 1.0471976 + (i > 6 ? 0.5235988 : 0.0) + uSeed.w;
    vec3 tap = i == 0 ? d : normalize(d + (cos(a) * t1 + sin(a) * t2) * ((i > 6 ? 0.00092 : 0.00046) / R));
    vec4 g = glandAt(tap);
    bool dup = g.w <= 0.0;
    for (int j = 0; j < 13; j++) { if (j >= n) break; if (gs[j] == g) dup = true; }
    if (!dup) gs[n++] = g;
  }
  float poleR = shapeAt(vec3(0, 1, 0)).x;
  float eps = 0.012 / (R * 1000.0);
  Pits P, Px, Py;
  float h0 = totalHeight(d, R, gs, n, poleR, P);
  float hx = totalHeight(normalize(d + t1 * eps), R, gs, n, poleR, Px);
  float hy = totalHeight(normalize(d + t2 * eps), R, gs, n, poleR, Py);
  vec3 g = (t1 * (hx - h0) + t2 * (hy - h0)) / (eps * R);
  float tone = 0.0;
  vec4 lm = vec4(0.0);
  float sep, stub, vein, hole, crease, furrow;
  extraHeight(d, poleR, sep, stub, vein, hole, crease, furrow);
  if (uLemonOn > 0.5) {
    float lod = log2(max(texel * R * 1000.0 * ${LEMON_PX_PER_MM.toFixed(1)}, 1.0));
    lm = lemon(p, d, lod, tone);
    vec3 lg = lm.xyz - d * dot(lm.xyz, d);
    g += lg * uUndul.w * (1.0 - 0.5 * P.k) * (1.0 - stub) * (1.0 - 0.6 * hole);
  }
  float th = acos(clamp(d.y, -1.0, 1.0));
  float rho = th * poleR;
  vec3 q = p * 1000.0 + uSeed.zxy * 50.0;
  float m1 = vnoise(q / 30.0) * 0.65 + vnoise(q / 14.0 + 3.1) * 0.35;
  float m2 = vnoise(q / 22.0 + 9.7);
  vec3 col = uBase;
  col = mix(col, uBase * vec3(1.06, 1.5, 2.2), smoothstep(0.45, 0.85, m1) * uPal.x);
  col = mix(col, uBase * vec3(0.86, 0.42, 0.6), smoothstep(0.55, 0.15, m1) * uPal.y);
  col *= 1.0 + (m2 - 0.5) * uPal.z;
  float stemK = 1.0 - smoothstep(0.004, 0.022, rho);
  col = mix(col, uStemCol.rgb, stemK * uStemCol.a);
  col = mix(col, vec3(0.30, 0.33, 0.04), stemK * stemK * uPal.w);
  vec3 gid = P.id;
  float speck = (gid.x - 0.5) * 0.08 + (gid.y > 0.95 ? 0.08 : 0.0);
  col *= 1.0 + speck * P.k;
  col = mix(col, col * vec3(0.95, 0.9, 0.86), P.k * P.k * 0.4);
  col *= 1.0 + tone * 0.08;
  float dead = step(0.9992, gid.z) * smoothstep(0.6, 0.9, P.k);
  col = mix(col, col * vec3(0.45, 0.3, 0.2), dead);
  float rough = 0.4 + lm.w * 0.06 + 0.2 * P.k * P.k + 0.04 * (m2 - 0.5);
  for (int i = 0; i < 3; i++) {
    vec4 sc = uScar[i];
    if (sc.w <= 0.0) continue;
    float dd = length(d - normalize(sc.xyz)) * R;
    float nz = vnoise(q / 1.4 + float(i) * 13.0) * 0.6 + vnoise(q / 0.5 + float(i) * 5.0) * 0.4;
    float k = smoothstep(0.62, 0.7, (1.0 - dd / sc.w) * 0.8 + nz * 0.5);
    col = mix(col, vec3(0.42, 0.27, 0.12) * (0.8 + 0.4 * nz), k * 0.7);
    rough = mix(rough, 0.72, k);
    g += (t1 * (nz - 0.5) + t2 * (vnoise(q / 0.6 + 2.0) - 0.5)) * 0.15 * k;
  }
  float sm = length(d - normalize(uSmudge.xyz)) * R / uSmudge.w;
  float ridges = 0.5 + 0.5 * sin(dot(p * 1000.0, normalize(cross(uSmudge.xyz, vec3(0.3, 1.0, 0.2)))) * 13.0 + 3.0 * vnoise(q / 1.5));
  rough += 0.12 * (1.0 - smoothstep(0.6, 1.0, sm)) * (0.4 + 0.6 * ridges);
  if (sep > 0.0) {
    float nz = vnoise(q / 0.25) * 0.5 + vnoise(q / 0.08) * 0.5;
    float blot = vnoise(q / 0.9 + 4.0);
    vec3 olive = mix(vec3(0.05, 0.058, 0.01), vec3(0.1, 0.105, 0.02), nz * 0.6 + blot * 0.4);
    olive = mix(olive, vec3(0.12, 0.12, 0.028), vein * 0.35);
    float edge = smoothstep(0.1, 0.45, envelopeRelief(d) * 1000.0);
    olive = mix(vec3(0.07, 0.05, 0.018), olive, mix(1.0, edge, 0.4 + 0.6 * uStem.z));
    float brown = smoothstep(0.6, 1.0, rho / uCalyx.x) * uStem.z;
    olive = mix(olive, vec3(0.11, 0.07, 0.025) * (0.8 + 0.4 * nz), brown * 0.8);
    float rs = length(vec2(cos(atan(d.z, d.x)), sin(atan(d.z, d.x))) * rho - uStem.xy) / uCalyx.z;
    float ring = vnoise(vec3(rs * 14.0, atan(d.z, d.x) * 2.0, 1.0));
    vec3 cut = mix(vec3(0.07, 0.08, 0.015), vec3(0.2, 0.2, 0.06), smoothstep(0.55, 0.8, 1.0 - rs));
    cut = mix(cut, vec3(0.3, 0.29, 0.13), smoothstep(0.55, 0.85, 1.0 - rs) * (0.6 + 0.4 * ring));
    cut = mix(cut, vec3(0.38, 0.35, 0.2), (1.0 - smoothstep(0.12, 0.3, rs)) * (0.5 + 0.5 * nz));
    cut *= 0.85 + 0.3 * nz;
    olive = mix(olive, cut, stub);
    col = mix(col, olive, sep);
    rough = mix(rough, mix(0.55, 0.62, stub), sep);
  }
  col = mix(col, col * 0.55, furrow * 0.25);
  if (rho < 0.012) {
    float rel = envelopeRelief(d) * 1000.0;
    float lift0, w0, a0;
    float xs = sepalAngle(atan(d.z, d.x), lift0, w0, a0);
    float outl = uCalyx.y * 0.9 + (a0 - uCalyx.y * 0.9) * pow(max(0.0, 1.0 - abs(xs)), 1.25);
    float gap = (1.0 - smoothstep(0.0, 0.0009, rho - max(outl, uCalyx.y))) * (1.0 - sep);
    col = mix(col, col * vec3(0.32, 0.22, 0.2), gap * 0.75);
    rough = mix(rough, 0.6, gap);
  }
  if (hole > 0.0) {
    float lip = smoothstep(uNavel.x * 0.55, uNavel.x * 0.9, 3.14159265 - th);
    vec3 inner = mix(uBase * vec3(1.02, 1.25, 1.4), uBase * vec3(0.55, 0.4, 0.3), crease);
    inner = mix(inner, uBase * vec3(0.8, 0.7, 0.6), lip * 0.5);
    col = mix(col, inner * (0.85 + 0.3 * vnoise(q / 0.4)), hole);
    rough = mix(rough, mix(0.38, 0.6, crease), hole);
  }
  float tn = 3.14159265 - th;
  if (uNavel.x <= 0.0) {
    float sk = 1.0 - smoothstep(0.0006, 0.0011, tn * R);
    col = mix(col, vec3(0.2, 0.12, 0.05), sk * 0.85);
    rough = mix(rough, 0.7, sk);
  }
  float dz = (hash13(vec3(gl_FragCoord.xy, float(uFace))) - 0.5) / 255.0 * GMAX * 2.0;
  vec3 gt = g - d * dot(g, d) + (t1 + t2) * dz;
  gt = clamp(gt, -GMAX, GMAX);
  outN = vec4(gt / GMAX * 0.5 + 0.5, min(dot(gt, gt) / (GMAX * GMAX), 1.0));
  outC = vec4(clamp(col, 0.0, 1.0), clamp(rough, 0.0, 1.0));
}
`;

const assetUrl = (name) => new URL(`../../assets/rind/${name}`, import.meta.url).href;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

const images = typeof Image === 'undefined' ? Promise.resolve(null) : Promise.all([loadImage(assetUrl('lemon-relief.jpg')), loadImage(assetUrl('lemon-tone.jpg'))]).catch((e) => { console.warn(e.message); return null; });

const states = new WeakMap();

function state(gl) {
  let s = states.get(gl);
  if (s) return s;
  const prog = program(gl, BAKE_VS, BAKE_FS, { label: 'rind-bake' });
  const cube = (internal) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    const levels = Math.log2(RIND_SIZE) + 1;
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, internal, RIND_SIZE, RIND_SIZE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, p, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_CUBE_MAP, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return { tex, cube: true, size: RIND_SIZE };
  };
  const tex2d = (internal, format, w, h, data) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, data);
    return { tex, width: w, height: h };
  };
  s = {
    prog, fb: gl.createFramebuffer(), normal: cube(gl.RGBA8), color: cube(gl.SRGB8_ALPHA8),
    lemon: tex2d(gl.RGBA8, gl.RGBA, 1, 1, new Uint8Array([128, 128, 128, 255])), tone: tex2d(gl.R8, gl.RED, 1, 1, new Uint8Array([128])),
    lemonOn: false, shape: null, params: null, shapeTex: null,
  };
  s.ready = images.then((imgs) => {
    if (!imgs) return;
    const up = (t, internal, format, img) => {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
    };
    up(s.lemon, gl.RGBA8, gl.RGBA, imgs[0]);
    up(s.tone, gl.R8, gl.RED, imgs[1]);
    s.lemonOn = true;
    if (s.shape) bake(gl, s);
  });
  states.set(gl, s);
  return s;
}

function rindUniforms(shape, p) {
  const rnd = mulberry32(((shape.seed >>> 0) ^ 0x6a09e667) >>> 0);
  const dir = () => { const z = rnd() * 1.7 - 0.85, t = rnd() * Math.PI * 2, q = Math.sqrt(1 - z * z); return [q * Math.cos(t), z, q * Math.sin(t)]; };
  const cx = shape.calyx;
  const sepals = new Float32Array(24);
  cx.sepals.slice(0, 6).forEach((s, i) => sepals.set([s.angle, s.length, s.width, s.lift], i * 4));
  const scars = new Float32Array(12);
  const nScar = Math.floor(rnd() * 3.2);
  for (let i = 0; i < 3; i++) scars.set(i < nScar ? [...dir(), 0.0015 + rnd() * 0.004] : [0, 1, 0, 0], i * 4);
  const rind = p.rind || [0.855, 0.254, 0.003];
  const tint = 0.92 + rnd() * 0.16;
  return {
    uSeed: [rnd(), rnd(), rnd(), rnd()],
    uBase: [rind[0] * tint, rind[1] * (1.05 + rnd() * 0.35), rind[2]],
    uStemCol: [...(p.rindStem || [0.591, 0.06, 0]), 0.35 + rnd() * 0.35],
    uPal: [0.12 + rnd() * 0.25, 0.08 + rnd() * 0.22, 0.06 + rnd() * 0.08, rnd() < 0.3 ? rnd() * 0.25 : 0],
    uUndul: [0.00009 + rnd() * 0.00008, 0.00005 + rnd() * 0.00004, 0.000015 + rnd() * 0.000015, 0.06 + rnd() * 0.03],
    uCushion: [0.00018 + rnd() * 0.0001, 0.00006 + rnd() * 0.00004, 1, 0],
    uCalyx: [cx.radius, cx.inner, cx.stemR, cx.stemH],
    uStem: [cx.stemTilt[0] * cx.stemH * 0.6, cx.stemTilt[1] * cx.stemH * 0.6, cx.brown, 4 + Math.floor(rnd() * 5)],
    uNavel: [shape.navelOpen > 0.02 ? shape.navelOpen : 0, shape.navelDepth || 0, 7 + Math.floor(rnd() * 4), 0],
    uScar: scars,
    uSmudge: [...dir(), rnd() < 0.6 ? 0.007 + rnd() * 0.004 : 0.00001],
    uSepal: sepals,
  };
}

function bake(gl, s) {
  const t0 = performance.now();
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT);
  const u = rindUniforms(s.shape, s.params);
  use(s.prog, { ...u, ...s.shapeTex, uLemon: s.lemon, uTone: s.tone, uSize: RIND_SIZE, uLemonOn: s.lemonOn ? 1 : 0 });
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
  gl.viewport(0, 0, RIND_SIZE, RIND_SIZE);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  for (let f = 0; f < 6; f++) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, s.normal.tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, s.color.tex, 0);
    gl.uniform1i(s.prog.uniforms.uFace, f);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_CUBE_MAP_POSITIVE_X, null, 0);
  for (const t of [s.normal, s.color]) {
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, t.tex);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
  gl.viewport(vp[0], vp[1], vp[2], vp[3]);
  s.ms = performance.now() - t0;
}

export function rindReady(gl) { return state(gl).ready; }

export function orangeTextures(gl, params) {
  const s = state(gl);
  const shape = shapeOf(params);
  if (s.shape && s.shape !== shape && s.shape.dispose) s.shape.dispose(gl);
  const baked = shape.bake(gl);
  s.shape = shape; s.params = params; s.shapeTex = baked.uniforms;
  bake(gl, s);
  return { ...baked.uniforms, uRindN: s.normal, uRindC: s.color };
}

export function rindStats(gl) { const s = states.get(gl); return s ? { ms: s.ms, lemon: s.lemonOn } : null; }
