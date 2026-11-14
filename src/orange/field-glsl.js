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
const float H_MIN = -0.0006;
const float H_MAX = 0.0008;
struct Anat {
  vec3 p; vec3 dir; vec4 sh;
  float r; float depthO; float depthP; float flav;
  float rho; float psi; float lat;
  float fseg; float u; float segW; float dS; float baseW;
  float coreR; float dC; float inSeg; float memHalf; float pulpD;
};
struct Sac { float sdf; float e; vec3 id; float t; vec2 g; float wx; float wz; float second; };

float segBound(int i) { return oSegB[i >> 2][i & 3]; }

float septumRel(int i, float rho, float y) {
  int n = int(oSeg.x);
  float b0 = segBound(0);
  int k = i < 0 ? i + n : (i >= n ? i - n : i);
  float base = (k == 0 ? 0.0 : segBound(k) - b0) + (i < 0 ? -F_TAU : (i >= n ? F_TAU : 0.0));
  vec3 h = hash33(vec3(float(k) + 0.5, 7.5, oRind.w * 97.0 + 0.5));
  float a = oShape.x;
  float lr = rho / a;
  float w = (0.0008 * sin(rho * 150.0 + h.x * 6.283 + y * 40.0) + 0.00028 * sin(rho * 560.0 + y * 210.0 + h.y * 6.283)) * smoothstep(0.003, 0.01, rho) / max(rho, 0.003);
  float curve = (h.z - 0.5) * 0.16 * lr * lr;
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
  A.depthP = A.sh.y - A.r;
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
  float coreBase = oLayers.z * (0.5 + 0.55 * yN * yN);
  float torn = 0.5;
  if (A.rho < coreBase * 2.0) {
    vec2 cs = vec2(cos(A.psi), sin(A.psi));
    torn = vnoise(vec3(cs * 2.3, p.y * 140.0) + oNoise.xyz) * 0.6 + vnoise(vec3(cs * 7.0, p.y * 520.0) + oNoise.zxy) * 0.4;
  }
  A.coreR = coreBase * (0.72 + 0.6 * torn);
  A.dC = A.rho - A.coreR;
  A.memHalf = 0.00007 + 0.00026 * exp(-max(A.dC, 0.0) / 0.0025);
  vec3 hs = hash33(vec3(A.fseg + 0.5, 3.5, oRind.w * 31.0));
  float kD = 0.0009 + 0.0006 * hs.x, kC = 0.0026 + 0.0022 * hs.y;
  A.inSeg = smin(smin(A.dS - A.memHalf, A.depthP - 0.00005, kD), A.dC - 0.00035, kC);
  A.pulpD = max(A.sh.y - A.coreR, 0.004);
  return A;
}

