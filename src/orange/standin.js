import { GLAND_STRIDE } from './shape.js';

export const GLAND_SIZE = 384;

const AXES = [[0, 1, -1, 2, -1, 1], [0, -1, 1, 2, -1, 1], [1, 1, 1, 0, 1, 2], [1, -1, 1, 0, -1, 2], [2, 1, 1, 0, -1, 1], [2, -1, -1, 0, -1, 1]];

function faceDir(f, s, t) {
  const [ax, sg, ss, si, ts, ti] = AXES[f];
  const d = [0, 0, 0];
  d[ax] = sg; d[si] = s * ss; d[ti] = t * ts;
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

function project(f, d) {
  const [ax, sg, ss, si, ts, ti] = AXES[f];
  const m = d[ax] * sg;
  if (m <= 0.2) return null;
  return [(d[si] * ss) / m, (d[ti] * ts) / m];
}

export function glandCubeData(shape, size = GLAND_SIZE) {
  const faces = Array.from({ length: 6 }, () => new Float32Array(size * size * 4));
  const best = Array.from({ length: 6 }, () => new Float32Array(size * size).fill(Infinity));
  const g = shape.glands, n = shape.glandCount;
  const reach = 0.0011;
  for (let k = 0; k < n; k++) {
    const x = g[k * GLAND_STRIDE], y = g[k * GLAND_STRIDE + 1], z = g[k * GLAND_STRIDE + 2], rad = g[k * GLAND_STRIDE + 3];
    const R = Math.hypot(x, y, z), d = [x / R, y / R, z / R];
    const win = Math.ceil((reach / R) * size * 0.5) + 1;
    for (let f = 0; f < 6; f++) {
      const st = project(f, d);
      if (!st || Math.abs(st[0]) > 1.08 || Math.abs(st[1]) > 1.08) continue;
      const ci = Math.floor(((st[0] + 1) / 2) * size), cj = Math.floor(((st[1] + 1) / 2) * size);
      for (let j = Math.max(0, cj - win); j <= Math.min(size - 1, cj + win); j++) {
        for (let i = Math.max(0, ci - win); i <= Math.min(size - 1, ci + win); i++) {
          const td = faceDir(f, ((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1);
          const ox = x - td[0] * R, oy = y - td[1] * R, oz = z - td[2] * R;
          const dd = ox * ox + oy * oy + oz * oz;
          const t = j * size + i;
          if (dd >= best[f][t] || dd > reach * reach) continue;
          best[f][t] = dd;
          faces[f].set([ox, oy, oz, rad], t * 4);
        }
      }
    }
  }
  return faces;
}

export function bakeGlandCube(gl, shape) {
  if (shape.glandCube) return shape.glandCube;
  const size = GLAND_SIZE, faces = glandCubeData(shape, size);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA16F, size, size);
  for (let f = 0; f < 6; f++) gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, 0, 0, size, size, gl.RGBA, gl.FLOAT, faces[f]);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, p, gl.CLAMP_TO_EDGE);
  shape.glandCube = { tex, cube: true, size };
  return shape.glandCube;
}

