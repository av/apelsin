export const ORANGE_UBO = `
layout(std140) uniform Orange {
  vec4 oShape;
  vec4 oShape2;
  vec4 oLump[4];
  vec4 oLumpPhase;
  vec4 oLayers;
  vec4 oSeg;
  vec4 oSegB[3];
  vec4 oSeeds[6];
  vec4 oRind;
  vec4 oRindStem;
  vec4 oBlush;
  vec4 oFlesh;
  vec4 oFlesh2;
  vec4 oPith;
  vec4 oGland;
  vec4 oNoise;
  vec4 oFleshDeep;
  vec4 oFleshWall;
  vec4 oExtra;
};
`;

export const ORANGE_SHAPE = `
float orangeShapeRadius(vec3 d) {
  float a = oShape.x, c = oShape.y;
  float r = 1.0 / sqrt((d.x * d.x + d.z * d.z) / (a * a) + (d.y * d.y) / (c * c));
  float lump = 0.0;
  for (int i = 0; i < 4; i++) lump += oLump[i].w * cos(dot(d, oLump[i].xyz) * oShape2.w + oLumpPhase[i]);
  float up = max(d.y, 0.0);
  float shoulder = oShape.z * up * up * (1.0 - up * up) * 4.0;
  float th = acos(clamp(d.y, -1.0, 1.0));
  float dip = oShape.w * exp(-(th * th) / (oShape2.x * oShape2.x));
  float psi = atan(d.z, d.x + 1e-7);
  float rc = (oShape2.z / a) * (0.8 + 0.2 * cos(5.0 * psi));
  float calyx = 0.0008 * (1.0 - smoothstep(rc * 0.55, rc, th));
  float tn = 3.14159265 - th;
  float navel = oShape2.y * (exp(-(tn * tn) / 0.01) - 0.6 * exp(-(tn * tn) / 0.0012));
  return r * (1.0 + lump + shoulder) - dip + calyx - navel;
}
vec3 orangeShapePoint(vec3 d) { d = normalize(d); return d * orangeShapeRadius(d); }
vec3 orangeShapeNormal(vec3 d) {
  vec3 t1 = normalize(abs(d.y) < 0.9 ? cross(d, vec3(0, 1, 0)) : cross(d, vec3(1, 0, 0)));
  vec3 t2 = cross(d, t1);
  float e = 0.003;
  vec3 a = orangeShapePoint(d + t1 * e) - orangeShapePoint(d - t1 * e);
  vec3 b = orangeShapePoint(d + t2 * e) - orangeShapePoint(d - t2 * e);
  vec3 n = normalize(cross(a, b));
  return dot(n, d) < 0.0 ? -n : n;
}
float segBound(int i) { return oSegB[i >> 2][i & 3]; }
void orangeSegment(float ang, out int idx, out float rel, out float width, out float edge) {
  int n = int(oSeg.x);
  float b0 = segBound(0);
  float a = mod(ang - b0, 6.2831853);
  float start = 0.0, end = 6.2831853;
  idx = n - 1;
  for (int i = 1; i < 12; i++) {
    if (i >= n) break;
    float bi = segBound(i) - b0;
    if (a < bi) { idx = i - 1; end = bi; break; }
    start = bi;
  }
  rel = a - 0.5 * (start + end);
  width = end - start;
  edge = min(a - start, end - a);
}
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
struct Gland { float f1; float f2; vec3 r1; vec3 r2; vec3 id; float t1; };
Gland glandCells(vec3 p, vec3 n) {
  vec3 i = floor(p), f = fract(p);
  Gland c; c.f1 = 9.0; c.f2 = 9.0; c.r1 = vec3(0.5); c.r2 = vec3(1.0); c.id = vec3(0); c.t1 = 1.0;
  vec3 o = step(0.5, f) - 1.0;
  for (int z = 0; z <= 1; z++) for (int y = 0; y <= 1; y++) for (int x = 0; x <= 1; x++) {
    vec3 g = o + vec3(x, y, z);
    vec3 h = hash33(i + g);
    vec3 r = g + 0.5 + (h - 0.5) * 0.72 - f;
    float d = dot(r, r);
    if (d < c.f1) { c.f2 = c.f1; c.r2 = c.r1; c.f1 = d; c.r1 = r; c.id = h; }
    else if (d < c.f2) { c.f2 = d; c.r2 = r; }
  }
  c.f1 = sqrt(c.f1); c.f2 = sqrt(c.f2);
  vec3 rt = c.r1 - n * dot(c.r1, n);
  c.t1 = length(rt);
  return c;
}
struct Ves { float f1; float f2; vec3 m; vec3 r; vec3 id; float k; float taper; };
Ves vesicleCells(vec3 q) {
  vec3 i = floor(q), f = fract(q);
  Ves v; v.f1 = 9.0; v.f2 = 9.0; v.m = vec3(0); v.r = vec3(0); v.id = vec3(0); v.k = 1.0; v.taper = 1.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z);
    vec3 h = hash33(i + g);
    vec3 r = g + 0.5 + (h - 0.5) * vec3(0.9, 0.8, 0.8) - f;
    float k = 0.68 + 0.64 * fract(h.x * 13.7 + h.z * 5.3);
    float s = clamp(-r.x / k, -1.0, 1.0);
    float taper = max(1.0 + 0.3 * s - 0.75 * s * s, 0.25);
    vec3 m = r / (k * vec3(1.0, taper, taper));
    float d = dot(m, m);
    if (d < v.f1) { v.f2 = v.f1; v.f1 = d; v.m = m; v.r = r; v.id = h; v.k = k; v.taper = taper; }
    else if (d < v.f2) v.f2 = d;
  }
  v.f1 = sqrt(v.f1); v.f2 = sqrt(v.f2);
  return v;
}
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
`;

