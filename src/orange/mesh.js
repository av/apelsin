import { v3 } from '../math.js';
import { createShape } from './shape.js';

export const STRIDE = 7;

const shapes = new WeakMap();

export function shapeOf(p) {
  let s = shapes.get(p);
  if (!s) { s = createShape(p.seed ?? 1, p); shapes.set(p, s); }
  return s;
}

export function shapeRadius(p, d) { return shapeOf(p).radius(d); }

export function shapePoint(p, d) {
  const n = v3.norm(d);
  return v3.scale(n, shapeRadius(p, n));
}

const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

const POLE_K = 0.45;

function warp(u, v, pole) {
  if (!pole) return [u, v];
  const r = Math.max(Math.abs(u), Math.abs(v));
  if (r < 1e-9) return [u, v];
  const t = Math.min(1, r / 0.5);
  const k = POLE_K + (1 - POLE_K) * t * t * (3 - 2 * t);
  return [u * k, v * k];
}

export function orangeMesh(p, n = 64) {
  const shape = shapeOf(p);
  const tris = 6 * n * n * 2;
  const data = new Float32Array(tris * 3 * STRIDE);
  let o = 0;
  const grid = new Float32Array((n + 1) * (n + 1) * 6);
  const M = n + 3, apron = new Float32Array(M * M * 3);
  for (const [f, u, v] of FACES) {
    const pole = f[1] > 0.5;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const [gu, gv] = warp(((i - 1) / n) * 2 - 1, ((j - 1) / n) * 2 - 1, pole);
      const a = Math.tan(gu * Math.PI / 4), b = Math.tan(gv * Math.PI / 4);
      const d = v3.norm([f[0] + u[0] * a + v[0] * b, f[1] + u[1] * a + v[1] * b, f[2] + u[2] * a + v[2] * b]);
      const r = shape.envelope(d);
      apron.set([d[0] * r, d[1] * r, d[2] * r], (j * M + i) * 3);
    }
    const P = (i, j) => { const k = (j * M + i) * 3; return [apron[k], apron[k + 1], apron[k + 2]]; };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const pos = P(i + 1, j + 1);
      let nor = v3.norm(v3.cross(v3.sub(P(i + 2, j + 1), P(i, j + 1)), v3.sub(P(i + 1, j + 2), P(i + 1, j))));
      if (v3.dot(nor, pos) < 0) nor = v3.scale(nor, -1);
      grid.set([...pos, ...nor], (j * (n + 1) + i) * 6);
    }
    const emit = (i, j) => {
      const k = (j * (n + 1) + i) * 6;
      for (let c = 0; c < 6; c++) data[o++] = grid[k + c];
      data[o++] = 0;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const diag = (i < n / 2) === (j < n / 2);
      if (diag) {
        emit(i, j); emit(i + 1, j); emit(i + 1, j + 1);
        emit(i, j); emit(i + 1, j + 1); emit(i, j + 1);
      } else {
        emit(i, j); emit(i + 1, j); emit(i, j + 1);
        emit(i + 1, j); emit(i + 1, j + 1); emit(i, j + 1);
      }
    }
  }
  fixWinding(data);
  return { data, count: tris * 3, params: p, planes: {} };
}

function fixWinding(data) {
  const S = STRIDE;
  for (let t = 0; t < data.length; t += 3 * S) {
    const ax = data[t], ay = data[t + 1], az = data[t + 2];
    const e1 = [data[t + S] - ax, data[t + S + 1] - ay, data[t + S + 2] - az];
    const e2 = [data[t + 2 * S] - ax, data[t + 2 * S + 1] - ay, data[t + 2 * S + 2] - az];
    const nrm = [data[t + 3] + data[t + S + 3] + data[t + 2 * S + 3], data[t + 4] + data[t + S + 4] + data[t + 2 * S + 4], data[t + 5] + data[t + S + 5] + data[t + 2 * S + 5]];
    if (v3.dot(v3.cross(e1, e2), nrm) < 0) {
      for (let c = 0; c < S; c++) { const tmp = data[t + S + c]; data[t + S + c] = data[t + 2 * S + c]; data[t + 2 * S + c] = tmp; }
    }
  }
}

