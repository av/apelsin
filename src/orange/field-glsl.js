export const FIELD_COMMON = `
const float F_TAU = 6.2831853;
const float F_PI = 3.14159265;
vec4 noiseD(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g, k7 = -a + b + c - d + e - g - h + k;
  float v = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  vec3 dv = du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  return vec4(v, dv);
}
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
`;

export const FIELD_GLSL = `
float gPx = 0.0;
#ifndef DEBUGTERM
#define DEBUGTERM 0
#endif
bool termOff(int bit) { return (DEBUGTERM & bit) != 0; }
const float H_MIN = -0.0006;
const float H_MAX = 0.001;
struct Anat {
  vec3 p; vec3 dir; vec4 sh;
  float r; float depthO; float depthP; float flav;
  float rho; float psi; float lat;
  float fseg; float u; float segW; float dS; float baseW;
  float coreR; float dC; float inSeg; float memHalf; float pulpD;
};
struct Sac { float sdf; float e; vec3 id; float t; vec2 g; float wx; float wz; float second; float xa; vec3 lane; };

float segBound(int i) { return oSegB[i >> 2][i & 3]; }

float septumRel(int i, float rho, float y) {
  int n = int(oSeg.x);
  float b0 = segBound(0);
  int k = i < 0 ? i + n : (i >= n ? i - n : i);
  float base = (k == 0 ? 0.0 : segBound(k) - b0) + (i < 0 ? -F_TAU : (i >= n ? F_TAU : 0.0));
  vec3 h = hash33(vec3(float(k) + 0.5, 7.5, oRind.w * 97.0 + 0.5));
  float a = oShape.x;
  float lr = rho / a;
  float w = (0.0005 * sin(rho * 150.0 + h.x * 6.283 + y * 40.0) + 0.00028 * sin(rho * 560.0 + y * 210.0 + h.y * 6.283)) * smoothstep(0.003, 0.01, rho) / max(rho, 0.003);
  float curve = (h.z - 0.5) * 0.07 * lr * lr;
  return base + w + curve;
}

Anat anatomy(vec3 p) {
  Anat A;
  A.p = p;
  A.r = length(p);
  A.dir = p / max(A.r, 1e-6);
  A.sh = shapeAt(A.dir);
  A.depthO = A.sh.x - A.r;
  A.flav = A.sh.x - A.sh.z;
  A.depthP = A.sh.y - A.r + 0.0019;
  if (A.depthP < 0.0045) {
    float pv = vnoise(A.dir * 7.0 + oNoise.xyz) - 0.5, pv2 = vnoise(A.dir * 31.0 + oNoise.zyx) - 0.5;
    float pv3 = A.depthP < 0.0028 ? vnoise(p * 2400.0 + oNoise.yxz) - 0.5 : 0.0;
    A.depthP = min(A.depthP + 0.0012 * pv + 0.0006 * pv2 + 0.00018 * pv3, A.depthO - A.flav - 0.0006);
  }
  A.rho = length(p.xz);
  A.psi = atan(p.z, p.x + 1e-9);
  A.lat = asin(clamp(p.y / max(A.r, 1e-6), -1.0, 1.0));
  int n = int(oSeg.x);
  float b0 = segBound(0);
  float a = mod(A.psi - b0, F_TAU);
  int idx = n - 1;
  for (int i = 1; i < 12; i++) {
    if (i >= n) break;
    if (a < segBound(i) - b0) { idx = i - 1; break; }
  }
  float left = septumRel(idx, A.rho, p.y), right = septumRel(idx + 1, A.rho, p.y);
  if (a < left) { idx -= 1; right = left; left = septumRel(idx, A.rho, p.y); }
  else if (a > right) { idx += 1; left = right; right = septumRel(idx + 1, A.rho, p.y); }
  int iw = idx < 0 ? idx + n : (idx >= n ? idx - n : idx);
  A.fseg = float(iw);
  A.baseW = (iw + 1 < n ? segBound(iw + 1) : segBound(0) + F_TAU) - segBound(iw);
  A.segW = max(right - left, 1e-3);
  A.u = clamp((a - left) / A.segW * 2.0 - 1.0, -1.0, 1.0);
  A.dS = max(min(a - left, right - a), 0.0) * A.rho;
  float yN = p.y / oShape.y;
  float coreBase = oLayers.z * (0.36 + 0.34 * yN * yN);
  float torn = 0.5;
  if (A.rho < coreBase * 2.0) {
    vec2 cs = vec2(cos(A.psi), sin(A.psi));
    torn = vnoise(vec3(cs * 2.3, p.y * 260.0) + oNoise.xyz) * 0.5 + vnoise(vec3(cs * 7.0, p.y * 700.0) + oNoise.zxy) * 0.35 + vnoise(vec3(cs * 19.0, p.y * 600.0) + oNoise.yxz) * 0.15;
  }
  A.coreR = coreBase * (0.55 + 0.9 * torn * torn);
  A.dC = A.rho - A.coreR;
  float mv = sin(A.rho * 420.0 + float(idx) * 7.3 + oRind.w * 11.0) * sin(p.y * 300.0 + A.rho * 170.0 + float(idx) * 3.1);
  A.memHalf = (0.00014 + 0.00026 * exp(-max(A.dC, 0.0) / 0.0025)) * (1.0 + 0.45 * mv);
  vec3 hs = hash33(vec3(A.fseg + 0.5, 3.5, oRind.w * 31.0));
  float kD = 0.0016 + 0.0012 * hs.x, kC = 0.0055 + 0.003 * hs.y;
  A.inSeg = smin(smin(A.dS - A.memHalf, A.depthP - 0.00005, kD), A.dC - 0.00035, kC);
  float nearCore = 1.0 - smoothstep(0.0, 0.005, A.dC);
  if (nearCore > 0.0) A.inSeg += (vnoise(p * 900.0 + oNoise.yzx) - 0.5) * 0.0013 * nearCore;
  A.pulpD = max(A.sh.y - A.coreR, 0.004);
  return A;
}

Sac sacsAt(Anat A) {
  float LX = oSeg.z * 1.28;
  float LZ = LX * 0.95;
  float Rp = A.r + A.depthP;
  float wallRho = sqrt(max(Rp * Rp - A.p.y * A.p.y, 1e-8));
  float S = max(wallRho - A.rho, 0.0);
  float D = max(wallRho - A.coreR, 0.002);
  float w = clamp(S / D, 0.0, 1.0);
  float chev = 0.18;
  float warpA = sin(S * 260.0 + A.p.y * 310.0 + A.fseg * 1.7) + 0.5 * sin(S * 610.0 - A.p.y * 170.0 + A.fseg * 4.1);
  float warpB = sin(S * 190.0 - A.p.y * 420.0 + A.fseg * 2.9) + 0.5 * sin(S * 530.0 + A.u * 6.0 + A.fseg);
  float ell = A.p.y + S * 0.22 + 0.00022 * warpA;
  float nL = max(3.0, floor(A.baseW * oShape.x * 0.88 / LX + 0.5));
  float stretch = 1.0 + chev * w;
  float xl = (A.u * stretch + 1.0) * 0.5 * nL + 0.14 * warpB * smoothstep(0.0, 0.25, 1.0 - abs(A.u));
  float physX = A.segW * max(A.rho, 0.0015) / nL / stretch;
  float physZ = LZ;
  float zq = ell / LZ;
  float i0 = floor(xl);
  Sac best;
  best.sdf = 1.0; best.second = 1.0; best.e = 9.0; best.id = vec3(0.5); best.t = 0.5; best.g = vec2(0.0); best.wx = 1e-4; best.wz = 1e-4; best.xa = 0.0; best.lane = vec3(0.5);
  float segKey = A.fseg * 17.0 + oRind.w * 53.0;
  float di = fract(xl) < 0.5 ? -1.0 : 1.0;
  for (int a = 0; a < 2; a++) {
    float ci = i0 + (a == 0 ? 0.0 : di);
    vec3 hc = hash33(vec3(ci + 0.5, segKey + 0.5, 11.5));
    float zz = zq + hc.x;
    float j0 = floor(zz);
    float dj = fract(zz) < 0.5 ? -1.0 : 1.0;
    for (int b = 0; b < 2; b++) {
      float cj = j0 + (b == 0 ? 0.0 : dj);
      vec3 h = hash33(vec3(ci + 0.5, cj + 0.5, segKey + 29.5));
      vec3 h2 = hash33(h * 113.0 + 7.0);
      float cx = ci + 0.5 + (h.x - 0.5) * 0.28;
      float cz = cj + 0.5 + (h.y - 0.5) * 0.42;
      float Sa = 0.00015 + 0.0005 * h2.y, Sb = Sa;
      vec3 hs = h2;
      for (int m = 0; m < 6; m++) {
        hs = hash33(h2 * 37.0 + float(m) * 5.1 + 0.5);
        Sb = Sa + D * (m == 0 && h.z < 0.3 ? mix(0.5, 0.8, hs.x) : mix(0.12, 0.42, hs.x * hs.x));
        if (S <= Sb || m == 5) break;
        Sa = Sb + 0.00015 + 0.0009 * hs.y * hs.y;
      }
      float t = clamp((S - Sa) / max(Sb - Sa, 1e-4), 0.0, 1.0);
      float size = hs.z < 0.15 ? 0.55 : 0.8 + 0.45 * hs.z;
      float tt = pow(t, 0.75);
      float prof = pow(max(sin(F_PI * tt), 0.0), 0.42);
      float bend = (hs.x - 0.5) * 0.3 * sin(F_PI * t) + (hs.z - 0.5) * 0.12 * sin(F_TAU * t);
      float X = (xl - cx - bend) * physX;
      float Z = (zz - cz - (hs.y - 0.5) * 0.25 * sin(F_PI * t)) * physZ;
      float wx = max(0.5 * physX * (0.9 + 0.3 * hs.y) * size * prof, 1e-6);
      float wz = max(0.5 * physZ * (0.95 + 0.4 * fract(hs.z * 7.3)) * size * prof, 1e-6);
      vec2 q = vec2(X / wx, Z / wz);
      float e = length(q);
      float sdf = (e - 1.0) * min(wx, wz);
      if (e < best.e) {
        best.second = best.sdf;
        best.sdf = sdf; best.e = e; best.id = hs; best.t = t; best.g = q / vec2(wx, wz); best.wx = wx; best.wz = wz; best.xa = clamp((xl - cx) * 2.0, -1.5, 1.5); best.lane = h;
      } else best.second = min(best.second, sdf);
    }
  }
  return best;
}

vec2 spongeAt(vec3 q) {
  float w = vnoise(q * 0.45 + 3.1) - 0.5;
  float v = vnoise(q + vec3(1.8, -1.3, 1.1) * w + oNoise.xyz) * 0.6 + vnoise(q * 2.4 + vec3(-0.9, 1.2, 0.7) * w + oNoise.zxy) * 0.4;
  return vec2(smoothstep(0.58, 0.7, v), v);
}
vec3 peelCoord(Anat A, float scale) { return A.dir * A.sh.x * scale + vec3(0.0, A.depthO * scale * 0.35, 0.0); }
vec3 coreCoord(vec3 p, float scale) { return vec3(p.x * 0.35, p.y, p.z * 0.35) * scale; }
vec3 tissueCoord(Anat A) {
  float arc = A.u * A.segW * 0.5 * max(A.rho, 0.0005);
  return vec3(arc, A.rho + 0.22 * A.p.y, A.p.y - 0.22 * A.rho);
}
vec4 tissue(Anat A) {
  vec3 T = tissueCoord(A);
  vec3 seg = vec3(A.fseg * 7.31, A.fseg * 3.17, oRind.w * 13.0);
  float warp = vnoise(vec3(T.x * 900.0, T.z * 900.0, T.y * 260.0) + seg) - 0.5;
  float s1 = vnoise(vec3(T.x * 5200.0 + warp * 2.4, T.z * 4300.0, T.y * 800.0) + seg * 2.0);
  float s2 = vnoise(vec3(T.x * 11000.0 + warp * 3.0, T.z * 9000.0, T.y * 700.0) + seg * 3.0 + 17.0);
  float toneA = vnoise(vec3(T.x * 1100.0 + warp * 1.5, T.z * 1100.0, T.y * 420.0) + seg + 41.0);
  return vec4(s1, s2, toneA, 0.5);
}
float tissueHeight(Anat A, Sac s, float ph) {
  vec3 T = tissueCoord(A);
  vec3 seg = vec3(A.fseg * 7.31, A.fseg * 3.17, oRind.w * 13.0);
  float along = vnoise(vec3(T.x * 700.0, T.z * 700.0, T.y * 380.0) + seg + ph * 5.0);
  float ridge = 0.000022 * along * along * smoothstep(0.0, 0.6, 1.0 - s.xa * s.xa);
  float h = ridge;
  float f1 = 1.0 - smoothstep(0.00006, 0.00016, gPx);
  if (f1 > 0.0) {
    float warp = vnoise(vec3(T.x * 900.0, T.z * 900.0, T.y * 260.0) + seg) - 0.5;
    float s1 = vnoise(vec3(T.x * 5200.0 + warp * 2.4, T.z * 4300.0, T.y * 800.0) + seg * 2.0);
    h += (s1 - 0.5) * 0.000011 * f1;
  }
  return h;
}

float planeHash(vec4 plane) { return fract(plane.w * 7919.13 + dot(plane.xyz, vec3(3.71, 11.37, 5.93))); }

float juiceLevel(vec3 p) { return smoothstep(0.5, 0.7, vnoise(p * 260.0 + oNoise.zyx) * 0.7 + vnoise(p * 900.0 + oNoise.xzy) * 0.3); }

float sacHeight(Anat A, Sac s, float ph, float w) {
  if (termOff(64)) return 0.0;
  return tissueHeight(A, s, ph) - 0.000008 * w;
}

vec3 onPlane(vec3 p, vec4 plane) { return p - plane.xyz * (dot(plane.xyz, p) - plane.w); }
bool fleshy(Anat A) { return A.depthO >= 0.0 && A.depthP >= 0.0 && A.dC >= 0.0; }
Sac noSac() { Sac s; s.sdf = 1.0; s.second = 1.0; s.e = 9.0; s.id = vec3(0.5); s.t = 0.5; s.g = vec2(0.0); s.wx = 1e-4; s.wz = 1e-4; s.xa = 0.0; s.lane = vec3(0.5); return s; }

vec3 beadAt(vec3 p, vec4 plane, float boost) {
  vec3 n = plane.xyz;
  vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0, 1, 0)) : cross(n, vec3(1, 0, 0)));
  vec3 t2 = cross(n, t1);
  vec2 bq = vec2(dot(p, t1), dot(p, t2)) / 0.0014;
  vec2 bc = floor(bq);
  vec3 bh = hash33(vec3(bc, 41.5 + planeHash(plane) * 17.0));
  float br = 0.06 + 0.16 * bh.z * bh.z;
  vec2 bo = bq - bc - 0.5 - (bh.xy - 0.5) * (1.0 - 2.0 * br);
  float bd = length(bo) / br;
  float on = step(fract(bh.x * 13.7 + bh.y * 3.1), 0.06 + 0.5 * boost);
  float cap = on * sqrt(max(1.0 - bd * bd, 0.0));
  return vec3(cap * br * 0.0014 * 0.75, on * (1.0 - smoothstep(0.85, 1.0, bd)), bd);
}

float heightRaw(Anat A, Sac s, vec3 p, vec4 plane) {
  if (A.depthO < 0.0) return 0.0;
  bool lod = gPx > 0.00015;
  if (A.depthP < 0.0) {
    if (A.depthO < A.flav * 0.9) return 0.0;
    if (lod) return -0.00004 * (1.0 - smoothstep(0.0, 0.0007, -A.depthP));
    vec2 sp = spongeAt(peelCoord(A, 2600.0));
    float wet = 1.0 - smoothstep(0.0, 0.0007, -A.depthP);
    float fade = smoothstep(A.flav * 0.9, A.flav * 1.3, A.depthO);
    float torn = smoothstep(0.72, 0.92, vnoise(p * 2200.0 + oNoise.zyx) * 0.7 + vnoise(p * 7000.0 + oNoise.xzy) * 0.3) * (1.0 - smoothstep(0.0, 0.0012, -A.depthP));
    return (0.00004 * (sp.y - 0.5) - 0.00012 * sp.x) * fade - 0.00004 * wet + 0.0003 * torn + beadAt(p, plane, wet * 0.8).x;
  }
  if (A.dC < 0.0) {
    if (lod) return mix(0.00004, 0.00045, 1.0 - smoothstep(-0.0012, 0.0, A.dC));
    vec2 cs = vec2(cos(A.psi), sin(A.psi));
    float fib = vnoise(vec3(cs * 9.0, A.rho * 2600.0) + oNoise.zxy) * 0.6 + vnoise(p * 3000.0 + oNoise.xyz) * 0.4;
    float strands = smoothstep(0.45, 0.9, vnoise(vec3(cs * 23.0, A.rho * 5200.0) + p * 1800.0 + oNoise.yzx));
    float k = 1.0 - smoothstep(-0.0012, 0.0, A.dC);
    vec2 sp = spongeAt(coreCoord(p, 1700.0));
    return mix(0.00004, 0.00016 + 0.00035 * fib + 0.0006 * strands, k) - 0.00012 * sp.x + 0.00006 * (sp.y - 0.5);
  }
  float ph = planeHash(plane);
  float w = clamp(A.depthP / A.pulpD, 0.0, 1.0);
  float segBulge = 0.00026 * (0.4 + 0.6 * fract(A.fseg * 0.618 + ph)) * (1.0 - A.u * A.u) * sin(F_PI * clamp(w * 1.1, 0.0, 1.0));
  float rim = 1.0 - smoothstep(0.0, 0.0018, A.depthP);
  if (A.inSeg < 0.0) {
    float thick = smoothstep(0.0, -0.0006, A.inSeg);
    if (lod) return mix(segBulge * 0.8 - 0.00001, 0.00001 + segBulge * 0.3 + 0.00025 * (1.0 - smoothstep(0.0015, 0.003, A.dC)), thick);
    vec2 sp = spongeAt(coreCoord(p, 1700.0));
    float tuft = (1.0 - smoothstep(0.0015, 0.003, A.dC)) * (0.0002 + 0.0004 * smoothstep(0.4, 0.85, vnoise(p * 2400.0 + oNoise.yzx)));
    return mix(segBulge * 0.8 - 0.00001, 0.00004 - 0.00018 * sp.x + 0.00005 * (sp.y - 0.5) + segBulge * 0.3 + tuft, thick) + beadAt(p, plane, rim).x;
  }
  float h = sacHeight(A, s, ph, w) + segBulge + 0.00012 * rim * (vnoise(p * 700.0 + oNoise.xyz) - 0.3);
  float edge = smoothstep(0.0, 0.0004, A.inSeg);
  return mix(segBulge * 0.8 - 0.00001, h, edge) + (lod ? 0.0 : beadAt(p, plane, rim).x);
}

float heightAt(Anat A, Sac s, vec3 p, vec4 plane) { return clamp(heightRaw(A, s, p, plane), H_MIN, H_MAX - 0.00025); }

float cutHeight(vec3 p, vec4 plane) {
  p = onPlane(p, plane);
  Anat A = anatomy(p);
  Sac s = noSac();
  if (fleshy(A) && A.inSeg >= 0.0) s = sacsAt(A);
  return heightAt(A, s, p, plane);
}

vec3 fleshBase(float w, vec3 id) {
  vec3 outer = oFleshDeep.rgb, mid = oFlesh.rgb;
  vec3 inner = oFleshDeep.w >= 0.0 ? mix(mid, oFleshWall.rgb, oFleshDeep.w) : mix(mid, outer, -oFleshDeep.w);
  vec3 c = w < 0.45 ? mix(outer, mid, smoothstep(0.0, 0.45, w)) : mix(mid, inner, smoothstep(0.45, 1.0, w));
  c *= 0.88 + 0.2 * id.x;
  c.g *= 0.86 + 0.26 * id.z;
  return min(c * vec3(0.68, 0.48, 0.45), vec3(1.0));
}

vec2 tissueTone(Anat A) {
  vec3 T = tissueCoord(A);
  vec3 seg = vec3(A.fseg * 7.31, A.fseg * 3.17, oRind.w * 13.0);
  return vec2(vnoise(vec3(T.x * 1300.0, T.z * 1300.0, T.y * 110.0) + seg + 41.0), vnoise(vec3(T.x * 380.0, T.z * 380.0, T.y * 45.0) + seg + 73.0));
}
float gSlopeOcc = 0.0;
float pathLength(vec3 p, vec3 d, float tMax, int self) {
  float t = tMax;
  for (int i = 0; i < MAX_PLANES; i++) {
    if (i >= uPlaneCount) break;
    if (i == self) continue;
    float dn = dot(uPlanes[i].xyz, d);
    if (dn > 1e-5) t = min(t, (uPlanes[i].w - dot(uPlanes[i].xyz, p)) / dn);
  }
  return max(t, 0.0);
}
vec3 fleshVolume(vec3 p, vec3 dirIn, int samples, vec3 surface, int self, float w0) {
  vec3 sigA = vec3(0.12, 0.55, 3.2) * 1000.0;
  vec3 T = vec3(1.0), col = vec3(0.0), Tf = vec3(1.0), colF = vec3(0.0);
  vec3 cFlat = fleshBase(w0, vec3(0.5));
  vec3 cRef = mix(cFlat, min(cFlat * vec3(1.03, 1.16, 1.4), vec3(1.0)), 0.27);
  float tEnd = pathLength(p, dirIn, 0.0025, self);
  float jit = ign(gl_FragCoord.xy + fract(uCamPos.w * 7.0) * 31.0);
  for (int k = 0; k < 6; k++) {
    if (k >= samples) break;
    float a0 = float(k) / float(samples), a1 = float(k + 1) / float(samples);
    float e0 = k == 0 ? 0.0 : 0.00012 * pow(0.0025 / 0.00012, a0);
    float e1 = min(0.00012 * pow(0.0025 / 0.00012, a1), tEnd);
    float ds = e1 - e0;
    if (ds <= 0.0) break;
    vec3 q = p + dirIn * mix(e0, e1, 0.2 + 0.6 * jit);
    Anat B = anatomy(q);
    if (B.depthO < 0.0) break;
    float pith = 1.0 - smoothstep(-0.0005, 0.0005, B.depthP);
    float core = 1.0 - smoothstep(-0.0005, 0.0005, B.dC);
    float mem = (1.0 - smoothstep(-0.0003, 0.0003, B.inSeg)) * (1.0 - pith) * (1.0 - core);
    vec3 c = fleshBase(0.5, vec3(0.5));
    float wall = 0.0;
    if (pith + core < 0.999) {
      Sac sb = sacsAt(B);
      vec2 tt = tissueTone(B);
      wall = exp(-(sb.sdf * sb.sdf) / (0.00012 * 0.00012 + ds * ds * 0.05));
      c = fleshBase(w0, vec3(tt.x, tt.y, mix(tt.x, tt.y, 0.5)));
      c = mix(c, min(c * vec3(1.03, 1.16, 1.4), vec3(1.0)), wall * 0.9);
    }
    c = mix(c, min(surface * vec3(1.04, 1.16, 1.4) + 0.03, vec3(1.0)), mem * 0.6);
    c = mix(c, vec3(0.86, 0.8, 0.6), max(pith, core));
    float sigS = mix(300.0 + 4000.0 * wall, 1200.0, mem * 0.6);
    sigS = mix(sigS, 900.0, max(pith, core));
    float a = 1.0 - exp(-sigS * ds);
    col += T * a * c;
    T *= exp(-(sigA + sigS) * ds);
    float af = 1.0 - exp(-1500.0 * ds);
    colF += Tf * af * cRef;
    Tf *= exp(-(sigA + 1500.0) * ds);
  }
  col += T * cFlat * vec3(0.92, 0.7, 0.45);
  colF += Tf * cFlat * vec3(0.92, 0.7, 0.45);
  return col / max(colF, vec3(0.004));
}

Surface cutSurface(SurfaceInput si, vec4 plane, vec3 Nrest, Anat A, Sac sacIn) {
  vec3 p = A.p;
  float px = max(si.pixel, 1e-6);
  float tier = uFlags.x;
  vec3 n = plane.xyz;
  vec3 Vr = normalize(transpose(si.restToWorld) * si.V);
  vec3 albedo, gN = vec3(0.0);
  float rough = 0.3, clear = 0.0, ccRough = 0.05, cavity = 1.0, profile = 3.0, width = 0.9;
  vec3 sssColor = oFlesh.rgb * 0.5, trans = oFlesh.rgb * vec3(0.66, 0.25, 0.02);
  float ph = planeHash(plane);
  float w = clamp(A.depthP / A.pulpD, 0.0, 1.0);
  if (A.depthO < -0.00004) {
    float rr = length(p.xz);
    float ring = smoothstep(0.00025, 0.0005, rr) * (1.0 - smoothstep(0.0007, 0.001, rr));
    vec3 stem = mix(vec3(0.2, 0.19, 0.025), vec3(0.4, 0.38, 0.13), ring * (0.7 + 0.3 * vnoise(p * 9000.0)));
    stem = mix(stem, vec3(0.1, 0.1, 0.015), smoothstep(-0.0003, -0.0008, A.depthO) * (1.0 - ring) * 0.4);
    albedo = stem;
    rough = 0.55; clear = 0.15; ccRough = 0.1; profile = 2.0; width = 0.3;
    sssColor = stem * 0.2; trans = vec3(0.0);
  } else if (A.depthP < 0.0) {
    vec4 g = glandAt(A.dir);
    float has = step(1e-6, g.w), grad = max(g.w, 1e-5);
    vec3 gdir = g.xyz / max(length(g.xyz), 1e-6);
    vec3 off = p - g.xyz;
    float radial = dot(off, gdir);
    float tdist = length(off - gdir * radial);
    float ge = length(vec2(tdist / grad, radial / (GLAND_RADIAL * grad)));
    float gd = A.sh.x - length(g.xyz);
    float tooth = has * (gd + GLAND_RADIAL * grad * sqrt(max(1.0 - tdist * tdist / (2.6 * grad * grad), 0.0)) + 0.0001);
    float bn = vnoise(p * 3200.0 + oNoise.zxy) - 0.5;
    float boundary = max(A.flav * (0.62 + 0.3 * vnoise(p * 380.0 + oNoise.xyz) + 0.14 * vnoise(p * 1300.0 + oNoise.yzx)), tooth) + bn * 0.0001;
    float aa = px * 0.6;
    float flav = 1.0 - smoothstep(boundary - aa, boundary + aa, A.depthO);
    float gland = has * (1.0 - smoothstep(0.85, 1.0 + px / grad, ge));
    float outerLine = 1.0 - smoothstep(0.00022, 0.00035 + aa, A.depthO);
    vec3 flavCol = mix(vec3(0.93, 0.33, 0.006), vec3(0.95, 0.25, 0.018), outerLine);
    flavCol *= 0.92 + 0.14 * vnoise(p * 5200.0 + oNoise.xyz);
    float glandCore = gland * (1.0 - smoothstep(0.0, 0.9, ge));
    flavCol = mix(flavCol, vec3(0.95, 0.5, 0.03), gland * 0.55);
    flavCol = mix(flavCol, vec3(0.97, 0.66, 0.08), glandCore * 0.5);
    float below = has * (1.0 - smoothstep(0.0, 0.0004, A.depthO - gd - GLAND_RADIAL * grad)) * step(gd, A.depthO) * (1.0 - smoothstep(grad * 0.8, grad * 1.6, tdist));
    flavCol = mix(flavCol, vec3(0.95, 0.6, 0.12), below * 0.4);
    float peel = A.sh.x - A.sh.y;
    float into = clamp((A.depthO - boundary) / max(peel - boundary, 1e-4), 0.0, 1.0);
    vec3 fq = peelCoord(A, 3600.0);
    float fib = vnoise(fq + oNoise.yzx) * 0.55 + vnoise(fq * 2.7 + oNoise.zxy) * 0.3 + vnoise(fq * 0.35 + oNoise.xzy) * 0.15;
    vec2 spg = spongeAt(peelCoord(A, 2600.0));
    float pores = spg.x;
    vec3 pith = mix(vec3(0.82, 0.68, 0.28), vec3(0.78, 0.74, 0.56), smoothstep(0.0, 0.3, into));
    pith = mix(pith, vec3(0.8, 0.76, 0.6), smoothstep(0.4, 1.0, into));
    float blotch = vnoise(A.dir * 90.0 + oNoise.yzx) * 0.6 + vnoise(A.dir * 260.0 + oNoise.zxy) * 0.4;
    pith *= 0.84 + 0.22 * blotch;
    pith = mix(pith, pith * vec3(1.0, 0.86, 0.62), smoothstep(0.6, 1.0, into) * (0.3 + 0.5 * blotch));
    pith *= 0.88 + 0.2 * fib;
    pith *= 0.92 + 0.14 * spg.y;
    pith = mix(pith, vec3(0.66, 0.6, 0.44), pores * 0.5);
    float wet = 1.0 - smoothstep(0.0, 0.0006, -A.depthP);
    float thin = exp(-max(-A.depthP, 0.0) / (0.00025 + 0.00035 * fib));
    pith = mix(pith, pith * vec3(1.0, 0.76, 0.4), thin * (0.45 + 0.4 * blotch));
    pith = mix(pith, pow(pith, vec3(1.4)) * vec3(1.0, 0.94, 0.78), wet * 0.4);
    float dorsal = 1.0 - smoothstep(0.00004, 0.0001 + aa, -A.depthP - 0.00005);
    pith = mix(pith, vec3(0.86, 0.78, 0.52), dorsal * 0.5);
    albedo = mix(pith, flavCol, flav);
    float pbead = beadAt(p, plane, wet * 0.8).y * (1.0 - flav);
    rough = mix(mix(0.62, 0.3, wet), mix(0.38, 0.12, gland), flav);
    clear = mix(wet * 0.7, gland * 0.8, flav);
    rough = mix(rough, 0.03, pbead);
    clear = mix(clear, 1.0, pbead);
    ccRough = mix(0.05, 0.04, flav);
    vec4 sp = noiseD(fq * 0.5 + oNoise.xzy);
    vec3 gp = sp.yzw - A.dir * dot(sp.yzw, A.dir);
    gN = gp * 1800.0 * 0.0000075 * (1.0 - flav) * (1.0 - smoothstep(0.0001, 0.0006, px));
    cavity = mix(1.0, 0.7, pores * (1.0 - flav));
    profile = flav > 0.5 ? 1.0 : 2.0;
    width = flav > 0.5 ? 0.3 : 0.35;
    sssColor = mix(vec3(0.95, 0.9, 0.62) * 0.3, oRind.rgb * vec3(0.35, 0.16, 0.04), flav);
    trans = mix(vec3(0.95, 0.9, 0.62) * vec3(0.22, 0.15, 0.04), oRind.rgb * 0.1, flav);
  } else if (A.dC < 0.0) {
    vec2 cs = vec2(cos(A.psi), sin(A.psi));
    float fib = vnoise(vec3(cs * 9.0, A.rho * 2600.0) + oNoise.zxy) * 0.6 + vnoise(p * 3000.0 + oNoise.xyz) * 0.4;
    vec4 pore = noiseD(p * 5200.0 + oNoise.xzy);
    float holes = smoothstep(0.74, 0.86, pore.x) * (1.0 - smoothstep(0.00008, 0.0003, px));
    float voids = smoothstep(0.6, 0.72, vnoise(p * 1500.0 + oNoise.yxz) * 0.65 + vnoise(p * 4200.0 + oNoise.zyx) * 0.35);
    vec2 spc = spongeAt(coreCoord(p, 1700.0));
    float fw = vnoise(vec3(cs.x * 4.0, cs.y * 4.0, p.y * 90.0) + oNoise.zyx) - 0.5;
    float fibre = vnoise(vec3(cs.x * 12.0 + A.rho * 2600.0 + fw * 1.5, cs.y * 12.0 + fw, p.y * 110.0) + oNoise.xzy) * 0.65 + vnoise(vec3(cs.x * 25.0 + A.rho * 5200.0, cs.y * 25.0, p.y * 220.0) + oNoise.yxz) * 0.35;
    fibre = smoothstep(0.25, 0.8, fibre);
    float axial = 1.0 - abs(n.y);
    vec3 core = vec3(0.78, 0.74, 0.6) * (0.84 + 0.18 * fib) * mix(0.9 + 0.14 * fibre, 0.62 + 0.36 * fibre, axial);
    core = mix(core, mix(core, oFleshDeep.rgb * vec3(1.0, 1.1, 1.4) + 0.08, 0.35), axial * smoothstep(-0.0012, 0.0, A.dC));
    float soak = smoothstep(0.25, 0.75, vnoise(vec3(cs.x * 6.0 + A.rho * 2200.0, cs.y * 6.0, p.y * 150.0) + oNoise.yxz) * 0.6 + vnoise(vec3(cs.x * 17.0 + A.rho * 6000.0, cs.y * 17.0, p.y * 400.0) + oNoise.zyx) * 0.4);
    core = mix(core, vec3(0.95, 0.8, 0.5), smoothstep(0.0, 0.7, soak) * 0.35);
    core = mix(core, vec3(0.93, 0.86, 0.66), max(spc.x, voids) * 0.25);
    holes = max(holes * 0.3, max(voids, spc.x) * 0.25);
    float hollow = oExtra.w > 0.0 ? 1.0 - smoothstep(0.0, 0.0008, A.rho - oExtra.w * A.coreR) : 0.0;
    core = mix(core, core * vec3(0.75, 0.66, 0.48), hollow);
    albedo = core;
    rough = mix(0.55, 0.38, fib);
    clear = 0.25;
    gN = pore.yzw * 5200.0 * 0.000004 * (1.0 - smoothstep(0.0001, 0.0006, px));
    vec3 eR = normalize(vec3(p.x, 0.0, p.z) + 1e-7);
    gN += (eR - n * dot(eR, n)) * (fibre - 0.5) * 0.35 * axial;
    cavity = mix(1.0, 0.8, holes) * mix(1.0, 0.5, hollow) * mix(1.0, 0.75 + 0.25 * fibre, axial);
    profile = 2.0; width = mix(0.55, 0.25, axial);
    sssColor = vec3(0.95, 0.92, 0.75) * 0.32;
    trans = vec3(0.95, 0.92, 0.75) * vec3(0.22, 0.15, 0.04);
  } else {
    Sac s = sacIn;
    vec3 id = s.id;
    vec4 tis = tissue(A);
    vec3 TT = tissueCoord(A);
    float laneT = vnoise(vec3(s.lane.xy * 41.0, TT.y * 300.0 + s.lane.z * 9.0));
    float group = vnoise(vec3(TT.x, TT.y * 0.6, TT.z) * 420.0 + vec3(A.fseg * 5.3, 0.0, oRind.w * 7.0));
    float acrossL = smoothstep(0.55, 1.2, abs(s.xa));
    float vt = mix(mix(laneT, tis.z, acrossL), group, 0.45);
    vec3 flesh = fleshBase(w, termOff(2) ? vec3(0.5) : vec3(vt, group, mix(vt, group, 0.5)));
    vec3 hseg = hash33(vec3(A.fseg + 0.5, 9.5, oRind.w * 7.0));
    flesh *= vec3(0.94 + 0.1 * hseg.x, 0.9 + 0.14 * hseg.y, 1.0);
    float dors = A.depthP < 0.0007 ? (1.0 - smoothstep(0.0, 0.0007, A.depthP)) * smoothstep(0.35, 0.75, vnoise(p * 1800.0 + oNoise.zyx)) : 0.0;
    flesh = mix(flesh, min(flesh * vec3(1.03, 1.15, 1.4) + 0.04, vec3(1.0)), dors * 0.4);
    float flank = 1.0 - smoothstep(0.0, 0.0022, A.dS - A.memHalf);
    flesh *= mix(vec3(1.0), vec3(0.9, 0.72, 0.45), flank * 0.85);
    vec3 wallCol = min(flesh * vec3(1.02, 1.14, 1.35), vec3(1.0));
    vec3 Ndir = n;
    vec3 gradS = vec3(0.0);
    vec3 ePsi = normalize(vec3(-sin(A.psi), 0.0, cos(A.psi)));
    vec3 eLat = normalize(cross(A.dir, ePsi));
    gradS = ePsi * s.g.x + eLat * s.g.y;
    float gl = max(length(gradS), 1e-6);
    float gp = length(gradS - n * dot(gradS, n)) / gl;
    float bandW = 0.000045;
    float inPlane = -s.sdf / max(gp, 0.12);
    float cover = min(bandW / max(px * 0.8, 1e-6), 1.0);
    float open = smoothstep(0.35, 0.75, vnoise(vec3(A.rho * 1400.0, A.u * 9.0, s.id.x * 40.0)));
    float wall = termOff(1) ? 0.0 : (1.0 - smoothstep(bandW, bandW + px * 0.8, inPlane)) * step(0.0, -s.sdf + px * 0.3) * sqrt(gp) * mix(0.35, 1.0, cover) * open;
    float gap = 0.0;
    float juice = termOff(32) ? 0.0 : juiceLevel(p);
    float inner = clamp(s.e, 0.0, 1.0);
    float lowF = smoothstep(0.15, 0.85, group);
    flesh *= mix(vec3(1.0, 0.82, 0.55), vec3(1.0, 1.1, 1.25), lowF);
    int vs = tier < 1.5 ? 0 : 1;
    if (vs > 0 && !termOff(4)) {
      vec3 dirIn = refract(-Vr, n, 1.0 / 1.35);
      if (dot(dirIn, dirIn) < 0.5) dirIn = -n;
      int self = -1;
      for (int i = 0; i < MAX_PLANES; i++) { if (i >= uPlaneCount) break; if (distance(uPlanes[i], plane) < 1e-6) self = i; }
      vec3 vol = fleshVolume(p, dirIn, vs, flesh, self, w);
      flesh = min(flesh * mix(vec3(1.0), clamp(vol, vec3(0.5), vec3(1.8)), 0.85), vec3(1.0));
    }
    vec3 gapCol = flesh * vec3(0.97, 0.9, 0.75);
    albedo = mix(flesh, gapCol, gap);
    float wrinkleK = (1.0 - smoothstep(0.00006, 0.00025, px)) * step(0.5, tier);
    float strand = smoothstep(0.35, 0.75, tis.x) * 0.6 + smoothstep(0.4, 0.8, tis.y) * 0.4;
    if (!termOff(8)) albedo *= mix(vec3(1.0), mix(vec3(0.95, 0.88, 0.78), vec3(1.03, 1.08, 1.14), strand), wrinkleK * 0.55);
    float memK = 1.0 - smoothstep(-0.00002, 0.00012 + px * 0.5, A.inSeg);
    float thick = smoothstep(0.0, -0.0005, A.inSeg);
    float ax = 1.0 - abs(n.y);
    float nearCore = (1.0 - smoothstep(mix(0.0022, 0.0008, ax), mix(0.0045, 0.0018, ax), A.dC)) * mix(1.0, 0.3, ax);
    float crumb = vnoise(p * 2600.0 + oNoise.zxy) * 0.6 + vnoise(p * 7000.0 + oNoise.xyz) * 0.4;
    float cvoid = smoothstep(0.62, 0.74, vnoise(p * 1500.0 + oNoise.yxz) * 0.65 + vnoise(p * 4200.0 + oNoise.zyx) * 0.35) * nearCore;
    vec2 spf = spongeAt(coreCoord(p, 1700.0));
    vec3 fillCol = mix(mix(albedo, albedo * vec3(1.05, 1.3, 1.9) + vec3(0.06, 0.06, 0.04), 0.6), vec3(0.82, 0.79, 0.66) * (0.84 + 0.2 * crumb), nearCore);
    float root = (1.0 - smoothstep(0.0, 0.0016, A.depthP)) * (0.55 + 0.45 * crumb);
    fillCol = mix(fillCol, vec3(0.8, 0.74, 0.54) * (0.86 + 0.18 * crumb), root);
    fillCol = mix(fillCol, vec3(0.93, 0.86, 0.66), spf.x * 0.2 * nearCore);
    float seen = smoothstep(0.25, 0.75, vnoise(vec3(A.rho * 600.0, p.y * 600.0, A.fseg * 3.7 + oRind.w)));
    memK *= mix(1.0, 0.75, smoothstep(0.85, 0.4, s.e) * (1.0 - thick));
    memK *= mix(1.0, 0.15, pow(abs(dot(n, ePsi)), 3.0) * (1.0 - nearCore));
    vec3 memCol = mix(mix(albedo, mix(albedo * vec3(1.03, 1.18, 1.5) + vec3(0.03, 0.03, 0.02), vec3(0.88, 0.72, 0.38), 0.55 * (1.0 - ax)), 0.55 + 0.4 * seen), fillCol, thick);
    albedo = mix(albedo, memCol, memK);
    float rupt = 0.0;
    float far = smoothstep(0.00008, 0.0003, px);
    float film = termOff(32) ? 0.0 : smoothstep(0.6, 0.78, vnoise(p * mix(2400.0, 900.0, far) + ph * 9.0) * 0.7 + vnoise(p * 300.0 + oNoise.yxz) * 0.3) * smoothstep(0.45, 0.62, tis.x);
    rough = mix(mix(0.3, 0.035, film), 0.36, wall);
    rough = mix(rough, 0.09, gap * juice * film);
    rough = mix(rough, mix(0.45, 0.55, thick), memK);
    clear = mix(mix(0.9 * film, 0.8, rupt), 1.0, gap * juice * film);
    clear = mix(clear, 0.0, memK);
    ccRough = mix(0.035, 0.02, gap * juice);
    float NoVg = clamp(abs(dot(si.normal, si.V)), 0.0, 1.0);
    float graze = (1.0 - NoVg) * (1.0 - NoVg) * (1.0 - film);
    rough = mix(rough, max(rough, 0.26), (1.0 - wrinkleK) * (1.0 - film) * (1.0 - gap * juice));
    rough = mix(rough, 0.7, graze);
    clear *= 1.0 - graze;
    if (!termOff(32)) {
      vec3 T = tissueCoord(A);
      vec3 rh = normalize(vec3(p.x, 0.0, p.z) + 1e-7);
      vec3 eP = vec3(-rh.z, 0.0, rh.x);
      vec3 gArc = eP + rh * (A.u * A.segW * 0.5);
      vec3 gAlong = rh + vec3(0.0, 0.22, 0.0);
      vec3 gAx = vec3(0.0, 1.0, 0.0) - 0.22 * rh;
      vec3 seg = vec3(A.fseg * 5.1, oRind.w * 3.0, ph * 4.0);
      float gCalm = 0.0;
      gSlopeOcc = 0.0;
      vec4 m1 = noiseD(vec3(T.x * 2800.0, T.y * 650.0, T.z * 2800.0) + seg);
      float rb = mix(0.035, 0.1, m1.x);
      float f1 = 1.0 - smoothstep(0.00012, 0.00035, px), f2 = (1.0 - smoothstep(0.00005, 0.00014, px)) * step(1.5, uFlags.x);
      vec4 m2 = f2 > 0.0 ? noiseD(vec3(T.x * 6500.0, T.y * 1500.0, T.z * 6500.0) + seg + 11.0) : vec4(0.0);
      vec3 g = (m1.y * 2800.0 * gArc + m1.z * 650.0 * gAlong + m1.w * 2800.0 * gAx) * 0.0002 * f1
             + (m2.y * 6500.0 * gArc + m2.z * 1500.0 * gAlong + m2.w * 6500.0 * gAx) * 0.00004 * f2;
      {
        vec4 mm = noiseD(vec3(T.x * 700.0, T.y * 260.0, T.z * 700.0) + seg + 29.0);
        float hMid = 0.00045;
        vec3 gm = (mm.y * 700.0 * gArc + mm.z * 260.0 * gAlong + mm.w * 700.0 * gAx) * hMid;
        float vv = smoothstep(0.25, 0.75, vnoise(vec3(T.x * 450.0, T.y * 180.0, T.z * 450.0) + seg + 57.0));
        float microScale = mix(0.05, 1.1, vv * vv);
        {
          gCalm = 1.0 - vv;
        }
        g = g * microScale + gm * mix(0.08, 1.0, vv);
        gSlopeOcc = smoothstep(0.15, 0.6, length(g - n * dot(g, n)));
      }
      gN += (g - n * dot(g, n)) * (1.0 - memK);
      rb = mix(rb, 0.03, gCalm * 0.8);
      float lost = 0.45 * (1.0 - f1) + 0.08 * (1.0 - f2);
      float wetCover = smoothstep(0.12, 0.3, vnoise(p * 180.0 + oNoise.xzy) * 0.6 + vnoise(p * 700.0 + ph) * 0.4);
      rough = mix(rough, mix(0.24, sqrt(rb * rb + lost * 0.25), wetCover), 1.0 - memK);
      clear = 0.0;
    }
    cavity = mix(1.0, 0.9, gap * (1.0 - juice)) * mix(1.0, 0.3, graze);
    profile = memK * thick > 0.5 ? 2.0 : 3.0;
    width = profile > 2.5 ? 0.6 : 0.35;
    sssColor = mix(oFlesh.rgb * 0.5, vec3(0.95, 0.9, 0.62) * 0.32, memK * thick);
    trans = mix(oFlesh.rgb * vec3(0.66, 0.25, 0.02), vec3(0.95, 0.9, 0.62) * vec3(0.22, 0.15, 0.04), memK * thick);
    vec3 bead3 = beadAt(p, plane, 1.0 - smoothstep(0.0, 0.0018, A.depthP));
    float bead = termOff(32) ? 0.0 : bead3.y * (1.0 - memK);
    if (bead > 0.0) {
      albedo = mix(albedo, albedo * vec3(1.02, 1.08, 1.1), bead);
      rough = mix(rough, 0.03, bead);
      clear = mix(clear, 1.0, bead);
      ccRough = mix(ccRough, 0.012, bead);
    }
  }
  if (A.depthO > A.flav) {
    vec4 un = noiseD(p * 140.0 + ph * 31.0 + oNoise.yxz);
    vec4 un2 = tier > 1.5 ? noiseD(p * 380.0 + ph * 17.0 + oNoise.zyx) : vec4(0.0);
    vec3 ug = (un.yzw * 140.0 * 0.00034 + un2.yzw * 380.0 * 0.00008) * smoothstep(A.flav, A.flav * 2.5, A.depthO);
    gN += ug - n * dot(ug, n);
  }
  Surface s = defaultSurface(vec3(0, 1, 0));
  if (termOff(16)) { gN = vec3(0.0); Nrest = plane.xyz; }
  s.N = normalize(si.restToWorld * perturb(Nrest, gN, 1.0));
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = rough;
  s.f0 = vec3(0.022) * mix(1.0, 0.5, gSlopeOcc);
  s.clearcoat = clamp(clear, 0.0, 1.0);
  s.clearcoatRoughness = ccRough;
  s.sssColor = sssColor;
  s.sssProfile = profile;
  s.sssWidth = width;
  s.transmission = trans;
  s.cavity = cavity;
  return s;
}
`;