export const STANDIN_GLSL = `
uniform samplerCube uGlands;
vec4 glandAt(vec3 dir) { return textureLod(uGlands, dir, 0.0); }
float envelopeRelief(vec3 p) {
  if (p.y <= 0.0) return 0.0;
  float rr = length(p.xz);
  if (rr > 0.0045) return 0.0;
  float stub = 0.0015 * (1.0 - smoothstep(0.0013, 0.0017, rr));
  float button = 0.00035 * (1.0 - smoothstep(0.002, 0.0042, rr));
  return max(stub, button);
}
Surface rindSurface(SurfaceInput si) {
  vec3 p = si.rest;
  vec3 Nr = normalize(si.restNormal);
  vec3 d = normalize(p);
  float px = max(si.pixel, 1e-6);
  vec4 g = glandAt(d);
  vec3 tg = g.xyz - Nr * dot(g.xyz, Nr);
  float dist = length(tg), rad = max(g.w, 1e-5);
  float has = step(1e-5, g.w);
  float x = dist / rad;
  float detail = (1.0 - smoothstep(0.5, 1.4, px / rad)) * has;
  float seed = fract(g.w * 73117.0 + dot(g.xyz, vec3(9123.0, 7411.0, 5113.0)));
  float depth = 0.00006 + 0.00007 * seed;
  float q = max(1.0 - x * x, 0.0);
  float dh = depth * 4.0 * x * q / rad;
  float rx = (x - 1.12) / 0.22;
  float rim = exp(-rx * rx);
  dh += -0.3 * depth * 2.0 * rx / 0.22 * rim / rad;
  vec3 grad = dh * (-tg / max(dist, 1e-7)) * detail;
  vec4 und = noiseD(p * 220.0 + oNoise.yzx);
  grad += und.yzw * 220.0 * 0.00004;
  vec4 fine = noiseD(p * 2600.0 + oNoise.zxy);
  grad += fine.yzw * 2600.0 * 0.000006 * (1.0 - smoothstep(0.00004, 0.00012, px));
  float pit = q * q * detail;
  float m1 = vnoise(p * 45.0 + oNoise.yzx), m2 = vnoise(p * 110.0 + oNoise.zxy + 5.0);
  vec3 albedo = oRind.rgb * (1.0 + 0.16 * (m1 - 0.5)) * (0.97 + 0.06 * m2);
  albedo = mix(albedo, min(oRind.rgb * vec3(1.05, 1.25, 1.6), vec3(1.0)), smoothstep(0.55, 0.85, m2) * 0.3);
  float th = acos(clamp(d.y, -1.0, 1.0));
  float stemT = 1.0 - smoothstep(0.08, 0.55, th);
  albedo = mix(albedo, oRindStem.rgb, stemT * stemT * oRindStem.w);
  albedo *= mix(vec3(1.0), vec3(0.9, 0.84, 0.8), pit);
  float rough = mix(0.42, 0.58, pit);
  float clear = oExtra.x;
  float ccRough = mix(0.12, 0.22, pit) + 0.06 * (1.0 - detail * has);
  float rr = length(p.xz);
  float cav = 1.0;
  if (p.y > 0.0 && rr < 0.0065) {
    float psi = atan(p.z, p.x + 1e-7);
    float lobe = pow(0.5 + 0.5 * cos(psi * 5.0 + oNoise.x), 0.8);
    float star = 0.0024 + 0.0018 * lobe;
    float calyx = 1.0 - smoothstep(star - 0.0003, star + 0.0002, rr);
    vec3 calyxCol = mix(vec3(0.11, 0.11, 0.014), vec3(0.06, 0.065, 0.012), vnoise(p * 3000.0));
    calyxCol = mix(calyxCol, vec3(0.13, 0.08, 0.02), smoothstep(0.75, 1.0, rr / star) * 0.6);
    float stub = 1.0 - smoothstep(0.0012, 0.0016, rr);
    vec3 stubCol = mix(vec3(0.12, 0.12, 0.02), vec3(0.24, 0.22, 0.07), smoothstep(0.0004, 0.001, rr));
    albedo = mix(albedo, calyxCol, calyx);
    albedo = mix(albedo, stubCol, stub);
    grad *= 1.0 - calyx;
    grad += vec3(-p.z, 0.0, p.x) / max(rr, 1e-6) * sin(psi * 5.0 + oNoise.x) * 0.3 * calyx;
    rough = mix(rough, 0.62, calyx);
    clear = mix(clear, 0.12, calyx);
    cav = mix(1.0, 0.7, calyx * (1.0 - lobe));
  }
  Surface s = defaultSurface(vec3(0, 1, 0));
  s.N = normalize(si.restToWorld * perturb(Nr, grad, 1.0));
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = rough;
  s.f0 = vec3(0.035);
  s.clearcoat = clear;
  s.clearcoatRoughness = ccRough;
  s.cavity = mix(1.0, 0.88, pit) * cav;
  s.sssProfile = 1.0;
  s.sssWidth = 0.45;
  s.sssColor = oRind.rgb * vec3(0.35, 0.16, 0.04);
  s.transmission = oRind.rgb * vec3(0.05, 0.015, 0.0);
  return s;
}
`;
