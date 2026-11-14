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
  outColor = vec4(pow(ao, 1.4), 0.0, 0.0, 1.0);
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

export const SSS_FS = DEPTH + `
uniform sampler2D uColor;
uniform vec2 uDir;
uniform float uProjScale;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(uColor, vUv);
  float prof = c.a * 4.0;
  float id = floor(prof + 0.001);
  if (id < 0.5) { outColor = c; return; }
  float wk = fract(prof + 0.001);
  vec3 falloff = id > 2.5 ? vec3(1.0, 0.4, 0.09) : id > 1.5 ? vec3(1.0, 0.8, 0.5) : vec3(1.0, 0.35, 0.12);
  float width = (id > 2.5 ? 0.003 : id > 1.5 ? 0.0011 : 0.0005) * (0.3 + wk);
  float strength = id > 2.5 ? 0.7 : id > 1.5 ? 0.55 : 0.4;
  float z = sceneDepth(vUv);
  float sigmaPx = width * uProjScale / z;
  if (sigmaPx < 0.35) { outColor = c; return; }
  vec3 sum = c.rgb, wsum = vec3(1.0);
  for (int i = -8; i <= 8; i++) {
    if (i == 0) continue;
    float o = float(i) / 8.0 * 3.0;
    vec2 uv = vUv + uDir * o * sigmaPx;
    vec4 s = texture(uColor, uv);
    float zs = sceneDepth(uv);
    float sid = floor(s.a * 4.0 + 0.001);
    float same = step(0.5, sid) * mix(0.25, 1.0, step(abs(sid - id), 0.5)) * (1.0 - smoothstep(width * 1.5, width * 3.0, abs(zs - z)));
    vec3 col = mix(c.rgb, s.rgb, same);
    vec3 sig = falloff;
    vec3 wt = exp(-(o * o) / (2.0 * sig * sig));
    sum += col * wt;
    wsum += wt;
  }
  outColor = vec4(mix(c.rgb, sum / wsum, strength), c.a);
}`;

export const COMBINE_FS = FRAME_UBO + `
uniform sampler2D uDiffuse;
uniform sampler2D uSpecular;
uniform sampler2D uDepth;
uniform samplerCube uEnvSource;
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
  outColor = vec4(texture(uDiffuse, vUv).rgb + texture(uSpecular, vUv).rgb, 1.0);
}`;

export const TAA_FS = FRAME_UBO + `
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uVelocity;
uniform sampler2D uDepth;
uniform float uReset;
in vec2 vUv;
out vec4 outColor;
vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 tm(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 itm(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
vec3 sampleHistory(vec2 uv) {
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
  return max(r / wsum, vec3(0));
}
void main() {
  vec2 texel = uResolution.zw;
  vec3 cur = tm(texture(uCurrent, vUv).rgb);
  vec3 m1 = vec3(0), m2 = vec3(0);
  float closest = 1.0;
  vec2 closestUv = vUv;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 uv = vUv + vec2(x, y) * texel;
    vec3 s = toYCoCg(tm(texture(uCurrent, uv).rgb));
    m1 += s; m2 += s * s;
    float d = texture(uDepth, uv).r;
    if (d < closest) { closest = d; closestUv = uv; }
  }
  vec3 mean = m1 / 9.0, sd = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  vec2 vel;
  if (closest >= 1.0) {
    vec4 p = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 prev = uPrevViewProjNJ * vec4(p.xyz / p.w, 1.0);
    vec4 now = uViewProjNJ * vec4(p.xyz / p.w, 1.0);
    vel = (now.xy / now.w - prev.xy / prev.w) * 0.5;
  } else vel = texture(uVelocity, closestUv).xy;
  vec2 prevUv = vUv - vel;
  if (uReset > 0.5 || any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) { outColor = vec4(itm(cur), 1.0); return; }
  vec3 hist = toYCoCg(tm(sampleHistory(prevUv)));
  float speed = length(vel * uResolution.xy);
  float gamma = mix(1.25, 0.9, clamp(speed / 6.0, 0.0, 1.0));
  vec3 lo = mean - gamma * sd, hi = mean + gamma * sd;
  vec3 c = toYCoCg(cur);
  vec3 center = 0.5 * (hi + lo), extents = 0.5 * (hi - lo) + 1e-4;
  vec3 off = hist - center;
  vec3 ts = abs(off / extents);
  float t = max(ts.x, max(ts.y, ts.z));
  if (t > 1.0) hist = center + off / t;
  float alpha = mix(0.08, 0.25, clamp(speed / 4.0, 0.0, 1.0));
  vec3 res = mix(fromYCoCg(hist), cur, alpha);
  outColor = vec4(itm(res), 1.0);
}`;

export const DOF_FS = DEPTH + FRAME_UBO + `
uniform sampler2D uColor;
uniform float uFocus;
uniform float uAperture;
in vec2 vUv;
out vec4 outColor;
float coc(float z) { return clamp(uAperture * abs(z - uFocus) / max(z, 1e-3), 0.0, 1.0); }
void main() {
  float z = sceneDepth(vUv);
  float c0 = coc(z);
  vec3 sum = vec3(0);
  float w = 0.0;
  float maxR = 14.0;
  for (int i = 0; i < 36; i++) {
    float fi = (float(i) + 0.5) / 36.0;
    float r = sqrt(fi) * maxR;
    float a = float(i) * 2.39996;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uResolution.zw;
    float zs = sceneDepth(uv);
    float cs = coc(zs) * maxR;
    float wt = smoothstep(r - 1.0, r + 1.0, max(min(cs, c0 * maxR + 2.0), zs < z ? cs : 0.0) + 0.5);
    sum += texture(uColor, uv).rgb * wt;
    w += wt;
  }
  vec3 blur = sum / max(w, 1e-3);
  outColor = vec4(mix(texture(uColor, vUv).rgb, blur, smoothstep(0.03, 0.15, c0)), 1.0);
}`;

export const DOWN_FS = `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uFirst;
in vec2 vUv;
out vec4 outColor;
vec3 karis(vec3 c) { return c / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
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
uniform float uDesaturation;
uniform float uWhite;
in vec2 vUv;
out vec4 outColor;
vec3 pbrNeutral(vec3 color) {
  const float startCompression = 0.76;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (uDesaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
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
    c = max(mix(c, sharp, 1.0 / (1.0 + dot(c, vec3(0.3)))), vec3(0));
  }
  c += texture(uBloom, vUv).rgb * uBloomStrength;
  c *= uExposure;
  c = uMode > 0.5 ? agx(c) : pbrNeutral(c);
  c /= uWhite;
  vec2 q = vUv - 0.5;
  c *= mix(1.0, 1.0 - dot(q, q) * 1.2, uVignette);
  c = srgb(clamp(c, 0.0, 1.0));
  float n = hash12(gl_FragCoord.xy + fract(uCamPos.w) * 517.0);
  c += (n - 0.5) * (uGrain + 1.0 / 255.0);
  outColor = vec4(c, 1.0);
}`;

export const COPY_FS = `
uniform sampler2D uSource;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uSource, vUv); }`;
