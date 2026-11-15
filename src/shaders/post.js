import { FRAME_UBO, NOISE } from './common.js';

const DEPTH = `
uniform sampler2D uDepth;
uniform vec2 uNearFar;
float linearDepth(float d) { float z = d * 2.0 - 1.0; float n = uNearFar.x, f = uNearFar.y; return 2.0 * n * f / (f + n - z * (f - n)); }
float sceneDepth(vec2 uv) { return linearDepth(texture(uDepth, uv).r); }
`;

export const SSAO_FS = FRAME_UBO + NOISE + DEPTH + `
uniform sampler2D uNormal;
uniform mat4 uInvProj;
uniform mat4 uProjM;
uniform float uRadius;
uniform float uSamples;
in vec2 vUv;
out vec4 outColor;
vec3 viewPos(vec2 uv) {
  float d = texture(uDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { outColor = vec4(1); return; }
  vec3 P = viewPos(vUv);
  vec3 N = normalize(texture(uNormal, vUv).xyz * 2.0 - 1.0);
  float a = ign(gl_FragCoord.xy + fract(uCamPos.w * 7.0) * 64.0) * 6.2831853;
  vec3 rv = normalize(vec3(cos(a), sin(a), 0.3));
  vec3 T = normalize(rv - N * dot(rv, N)), B = cross(N, T);
  float occ = 0.0;
  int n = int(uSamples);
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    float fi = (float(i) + 0.5) / float(n);
    float phi = float(i) * 2.39996;
    float rr = sqrt(fi);
    vec3 h = vec3(cos(phi) * rr, sin(phi) * rr, sqrt(1.0 - fi));
    float scale = mix(0.15, 1.0, fi * fi);
    vec3 S = P + (T * h.x + B * h.y + N * h.z) * uRadius * scale;
    vec4 c = uProjM * vec4(S, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-4));
    occ += (sz >= S.z + 0.0008 ? 1.0 : 0.0) * range;
  }
  float ao = clamp(1.0 - occ / float(n), 0.0, 1.0);
  outColor = vec4(pow(ao, 2.2), 0.0, 0.0, 1.0);
}`;

export const BLUR_FS = DEPTH + `
uniform sampler2D uSource;
uniform vec2 uDir;
in vec2 vUv;
out vec4 outColor;
void main() {
  float z = sceneDepth(vUv);
  float sum = 0.0, w = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + uDir * float(i);
    float zs = sceneDepth(uv);
    float wt = exp(-float(i * i) / 12.0) * exp(-abs(zs - z) / (0.004 * z));
    sum += texture(uSource, uv).r * wt;
    w += wt;
  }
  outColor = vec4(sum / max(w, 1e-4), 0, 0, 1);
}`;

export const SSS_FS = DEPTH + NOISE + `
uniform sampler2D uColor;
uniform vec2 uDir;
uniform float uProjScale;
uniform float uTaps;
uniform float uSeed;
uniform vec4 uProfiles[4];
in vec2 vUv;
out vec4 outColor;
vec3 profile1D(float x, vec3 d) {
  vec3 n = 0.32 * d, w = d;
  return 0.6 * exp(-x * x / (2.0 * n * n)) / n + 0.4 * exp(-x * x / (2.0 * w * w)) / w;
}
void main() {
  vec4 c = texture(uColor, vUv);
  float prof = c.a * 4.0;
  float id = floor(prof + 0.001);
  if (id < 0.5) { outColor = c; return; }
  vec4 P = uProfiles[int(id)];
  vec3 rad = P.rgb * mix(0.55, 1.25, fract(prof + 0.001));
  float z = sceneDepth(vUv);
  float pxPerM = uProjScale / z;
  float maxR = max(rad.r, max(rad.g, rad.b)) * 2.2;
  if (maxR * pxPerM < 1.0) { outColor = c; return; }
  int n = int(uTaps);
  float j = ign(gl_FragCoord.xy + uSeed * 37.0);
  float t0 = 0.5 / float(n);
  vec3 wc = profile1D(0.0, rad) * 2.0 * t0 * t0 * maxR;
  vec3 sum = c.rgb * wc, wsum = wc;
  for (int i = 0; i < 24; i++) {
    if (i >= n) break;
    float t = (float(i) + 0.5 + (j - 0.5) * 0.9) / float(n);
    float x = t * t * maxR;
    vec3 wt = profile1D(x, rad) * 2.0 * t * maxR / float(n);
    for (int side = -1; side <= 1; side += 2) {
      vec2 uv = vUv + uDir * float(side) * x * pxPerM;
      vec4 s = texture(uColor, uv);
      float zs = sceneDepth(uv);
      float sid = floor(s.a * 4.0 + 0.001);
      float ok = step(0.5, sid) * (1.0 - smoothstep(x * 1.2 + 0.0006, x * 2.0 + 0.0012, abs(zs - z)));
      float k = ok * (abs(sid - id) < 0.5 ? 1.0 : 0.5);
      sum += mix(c.rgb, s.rgb, k) * wt;
      wsum += wt;
    }
  }
  outColor = vec4(mix(c.rgb, sum / wsum, P.w), c.a);
}`;

