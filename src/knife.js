import { mesh as glMesh } from './gl.js';
import { ATTRIBS } from './shaders/materials.js';
import { STRIDE } from './orange/mesh.js';
import { mat4, v3, clamp } from './math.js';

const L = 0.15;
const H = 0.031;
const CONTACT = 0.68;
const TILT = 0.62;

const edgeY = (x) => { const t = x / L; return t < 0.5 ? 0 : H * 0.36 * ((t - 0.5) / 0.5) ** 2.1; };
const spineY = (x) => { const t = x / L; return t < 0.58 ? H : H - (H - H * 0.36) * ((t - 0.58) / 0.42) ** 1.55; };
const thick = (x) => 0.0021 - 0.0013 * (x / L);

function knifeMesh() {
  const data = [];
  const push = (p, n, cap) => data.push(p[0], p[1], p[2], n[0], n[1], n[2], cap);
  const quad = (a, b, c, d, cap, flip = false) => {
    let n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(d, a)));
    if (flip) n = v3.scale(n, -1);
    if (!Number.isFinite(n[0]) || v3.len(n) < 0.5) n = [0, 0, 1];
    if (flip) { push(a, n, cap); push(c, n, cap); push(b, n, cap); push(a, n, cap); push(d, n, cap); push(c, n, cap); }
    else { push(a, n, cap); push(b, n, cap); push(c, n, cap); push(a, n, cap); push(c, n, cap); push(d, n, cap); }
  };
  const N = 72;
  const ring = (x) => {
    const ye = edgeY(x), ys = Math.max(spineY(x), ye + 0.0004), t = thick(x) / 2, bh = Math.min(0.0018, (ys - ye) * 0.35);
    const shoulder = Math.min(t * 0.8, 0.00042);
    return [[x, ys, t], [x, ye + bh, shoulder], [x, ye, 0], [x, ye + bh, -shoulder], [x, ys, -t]];
  };
  for (let i = 0; i < N; i++) {
    const x0 = (i / N) * L, x1 = ((i + 1) / N) * L;
    const a = ring(x0), b = ring(x1);
    for (let k = 0; k < 5; k++) {
      const k2 = (k + 1) % 5;
      quad(a[k], b[k], b[k2], a[k2], 0, true);
    }
  }
  const box = (x0, x1, y0, y1, z, cap, round = 0.3) => {
    const seg = 12;
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const e = round;
      const px = Math.sign(c) * Math.abs(c) ** e, py = Math.sign(s) * Math.abs(s) ** e;
      pts.push([(y0 + y1) / 2 + py * (y1 - y0) / 2, px * z]);
    }
    const stations = [x0, x1];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const A = [stations[0], pts[i][0], pts[i][1]], B = [stations[1], pts[i][0], pts[i][1]], C = [stations[1], pts[j][0], pts[j][1]], D = [stations[0], pts[j][0], pts[j][1]];
      quad(A, B, C, D, cap, false);
    }
    for (const [xs, dir] of [[x0, -1], [x1, 1]]) {
      const c = [xs, (y0 + y1) / 2, 0];
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        const p = [xs, pts[i][0], pts[i][1]], q = [xs, pts[j][0], pts[j][1]];
        const n = [dir, 0, 0];
        if (dir > 0) { push(c, n, cap); push(p, n, cap); push(q, n, cap); } else { push(c, n, cap); push(q, n, cap); push(p, n, cap); }
      }
    }
  };
  box(-0.014, 0.0005, -0.0015, H + 0.001, 0.0042, 0, 0.25);
  box(-0.125, -0.014, H * 0.5 - 0.0125, H * 0.5 + 0.0115, 0.0085, 1, 0.45);
  return new Float32Array(data);
}

