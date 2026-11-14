import { v3 } from '../math.js';
import { STRIDE } from './mesh.js';

class Sink {
  constructor(cap) { this.data = new Float32Array(cap * STRIDE); this.n = 0; }
  push(src, k) {
    if ((this.n + 1) * STRIDE > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    for (let c = 0; c < STRIDE; c++) this.data[this.n * STRIDE + c] = src[k + c];
    this.n++;
  }
  mesh() { return { data: this.data.slice(0, this.n * STRIDE), count: this.n }; }
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
  let cx = 0, cy = 0;
  for (const h of hull) { cx += h[0]; cy += h[1]; }
  cx /= hull.length; cy /= hull.length;
  const centre = v3.add(point, v3.add(v3.scale(u, cx), v3.scale(w, cy)));
  const vert = (p, nn) => new Float32Array([p[0], p[1], p[2], nn[0], nn[1], nn[2], 1]);
  const mn = v3.scale(n, -1);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i][2], b = hull[(i + 1) % hull.length][2];
    neg.push(vert(centre, n), 0); neg.push(vert(a, n), 0); neg.push(vert(b, n), 0);
    pos.push(vert(centre, mn), 0); pos.push(vert(b, mn), 0); pos.push(vert(a, mn), 0);
  }
  return [pos.mesh(), neg.mesh()];
}
