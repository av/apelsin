export const FRAME_UBO = `
layout(std140) uniform Frame {
  mat4 uViewProj;
  mat4 uView;
  mat4 uProj;
  mat4 uInvViewProj;
  mat4 uViewProjNJ;
  mat4 uPrevViewProjNJ;
  mat4 uLightViewProj;
  vec4 uCamPos;
  vec4 uResolution;
  vec4 uJitter;
  vec4 uKeyDir;
  vec4 uOccluderTint;
  vec4 uShadowParams;
  vec4 uEnvParams;
  vec4 uShEnv[9];
  vec4 uShKey[9];
  vec4 uWetParams;
  vec4 uFlags;
  vec4 uBackground;
};
`;

export const FRAME_UBO_FLOATS = 16 * 7 + 4 * (7 + 18 + 3);

export const NOISE = `
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash33(vec3 p) {
  vec3 q = fract(floor(p) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
vec3 hash33Exact(vec3 p) { return vec3(pcg3d(uvec3(ivec3(floor(p)) + 32768))) * (1.0 / 4294967295.0); }
float hash13(vec3 p) { return hash33(p).x; }
float hash12(vec2 p) { return hash33(vec3(p, 17.0)).x; }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1)), h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float fbm3(vec3 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 11.7) + 0.2 * vnoise(p * 4.11 + 23.1); }
struct Cell { float f1; float f2; vec3 toCenter; vec3 id; };
Cell voronoi3(vec3 p, float jitter) {
  vec3 i = floor(p), f = fract(p);
  Cell c; c.f1 = 9.0; c.f2 = 9.0; c.toCenter = vec3(0); c.id = vec3(0);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z);
    vec3 h = hash33(i + g);
    vec3 r = g + 0.5 + (h - 0.5) * jitter - f;
    float d = dot(r, r);
    if (d < c.f1) { c.f2 = c.f1; c.f1 = d; c.toCenter = r; c.id = h; }
    else if (d < c.f2) c.f2 = d;
  }
  c.f1 = sqrt(c.f1); c.f2 = sqrt(c.f2);
  return c;
}
Cell voronoiShell(vec3 p, vec3 n, float jitter) {
  vec3 i = floor(p), f = fract(p);
  Cell c; c.f1 = 9.0; c.f2 = 9.0; c.toCenter = vec3(0); c.id = vec3(0);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z);
    vec3 h = hash33(i + g);
    vec3 r = g + 0.5 + (h - 0.5) * jitter - f;
    float radial = dot(r, n);
    if (abs(radial) > 0.5) continue;
    r -= n * radial;
    float d = dot(r, r);
    if (d < c.f1) { c.f2 = c.f1; c.f1 = d; c.toCenter = r; c.id = h; }
    else if (d < c.f2) c.f2 = d;
  }
  c.f1 = sqrt(c.f1); c.f2 = sqrt(c.f2);
  return c;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

export const SURFACE = `
struct Surface {
  vec3 albedo; vec3 N; float roughness; vec3 f0;
  float clearcoat; float clearcoatRoughness;
  vec3 sssColor; float sssWidth; float sssProfile;
  vec3 transmission; float cavity; vec3 emission;
};
struct SurfaceInput {
  vec3 rest; vec3 restNormal; vec3 world; vec3 normal; vec3 V; float cap; mat3 restToWorld; float pixel;
};
Surface defaultSurface(vec3 N) {
  Surface s;
  s.albedo = vec3(0.8); s.N = N; s.roughness = 0.5; s.f0 = vec3(0.04);
  s.clearcoat = 0.0; s.clearcoatRoughness = 0.1;
  s.sssColor = vec3(0); s.sssWidth = 0.0; s.sssProfile = 0.0;
  s.transmission = vec3(0); s.cavity = 1.0; s.emission = vec3(0);
  return s;
}
vec3 perturb(vec3 N, vec3 grad, float k) { return normalize(N - k * (grad - N * dot(grad, N))); }
`;

export const LIGHTING = `
uniform samplerCube uEnvCube;
uniform samplerCube uKeyCube;
uniform sampler2D uBrdfLut;
uniform sampler2D uShadowMap;
uniform sampler2D uAO;
const float PI = 3.14159265;
vec3 evalSH(vec4 sh[9], vec3 n) {
  vec3 r = sh[0].rgb * 0.886227;
  r += sh[1].rgb * 1.023328 * n.y + sh[2].rgb * 1.023328 * n.z + sh[3].rgb * 1.023328 * n.x;
  r += sh[4].rgb * 0.858086 * n.x * n.y + sh[5].rgb * 0.858086 * n.y * n.z;
  r += sh[6].rgb * 0.247708 * (3.0 * n.z * n.z - 1.0);
  r += sh[7].rgb * 0.858086 * n.x * n.z + sh[8].rgb * 0.429043 * (n.x * n.x - n.y * n.y);
  return max(r, vec3(0)) / PI;
}
vec3 shEnv(vec3 n) { return evalSH(uShEnv, n); }
vec3 shKey(vec3 n) { return evalSH(uShKey, n); }
const vec2 POISSON[16] = vec2[](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));
vec3 shadowCoord(vec3 world, vec3 N) {
  vec3 L = uKeyDir.xyz;
  float slope = 1.0 - clamp(dot(N, L), 0.0, 1.0);
  vec4 c = uLightViewProj * vec4(world + N * (0.0006 + 0.0015 * slope), 1.0);
  return c.xyz / c.w * 0.5 + 0.5;
}
float keyShadow(vec3 world, vec3 N) {
  if (uShadowParams.w < 0.5) return 1.0;
  vec3 sc = shadowCoord(world, N);
  if (any(lessThan(sc.xy, vec2(0.0))) || any(greaterThan(sc.xy, vec2(1.0))) || sc.z > 1.0) return 1.0;
  float range = uShadowParams.z, tanA = uKeyDir.w, extent = uShadowParams.y;
  float a = ign(gl_FragCoord.xy + uJitter.xy * 1000.0) * 6.2831853;
  mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
  float search = clamp(tanA * 0.06 / extent, uShadowParams.x * 2.0, 0.2);
  float blockers = 0.0, sum = 0.0;
  for (int i = 0; i < 16; i++) {
    float d = texture(uShadowMap, sc.xy + rot * POISSON[i] * search).r;
    if (d < sc.z - 0.0005) { blockers += d; sum += 1.0; }
  }
  if (sum < 0.5) return 1.0;
  float zb = blockers / sum;
  float pen = clamp((sc.z - zb) * range * tanA / extent, uShadowParams.x * 1.5, 0.25);
  float lit = 0.0;
  int taps = int(uFlags.x) >= 2 ? 32 : 16;
  for (int i = 0; i < 32; i++) {
    if (i >= taps) break;
    vec2 o = rot * POISSON[i & 15] * (i >= 16 ? 0.55 : 1.0);
    float d = texture(uShadowMap, sc.xy + o * pen).r;
    lit += d < sc.z - 0.0004 ? 0.0 : 1.0;
  }
  return lit / float(taps);
}
float keyThickness(vec3 world) {
  vec4 c = uLightViewProj * vec4(world, 1.0);
  vec3 sc = c.xyz / c.w * 0.5 + 0.5;
  if (any(lessThan(sc.xy, vec2(0.0))) || any(greaterThan(sc.xy, vec2(1.0)))) return 1.0;
  float d = texture(uShadowMap, sc.xy).r;
  return max(sc.z - d, 0.0) * uShadowParams.z;
}
float screenAO() { return uFlags.y > 0.5 ? texture(uAO, gl_FragCoord.xy * uResolution.zw).r : 1.0; }
float D_GGX(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
vec3 envSpec(samplerCube cube, vec3 R, float rough) { return textureLod(cube, R, rough * uEnvParams.w).rgb; }
float encodeProfile(Surface s) { return s.sssProfile < 0.5 ? 0.0 : (floor(s.sssProfile + 0.5) + clamp(s.sssWidth, 0.0, 0.99)) * 0.25; }
void shadeSurface(Surface s, SurfaceInput si, out vec3 diffuse, out vec3 specular) {
  vec3 N = s.N, V = si.V, L = uKeyDir.xyz;
  float NoV = clamp(dot(N, V), 1e-4, 1.0);
  float rough = clamp(s.roughness, 0.03, 1.0);
  vec2 lut = texture(uBrdfLut, vec2(NoV, rough)).rg;
  vec3 single = s.f0 * lut.x + lut.y;
  vec3 energy = 1.0 + s.f0 * (1.0 / max(lut.x + lut.y, 1e-3) - 1.0);
  vec3 specColor = single * energy;
  vec3 R = reflect(-V, N);
  R = normalize(mix(R, N, rough * rough * 0.5));
  float ao = screenAO() * s.cavity;
  float specAO = clamp(pow(NoV + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0);
  float shadow = keyShadow(si.world, si.normal);
  float envI = uEnvParams.x, keyI = uEnvParams.y;
  vec3 tint = mix(vec3(1.0), uOccluderTint.rgb, uOccluderTint.w);
  vec3 ambient = shEnv(N) * envI * mix(tint, vec3(1.0), ao) * ao;
  vec3 keyDiff = shKey(N) * keyI * mix(tint * 0.35, vec3(1.0), shadow);
  vec3 keyIrr = shKey(L) * keyI;
  float NoL = dot(N, L);
  float wrap = max(0.0, pow(clamp((NoL + 0.45) / 1.45, 0.0, 1.0), 1.6) - clamp(NoL, 0.0, 1.0));
  vec3 kd = (1.0 - single) * (1.0 - s.clearcoat * 0.04);
  diffuse = s.albedo * kd * (ambient + keyDiff) + s.sssColor * keyIrr * wrap * mix(0.4, 1.0, shadow);
  if (dot(s.transmission, vec3(1)) > 0.0) {
    float t = keyThickness(si.world);
    float back = clamp(dot(-N, L) * 0.6 + 0.4, 0.0, 1.0);
    diffuse += s.transmission * keyIrr * exp(-t / 0.007) * back + s.transmission * shEnv(-N) * envI * 0.35 * ao;
  }
  vec3 specEnv = envSpec(uEnvCube, R, rough) * envI * specAO;
  vec3 specKey = envSpec(uKeyCube, R, rough) * keyI * shadow * mix(1.0, specAO, 0.5);
  specular = (specEnv + specKey) * specColor;
  if (s.clearcoat > 0.0) {
    float cr = clamp(s.clearcoatRoughness, 0.03, 1.0);
    vec3 Rc = reflect(-V, N);
    float Fc = (0.04 + 0.96 * pow(1.0 - NoV, 5.0)) * s.clearcoat;
    vec3 cc = (envSpec(uEnvCube, Rc, cr) * envI * specAO + envSpec(uKeyCube, Rc, cr) * keyI * shadow) * Fc;
    diffuse *= 1.0 - Fc;
    specular = specular * (1.0 - Fc) + cc;
  }
  specular += s.emission;
}
`;