export const ORANGE_RIND = `
Surface orangeRind(SurfaceInput si) {
  vec3 p = si.rest;
  float rl = length(p);
  vec3 d = p / max(rl, 1e-6);
  vec3 Nr = normalize(si.restNormal);
  float a = oShape.x;
  float th = acos(clamp(d.y, -1.0, 1.0));
  float tn = 3.14159265 - th;
  float psi = atan(d.z, d.x + 1e-7);
  vec3 ePsi = normalize(vec3(-d.z, 0.0, d.x) + vec3(1e-6, 0.0, 0.0));
  vec3 eTh = normalize(cross(ePsi, d));
  float px = max(si.pixel, 1e-6);
  float scale = oGland.x;
  float fw = px * scale;
  float detail = 1.0 - smoothstep(0.22, 0.7, fw);
  float fineDetail = 1.0 - smoothstep(0.3, 0.9, px * 3300.0);
  vec3 g = vec3(0);
  float pit = 0.0, ridge = 0.0;
  Gland c;
  c.id = vec3(0.5);
  vec4 peb = noiseD(p * 260.0 + oNoise.yzx);
  if (detail > 0.0) {
    c = glandCells(p * scale + oNoise.xyz + peb.yzw * 0.3, d);
    float e = c.f2 - c.f1;
    float rp = 0.36 + 0.16 * c.id.y;
    float x = min(c.t1 * c.t1 / (rp * rp), 1.0);
    float wallE = 0.05 + 0.05 * c.id.x;
    float edge = smoothstep(0.0, wallE + 0.12, e);
    pit = (1.0 - smoothstep(0.25, 1.0, x)) * edge;
    ridge = 1.0 - smoothstep(0.0, wallE + 0.06, e);
    float pitDepth = oGland.y * 0.5e-4 * (0.55 + 0.9 * c.id.x);
    vec3 rt = c.r1 - d * dot(c.r1, d);
    float sx = clamp((x - 0.25) / 0.75, 0.0, 1.0);
    g += pitDepth * 6.0 * sx * (1.0 - sx) / 0.75 * 2.0 / (rp * rp) * (-rt) * scale * edge;
    vec3 gradE = (c.r1 / max(c.f1, 1e-4) - c.r2 / max(c.f2, 1e-4)) * scale;
    float t = clamp(e / (wallE + 0.12), 0.0, 1.0);
    g += -pitDepth * (1.0 - smoothstep(0.25, 1.0, x)) * 6.0 * t * (1.0 - t) / (wallE + 0.12) * gradE;
    g *= detail;
  }
  vec4 fine = noiseD(p * 3300.0 + oNoise.zxy);
  g += fine.yzw * 3300.0 * 0.000018 * fineDetail;
  g += peb.yzw * 260.0 * oExtra.y;
  float m1 = vnoise(p * 38.0 + oNoise.yzx), m2 = vnoise(p * 90.0 + oNoise.zxy + 5.0), m3 = vnoise(p * 420.0 + oNoise.xzy);
  vec3 albedo = oRind.rgb * (1.0 + oGland.z * (m1 - 0.5) * 1.8) * (0.96 + 0.08 * m3);
  albedo = mix(albedo, min(oRind.rgb * vec3(1.09, 1.5, 3.0), vec3(1.0)), smoothstep(0.35, 0.8, m2) * 0.45);
  float stemT = 1.0 - smoothstep(0.1, 0.62, th);
  albedo = mix(albedo, oRindStem.rgb, stemT * stemT * oRindStem.w);
  float blushMask = oBlush.w > 0.0 ? smoothstep(0.4, 0.75, fbm3(p * 30.0 + oNoise.xzy + 3.0) + 0.25 * d.x) : 0.0;
  albedo = mix(albedo, oBlush.rgb, blushMask * oBlush.w);
  float speck = oBlush.w > 0.4 ? step(0.82, c.id.z) * pit * detail * (0.4 + blushMask) : 0.0;
  albedo = mix(albedo, oBlush.rgb * 0.8, min(speck, 1.0));
  albedo *= mix(vec3(1.0), vec3(0.97, 0.93, 0.9), pit * detail);
  albedo *= 1.0 - 0.04 * (1.0 - detail);
  float dot1 = step(0.996, c.id.z) * (1.0 - smoothstep(0.12, 0.2, c.t1)) * detail;
  albedo = mix(albedo, vec3(0.2, 0.08, 0.02), dot1 * 0.7);
  float scarN = vnoise(vec3(p.x * 160.0, p.y * 900.0, p.z * 160.0) + oNoise.zyx * 1.3);
  float scar = smoothstep(0.8, 0.86, scarN) * smoothstep(0.62, 0.75, m2);
  albedo = mix(albedo, albedo * vec3(0.85, 1.15, 2.0) + vec3(0.02, 0.02, 0.01), scar * 0.5);
  float scuff = smoothstep(0.72, 0.8, fine.x * 0.5 + m3 * 0.5);
  float rough = mix(0.46, 0.34, ridge * detail);
  rough = mix(rough, 0.56, pit * detail * 0.6);
  rough = mix(rough, 0.62, max(scuff * 0.6, scar));
  rough = mix(rough, 0.52, 1.0 - detail);
  float clear = oExtra.x * mix(1.0, 0.3, max(scuff, scar));
  float ccRough = mix(0.13, 0.2, pit * detail) + 0.08 * scuff + 0.08 * (1.0 - detail);
  float rc = (oShape2.z / a);
  float cav = 1.0;
  if (th < rc * 4.2) {
    float furrowFade = smoothstep(rc * 0.9, rc * 1.4, th) * (1.0 - smoothstep(rc * 2.2, rc * 4.0, th));
    float fpsi = psi * 6.0 + 1.6 * vnoise(vec3(th * 30.0, psi * 2.0, 1.0) + oNoise.xyz);
    float furrow = sin(fpsi);
    g += ePsi * cos(fpsi) * 6.0 / max(rl * sin(th), 1e-4) * 0.00022 * furrowFade * (0.4 + 0.6 * smoothstep(-0.2, 0.8, furrow));
    float lobePhase = psi * 5.0 + oNoise.x;
    float lobeId = floor((lobePhase + 3.14159) / 6.28318);
    float lobe = pow(0.5 + 0.5 * cos(lobePhase), 0.9);
    float rStar = rc * (0.6 + (0.34 + 0.12 * fract(sin(lobeId * 12.9 + oNoise.y) * 43758.5)) * lobe);
    float calyx = 1.0 - smoothstep(rStar * 0.92, rStar * 1.04, th);
    float gap = smoothstep(rStar * 0.95, rStar * 1.05, th) * (1.0 - smoothstep(rStar * 1.05, rStar * 1.3, th)) * (1.0 - smoothstep(rc * 1.2, rc * 1.4, th));
    float vein = (1.0 - smoothstep(0.0, 0.35, abs(sin(lobePhase * 0.5)))) * calyx;
    vec3 calyxCol = mix(vec3(0.1, 0.1, 0.012), vec3(0.06, 0.065, 0.012), vnoise(p * 3000.0));
    calyxCol = mix(calyxCol, vec3(0.09, 0.07, 0.02), smoothstep(0.4, 0.8, vnoise(p * 900.0 + 7.0)) * 0.6);
    calyxCol = mix(calyxCol, vec3(0.16, 0.15, 0.03), vein * 0.6);
    calyxCol = mix(calyxCol, vec3(0.14, 0.07, 0.015), smoothstep(0.7, 1.0, th / rStar) * 0.7);
    g += eTh * (smoothstep(rStar * 0.7, rStar, th) * 2.2 - (1.0 - smoothstep(0.0, rStar * 0.6, th)) * 0.3) * calyx;
    g += ePsi * sin(lobePhase) * 0.5 * calyx;
    float excess = rl - orangeShapeRadius(d);
    float stub = step(0.00025, excess) * (1.0 - step(rc * 0.9, th));
    vec3 stubSide = mix(vec3(0.1, 0.105, 0.012), vec3(0.16, 0.15, 0.04), vnoise(vec3(psi * 14.0, p.y * 4000.0, 0.0)));
    float rr = length(p.xz);
    float ring = smoothstep(0.0003, 0.0006, rr) * (1.0 - smoothstep(0.0008, 0.0011, rr));
    vec3 stubTop = mix(vec3(0.17, 0.16, 0.035), vec3(0.27, 0.25, 0.08), ring * (0.6 + 0.4 * vnoise(p * 9000.0)));
    stubTop = mix(stubTop, vec3(0.32, 0.29, 0.14), (1.0 - smoothstep(0.0002, 0.0004, rr)) * 0.5);
    vec3 stubCol = mix(stubSide, stubTop, smoothstep(0.6, 0.9, Nr.y));
    float calyxAll = max(calyx, stub);
    albedo = mix(albedo, calyxCol, calyx);
    albedo = mix(albedo, albedo * 0.35, gap);
    albedo = mix(albedo, stubCol, stub);
    g = mix(g, vec3(0), stub);
    rough = mix(rough, 0.62, calyxAll);
    clear = mix(clear, 0.15, calyxAll);
    cav = mix(1.0, 0.45, gap);
  }
  float navelOpen = oExtra.z;
  if (tn < 0.45 && navelOpen > 0.0) {
    float folds = smoothstep(navelOpen * 0.9, navelOpen * 1.6, tn) * (1.0 - smoothstep(navelOpen * 1.6, navelOpen * 3.0, tn));
    float fp = psi * 9.0 + 2.0 * vnoise(vec3(tn * 40.0, psi, 3.0));
    g += ePsi * cos(fp) * 9.0 / max(rl * sin(tn), 1e-4) * 0.00025 * folds;
    float hole = 1.0 - smoothstep(navelOpen * 0.75, navelOpen, tn);
    float lip = smoothstep(navelOpen * 0.7, navelOpen, tn) * (1.0 - smoothstep(navelOpen, navelOpen * 1.25, tn));
    vec4 crumple = noiseD(vec3(psi * 4.0, tn * 160.0, 0.0) + oNoise.xyz);
    vec4 crumple2 = noiseD(p * 2600.0 + oNoise.zxy);
    float crease = smoothstep(0.35, 0.05, abs(crumple.x - 0.5));
    vec3 inner = oRind.rgb * vec3(1.0, 1.15, 1.2) * (0.7 + 0.35 * crumple2.x);
    albedo = mix(albedo, mix(inner, inner * 0.35, crease), hole);
    g += (ePsi * crumple.y * 4.0 / max(rl * sin(tn), 1e-4) + eTh * crumple.z * 160.0 / rl) * 0.0004 * hole + crumple2.yzw * 2600.0 * 0.00003 * hole;
    g += eTh * 0.6 * lip;
    cav = min(cav, mix(1.0, mix(0.75, 0.3, crease), hole));
    rough = mix(rough, 0.55, hole);
    clear = mix(clear, 0.2, hole);
  } else if (tn < 0.45) {
    float scarR = 0.035 + 0.01 * oNoise.y / 100.0;
    float scarK = 1.0 - smoothstep(scarR * 0.6, scarR, tn);
    float scarRing = smoothstep(scarR * 0.6, scarR, tn) * (1.0 - smoothstep(scarR, scarR * 1.6, tn));
    albedo = mix(albedo, vec3(0.25, 0.1, 0.015) * (0.8 + 0.4 * vnoise(p * 4000.0)), scarK * 0.9);
    albedo *= 1.0 - 0.15 * scarRing;
    g += -eTh * scarRing * 0.4;
    rough = mix(rough, 0.68, scarK);
    clear *= 1.0 - scarK;
  }
  Surface s = defaultSurface(vec3(0, 1, 0));
  vec3 Nrest = perturb(Nr, g, 1.0);
  s.N = normalize(si.restToWorld * Nrest);
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = rough;
  s.f0 = vec3(0.035);
  s.clearcoat = clear;
  s.clearcoatRoughness = ccRough;
  s.cavity = mix(1.0, 0.9, pit * detail) * cav;
  s.sssProfile = 1.0;
  s.sssWidth = 0.45;
  s.sssColor = oRind.rgb * vec3(0.35, 0.16, 0.04);
  s.transmission = oRind.rgb * vec3(0.05, 0.015, 0.0);
  return s;
}
`;

