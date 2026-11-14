import { shapeRadius, STRIDE } from './mesh.js';

const fract = (x) => x - Math.floor(x);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

function hash13(x, y, z) {
  let qx = fract(x * 0.1031), qy = fract(y * 0.1030), qz = fract(z * 0.0973);
  const d = qx * (qy + 33.33) + qy * (qx + 33.33) + qz * (qz + 33.33);
  qx += d; qy += d; qz += d;
  return fract((qx + qy) * qz);
}

export function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash13(ix + a, iy + b, iz + c);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), ux), l(h(0, 1, 0), h(1, 1, 0), ux), uy), l(l(h(0, 0, 1), h(1, 0, 1), ux), l(h(0, 1, 1), h(1, 1, 1), ux), uy), uz);
}

function segment(p, ang) {
  const n = p.segments, b0 = p.bounds[0];
  const a = ang - b0 - TAU * Math.floor((ang - b0) / TAU);
  let start = 0, end = TAU, idx = n - 1;
  for (let i = 1; i < n; i++) {
    const bi = p.bounds[i] - b0;
    if (a < bi) { idx = i - 1; end = bi; break; }
    start = bi;
  }
  return { idx, rel: a - 0.5 * (start + end), width: end - start, edge: Math.min(a - start, end - a) };
}

export function capRelief(p, x, y, z) {
  const r = Math.hypot(x, y, z);
  if (r < 1e-6) return 0;
  const N = p.noiseOffset;
  const depth = shapeRadius(p, [x / r, y / r, z / r]) - r;
  const pv = vnoise(x * 90 + N[2], y * 90 + N[0], z * 90 + N[1]);
  const peel = p.flavedo + p.pith * (0.9 + 0.2 * pv);
  const rho = Math.hypot(x, z), psi = Math.atan2(z, x + 1e-7);
  const yN = y / p.c;
  const coreBase = p.core * (0.75 + 0.6 * yN * yN);
  let torn = 0.5;
  if (rho < coreBase * 2) {
    const cs = Math.cos(psi), sn = Math.sin(psi);
    torn = 0.6 * vnoise(cs * 3 + N[0], sn * 3 + N[1], y * 240 + N[2]) + 0.4 * vnoise(cs * 9 + N[2], sn * 9 + N[0], y * 1800 + N[1]);
  }
  const coreR = coreBase * (0.62 + 0.75 * torn);
  const wave = (p.wave * Math.sin(y * 70 + rho * 110 + N[0]) + p.wave * 1.2 * (pv - 0.5)) * smooth(0, 0.012, rho);
  const s = segment(p, psi + wave);
  const gap = p.hollow > 0 ? 0.0016 * yN ** 4 * (0.5 + pv) : 0;
  const dD = depth - peel - gap, dC = rho - coreR, dS = s.edge * rho;
  const radial = Math.min(Math.max((rho - coreR) / Math.max(p.a - peel - coreR, 1e-4), 0), 1);
  const segAmp = 0.0003 + 0.0005 * fract(s.idx * 0.73 + p.hue);
  const uu = (s.rel * rho) / Math.max(0.5 * s.width * rho, 1e-4);
  const dome = Math.max(1 - uu * uu, 0) ** 0.6 * Math.sin(Math.PI * Math.min(radial * 1.15, 1)) ** 0.5;
  const lumps = (vnoise(x * 300 + s.idx * 7.1, y * 300, z * 300) - 0.5) * 0.0006 + (vnoise(x * 700, y * 700 + s.idx * 3.3, z * 700) - 0.5) * 0.00025;
  const septum = -0.00028 * Math.exp(-((dS / 0.0007) ** 2));
  const flesh = (segAmp * dome + lumps + septum) * smooth(0, 0.0014, dD) * smooth(-0.0005, 0.0015, dC);
  const coreK = 1 - smooth(-0.0006, 0.0012, dC);
  const tuft = (0.0005 + 0.0011 * torn + 0.0004 * vnoise(x * 2600 + N[1], y * 2600, z * 2600 + N[0])) * (1 - smooth(0, coreR + 0.001, rho) * 0.5);
  return flesh * (1 - coreK) + tuft * coreK * smooth(0, 0.0015, dD + peel);
}

export function displaceCaps(geometry) {
  const { data, count, planes, params } = geometry;
  const out = data.slice();
  if (!params || !planes) return out;
  const ids = new Set();
  for (let i = 0; i < count; i++) if (data[i * STRIDE + 6] > 0.5) ids.add(data[i * STRIDE + 6]);
  if (!ids.size) return out;
  const own = [...ids].map((id) => [id, planes[id]]).filter((e) => e[1]);
  const cache = new Map();
  const height = (x, y, z, id) => {
    const r = Math.hypot(x, y, z);
    let m = shapeRadius(params, [x / r, y / r, z / r]) - r;
    for (const [j, q] of own) if (j !== id) m = Math.min(m, Math.abs(q[0] * x + q[1] * y + q[2] * z - q[3]));
    const fall = smooth(0, 0.0012, m);
    return fall > 0 ? capRelief(params, x, y, z) * fall : 0;
  };
  const slot = new Int32Array(count).fill(-1);
  const pos = [], nrm = [];
  for (let i = 0; i < count; i++) {
    const k = i * STRIDE, id = data[k + 6];
    if (id < 0.5 || !planes[id]) continue;
    const x = data[k], y = data[k + 1], z = data[k + 2];
    let map = cache.get(id);
    if (!map) cache.set(id, map = new Map());
    const key = (Math.round(x * 1e6) * 100003 + Math.round(y * 1e6)) * 100003 + Math.round(z * 1e6);
    let j = map.get(key);
    if (j === undefined) {
      const q = planes[id], h = height(x, y, z, id);
      j = pos.length / 3;
      pos.push(x + q[0] * h, y + q[1] * h, z + q[2] * h);
      nrm.push(0, 0, 0);
      map.set(key, j);
    }
    slot[i] = j;
  }
  for (let t = 0; t < count; t += 3) {
    const a = slot[t], b = slot[t + 1], c = slot[t + 2];
    if (a < 0 || b < 0 || c < 0) continue;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[v * 3] += fx; nrm[v * 3 + 1] += fy; nrm[v * 3 + 2] += fz; }
  }
  for (let i = 0; i < count; i++) {
    const j = slot[i];
    if (j < 0) continue;
    const k = i * STRIDE, q = planes[data[k + 6]];
    let nx = nrm[j * 3], ny = nrm[j * 3 + 1], nz = nrm[j * 3 + 2];
    if (nx * q[0] + ny * q[1] + nz * q[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    out[k] = pos[j * 3]; out[k + 1] = pos[j * 3 + 1]; out[k + 2] = pos[j * 3 + 2];
    out[k + 3] = nx / l; out[k + 4] = ny / l; out[k + 5] = nz / l;
  }
  return out;
}
