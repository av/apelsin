import { orangeMesh, hullPoints, shapeRadius, shapeOf } from './orange/mesh.js';
import { supportPlanes } from './orange/proxy.js';
import { slicePiece } from './orange/slice.js';
import { createPiece, updateModel, disposePiece, worldToRest, worldDirToRest, restToWorld, drawable } from './orange/piece.js';
import { quat, v3, mulberry32 } from './math.js';

const MIN_VOLUME = 3e-8;

export function createWorld(gl, { juice, audio }) {
  const w = { pieces: [], params: null, physics: null, floorAt: () => 0, baseMesh: null, cuts: 0, time: 0 };

  function hull(piece) { return piece.hull || (piece.hull = hullPoints(piece.geometry, piece.com)); }

  function lowestY(piece, rotation = piece.rotation) {
    const [x, y, z, q] = rotation;
    const rx = 2 * (x * y + q * z), ry = 1 - 2 * (x * x + z * z), rz = 2 * (y * z - q * x);
    const d = piece.geometry.data, c = piece.com;
    let lo = Infinity;
    for (let i = 0; i < piece.geometry.count; i++) lo = Math.min(lo, rx * (d[i * 7] - c[0]) + ry * (d[i * 7 + 1] - c[1]) + rz * (d[i * 7 + 2] - c[2]));
    return lo;
  }

  function add(piece, opts = {}) {
    w.pieces.push(piece);
    piece.sleepOnAttach = !!opts.sleep;
    if (w.physics) w.physics.addPiece(piece, opts);
    return piece;
  }

  function remove(piece) {
    if (w.physics) w.physics.removePiece(piece);
    w.pieces = w.pieces.filter((p) => p !== piece);
    disposePiece(piece);
  }

  function clear() {
    for (const p of w.pieces.slice()) remove(p);
    juice.clear();
  }

  function place(piece, position, rotation, { sleep = false, drop = 0, linvel, angvel } = {}) {
    const pos = position.slice();
    pos[1] = (position[1] ?? 0) - lowestY(piece, rotation) + drop;
    piece.sleepOnAttach = sleep;
    if (w.physics && piece.body) w.physics.setPose(piece, pos, rotation, { sleep, linvel, angvel });
    else { piece.position = pos; piece.rotation = rotation.slice(); }
    piece.hasPrev = false;
    updateModel(piece);
  }

  function newOrange(params, { tilt = true } = {}) {
    clear();
    const key = `${params.variety}:${params.seed}`;
    if (!w.baseMesh || w.baseMesh.key !== key) {
      const mesh = orangeMesh(params);
      mesh.support = supportPlanes(mesh);
      w.baseMesh = { key, params, mesh };
    }
    params = w.baseMesh.params;
    w.params = params;
    w.shape = shapeOf(params);
    w.cuts = 0;
    const piece = createPiece(gl, w.baseMesh.mesh);
    let rot = quat.identity();
    if (tilt) {
      const rng = mulberry32(params.seed ^ 0x5bd1e995);
      const axis = v3.norm([rng() - 0.5, 0, rng() - 0.5]);
      const lean = params.c > params.a * 1.005 ? Math.PI / 2 - 0.12 + rng() * 0.1 : 0.06 + rng() * 0.12;
      rot = quat.mul(quat.axisAngle([0, 1, 0], rng() * Math.PI * 2), quat.axisAngle(axis, lean));
    }
    place(piece, [0, w.floorAt(0, 0), 0], rot);
    add(piece);
    return piece;
  }

  function originWorld() {
    const p = w.pieces[0];
    return p ? restToWorld(p, [0, 0, 0]) : [0, 0.04, 0];
  }

  function cut(point, normal, only = null, { impulse = 0.04, sound = true, juiceAmount = 1 } = {}) {
    const n = v3.norm(normal);
    let count = 0, area = 0;
    for (const piece of (only || w.pieces).slice()) {
      if (!w.pieces.includes(piece)) continue;
      const rp = worldToRest(piece, point), rn = worldDirToRest(piece, n);
      if (Math.abs(v3.dot(v3.sub(piece.com, rp), rn)) > piece.radius) continue;
      const halves = slicePiece(piece.geometry, rp, rn);
      if (!halves) continue;
      const kids = halves.map((g) => createPiece(gl, g));
      if (kids.some((k) => k.volume < MIN_VOLUME)) { kids.forEach(disposePiece); continue; }
      const av = piece.body ? piece.body.angvel() : { x: 0, y: 0, z: 0 };
      const vels = kids.map((k) => (w.physics && piece.body ? w.physics.velocityAt(piece, restToWorld(piece, k.com)) : [0, 0, 0]));
      const prev = piece.prevModel.slice();
      remove(piece);
      kids.forEach((k, i) => {
        const side = i === 0 ? 1 : -1;
        k.rotation = piece.rotation.slice();
        k.position = v3.add(restToWorld(piece, k.com), v3.scale(n, side * 0.00015));
        k.hasPrev = false;
        updateModel(k);
        k.prevModel.set(prev);
        k.bornAt = w.time;
        const out = v3.scale(n, side);
        const tip = v3.scale(v3.cross([0, 1, 0], out), impulse * 20 * Math.sqrt(Math.max(0, 1 - n[1] * n[1])));
        add(k, { linvel: v3.add(vels[i], v3.add(v3.scale(out, impulse), [0, impulse * 0.3, 0])), angvel: v3.add([av.x, av.y, av.z], tip) });
        for (const c of k.caps) {
          if (Math.abs(Math.abs(v3.dot(c.normal, rn)) - 1) > 1e-4 || Math.abs(v3.dot(c.normal, rp) - c.d) > 2e-4) continue;
          if (i === 0) area += c.area;
          if (juiceAmount > 0) juice.cutBurst(k, c, w.params, juiceAmount);
          juice.fresh(k, c, juiceAmount > 0 ? 4 + 3 * juiceAmount : 2);
        }
      });
      count++;
      w.cuts++;
    }
    if (count && sound) audio.slice({ area, pieces: count, surface: w.surfaceAt ? w.surfaceAt() : 'paper' });
    return count;
  }

  function attachPhysics(physics, colliders) {
    w.physics = physics;
    physics.setColliders(colliders);
    for (const p of w.pieces) physics.addPiece(p, { sleep: p.sleepOnAttach });
  }

  function update(dt) {
    w.time += dt;
    if (w.physics) w.physics.step(dt, w.pieces);
    for (const p of w.pieces) updateModel(p);
  }

  function depthInside(piece, rest) {
    const r = v3.len(rest);
    if (r < 1e-6) return Infinity;
    let depth = shapeRadius(w.params, v3.scale(rest, 1 / r)) - r;
    for (const c of piece.caps) depth = Math.min(depth, c.d - v3.dot(rest, c.normal));
    return depth;
  }

  function lowestVertex(piece) {
    const d = piece.geometry.data, m = piece.model;
    let lo = Infinity;
    for (let i = 0; i < piece.geometry.count; i++) lo = Math.min(lo, m[1] * d[i * 7] + m[5] * d[i * 7 + 1] + m[9] * d[i * 7 + 2] + m[13]);
    return lo;
  }

  function contacts() {
    const gaps = w.pieces.map((p) => lowestVertex(p) - w.floorAt(p.position[0], p.position[2]));
    let floor = Infinity, overlap = 0;
    for (const p of w.pieces) {
      floor = Math.min(floor, p.position[1] + lowestY(p) - w.floorAt(p.position[0], p.position[2]));
      const h = hull(p);
      for (const q of w.pieces) {
        if (q === p || v3.len(v3.sub(p.position, q.position)) > p.radius + q.radius) continue;
        for (let i = 0; i < h.length; i += 3) {
          const world = v3.add(quat.rotate(p.rotation, [h[i], h[i + 1], h[i + 2]]), p.position);
          overlap = Math.max(overlap, depthInside(q, worldToRest(q, world)));
        }
      }
    }
    return { floor: Number.isFinite(floor) ? floor : 0, overlap, gaps };
  }

  function cutFaces() { return w.pieces.reduce((s, p) => s + p.caps.length, 0); }

  function bounds() {
    if (!w.pieces.length) return { centre: [0, 0.03, 0], radius: 0.05 };
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of w.pieces) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.position[k] - p.radius); hi[k] = Math.max(hi[k], p.position[k] + p.radius); }
    return { centre: lo.map((v, k) => (v + hi[k]) / 2), radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
  }

  Object.assign(w, { add, remove, clear, place, newOrange, cut, attachPhysics, update, cutFaces, contacts, bounds, lowestY, originWorld, drawables: () => w.pieces.map(drawable) });
  return w;
}
