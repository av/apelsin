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
`;

export const ORANGE_RIND = `
Surface orangeRind(SurfaceInput si) {
  vec3 p = si.rest;
  vec3 d = normalize(p);
  vec3 Nr = orangeShapeNormal(d);
  float a = oShape.x;
  float th = acos(clamp(d.y, -1.0, 1.0));
  float psi = atan(d.z, d.x + 1e-7);
  vec3 ePsi = normalize(vec3(-d.z, 0.0, d.x) + 1e-6);
  float scale = oGland.x;
  float fw = si.pixel * scale;
  float detail = 1.0 - smoothstep(0.3, 0.85, fw);
  vec3 q = p * scale + oNoise.xyz;
  Cell c = voronoiShell(q, Nr, 0.9);
  float rPit = 0.42 + 0.12 * c.id.z;
  float x2 = min(c.f1 * c.f1 / (rPit * rPit), 1.0);
  float pit = (1.0 - x2) * (1.0 - x2);
  float rim = smoothstep(0.6, 0.9, x2) * (1.0 - smoothstep(1.0, 1.6, c.f1 * c.f1 / (rPit * rPit)));
  vec3 g = -oGland.y * 0.075 * (4.0 / (rPit * rPit)) * (1.0 - x2) * c.toCenter;
  Cell c2 = voronoiShell(q * 0.3 + 7.1, Nr, 0.9);
  g += -c2.toCenter * exp(-c2.f1 * c2.f1 / 0.12) * 0.2;
  g *= detail;
  float m1 = fbm3(p * 70.0 + oNoise.yzx), m2 = fbm3(p * 260.0 + oNoise.zxy);
  vec3 albedo = oRind.rgb * (1.0 + oGland.z * (m1 - 0.5) * 1.6 + 0.08 * (m2 - 0.5));
  float stemT = 1.0 - smoothstep(0.12, 0.75, th);
  albedo = mix(albedo, oRindStem.rgb, stemT * stemT * 0.8);
  float blushMask = smoothstep(0.45, 0.75, fbm3(p * 35.0 + oNoise.xzy + 3.0) + 0.2 * d.x);
  albedo = mix(albedo, oBlush.rgb, blushMask * oBlush.w);
  albedo *= mix(1.0, 0.86, pit * detail);
  float rough = mix(0.48, 0.36, rim * detail);
  float scuff = smoothstep(0.62, 0.7, fbm3(p * 420.0 + oNoise.zyx));
  rough = mix(rough, 0.6, scuff * 0.7);
  albedo = mix(albedo, albedo * vec3(1.05, 1.0, 0.9) + 0.02, scuff * 0.4);
  float clear = mix(0.7, 0.2, scuff);
  float rc = (oShape2.z / a) * (0.8 + 0.2 * cos(5.0 * psi));
  float calyx = 1.0 - smoothstep(rc * 0.9, rc * 1.05, th);
  float wrinkle = smoothstep(rc * 0.9, rc * 1.3, th) * (1.0 - smoothstep(rc * 1.6, rc * 3.2, th));
  g += ePsi * sin(psi * 34.0 + vnoise(p * 900.0) * 4.0) * wrinkle * 0.35 * detail;
  float lobes = cos(5.0 * psi);
  vec3 calyxCol = mix(vec3(0.16, 0.15, 0.045), vec3(0.24, 0.17, 0.06), smoothstep(-0.2, 0.8, lobes) * (th / rc));
  calyxCol *= 0.8 + 0.4 * vnoise(p * 2500.0);
  float stub = 1.0 - smoothstep(0.018, 0.03, th);
  calyxCol = mix(calyxCol, vec3(0.09, 0.07, 0.03), stub);
  g += ePsi * sin(psi * 5.0) * calyx * 0.5;
  albedo = mix(albedo, calyxCol, calyx);
  rough = mix(rough, 0.72, calyx);
  clear *= 1.0 - calyx;
  float tn = 3.14159265 - th;
  float scar = 1.0 - smoothstep(0.02, 0.045, tn);
  albedo = mix(albedo, vec3(0.32, 0.17, 0.04), scar * 0.85);
  rough = mix(rough, 0.7, scar);
  Surface s = defaultSurface(vec3(0, 1, 0));
  vec3 Nrest = perturb(Nr, g, 1.0);
  s.N = normalize(si.restToWorld * Nrest);
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = rough;
  s.clearcoat = clear;
  s.clearcoatRoughness = mix(0.15, 0.3, scuff);
  s.cavity = mix(1.0, 0.7, pit * detail);
  s.sssProfile = 1.0;
  s.sssWidth = 0.5;
  s.sssColor = oRind.rgb * vec3(0.35, 0.18, 0.05);
  s.transmission = oRind.rgb * vec3(0.05, 0.02, 0.0);
  return s;
}
`;

export const ORANGE_INTERIOR = `
Surface orangeInterior(SurfaceInput si) {
  vec3 p = si.rest;
  float r = length(p);
  vec3 d = p / max(r, 1e-6);
  float R = orangeShapeRadius(d);
  float depth = R - r;
  float tf = oLayers.x, tp = oLayers.y, peel = tf + tp;
  float rho = length(p.xz);
  vec3 rhoHat = vec3(p.x, 0.0, p.z) / max(rho, 1e-6);
  vec3 ePsi = vec3(-rhoHat.z, 0.0, rhoHat.x);
  float psi = atan(p.z, p.x + 1e-7);
  float px = max(si.pixel, 1e-5);
  vec3 gN = vec3(0);
  float wave = oSeg.y * sin(p.y * 95.0 + rho * 160.0 + oNoise.x) + oSeg.y * (vnoise(p * 140.0 + oNoise.xyz) - 0.5);
  int seg; float rel, segW, edge;
  orangeSegment(psi + wave, seg, rel, segW, edge);
  float fseg = float(seg);
  float yN = p.y / oShape.y;
  float coreBase = oLayers.z * (0.75 + 0.55 * yN * yN);
  float torn = fbm3(vec3(psi * 4.0, p.y * 300.0, 0.0) + oNoise.xyz);
  float coreR = coreBase * (0.8 + 0.5 * torn);
  float memT = oLayers.w * (1.0 + 3.0 * exp(-max(rho - coreR, 0.0) / 0.0035)) + px * 0.4;
  float memDist = edge * rho;
  float tilt = 0.26;
  float sAlong = rho * cos(tilt) + p.y * sin(tilt);
  float wAcross = -rho * sin(tilt) + p.y * cos(tilt);
  float R0 = oShape.x * 0.7;
  vec3 q = vec3(sAlong / oSeg.w, rel * R0 / oSeg.z, wAcross / (oSeg.z * 1.15)) + vec3(fseg * 13.7, fseg * 3.1, fseg * 5.3);
  float vfw = px / oSeg.z;
  float vdetail = 1.0 - smoothstep(0.3, 0.75, vfw);
  Cell v = voronoi3(q, 0.8);
  float wall = (1.0 - smoothstep(0.0, 0.07 + vfw * 0.6, v.f2 - v.f1)) * vdetail;
  float dome = clamp(1.0 - v.f1 * v.f1 / 0.5, 0.0, 1.0);
  vec3 gq = v.toCenter * (2.0 / 0.5) * step(0.0, 1.0 - v.f1 * v.f1 / 0.5);
  vec3 gAlong = (cos(tilt) * rhoHat + sin(tilt) * vec3(0, 1, 0)) / oSeg.w;
  vec3 gTan = ePsi * R0 / (oSeg.z * max(rho, 1e-4));
  vec3 gAcross = (-sin(tilt) * rhoHat + cos(tilt) * vec3(0, 1, 0)) / (oSeg.z * 1.15);
  gN += (gq.x * gAlong + gq.y * gTan + gq.z * gAcross) * 0.00045 * vdetail;
  float inner = R - peel;
  float radial = clamp((r - coreR) / max(inner - coreR, 1e-4), 0.0, 1.0);
  vec3 flesh = oFlesh.rgb * mix(vec3(1.0, 1.1, 1.15), vec3(1.0, 0.9, 0.6), radial * radial);
  flesh *= 0.92 + 0.16 * v.id.x;
  flesh *= mix(vec3(1.0), vec3(0.97, 1.05, 1.1), v.id.y);
  float septumNear = 1.0 - smoothstep(0.0, 0.003, memDist);
  float streak = fbm3(vec3(sAlong * 400.0, rel * 30.0, wAcross * 500.0) + fseg * 2.7) + 0.35 * septumNear - 0.2 * yN;
  float blood = smoothstep(0.75 - oFlesh2.w * 0.9, 1.0 - oFlesh2.w * 0.9, streak) * step(0.001, oFlesh2.w);
  flesh = mix(flesh, oFlesh2.rgb * (0.85 + 0.3 * v.id.z), blood);
  vec3 wallCol = mix(flesh, oPith.rgb * vec3(1.0, 0.85, 0.35), 0.5) * 1.05;
  vec3 albedo = mix(flesh, wallCol, wall * 0.5);
  float rough = mix(0.07, 0.2, wall);
  float clear = 0.3 + 0.4 * smoothstep(0.3, 0.6, fbm3(p * 260.0 + oNoise.zyx));
  float ccRough = 0.04;
  Cell b = voronoi3(p * 560.0 + oNoise.yxz, 0.9);
  float bead = step(0.84, b.id.x) * (1.0 - smoothstep(0.18, 0.3, b.f1));
  gN += -b.toCenter * bead * 1.8 * vdetail;
  ccRough = mix(ccRough, 0.015, bead);
  clear = max(clear, bead);
  float profile = 3.0, width = 0.9;
  vec3 sssColor = oFlesh.rgb * 0.5;
  vec3 trans = oFlesh.rgb * vec3(0.66, 0.25, 0.02);
  float dorsal = 1.0 - smoothstep(0.00004, 0.00012 + px * 0.5, abs(depth - peel - 0.00008));
  float mem = 1.0 - smoothstep(memT * 0.55, memT, memDist);
  vec3 septaCol = oPith.rgb * vec3(0.97, 0.9, 0.78);
  albedo = mix(albedo, septaCol, max(mem * 0.7, dorsal * 0.8));
  rough = mix(rough, 0.2, mem);
  gN *= 1.0 - mem;
  float fibre = vnoise(vec3(psi * 60.0, p.y * 900.0, rho * 1500.0)) * 0.6 + vnoise(p * 5000.0) * 0.4;
  float coreK = 1.0 - smoothstep(coreR - px, coreR + px * 1.5, rho);
  float tuft = smoothstep(0.35, 0.75, vnoise(vec3(psi * 18.0, rho * 2500.0, p.y * 600.0)));
  vec3 coreCol = oPith.rgb * vec3(0.98, 1.02, 1.3) * (0.9 + 0.14 * fibre + 0.06 * tuft);
  albedo = mix(albedo, min(coreCol, vec3(0.97)), coreK);
  rough = mix(rough, 0.6 - 0.2 * tuft, coreK);
  gN = mix(gN, (vec3(fibre, tuft, fibre) - 0.5) * 0.25, coreK);
  for (int i = 0; i < 6; i++) {
    vec4 sd = oSeeds[i];
    if (sd.w <= 0.0) continue;
    vec3 o = p - sd.xyz;
    float t = clamp(o.y / sd.w + 0.5, 0.0, 1.0);
    vec2 rad = vec2(0.28, 0.2) * sd.w * (sqrt(t) * (1.0 - 0.35 * t * t)) + 0.0002;
    vec2 loc = vec2(dot(o, rhoHat), dot(o, ePsi)) / rad;
    float e = length(loc);
    float inSeed = (1.0 - smoothstep(0.9, 1.0, e)) * step(-0.5, o.y / sd.w) * step(o.y / sd.w, 0.5);
    if (inSeed > 0.0) {
      vec3 sc = mix(vec3(0.82, 0.84, 0.66), vec3(0.807, 0.716, 0.527), smoothstep(0.6, 0.8, e));
      sc = mix(sc, vec3(0.694, 0.584, 0.392), smoothstep(0.75, 1.0, t) * 0.7);
      albedo = mix(albedo, sc, inSeed);
      rough = mix(rough, 0.3, inSeed);
      gN *= 1.0 - inSeed;
      profile = mix(profile, 2.0, inSeed);
    }
  }
  vec3 sq = d * (R * oGland.x * 1.6) + oNoise.xyz;
  Cell gl = voronoiShell(sq, d, 0.9);
  float tooth = (1.0 - smoothstep(0.28, 0.42, gl.f1)) * (1.0 - smoothstep(0.6, 1.2, px * oGland.x * 1.6));
  float boundary = tf + tooth * 0.00055 * (0.6 + 0.8 * gl.id.y);
  float pithK = 1.0 - smoothstep(peel - px * 0.6, peel + px * 0.6, depth);
  vec3 pithCol = mix(oPith.rgb * vec3(1.02, 1.02, 1.14), oPith.rgb, smoothstep(peel - 0.0008, tf + 0.0012, depth));
  pithCol = mix(pithCol, oPith.rgb * vec3(0.97, 0.98, 0.4), 1.0 - smoothstep(tf, tf + 0.0007, depth));
  pithCol *= 0.94 + 0.08 * fibre;
  albedo = mix(albedo, pithCol, pithK);
  rough = mix(rough, mix(0.45, 0.65, smoothstep(peel - 0.001, tf, depth)), pithK);
  clear = mix(clear, 0.25, pithK);
  ccRough = mix(ccRough, 0.15, pithK);
  gN = mix(gN, (vec3(fibre) - 0.5) * vec3(0.12, 0.0, 0.12), pithK);
  float flav = 1.0 - smoothstep(boundary - px * 0.6, boundary + px * 0.6, depth);
  Cell og = voronoi3(sq * 1.4 + 9.0, 0.9);
  float gland = (1.0 - smoothstep(0.22, 0.34, og.f1)) * step(0.0002, depth) * (1.0 - smoothstep(0.6, 1.2, px * oGland.x * 2.2));
  vec3 flavCol = mix(oRind.rgb * vec3(1.14, 1.05, 1.0), vec3(0.982, 0.266, 0.02), 1.0 - smoothstep(0.00015, 0.00035, depth));
  flavCol = mix(flavCol, vec3(0.973, 0.665, 0.033), max(gland * 0.85, tooth * smoothstep(tf - 0.0004, tf, depth)));
  albedo = mix(albedo, flavCol, flav);
  rough = mix(rough, mix(0.4, 0.12, gland), flav);
  clear = mix(clear, 0.5 * gland, flav);
  gN *= 1.0 - flav;
  profile = coreK > 0.5 || pithK > 0.5 ? 2.0 : profile;
  profile = flav > 0.5 ? 1.0 : profile;
  width = profile > 2.5 ? 0.9 : profile > 1.5 ? 0.55 : 0.3;
  float whiteK = max(pithK, coreK);
  sssColor = mix(sssColor, oPith.rgb * 0.3, whiteK);
  trans = mix(trans, oPith.rgb * vec3(0.22, 0.15, 0.04), whiteK);
  trans = mix(trans, oRind.rgb * 0.1, flav);
  Surface s = defaultSurface(vec3(0, 1, 0));
  vec3 Nrest = perturb(si.restNormal, gN, 1.0);
  s.N = normalize(si.restToWorld * Nrest);
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = rough;
  s.f0 = vec3(0.022);
  s.clearcoat = clear;
  s.clearcoatRoughness = ccRough;
  s.sssColor = sssColor;
  s.sssProfile = profile;
  s.sssWidth = width;
  s.transmission = trans;
  s.cavity = mix(1.0, 0.82, wall * (1.0 - whiteK));
  return s;
}
`;

export const ORANGE_MATERIAL = ORANGE_UBO + ORANGE_SHAPE + ORANGE_RIND + ORANGE_INTERIOR + `
Surface materialSurface(SurfaceInput si) {
  if (si.cap > 0.5) return orangeInterior(si);
  return orangeRind(si);
}
`;