Sac sacsAt(Anat A) {
  float LX = oSeg.z * 1.5;
  float LZ = LX * 0.85;
  float Rp = A.sh.y;
  float wallRho = sqrt(max(Rp * Rp - A.p.y * A.p.y, 1e-8));
  float S = max(wallRho - A.rho, 0.0);
  float D = max(wallRho - A.coreR, 0.002);
  float w = clamp(S / D, 0.0, 1.0);
  float chev = 0.3;
  float ell = A.p.y + S * 0.22;
  float nL = max(3.0, floor(A.baseW * oShape.x * 0.88 / LX + 0.5));
  float stretch = 1.0 + chev * w;
  float xl = (A.u * stretch + 1.0) * 0.5 * nL;
  float physX = A.segW * max(A.rho, 0.0015) / nL / stretch;
  float physZ = LZ;
  float zq = ell / LZ;
  float i0 = floor(xl);
  Sac best;
  best.sdf = 1.0; best.second = 1.0; best.e = 9.0; best.id = vec3(0.5); best.t = 0.5; best.g = vec2(0.0); best.wx = 1e-4; best.wz = 1e-4;
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
      float s0 = 0.00015 + 0.0005 * h2.y;
      float Sa = s0, Sb = s0 + D * (h.z < 0.6 ? mix(0.75, 1.0, h2.x) : mix(0.35, 0.65, h2.x));
      float k = 0.0;
      if (S > Sb) {
        Sa = Sb + 0.00025;
        Sb = Sa + max(D - Sa, 0.001) * mix(0.5, 1.0, h2.z);
        k = 1.0;
        if (S > Sb) { Sa = Sb + 0.00025; Sb = max(D * 1.03, Sa + 0.001); k = 2.0; }
      }
      float t = clamp((S - Sa) / max(Sb - Sa, 1e-4), 0.0, 1.0);
      vec3 hs = k < 0.5 ? h2 : hash33(h2 * 37.0 + k);
      float tt = pow(t, 0.75);
      float prof = pow(max(sin(F_PI * tt), 0.0), 0.42);
      float bend = (hs.x - 0.5) * 0.3 * sin(F_PI * t) + (hs.z - 0.5) * 0.12 * sin(F_TAU * t);
      float X = (xl - cx - bend) * physX;
      float Z = (zz - cz - (hs.y - 0.5) * 0.25 * sin(F_PI * t)) * physZ;
      float wx = max(0.5 * physX * (1.04 + 0.16 * hs.y) * prof, 1e-6);
      float wz = max(0.5 * physZ * (1.1 + 0.25 * hs.z) * prof, 1e-6);
      vec2 q = vec2(X / wx, Z / wz);
      float e = length(q);
      float sdf = (e - 1.0) * min(wx, wz);
      if (e < best.e) {
        best.second = best.sdf;
        best.sdf = sdf; best.e = e; best.id = hs; best.t = t; best.g = q / vec2(wx, wz); best.wx = wx; best.wz = wz;
      } else best.second = min(best.second, sdf);
    }
  }
  return best;
}

float planeHash(vec4 plane) { return fract(plane.w * 7919.13 + dot(plane.xyz, vec3(3.71, 11.37, 5.93))); }

float juiceLevel(vec3 p) { return smoothstep(0.5, 0.7, vnoise(p * 260.0 + oNoise.zyx) * 0.7 + vnoise(p * 900.0 + oNoise.xzy) * 0.3); }

float sacHeight(Sac s, float ph, vec3 p, float w) {
  vec3 id = fract(s.id + ph);
  float inside = 1.0 - s.e * s.e;
  float tip = smoothstep(0.0, 0.25, s.t) * smoothstep(1.0, 0.8, s.t);
  float dome = (0.00005 + 0.00014 * id.x) * sqrt(max(inside, 0.0)) * (0.4 + 0.6 * tip);
  if (id.y < 0.2) dome = -(0.00008 + 0.00018 * id.z) * max(inside, 0.0);
  else if (id.y > 0.975) dome += 0.00035 * max(inside, 0.0);
  float gap = -0.00016 - 0.00008 * w;
  float jl = juiceLevel(p);
  float meniscus = 0.00005 * (1.0 - smoothstep(0.0, 0.00025, s.sdf));
  float juice = -0.00004 - 0.00004 * (1.0 - jl) + meniscus;
  return s.sdf < 0.0 ? dome : max(gap, mix(gap, juice, jl));
}

vec3 onPlane(vec3 p, vec4 plane) { return p - plane.xyz * (dot(plane.xyz, p) - plane.w); }
float cutHeight(vec3 p, vec4 plane) {
  p = onPlane(p, plane);
  Anat A = anatomy(p);
  if (A.depthO < 0.0) return 0.0;
  if (A.depthP < 0.0) {
    if (A.depthO < A.flav * 0.9) return 0.0;
    float sponge = vnoise(p * 4200.0 + oNoise.xyz) - 0.5;
    float wet = 1.0 - smoothstep(0.0, 0.0007, -A.depthP);
    return 0.000025 * sponge - 0.00004 * wet;
  }
  if (A.dC < 0.0) {
    vec2 cs = vec2(cos(A.psi), sin(A.psi));
    float fib = vnoise(vec3(cs * 9.0, A.rho * 2600.0) + oNoise.zxy) * 0.6 + vnoise(p * 3000.0 + oNoise.xyz) * 0.4;
    float k = 1.0 - smoothstep(-0.0012, 0.0, A.dC);
    return mix(0.00004, 0.00018 + 0.00055 * fib, k);
  }
  float ph = planeHash(plane);
  float w = clamp(A.depthP / A.pulpD, 0.0, 1.0);
  float segBulge = 0.00026 * (0.4 + 0.6 * fract(A.fseg * 0.618 + ph)) * (1.0 - A.u * A.u) * sin(F_PI * clamp(w * 1.1, 0.0, 1.0));
  if (A.inSeg < 0.0) {
    float thick = smoothstep(0.0, -0.0006, A.inSeg);
    return mix(-0.00007, 0.00003, thick) + segBulge * 0.3;
  }
  Sac s = sacsAt(A);
  float h = sacHeight(s, ph, p, w) + segBulge;
  float edge = smoothstep(0.0, 0.0004, A.inSeg);
  return clamp(mix(-0.00006, h, edge), H_MIN, H_MAX);
}