export function analyseMesh(mesh) {
  const { data, count } = mesh, S = STRIDE;
  let vol = 0, cx = 0, cy = 0, cz = 0;
  const caps = [];
  for (let t = 0; t < count * S; t += 3 * S) {
    const a = [data[t], data[t + 1], data[t + 2]], b = [data[t + S], data[t + S + 1], data[t + S + 2]], c = [data[t + 2 * S], data[t + 2 * S + 1], data[t + 2 * S + 2]];
    const v = v3.dot(a, v3.cross(b, c)) / 6;
    vol += v;
    cx += v * (a[0] + b[0] + c[0]) / 4; cy += v * (a[1] + b[1] + c[1]) / 4; cz += v * (a[2] + b[2] + c[2]) / 4;
    if (data[t + 6] > 0.5) {
      const id = data[t + 6], plane = mesh.planes && mesh.planes[id];
      const n = plane ? plane.slice(0, 3) : [data[t + 3], data[t + 4], data[t + 5]], d = plane ? plane[3] : v3.dot(n, a);
      const area = v3.len(v3.cross(v3.sub(b, a), v3.sub(c, a))) / 2;
      let cap = caps.find((k) => k.id === id);
      if (!cap) caps.push(cap = { id, normal: n, d, area: 0, centroid: [0, 0, 0], tris: [] });
      cap.area += area;
      cap.centroid = v3.add(cap.centroid, v3.scale(v3.add(v3.add(a, b), c), area / 3));
      cap.tris.push(a, b, c, area);
    }
  }
  const com = vol > 0 ? [cx / vol, cy / vol, cz / vol] : [0, 0, 0];
  let radius = 0;
  for (let i = 0; i < count; i++) {
    const k = i * S;
    radius = Math.max(radius, Math.hypot(data[k] - com[0], data[k + 1] - com[1], data[k + 2] - com[2]));
  }
  const faces = caps.filter((c) => c.area > 2e-6).map((c) => ({ ...c, centroid: v3.scale(c.centroid, 1 / c.area) }));
  return { volume: vol, com, radius, caps: faces };
}

const DIRS = (() => {
  const out = [], n = 120, g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]);
  }
  return out;
})();

export function hullPoints(mesh, com) {
  const { data, count } = mesh, S = STRIDE;
  const best = DIRS.map(() => [-Infinity, -1]);
  for (let i = 0; i < count; i++) {
    const k = i * S, x = data[k], y = data[k + 1], z = data[k + 2];
    if (data[k + 6] > 0.5) continue;
    for (let d = 0; d < DIRS.length; d++) {
      const s = x * DIRS[d][0] + y * DIRS[d][1] + z * DIRS[d][2];
      if (s > best[d][0]) { best[d][0] = s; best[d][1] = i; }
    }
  }
  const idx = [...new Set(best.map((b) => b[1]))];
  const pts = new Float32Array(idx.length * 3);
  idx.forEach((i, j) => { pts[j * 3] = data[i * S] - com[0]; pts[j * 3 + 1] = data[i * S + 1] - com[1]; pts[j * 3 + 2] = data[i * S + 2] - com[2]; });
  return pts;
}

export function raycastMesh(mesh, ro, rd) {
  const { data, count } = mesh, S = STRIDE;
  let best = Infinity, normal = null;
  for (let t = 0; t < count * S; t += 3 * S) {
    const ax = data[t], ay = data[t + 1], az = data[t + 2];
    const e1x = data[t + S] - ax, e1y = data[t + S + 1] - ay, e1z = data[t + S + 2] - az;
    const e2x = data[t + 2 * S] - ax, e2y = data[t + 2 * S + 1] - ay, e2z = data[t + 2 * S + 2] - az;
    const px = rd[1] * e2z - rd[2] * e2y, py = rd[2] * e2x - rd[0] * e2z, pz = rd[0] * e2y - rd[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const tx = ro[0] - ax, ty = ro[1] - ay, tz = ro[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (rd[0] * qx + rd[1] * qy + rd[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (d > 0 && d < best) { best = d; normal = [data[t + 3], data[t + 4], data[t + 5], data[t + 6]]; }
  }
  return best < Infinity ? { t: best, normal: normal.slice(0, 3), cap: normal[3] > 0.5 } : null;
}