export function createKnife(gl) {
  const data = knifeMesh();
  const gpu = glMesh(gl, { data, stride: STRIDE, attribs: [[ATTRIBS.aPos, 3], [ATTRIBS.aNormal, 3], [ATTRIBS.aCap, 1]], count: data.length / STRIDE });
  const model = mat4.create(), prevModel = mat4.create();
  const contactLocal = [CONTACT * L, edgeY(CONTACT * L), 0];
  const k = {
    visible: false, contact: [0, 0, 0], edge: [1, 0, 0], up: [0, 1, 0], view: [0, 0, -1],
    phase: 'idle', t: 0, enter: 0, exitFrom: null, centre: [0, 0, 0], hasPrev: false,
  };

  function frame(contact, edge, up) {
    const z = v3.norm(v3.cross(edge, up));
    const y = v3.cross(z, edge);
    const m = new Float32Array([edge[0], edge[1], edge[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]);
    const o = v3.sub(contact, v3.add(v3.add(v3.scale(edge, contactLocal[0]), v3.scale(y, contactLocal[1])), v3.scale(z, contactLocal[2])));
    m[12] = o[0]; m[13] = o[1]; m[14] = o[2];
    return m;
  }

  function spineFor(edge, view, camUp, prev) {
    let u = v3.norm(v3.cross(view, edge));
    if (!Number.isFinite(u[0])) u = camUp;
    const ref = prev ? v3.dot(u, prev) : v3.dot(u, camUp) + 1e-3;
    if (ref < 0) u = v3.scale(u, -1);
    const toCam = v3.scale(view, -1);
    return v3.norm(v3.add(v3.scale(u, Math.cos(TILT)), v3.scale(toCam, Math.sin(TILT))));
  }

  function setPose(contact, edge, view, camUp) {
    k.view = view;
    const flat = v3.norm(v3.sub(edge, v3.scale(view, v3.dot(edge, view))));
    k.edge = Number.isFinite(flat[0]) ? flat : k.edge;
    k.flatUp = spineFor(k.edge, view, camUp, k.flatUp ? k.rawUp : null);
    k.rawUp = v3.norm(v3.cross(view, k.edge));
    if (v3.dot(k.rawUp, k.flatUp) < 0) k.rawUp = v3.scale(k.rawUp, -1);
    k.up = k.flatUp;
    k.contact = contact;
  }

  return {
    get visible() { return k.visible; },
    get phase() { return k.phase; },
    begin(contact, edge, view, camUp) {
      k.flatUp = null;
      setPose(contact, edge, view, camUp);
      k.visible = true; k.phase = 'enter'; k.t = 0; k.hasPrev = false;
    },
    move(contact, edge, view, camUp, follow = 0.45) {
      if (!k.visible || k.phase === 'exit') return;
      const e = v3.norm(v3.lerp(k.edge, edge, follow));
      setPose(v3.lerp(k.contact, contact, 0.85), e, view, camUp);
    },
    release(cut) {
      if (!k.visible) return;
      k.phase = 'exit'; k.t = 0; k.cut = cut;
      k.exitFrom = { contact: k.contact.slice(), edge: k.edge.slice(), up: k.up.slice() };
    },
    update(dt) {
      if (!k.visible) return;
      k.t += dt;
      let contact = k.contact, up = k.up, edge = k.edge;
      if (k.phase === 'enter') {
        const s = clamp(k.t / 0.11, 0, 1), e = 1 - (1 - s) ** 3;
        contact = v3.add(k.contact, v3.add(v3.scale(k.up, 0.03 * (1 - e)), v3.scale(k.view, -0.02 * (1 - e))));
        if (s >= 1) k.phase = 'cut';
      } else if (k.phase === 'exit') {
        const s = clamp(k.t / 0.3, 0, 1), e = s * s * (3 - 2 * s);
        const f = k.exitFrom;
        contact = v3.add(f.contact, v3.add(v3.scale(f.edge, (k.cut ? 0.035 : 0.015) * Math.sqrt(s)), v3.add(v3.scale(f.up, 0.075 * e * e), v3.scale(k.view, -0.03 * e))));
        up = f.up; edge = f.edge;
        if (s >= 1) { k.visible = false; k.phase = 'idle'; }
      }
      if (k.hasPrev) prevModel.set(model);
      model.set(frame(contact, edge, up));
      if (!k.hasPrev) { prevModel.set(model); k.hasPrev = true; }
      k.centre = v3.add(contact, v3.scale(up, H * 0.5));
    },
    drawables() {
      if (!k.visible) return [];
      return [{ material: 'steel', mesh: gpu, model, prevModel, castShadow: true, centre: k.centre, radius: 0.05 }];
    },
  };
}