export const COMBINE_FS = FRAME_UBO + `
uniform sampler2D uDiffuse;
uniform sampler2D uSpecular;
uniform sampler2D uAlbedo;
uniform sampler2D uDepth;
uniform samplerCube uEnvSource;
uniform float uDecode;
in vec2 vUv;
out vec4 outColor;
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) {
    vec4 p = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(p.xyz / p.w - uCamPos.xyz);
    outColor = vec4(textureLod(uEnvSource, dir, uBackground.x).rgb * uBackground.y / uEnvParams.z, 1.0);
    return;
  }
  outColor = vec4((texture(uDiffuse, vUv).rgb * texture(uAlbedo, vUv).rgb + texture(uSpecular, vUv).rgb) * uDecode, 1.0);
}`;

export const TAA_FS = FRAME_UBO + DEPTH + `
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uVelocity;
uniform float uReset;
in vec2 vUv;
out vec4 outColor;
vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 tm(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 itm(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
vec4 sampleHistory(vec2 uv) {
  vec2 size = uResolution.xy;
  vec2 pos = uv * size, c = floor(pos - 0.5) + 0.5, f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, tc12 = (c + w2 / w12) / size, tc0 = (c - 1.0) / size, tc3 = (c + 2.0) / size;
  vec3 r = texture(uHistory, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
    + texture(uHistory, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
    + texture(uHistory, tc12).rgb * (w12.x * w12.y)
    + texture(uHistory, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
    + texture(uHistory, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return vec4(max(r / wsum, vec3(0)), texture(uHistory, uv).a);
}
void main() {
  vec2 texel = uResolution.zw;
  vec3 cur = tm(texture(uCurrent, vUv).rgb);
  vec3 m1 = vec3(0), m2 = vec3(0);
  float closest = 1.0, farthest = 0.0;
  vec2 closestUv = vUv;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 uv = vUv + vec2(x, y) * texel;
    vec3 s = toYCoCg(tm(texture(uCurrent, uv).rgb));
    m1 += s; m2 += s * s;
    float d = texture(uDepth, uv).r;
    if (d < closest) { closest = d; closestUv = uv; }
    farthest = max(farthest, d);
  }
  vec3 mean = m1 / 9.0, sd = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  float zNow = linearDepth(texture(uDepth, vUv).r);
  vec2 vel;
  if (closest >= 1.0) {
    vec4 p = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 prev = uPrevViewProjNJ * vec4(p.xyz / p.w, 1.0);
    vec4 now = uViewProjNJ * vec4(p.xyz / p.w, 1.0);
    vel = (now.xy / now.w - prev.xy / prev.w) * 0.5;
  } else vel = texture(uVelocity, closestUv).xy;
  vec2 prevUv = vUv - vel;
  if (uReset > 0.5 || any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) { outColor = vec4(itm(cur), zNow); return; }
  vec4 h = sampleHistory(prevUv);
  vec3 hist = toYCoCg(tm(h.rgb));
  float speed = length(vel * uResolution.xy);
  float zPrev = h.a;
  float zLo = linearDepth(closest), zHi = linearDepth(farthest);
  float depthJump = max(zLo - zPrev, zPrev - zHi) / max(zNow, 1e-3);
  float disoccluded = smoothstep(0.03, 0.1, depthJump - speed * 0.004);
  float gamma = mix(1.25, 0.75, clamp(speed / 4.0, 0.0, 1.0));
  vec3 lo = mean - gamma * sd, hi = mean + gamma * sd;
  lo = min(lo, toYCoCg(cur)); hi = max(hi, toYCoCg(cur));
  vec3 center = 0.5 * (hi + lo), extents = 0.5 * (hi - lo) + 1e-4;
  vec3 off = hist - center;
  vec3 ts = abs(off / extents);
  float t = max(ts.x, max(ts.y, ts.z));
  if (t > 1.0) hist = center + off / t;
  float alpha = mix(0.07, 0.3, clamp(speed / 3.0, 0.0, 1.0));
  alpha = mix(alpha, 0.85, disoccluded);
  vec3 res = mix(fromYCoCg(hist), cur, alpha);
  outColor = vec4(itm(res), zNow);
}`;