vec3 fleshBase(float w, vec3 id) {
  vec3 outer = oFleshDeep.rgb, mid = oFlesh.rgb;
  vec3 inner = oFleshDeep.w >= 0.0 ? mix(mid, oFleshWall.rgb, oFleshDeep.w) : mix(mid, outer, -oFleshDeep.w);
  vec3 c = w < 0.45 ? mix(outer, mid, smoothstep(0.0, 0.45, w)) : mix(mid, inner, smoothstep(0.45, 1.0, w));
  c *= 0.93 + 0.13 * id.x;
  c.g *= 0.95 + 0.1 * id.z;
  return c;
}

float deepWalls(vec3 p, vec3 dirIn, int samples, vec3 own, out float septa) {
  float acc = 0.0, wsum = 0.0;
  septa = 0.0;
  for (int k = 0; k < 6; k++) {
    if (k >= samples) break;
    float dep = 0.00035 * pow(1.75, float(k) * 6.0 / float(samples));
    vec3 q = p + dirIn * dep;
    Anat B = anatomy(q);
    float T = exp(-dep / 0.0022);
    float wall = 0.0;
    if (B.depthP < 0.0 || B.dC < 0.0) wall = 0.5;
    else if (B.inSeg < 0.0) { septa += T; wall = 0.8; }
    else {
      Sac s = sacsAt(B);
      float ww = 0.00006 + 0.12 * dep;
      float d = distance(s.id, own) < 1e-4 ? s.second : s.sdf;
      wall = exp(-(d * d) / (ww * ww));
    }
    acc += wall * T;
    wsum += T;
  }
  septa /= max(wsum, 1e-6);
  return acc / max(wsum, 1e-6);
}

