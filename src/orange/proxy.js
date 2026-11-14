import { v3 } from '../math.js';
import { STRIDE } from './mesh.js';

export const MAX_PLANES = 12;
export const RELIEF_MARGIN = 0.0014;
const INFLATE = 0.0005;
const DIRECTIONS = 96;

const DIRS = (() => {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < DIRECTIONS; i++) {
    const y = 1 - (2 * (i + 0.5)) / DIRECTIONS, r = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]);
  }
  return out;
})();

export function supportPlanes(mesh) {
  const { data, count } = mesh;
  const best = new Float64Array(DIRS.length).fill(-Infinity);
  for (let i = 0; i < count; i++) {
    const k = i * STRIDE, x = data[k], y = data[k + 1], z = data[k + 2];
    for (let d = 0; d < DIRS.length; d++) {
      const s = x * DIRS[d][0] + y * DIRS[d][1] + z * DIRS[d][2];
      if (s > best[d]) best[d] = s;
    }
  }
  return DIRS.map((d, i) => [d[0], d[1], d[2], best[i] + INFLATE]);
}

function hull2(points) {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-16) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 1e-16) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

function clip(faces, plane) {
  const n = plane, d = plane[3], out = [], cut = [];
  for (const f of faces) {
    const res = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const da = v3.dot(n, a) - d, db = v3.dot(n, b) - d;
      if (da <= 0) res.push(a);
      if (Math.abs(da) < 1e-9) cut.push(a);
      if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
        const p = v3.lerp(a, b, da / (da - db));
        res.push(p);
        cut.push(p);
      }
    }
    if (res.length >= 3) out.push(res);
  }
  if (cut.length >= 3) {
    const nn = [n[0], n[1], n[2]];
    const u = v3.norm(Math.abs(nn[1]) < 0.9 ? v3.cross([0, 1, 0], nn) : v3.cross([1, 0, 0], nn));
    const w = v3.cross(nn, u);
    const h = hull2(cut.map((p) => [v3.dot(p, u), v3.dot(p, w), p]));
    if (h.length >= 3) out.push(h.map((e) => e[2]));
  }
  return out;
}

const CUBE = (() => {
  const s = 0.2, c = (x, y, z) => [x * s, y * s, z * s];
  return [
    [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
    [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)],
    [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)],
    [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
    [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
    [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)],
  ];
})();

export function pieceProxy(support, planes) {
  let faces = CUBE;
  for (const p of support) faces = clip(faces, p);
  for (const p of planes) faces = clip(faces, [p[0], p[1], p[2], p[3] + RELIEF_MARGIN]);
  const tris = [];
  let mid = [0, 0, 0], m = 0;
  for (const f of faces) for (const p of f) { mid = v3.add(mid, p); m++; }
  mid = v3.scale(mid, 1 / Math.max(m, 1));
  for (const f of faces) {
    let nrm = [0, 0, 0];
    for (let i = 1; i < f.length - 1; i++) nrm = v3.add(nrm, v3.cross(v3.sub(f[i], f[0]), v3.sub(f[i + 1], f[0])));
    const centre = v3.scale(f.reduce((s, p) => v3.add(s, p), [0, 0, 0]), 1 / f.length);
    const flip = v3.dot(nrm, v3.sub(centre, mid)) < 0;
    for (let i = 1; i < f.length - 1; i++) {
      const a = f[0], b = flip ? f[i + 1] : f[i], c = flip ? f[i] : f[i + 1];
      tris.push(...a, ...b, ...c);
    }
  }
  const data = new Float32Array(tris);
  let radius = 0;
  const centre = [0, 0, 0];
  const nv = data.length / 3;
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) centre[k] += data[i * 3 + k] / nv;
  for (let i = 0; i < nv; i++) radius = Math.max(radius, Math.hypot(data[i * 3] - centre[0], data[i * 3 + 1] - centre[1], data[i * 3 + 2] - centre[2]));
  const bounds = [...support, ...planes.map((p) => [p[0], p[1], p[2], p[3] + RELIEF_MARGIN])];
  return { data, count: nv, centre, radius, bounds };
}

export function insideProxy(proxy, p, margin = 0.002) {
  for (const b of proxy.bounds) if (b[0] * p[0] + b[1] * p[1] + b[2] * p[2] - b[3] > -margin) return false;
  return true;
}

export function piecePlanes(geometry) {
  const ids = new Set();
  const { data, count, planes } = geometry;
  for (let i = 0; i < count; i++) { const id = data[i * STRIDE + 6]; if (id > 0.5) ids.add(id); }
  const out = [];
  for (const id of ids) if (planes && planes[id]) out.push(planes[id]);
  return out.slice(0, MAX_PLANES);
}