export const FOCUS_FS = DEPTH + `
uniform sampler2D uPrevFocus;
uniform vec2 uFocusUv;
uniform vec2 uTexel;
uniform float uBlend;
uniform float uFallback;
in vec2 vUv;
out vec4 outColor;
void main() {
  float zmin = 1e9;
  float zs[25];
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    float d = texture(uDepth, uFocusUv + vec2(x, y) * uTexel * 6.0).r;
    float z = d >= 1.0 ? 1e9 : linearDepth(d);
    zs[(y + 2) * 5 + x + 2] = z;
    zmin = min(zmin, z);
  }
  float sum = 0.0, n = 0.0;
  for (int i = 0; i < 25; i++) if (zs[i] < zmin * 1.12) { sum += zs[i]; n += 1.0; }
  float z = n > 0.0 ? sum / n : uFallback;
  float prev = texture(uPrevFocus, vec2(0.5)).r;
  outColor = vec4(prev > 0.0 ? mix(prev, z, uBlend) : z, 0.0, 0.0, 1.0);
}`;

export const DOF_FS = DEPTH + FRAME_UBO + NOISE + `
uniform sampler2D uColor;
uniform sampler2D uFocus;
uniform vec4 uLens;
uniform float uMaxRadius;
uniform float uTaps;
in vec2 vUv;
out vec4 outColor;
float cocPx(float z, float zf) {
  float f = uLens.x, A = uLens.y;
  float c = A * f * abs(z - zf) / max(z * (zf - f), 1e-6);
  return min(c / uLens.z * uResolution.y, uMaxRadius);
}
void main() {
  float zf = texture(uFocus, vec2(0.5)).r;
  float z = sceneDepth(vUv);
  float c0 = cocPx(z, zf);
  vec4 centre = texture(uColor, vUv);
  float R = uMaxRadius;
  int n = int(uTaps);
  float cw = 1.0 / (3.14159 * max(c0 * c0, 0.3183));
  vec3 sum = centre.rgb * cw;
  float w = cw;
  float rot = ign(gl_FragCoord.xy + uCamPos.w * 61.0) * 6.2831853;
  float area = R * R / float(n);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    float fi = (float(i) + 0.5) / float(n);
    float r = sqrt(fi) * R;
    float a = float(i) * 2.39996323 + rot;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uResolution.zw;
    float zs = sceneDepth(uv);
    float cs = cocPx(zs, zf);
    float reach = zs < z - 0.003 ? cs : min(cs, c0);
    float wt = clamp(reach - r + 1.0, 0.0, 1.0) * area / max(cs * cs, 1.0) / 3.14159;
    sum += texture(uColor, uv).rgb * wt;
    w += wt;
  }
  outColor = vec4(sum / max(w, 1e-6), centre.a);
}`;

export const DOWN_FS = `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;
vec3 karis(vec3 c) {
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0);
  k = k * k / (k + 0.5 * uThreshold + 1e-4);
  return c * k / max(l, 1e-4) / (1.0 + k);
}
void main() {
  vec3 a = texture(uSource, vUv + uTexel * vec2(-1, -1)).rgb, b = texture(uSource, vUv + uTexel * vec2(1, -1)).rgb;
  vec3 c = texture(uSource, vUv + uTexel * vec2(-1, 1)).rgb, d = texture(uSource, vUv + uTexel * vec2(1, 1)).rgb;
  vec3 e = texture(uSource, vUv).rgb;
  vec3 r = uFirst > 0.5 ? (karis(a) + karis(b) + karis(c) + karis(d)) * 0.125 + karis(e) * 0.5 : (a + b + c + d) * 0.125 + e * 0.5;
  outColor = vec4(r, 1.0);
}`;

export const UP_FS = `
uniform sampler2D uSource;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 s = vec3(0);
  s += texture(uSource, vUv + uTexel * vec2(-1, -1)).rgb + texture(uSource, vUv + uTexel * vec2(1, -1)).rgb;
  s += texture(uSource, vUv + uTexel * vec2(-1, 1)).rgb + texture(uSource, vUv + uTexel * vec2(1, 1)).rgb;
  s += 2.0 * (texture(uSource, vUv + uTexel * vec2(0, -1)).rgb + texture(uSource, vUv + uTexel * vec2(0, 1)).rgb + texture(uSource, vUv + uTexel * vec2(-1, 0)).rgb + texture(uSource, vUv + uTexel * vec2(1, 0)).rgb);
  s += 4.0 * texture(uSource, vUv).rgb;
  outColor = vec4(s / 16.0, 1.0);
}`;