export const ORANGE_INTERIOR = `
vec3 fleshColour(float radial, vec3 id, float fseg) {
  vec3 mid = oFlesh.rgb, outer = oFleshDeep.rgb;
  vec3 core = oFleshDeep.w >= 0.0 ? mix(mid, oFleshWall.rgb, oFleshDeep.w) : mix(mid, outer, -oFleshDeep.w);
  vec3 col = radial < 0.55 ? mix(core, mid, smoothstep(0.0, 0.55, radial)) : mix(mid, outer, smoothstep(0.55, 1.0, radial));
  float segTone = fract(fseg * 0.618 + oRind.w);
  col *= (0.93 + 0.14 * id.x) * (0.97 + 0.06 * segTone);
  col = mix(col, col * vec3(1.0, 1.08, 1.2), (id.y - 0.5) * 0.35);
  return col;
}
Surface orangeInterior(SurfaceInput si) {
  vec3 p = si.rest;
  float r = length(p);
  vec3 d = p / max(r, 1e-6);
  float R = orangeShapeRadius(d);
  float depth = R - r;
  float tf = oLayers.x, tp = oLayers.y;
  float px = max(si.pixel, 1e-6);
  float rho = length(p.xz);
  vec3 rhoHat = vec3(p.x, 0.0, p.z) / max(rho, 1e-6);
  vec3 ePsi = vec3(-rhoHat.z, 0.0, rhoHat.x);
  float psi = atan(p.z, p.x + 1e-7);
  vec3 Nf = normalize(si.restNormal);
  float tier = uFlags.x;
  vec4 pv = noiseD(p * 90.0 + oNoise.zxy);
  float peel = tf + tp * (0.9 + 0.2 * pv.x);
  float yN = p.y / oShape.y;
  float coreBase = oLayers.z * (0.75 + 0.6 * yN * yN);
  float torn = 0.5;
  if (rho < coreBase * 2.0) torn = 0.6 * vnoise(vec3(cos(psi), sin(psi), p.y * 80.0) * 3.0 + oNoise.xyz) + 0.4 * vnoise(vec3(cos(psi), sin(psi), p.y * 200.0) * 9.0 + oNoise.zxy);
  float coreR = coreBase * (0.62 + 0.75 * torn);
  float wave = (oSeg.y * sin(p.y * 70.0 + rho * 110.0 + oNoise.x) + oSeg.y * 1.2 * (pv.x - 0.5)) * smoothstep(0.0, 0.012, rho);
  int seg; float rel, segW, edge;
  orangeSegment(psi + wave, seg, rel, segW, edge);
  float fseg = float(seg);
  float dS = edge * rho;
  float gap = oExtra.w > 0.0 ? 0.0016 * yN * yN * yN * yN * (0.5 + pv.x) : 0.0;
  float dD = depth - peel - gap;
  float dC = rho - coreR;
  float kC = 0.0038 + 0.0024 * fract(fseg * 0.37 + oRind.w), kD = 0.0008;
  float segD = smin(smin(dS, dD, kD), dC, kC);
  float rawMin = min(min(dS, dD), dC);
  float fill = clamp((rawMin - segD) / 0.0004, 0.0, 1.0);
  float memHalf = oLayers.w * (0.4 + 0.9 * exp(-max(dC, 0.0) / 0.004));
  float memW = max(memHalf, px * 0.7);
  float memCov = memHalf / memW;
  vec3 albedo = oFlesh.rgb;
  vec3 gN = vec3(0);
  float rough = 0.08, clear = 0.4, ccRough = 0.03, cavity = 1.0;
  float profile = 3.0, width = 0.9;
  float wallK = 0.0;
  float radial = clamp((rho - coreR) / max(R - peel - coreR, 1e-4), 0.0, 1.0);
  if (dD > -0.0006 && dC > -0.0012) {
    float tilt = 0.26;
    vec3 aHat = cos(tilt) * rhoHat + sin(tilt) * vec3(0, 1, 0);
    vec3 xHat = -sin(tilt) * rhoHat + cos(tilt) * vec3(0, 1, 0);
    float sAlong = rho * cos(tilt) + p.y * sin(tilt);
    float wAcross = -rho * sin(tilt) + p.y * cos(tilt);
    float L = oSeg.w, W = oSeg.z, Wa = oSeg.z * 1.15;
    float fanR = mix(rho, oShape.x * 0.7, 0.55);
    float fan = fanR / max(rho, 1e-4);
    vec3 q = vec3(sAlong / L, rel * fanR / W, wAcross / Wa) + vec3(fseg * 13.7, fseg * 3.1, fseg * 5.3);
    float bend = 0.3 * sin(q.x * 0.9 + q.z * 0.6 + fseg * 2.1) + 0.2 * sin(q.x * 2.3 - q.y * 0.4 + fseg);
    q.y += bend * 0.9;
    float vfw = px / W;
    float vdetail = 1.0 - smoothstep(0.2, 0.6, vfw);
    Ves v = vesicleCells(q);
    float f1 = min(v.f1, 1.2);
    float wallW = 0.05 + vfw * 0.9;
    float wallVar = smoothstep(0.15, 0.85, fract(v.id.x * 7.31 + v.id.y * 3.7));
    float wallLine = (1.0 - smoothstep(wallW * 0.25, wallW, v.f2 - v.f1)) * min(0.05 / wallW * 1.2, 1.0) * (0.15 + 0.85 * wallVar);
    wallK = wallLine * vdetail * (1.0 - 0.75 * smoothstep(0.55, 0.9, abs(v.m.x) / max(v.f1, 1e-3)));
    float domeD = inversesqrt(max(1.0 - min(f1 * f1, 1.0), 0.04));
    vec3 gq = v.m / (v.k * vec3(1.0, v.taper, v.taper)) * domeD;
    vec3 gAlong = aHat / L, gTan = ePsi * fan / W, gAcross = xHat / Wa;
    float bulge = W * 0.45 * (0.6 + 0.8 * v.id.z) * v.k;
    float ruptured = step(0.9, v.id.z) * step(0.3, radial);
    gN += bulge * (gq.x * gAlong + gq.y * gTan + gq.z * gAcross) * vdetail * (1.0 - ruptured);
    float hw = max(0.5 * segW * rho, 1e-4), uu = rel * rho / hw;
    float span = max(R - peel - coreR, 1e-3);
    float sB = 0.00045 * (0.7 + 0.6 * fract(fseg * 0.73 + oRind.w));
    float sR = sin(3.14159 * radial);
    gN += sB * (-2.0 * uu / hw * sR * ePsi + (1.0 - uu * uu) * 3.14159 * cos(3.14159 * radial) / span * rhoHat);
    float mdet = (1.0 - smoothstep(0.25, 0.7, px * 6000.0)) * step(1.5, tier);
    if (mdet > 0.0) {
      vec4 micro = noiseD(vec3(dot(p, aHat) * 2500.0, dot(p, ePsi) * 7000.0, dot(p, xHat) * 7000.0) + fseg);
      gN += (micro.y * aHat * 2500.0 + micro.z * ePsi * 7000.0 + micro.w * xHat * 7000.0) * 0.000028 * mdet;
    }
    vec3 flesh = fleshColour(radial, v.id, fseg);
    float inner = smoothstep(0.15, 1.0, f1);
    flesh *= mix(vec3(0.9, 0.84, 0.74), vec3(1.05, 1.08, 1.12), mix(0.5, inner, vdetail));
    if (oFlesh2.w > 0.0) {
      float streak = fbm3(vec3(q.x * 0.6, q.y * 1.4, q.z * 1.4) + 9.0) * 0.6 + 0.4 * v.id.x;
      float septumNear = 1.0 - smoothstep(0.0, 0.004, dS);
      float mask = smoothstep(0.75 - oFlesh2.w, 1.0 - oFlesh2.w, streak + 0.3 * septumNear - 0.15 * yN);
      flesh = mix(flesh, oFlesh2.rgb * (0.7 + 0.6 * v.id.y), mask);
    }
    vec3 wallCol = mix(flesh, oFleshWall.rgb, 0.55);
    float deep = 0.5, deepWall = 0.0;
    if (tier > 0.5) {
      vec3 Vr = normalize(transpose(si.restToWorld) * si.V);
      vec3 refr = refract(-Vr, Nf, 0.74);
      vec3 dp = refr * (0.0016 / max(-dot(refr, Nf), 0.35));
      vec3 qd = q + vec3(dot(dp, aHat) / L, dot(dp, ePsi) * fan / W, dot(dp, xHat) / Wa);
      deep = vnoise(qd * vec3(1.1, 2.0, 2.0) + 31.0);
      float rid = 1.0 - abs(2.0 * deep - 1.0);
      deepWall = smoothstep(0.82, 0.97, rid) * vdetail;
    }
    flesh *= mix(0.86, 1.06, deep);
    flesh = mix(flesh, wallCol, deepWall * 0.3);
    albedo = mix(flesh, wallCol, wallK * 0.8);
    albedo = mix(albedo, albedo * vec3(0.97, 0.9, 0.75), ruptured);
    float film = smoothstep(0.35, 0.65, pv.x * 0.75 + 0.25 * v.id.z);
    rough = mix(0.045, 0.16, wallK) + 0.08 * (1.0 - vdetail);
    rough = mix(rough, 0.035, ruptured);
    clear = mix(0.1, 0.55, max(film, ruptured));
    ccRough = mix(0.06, 0.018, film);
    vec3 dw = v.r * v.k * vec3(L, W / fan, Wa);
    float bd = length(dw);
    float br = (0.0003 + 0.0005 * fract(v.id.y * 31.0)) * v.k;
    float bead = step(0.93, v.id.y) * (1.0 - smoothstep(br - px, br + px * 0.5, bd)) * vdetail;
    vec3 dwv = -(v.r.x * v.k * L * aHat + v.r.y * v.k * W / fan * ePsi + v.r.z * v.k * Wa * xHat);
    gN = mix(gN, -dwv / sqrt(max(br * br - bd * bd, br * br * 0.04)) * 0.75, bead);
    albedo = mix(albedo, albedo * vec3(1.06, 1.1, 1.0), bead);
    rough = mix(rough, 0.02, bead);
    clear = mix(clear, 0.6, bead);
    ccRough = mix(ccRough, 0.01, bead);
    cavity = mix(1.0, 0.85, wallK);
  }
  float halo = (1.0 - smoothstep(memW, memW + 0.00035 + px, segD)) * (1.0 - step(segD, memW * 0.4));
  albedo = mix(albedo, mix(albedo, oFleshWall.rgb, 0.6), halo * 0.4);
  clear = mix(clear, 0.55, halo);
  ccRough = mix(ccRough, 0.015, halo);
  float segFlesh = smoothstep(memW * 0.4, memW, segD);
  float memCore = 1.0 - smoothstep(0.0, 0.003, dC);
  float thick = max(fill, memCore * 0.6);
  vec3 memCol = mix(vec3(0.93, 0.9, 0.74), albedo, (1.0 - thick) * 0.35);
  float memK = (1.0 - segFlesh) * mix(memCov * 0.8, 1.0, thick);
  albedo = mix(albedo, memCol, memK);
  rough = mix(rough, mix(0.18, 0.45, thick), memK);
  clear = mix(clear, 0.6 * (1.0 - thick), memK);
  gN *= 1.0 - memK;
  float coreK = 1.0 - smoothstep(-px, px * 1.5, dC);
  vec4 fib = vec4(0.5, 0.0, 0.0, 0.0), pore = vec4(0.5, 0.0, 0.0, 0.0);
  if (coreK > 0.0 || depth < peel + 0.001) {
    fib = noiseD(vec3(psi * 70.0, p.y * 2600.0, rho * 1200.0) + oNoise.yxz);
    pore = noiseD(p * 5200.0 + oNoise.xzy);
  }
  if (coreK > 0.0) {
    float hollow = oExtra.w * coreBase;
    float vasc = 1.0 - smoothstep(0.0004, 0.0009 + px, rho);
    float holes = smoothstep(0.76, 0.86, pore.x) * (1.0 - smoothstep(0.3, 0.8, px * 5200.0));
    vec3 coreCol = vec3(0.95, 0.925, 0.79) * (0.84 + 0.22 * fib.x);
    coreCol = mix(coreCol, vec3(0.8, 0.62, 0.25), holes * 0.45);
    coreCol = mix(coreCol, vec3(0.92, 0.8, 0.4), vasc * 0.6);
    float tuftN = smoothstep(0.45, 0.8, fib.x);
    float cr = clamp(rho / max(coreR, 1e-4), 0.0, 1.0);
    vec3 cg = ePsi * fib.y * 0.18 + pore.yzw * 0.006 + rhoHat * (-2.0 * 0.0007 * cr / max(coreR, 1e-4));
    float isHollow = 1.0 - smoothstep(hollow * 0.9, hollow * 1.1 + px, rho);
    coreCol = mix(coreCol, coreCol * vec3(0.75, 0.66, 0.48), isHollow);
    albedo = mix(albedo, coreCol, coreK);
    rough = mix(rough, mix(0.65, 0.45, tuftN), coreK);
    clear = mix(clear, 0.1, coreK);
    gN = mix(gN, cg, coreK);
    cavity = mix(cavity, mix(1.0, 0.7, holes) * mix(1.0, 0.5, isHollow), coreK);
  }
  for (int i = 0; i < 6; i++) {
    vec4 sd = oSeeds[i];
    if (sd.w <= 0.0) continue;
    vec3 o = p - sd.xyz;
    float t = clamp(o.y / sd.w + 0.5, 0.0, 1.0);
    vec2 rad = vec2(0.32, 0.22) * sd.w * (sqrt(t) * (1.0 - 0.45 * t * t)) + 0.0002;
    vec2 loc = vec2(dot(o, rhoHat), dot(o, ePsi)) / rad;
    float e = length(loc);
    float inSeed = (1.0 - smoothstep(0.9, 1.0, e)) * step(-0.5, o.y / sd.w) * step(o.y / sd.w, 0.5);
    if (inSeed > 0.0) {
      vec3 kernel = mix(vec3(0.8, 0.84, 0.6), vec3(0.68, 0.76, 0.42), vnoise(o * 3000.0) * 0.6);
      vec3 sc = mix(kernel, vec3(0.72, 0.62, 0.44), smoothstep(0.62, 0.72, e));
      sc = mix(sc, vec3(0.82, 0.74, 0.56), smoothstep(0.74, 0.86, e));
      sc = mix(sc, vec3(0.694, 0.584, 0.392), smoothstep(0.7, 1.0, t) * 0.75);
      sc *= 1.0 - 0.25 * smoothstep(0.85, 0.98, e);
      sc = mix(sc, oFleshDeep.rgb * 0.5, smoothstep(0.93, 1.0, e) * 0.7);
      albedo = mix(albedo, sc, inSeed);
      rough = mix(rough, 0.25, inSeed);
      clear = mix(clear, 0.7, inSeed);
      gN = mix(gN, (loc.x * rhoHat + loc.y * ePsi) * 0.25 * smoothstep(0.5, 1.0, e), inSeed);
      profile = mix(profile, 2.0, inSeed);
    }
  }
  if (oExtra.z > 0.0 && p.y < -oShape.y * 0.4) {
    float fs = oExtra.z / 0.1;
    vec3 fc = vec3(0.0, -oShape.y + peel + 0.0055 * fs, 0.0);
    vec3 fq = (p - fc) / (vec3(0.0085, 0.0065, 0.0085) * fs);
    float fe = length(fq) * (0.94 + 0.12 * vnoise(fq * 4.0 + oNoise.xyz));
    if (fe < 1.2) {
      float fa = atan(fq.z, fq.x + 1e-6) * 7.0 / 6.2831853 + oRind.w;
      float fedge = abs(fract(fa) - 0.5) * 2.0;
      float frad = length(fq.xz);
      vec3 fflesh = mix(oFlesh.rgb, oFleshWall.rgb, 0.25) * (0.88 + 0.24 * vnoise(fq * vec3(9.0, 3.0, 9.0) + 5.0));
      float fsep = 1.0 - smoothstep(0.05, 0.12, (1.0 - fedge) * frad * 3.14);
      float fwrap = smoothstep(0.8, 0.9, fe);
      float fcore = 1.0 - smoothstep(0.08, 0.16, frad);
      vec3 fcol = mix(fflesh, vec3(0.93, 0.9, 0.74), max(max(fsep, fwrap), fcore));
      float fcav = smoothstep(1.0, 1.04, fe) * (1.0 - smoothstep(1.06, 1.12, fe));
      fcol = mix(fcol, oFleshDeep.rgb * 0.55, fcav * 0.6);
      float fk = 1.0 - smoothstep(1.14, 1.2, fe);
      albedo = mix(albedo, fcol, fk);
      gN *= 1.0 - fk;
      rough = mix(rough, mix(0.1, 0.5, max(fsep, fwrap)), fk);
      cavity *= 1.0 - 0.6 * fcav * fk;
    }
  }
  float pithK = 1.0 - smoothstep(-px * 0.6, px * 0.6, dD);
  float flav = 0.0, glandK = 0.0;
  if (depth < peel + gap + 0.001) {
    vec4 pebS = noiseD(d * R * 260.0 + oNoise.yzx);
    vec3 sq = d * R * oGland.x + oNoise.xyz + pebS.yzw * 0.3;
    Gland gl = glandCells(sq, d);
    float gscale = 1.0 / oGland.x;
    float gfw = px * oGland.x;
    float gdet = 1.0 - smoothstep(0.35, 0.9, gfw);
    float tdist = gl.t1 * gscale;
    float tScale = tf / 0.0013;
    float gRad = (0.18 + 0.3 * gl.id.y * gl.id.y) * 0.001 * tScale;
    float gDepth = tf * (0.3 + 0.5 * gl.id.x);
    float gRadial = gRad * 1.4;
    float ge = length(vec2(tdist / gRad, (depth - gDepth) / gRadial));
    glandK = (1.0 - smoothstep(0.85, 1.0 + px / gRad, ge)) * gdet * step(0.00012, depth);
    float wrap = gRad * 2.1;
    float lobe = gDepth + (gRadial + 0.00025 * tScale) * sqrt(max(1.0 - tdist * tdist / (wrap * wrap), 0.0));
    float base = tf * (0.8 + 0.14 * vnoise(d * R * 2200.0 + oNoise.zxy));
    float bnoise = (vnoise(d * R * 9000.0 + oNoise.zxy) - 0.5) * 0.0001;
    float boundary = mix(base, max(base, lobe), gdet) + bnoise;
    float toothZone = smoothstep(base - 0.00005, base + 0.00015, depth);
    flav = 1.0 - smoothstep(boundary - px * 0.6, boundary + px * 0.6, depth);
    float outerLine = 1.0 - smoothstep(0.00022, 0.00035 + px * 0.5, depth);
    vec3 flavBody = min(oRind.rgb * vec3(1.12, 1.4, 1.6), vec3(1.0));
    vec3 flavCol = mix(flavBody, oRind.rgb * vec3(1.15, 1.05, 1.0), outerLine);
    flavCol *= 0.95 + 0.1 * vnoise(p * 6000.0);
    flavCol = mix(flavCol, vec3(0.95, 0.56, 0.08), toothZone * 0.55);
    vec3 glandCol = mix(vec3(0.973, 0.68, 0.04), vec3(0.9, 0.5, 0.03), smoothstep(0.6, 1.0, ge));
    flavCol = mix(flavCol, glandCol, glandK * (0.35 + 0.35 * gl.id.z));
    float yZone = 1.0 - smoothstep(boundary, boundary + 0.0006 + 0.0003 * gl.id.y, depth);
    vec3 pithOuter = vec3(0.913, 0.863, 0.22) * mix(vec3(1.0), oPith.rgb / vec3(0.947, 0.88, 0.546), 0.5);
    vec3 pithCol = mix(oPith.rgb, vec3(0.965, 0.896, 0.624) * oPith.rgb / vec3(0.947, 0.88, 0.546), smoothstep(peel - 0.0012, peel, depth));
    float fibre = fib.x * 0.6 + pore.x * 0.4;
    pithCol *= 0.92 + 0.1 * fibre;
    float pores2 = smoothstep(0.72, 0.85, pore.x) * (1.0 - smoothstep(0.3, 0.8, px * 5200.0));
    pithCol = mix(pithCol, pithCol * vec3(0.95, 0.9, 0.7), pores2 * 0.5);
    pithCol = mix(pithCol, pithOuter, yZone * 0.85);
    if (oFlesh2.w > 0.0) {
      float fleck = smoothstep(0.7, 0.85, vnoise(p * 2200.0 + 3.0)) * (1.0 - smoothstep(0.0, 0.0012, peel - depth));
      pithCol = mix(pithCol, oBlush.rgb, fleck * oFlesh2.w * 0.8);
    }
    float dorsal = (1.0 - smoothstep(0.00004, 0.0001 + px * 0.5, abs(depth - peel + 0.00006))) * (1.0 - memK);
    pithCol = mix(pithCol, vec3(0.98, 0.93, 0.7), dorsal * 0.7);
    vec3 pg = fib.yzw * vec3(0.0004, 0.00001, 0.0002) * 0.6 + pore.yzw * 0.000014;
    float air = smoothstep(peel - px, peel + px, depth) * step(0.0001, gap);
    pithCol = mix(pithCol, pithCol * vec3(0.78, 0.68, 0.48), air);
    vec3 peelCol = mix(pithCol, flavCol, flav);
    albedo = mix(albedo, peelCol, pithK);
    rough = mix(rough, mix(mix(0.62, 0.45, smoothstep(peel - 0.0012, peel, depth)), mix(0.38, 0.1, glandK), flav), pithK);
    clear = mix(clear, mix(0.2, 0.7 * glandK, flav), pithK);
    ccRough = mix(ccRough, 0.08, pithK);
    gN = mix(gN, pg * (1.0 - flav), pithK);
    cavity = mix(cavity, (1.0 - 0.25 * glandK * flav) * (1.0 - 0.5 * air), pithK);
  }
  float whiteK = max(pithK * (1.0 - flav), max(coreK, memK * thick));
  profile = whiteK > 0.5 ? 2.0 : profile;
  profile = flav * pithK > 0.5 ? 1.0 : profile;
  width = profile > 2.5 ? 0.9 : profile > 1.5 ? 0.6 : 0.3;
  vec3 sssColor = mix(oFlesh.rgb * 0.5, oPith.rgb * 0.32, whiteK);
  vec3 trans = mix(oFlesh.rgb * vec3(0.66, 0.25, 0.02), oPith.rgb * vec3(0.22, 0.15, 0.04), whiteK);
  trans = mix(trans, oRind.rgb * 0.1, flav * pithK);
  Surface s = defaultSurface(vec3(0, 1, 0));
  vec3 Nrest = perturb(Nf, gN, 1.0);
  s.N = normalize(si.restToWorld * Nrest);
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = rough;
  s.f0 = vec3(0.022 * (1.0 - 0.75 * clamp(clear / 0.55, 0.0, 1.0)));
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

export const ORANGE_MATERIAL = ORANGE_UBO + ORANGE_SHAPE + ORANGE_RIND + ORANGE_INTERIOR + `
Surface materialSurface(SurfaceInput si) {
  if (si.cap > 0.5) return orangeInterior(si);
  return orangeRind(si);
}
`;
