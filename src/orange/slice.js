import { v3 } from '../math.js';
import { STRIDE } from './mesh.js';

let nextCap = 1;
const SPACING = 0.0018;

class Sink {
  constructor(cap) { this.data = new Float32Array(cap * STRIDE); this.n = 0; }
  push(src, k) {
    if ((this.n + 1) * STRIDE > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    for (let c = 0; c < STRIDE; c++) this.data[this.n * STRIDE + c] = src[k + c];
    this.n++;
  }
  mesh(extra) { return { data: this.data.slice(0, this.n * STRIDE), count: this.n, ...extra }; }
}

function lerpVertex(src, a, b, t, out) {
  for (let c = 0; c < STRIDE; c++) out[c] = src[a + c] + (src[b + c] - src[a + c]) * t;
  const l = Math.hypot(out[3], out[4], out[5]) || 1;
  out[3] /= l; out[4] /= l; out[5] /= l;
  return out;
}

function convexHull2D(points) {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-14) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-14) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function slicePiece(mesh, point, normal) {
  const n = v3.norm(normal), S = STRIDE, src = mesh.data;
  const pos = new Sink(mesh.count / 2 + 1024), neg = new Sink(mesh.count / 2 + 1024);
  const cut = [];
  const dist = new Float32Array(3);
  const tmp = [new Float32Array(S), new Float32Array(S), new Float32Array(S), new Float32Array(S)];
  for (let t = 0; t < mesh.count; t += 3) {
    const base = t * S;
    let np = 0;
    for (let i = 0; i < 3; i++) {
      const k = base + i * S;
      dist[i] = (src[k] - point[0]) * n[0] + (src[k + 1] - point[1]) * n[1] + (src[k + 2] - point[2]) * n[2];
      if (dist[i] >= 0) np++;
    }
    if (np === 3) { for (let i = 0; i < 3; i++) pos.push(src, base + i * S); continue; }
    if (np === 0) { for (let i = 0; i < 3; i++) neg.push(src, base + i * S); continue; }
    const loneIsPos = np === 1;
    let lone = 0;
    for (let i = 0; i < 3; i++) if ((dist[i] >= 0) === loneIsPos) lone = i;
    const i0 = lone, i1 = (lone + 1) % 3, i2 = (lone + 2) % 3;
    const k0 = base + i0 * S, k1 = base + i1 * S, k2 = base + i2 * S;
    const a = lerpVertex(src, k0, k1, dist[i0] / (dist[i0] - dist[i1]), tmp[0]);
    const b = lerpVertex(src, k0, k2, dist[i0] / (dist[i0] - dist[i2]), tmp[1]);
    cut.push([a[0], a[1], a[2]], [b[0], b[1], b[2]]);
    const loneSink = loneIsPos ? pos : neg, other = loneIsPos ? neg : pos;
    loneSink.push(src, k0); loneSink.push(a, 0); loneSink.push(b, 0);
    other.push(a, 0); other.push(src, k1); other.push(src, k2);
    other.push(a, 0); other.push(src, k2); other.push(b, 0);
  }
  if (pos.n === 0 || neg.n === 0 || cut.length < 6) return null;
  const u = v3.norm(Math.abs(n[1]) < 0.9 ? v3.cross([0, 1, 0], n) : v3.cross([1, 0, 0], n));
  const w = v3.cross(n, u);
  const flat = cut.map((p) => { const d = v3.sub(p, point); return [v3.dot(d, u), v3.dot(d, w), p]; });
  const hull = convexHull2D(flat);
  if (hull.length < 3) return null;
  let ax = 0, ay = 0, area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i], [x1, y1] = hull[(i + 1) % hull.length];
    const c = x0 * y1 - x1 * y0;
    area += c; ax += (x0 + x1) * c; ay += (y0 + y1) * c;
  }
  const centre = v3.add(point, v3.add(v3.scale(u, ax / (3 * area)), v3.scale(w, ay / (3 * area))));
  const negId = nextCap++, posId = nextCap++;
  const d = v3.dot(n, point);
  const planes = { ...(mesh.planes || {}), [negId]: [...n, d], [posId]: [-n[0], -n[1], -n[2], -d] };
  const grid = capGrid(hull.map((h) => h[2]), centre);
  emitCap(neg, grid, n, negId);
  emitCap(pos, grid, v3.scale(n, -1), posId);
  return [pos.mesh({ planes, params: mesh.params }), neg.mesh({ planes, params: mesh.params })];
}

function capGrid(boundary, centre) {
  const N = boundary.length;
  const len = [0];
  for (let i = 0; i < N; i++) len.push(len[i] + v3.len(v3.sub(boundary[(i + 1) % N], boundary[i])));
  const perimeter = len[N];
  const along = (u) => {
    const s = u * perimeter;
    let i = 0;
    while (i < N - 1 && len[i + 1] < s) i++;
    const t = (s - len[i]) / Math.max(len[i + 1] - len[i], 1e-12);
    return v3.add(boundary[i], v3.scale(v3.sub(boundary[(i + 1) % N], boundary[i]), t));
  };
  let reach = 0;
  for (const b of boundary) reach = Math.max(reach, v3.len(v3.sub(b, centre)));
  const K = Math.min(Math.max(Math.ceil(reach / SPACING), 3), 60);
  const verts = [{ p: centre }];
  const rings = [[0]];
  for (let k = 1; k <= K; k++) {
    const t = k / K, ring = [];
    if (k === K) {
      for (let i = 0; i < N; i++) { ring.push(verts.length); verts.push({ p: boundary[i], u: len[i] / perimeter }); }
    } else {
      const m = Math.max(6, Math.round((perimeter * t) / SPACING));
      for (let j = 0; j < m; j++) {
        const h = along(j / m);
        ring.push(verts.length);
        verts.push({ p: v3.add(centre, v3.scale(v3.sub(h, centre), t)), u: j / m });
      }
    }
    rings.push(ring);
  }
  const tris = [];
  for (let j = 0; j < rings[1].length; j++) tris.push(0, rings[1][j], rings[1][(j + 1) % rings[1].length]);
  for (let k = 1; k < K; k++) {
    const A = rings[k], B = rings[k + 1], m = A.length, nB = B.length;
    const ua = (i) => (i >= m ? 1 : verts[A[i]].u), ub = (j) => (j >= nB ? 1 : verts[B[j]].u);
    let i = 0, j = 0;
    while (i < m || j < nB) {
      if (j >= nB || (i < m && ua(i + 1) <= ub(j + 1))) { tris.push(A[i % m], A[(i + 1) % m], B[j % nB]); i++; }
      else { tris.push(A[i % m], B[(j + 1) % nB], B[j % nB]); j++; }
    }
  }
  return { verts, tris };
}

function emitCap(sink, grid, outward, id) {
  const { verts, tris } = grid;
  const out = new Float32Array(STRIDE);
  for (let t = 0; t < tris.length; t += 3) {
    let a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const f = v3.cross(v3.sub(verts[b].p, verts[a].p), v3.sub(verts[c].p, verts[a].p));
    if (v3.dot(f, outward) < 0) { const tmp = b; b = c; c = tmp; }
    for (const k of [a, b, c]) {
      const p = verts[k].p;
      out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; out[3] = outward[0]; out[4] = outward[1]; out[5] = outward[2]; out[6] = id;
      sink.push(out, 0);
    }
  }
}