export const TONEMAP_FS = FRAME_UBO + NOISE + `
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uSharpen;
uniform float uMode;
uniform float uVignette;
uniform float uGrain;
uniform vec2 uSourceTexel;
uniform float uWhite;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uBalance;
uniform float uPathToWhite;
uniform float uToe;
uniform float uChannel;
uniform sampler2D uAuto;
uniform float uAutoDecode;
in vec2 vUv;
out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 photo(vec3 c) {
  c = max(c, vec3(0.0));
  float m = max(c.r, max(c.g, c.b));
  if (m <= 1e-6) return vec3(0.0);
  float mc = 0.18 * pow(m / 0.18, uContrast);
  mc = mc * mc / (mc + uToe);
  c *= mc / m; m = mc;
  float W = uWhite, s = 2.0 - W;
  float fm = m <= s ? m : m >= W ? 1.0 : s + (1.0 - s) * (1.0 - pow(1.0 - (m - s) / (W - s), 2.0));
  vec3 o = c * (fm / m);
  vec3 k = clamp((c - s) / (W - s), 0.0, 1.0);
  vec3 pc = mix(c, s + (1.0 - s) * (1.0 - (1.0 - k) * (1.0 - k)), step(vec3(s), c));
  o = mix(o, min(pc, vec3(1.0)), uChannel);
  float over = clamp((m - W) / (W * uPathToWhite), 0.0, 1.0);
  float ow = over * over * (3.0 - 2.0 * over);
  o = mix(o, vec3(1.0), vec3(ow, ow, ow * ow));
  float l = dot(o, LUMA);
  o = l + (o - l) * uSaturation;
  return clamp(o, 0.0, 1.0);
}
vec3 agx(vec3 c) {
  const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  c = inset * max(c, vec3(1e-10));
  c = clamp((log2(c) + 12.47393) / 16.5, 0.0, 1.0);
  vec3 x2 = c * c, x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  c = outset * c;
  return pow(max(c, vec3(0)), vec3(2.2));
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture(uColor, vUv).rgb;
  if (uSharpen > 0.0) {
    vec3 n = texture(uColor, vUv + vec2(uSourceTexel.x, 0)).rgb + texture(uColor, vUv - vec2(uSourceTexel.x, 0)).rgb
      + texture(uColor, vUv + vec2(0, uSourceTexel.y)).rgb + texture(uColor, vUv - vec2(0, uSourceTexel.y)).rgb;
    vec3 sharp = c + (c - n * 0.25) * uSharpen;
    vec3 lo = min(c, n * 0.25) * 0.8, hi = max(c, n * 0.25) * 1.2;
    c = clamp(mix(c, sharp, 1.0 / (1.0 + dot(c, vec3(0.3)))), lo, hi);
  }
  c += texture(uBloom, vUv).rgb * uBloomStrength;
  c *= uExposure * uBalance * texture(uAuto, vec2(0.5)).r * uAutoDecode;
  c = uMode > 0.5 ? agx(c) : photo(c);
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  c *= mix(1.0, smoothstep(1.25, 0.15, length(q)), uVignette);
  c = srgb(clamp(c, 0.0, 1.0));
  float n = hash12(gl_FragCoord.xy + fract(uCamPos.w * 13.0) * 517.0) + hash12(gl_FragCoord.yx * 1.31 + fract(uCamPos.w * 7.0) * 211.0) - 1.0;
  float lum = dot(c, LUMA);
  c += n * (uGrain * 4.0 * lum * (1.0 - lum) + 0.75 / 255.0);
  outColor = vec4(c, 1.0);
}`;

export const METER_FS = `
uniform sampler2D uColor;
uniform sampler2D uAlbedo;
uniform float uExposure;
uniform vec2 uGrid;
in vec2 vUv;
out vec4 outColor;
void main() {
  float sw = 0.0, sl = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + (vec2(float(i), float(j)) - 1.5) * 0.25 * uGrid;
    vec3 a = texture(uAlbedo, uv).rgb;
    vec3 c = texture(uColor, uv).rgb * uExposure;
    float w = smoothstep(0.3, 0.6, max(a.r, max(a.g, a.b)) - min(a.r, min(a.g, a.b))) * (1.0 - 0.6 * length(uv - 0.5));
    sw += w;
    sl += w * clamp((log2(max(max(c.r, max(c.g, c.b)), 1e-4)) + 8.0) / 12.0, 0.0, 1.0);
  }
  outColor = vec4(sl / 16.0, sw / 16.0, 0.0, 1.0);
}`;

export const ADAPT_FS = `
uniform sampler2D uMeter;
uniform sampler2D uPrev;
uniform float uLevel;
uniform vec4 uAutoParams;
uniform float uBlend;
uniform float uDecode;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 m = textureLod(uMeter, vec2(0.5), uLevel).rg;
  float f = 1.0;
  if (m.g > uAutoParams.w) f = clamp(exp2(uAutoParams.x - (m.r / m.g * 12.0 - 8.0)), uAutoParams.y, uAutoParams.z);
  float prev = texture(uPrev, vec2(0.5)).r * uDecode;
  outColor = vec4(mix(prev, f, uBlend) / uDecode, 0.0, 0.0, 1.0);
}`;

export const COPY_FS = `
uniform sampler2D uSource;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uSource, vUv); }`;