Surface cutSurface(SurfaceInput si, vec4 plane, vec3 Nrest) {
  vec3 p = onPlane(si.rest, plane);
  Anat A = anatomy(p);
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
    float bn = vnoise(A.dir * 9000.0 + oNoise.zxy) - 0.5;
    float boundary = max(A.flav * (0.8 + 0.12 * vnoise(A.dir * 1800.0 + oNoise.xyz)), tooth) + bn * 0.00008;
    float aa = px * 0.6;
    float flav = 1.0 - smoothstep(boundary - aa, boundary + aa, A.depthO);
    float gland = has * (1.0 - smoothstep(0.85, 1.0 + px / grad, ge));
    float outerLine = 1.0 - smoothstep(0.00022, 0.00035 + aa, A.depthO);
    vec3 flavCol = mix(vec3(0.93, 0.33, 0.006), vec3(0.95, 0.25, 0.018), outerLine);
    flavCol *= 0.94 + 0.12 * vnoise(p * 5200.0 + oNoise.xyz);
    flavCol = mix(flavCol, vec3(0.96, 0.62, 0.035), gland * 0.85);
    float peel = A.sh.x - A.sh.y;
    float into = clamp((A.depthO - boundary) / max(peel - boundary, 1e-4), 0.0, 1.0);
    vec3 fq = (p - A.dir * dot(p, A.dir)) * 3600.0 + A.dir * A.depthO * 700.0;
    float fib = vnoise(fq + oNoise.yzx) * 0.6 + vnoise(fq * 2.7 + oNoise.zxy) * 0.4;
    vec3 pith = mix(vec3(0.92, 0.82, 0.3), vec3(0.94, 0.88, 0.56), smoothstep(0.0, 0.3, into));
    pith = mix(pith, vec3(0.955, 0.9, 0.63), smoothstep(0.5, 1.0, into));
    pith *= 0.93 + 0.1 * fib;
    float wet = 1.0 - smoothstep(0.0, 0.0006, -A.depthP);
    pith = mix(pith, pow(pith, vec3(1.6)) * vec3(1.0, 0.97, 0.85), wet * 0.6);
    float dorsal = 1.0 - smoothstep(0.00004, 0.0001 + aa, -A.depthP - 0.00005);
    pith = mix(pith, vec3(0.97, 0.9, 0.62), dorsal * 0.5);
    albedo = mix(pith, flavCol, flav);
    rough = mix(mix(0.62, 0.3, wet), mix(0.38, 0.12, gland), flav);
    clear = mix(wet * 0.7, gland * 0.8, flav);
    ccRough = mix(0.05, 0.04, flav);
    vec4 sp = noiseD(fq * 0.5 + oNoise.xzy);
    gN = (sp.yzw * 0.5 * 3600.0) * 0.000004 * (1.0 - flav) * (1.0 - smoothstep(0.00005, 0.0002, px));
    profile = flav > 0.5 ? 1.0 : 2.0;
    width = flav > 0.5 ? 0.3 : 0.8;
    sssColor = mix(vec3(0.95, 0.9, 0.62) * 0.3, oRind.rgb * vec3(0.35, 0.16, 0.04), flav);
    trans = mix(vec3(0.95, 0.9, 0.62) * vec3(0.22, 0.15, 0.04), oRind.rgb * 0.1, flav);
  } else if (A.dC < 0.0) {
    vec2 cs = vec2(cos(A.psi), sin(A.psi));
    float fib = vnoise(vec3(cs * 9.0, A.rho * 2600.0) + oNoise.zxy) * 0.6 + vnoise(p * 3000.0 + oNoise.xyz) * 0.4;
    vec4 pore = noiseD(p * 5200.0 + oNoise.xzy);
    float holes = smoothstep(0.74, 0.86, pore.x) * (1.0 - smoothstep(0.00008, 0.0003, px));
    vec3 core = vec3(0.95, 0.925, 0.78) * (0.86 + 0.18 * fib);
    core = mix(core, vec3(0.88, 0.62, 0.2), holes * 0.4);
    float hollow = oExtra.w > 0.0 ? 1.0 - smoothstep(0.0, 0.0008, A.rho - oExtra.w * A.coreR) : 0.0;
    core = mix(core, core * vec3(0.75, 0.66, 0.48), hollow);
    albedo = core;
    rough = mix(0.62, 0.45, fib);
    clear = 0.1;
    gN = pore.yzw * 5200.0 * 0.0000025 * (1.0 - smoothstep(0.00006, 0.0003, px));
    cavity = mix(1.0, 0.7, holes) * mix(1.0, 0.5, hollow);
    profile = 2.0; width = 0.8;
    sssColor = vec3(0.95, 0.92, 0.75) * 0.32;
    trans = vec3(0.95, 0.92, 0.75) * vec3(0.22, 0.15, 0.04);
  } else {
    Sac s = sacsAt(A);
    vec3 id = s.id;
    vec3 flesh = fleshBase(w, id);
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
    float wall = (1.0 - smoothstep(bandW, bandW + px * 0.8, inPlane)) * step(0.0, -s.sdf + px * 0.3) * sqrt(gp) * mix(0.35, 1.0, cover);
    float gap = smoothstep(-px * 0.5, px * 0.5, s.sdf);
    float juice = juiceLevel(p);
    float inner = clamp(s.e, 0.0, 1.0);
    flesh *= mix(1.03, 0.97, inner * inner);
    int samples = tier < 0.5 ? 0 : tier < 1.5 ? 3 : tier < 2.5 ? 4 : 6;
    float septa = 0.0, deep = 0.35;
    if (samples > 0) {
      vec3 dirIn = refract(-Vr, n, 1.0 / 1.35);
      if (dot(dirIn, dirIn) < 0.5) dirIn = -n;
      deep = deepWalls(p, dirIn, samples, s.id, septa);
    }
    float lowF = vnoise(p * 220.0 + oNoise.yzx + A.fseg) * 0.65 + vnoise(p * 520.0 + oNoise.zxy) * 0.35;
    flesh *= mix(vec3(1.0, 0.86, 0.6), vec3(1.0, 1.06, 1.25), lowF);
    flesh = mix(flesh * vec3(1.0, 0.88, 0.62), mix(flesh, wallCol, 0.5), smoothstep(0.08, 0.7, deep));
    flesh = mix(flesh, mix(flesh, vec3(0.95, 0.86, 0.55), 0.35), septa * 0.5);
    vec3 gapCol = flesh * vec3(0.93, 0.8, 0.5);
    albedo = mix(flesh, gapCol, gap);
    albedo = mix(albedo, wallCol, wall * 0.45);
    vec3 eRho = normalize(vec3(p.x, 0.0, p.z) + vec3(1e-7, 0.0, 0.0));
    vec3 eAlong = normalize(-eRho - vec3(0.0, 0.22, 0.0));
    vec3 eUp = normalize(cross(eAlong, ePsi));
    float wrinkleK = (1.0 - smoothstep(0.00003, 0.00015, px)) * (1.0 - gap);
    if (wrinkleK > 0.0) {
      vec3 qw = vec3(dot(p, eAlong) * 900.0, dot(p, ePsi) * 5200.0, dot(p, eUp) * 5200.0) + id * 50.0;
      vec4 wr = noiseD(qw);
      vec4 wr2 = noiseD(qw * vec3(2.1, 2.3, 2.3) + 17.0);
      vec3 gw = (wr.y * 900.0 * eAlong + wr.z * 5200.0 * ePsi + wr.w * 5200.0 * eUp) * 0.000012 + (wr2.y * 1900.0 * eAlong + wr2.z * 12000.0 * ePsi + wr2.w * 12000.0 * eUp) * 0.000005;
      gN += gw * wrinkleK;
    }
    float memK = 1.0 - smoothstep(-0.00002, 0.00012 + px * 0.5, A.inSeg);
    float thick = smoothstep(0.0, -0.0005, A.inSeg);
    vec3 memCol = mix(mix(albedo, vec3(0.94, 0.87, 0.6), 0.6), vec3(0.95, 0.9, 0.66), thick);
    albedo = mix(albedo, memCol, memK);
    float rupt = step(fract(id.y + ph), 0.2) * step(s.sdf, 0.0);
    float film = step(fract(id.z * 7.31 + ph), 0.55);
    rough = mix(mix(0.2, 0.1, film), 0.24, wall);
    rough = mix(rough, 0.09, gap * juice);
    rough = mix(rough, mix(0.2, 0.45, thick), memK);
    clear = mix(mix(0.15 + 0.75 * film, 0.8, rupt), 1.0, gap * juice);
    clear = mix(clear, 0.5 * (1.0 - thick), memK);
    ccRough = mix(0.035, 0.02, gap * juice);
    cavity = mix(1.0, 0.9, gap * (1.0 - juice));
    profile = memK * thick > 0.5 ? 2.0 : 3.0;
    width = profile > 2.5 ? 0.9 : 0.8;
    sssColor = mix(oFlesh.rgb * 0.5, vec3(0.95, 0.9, 0.62) * 0.32, memK * thick);
    trans = mix(oFlesh.rgb * vec3(0.66, 0.25, 0.02), vec3(0.95, 0.9, 0.62) * vec3(0.22, 0.15, 0.04), memK * thick);
  }
  Surface s = defaultSurface(vec3(0, 1, 0));
  s.N = normalize(si.restToWorld * perturb(Nrest, gN, 1.0));
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = rough;
  s.f0 = vec3(0.022);
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
