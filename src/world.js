import { orangeMesh, hullPoints } from './orange/mesh.js';
import { slicePiece } from './orange/slice.js';
import { createPiece, updateModel, disposePiece, worldToRest, worldDirToRest, restToWorld, drawable } from './orange/piece.js';
import { quat, v3 } from './math.js';

const MIN_VOLUME = 3e-8;

export function createWorld(gl, { juice, audio, rng }) {
  const w = { pieces: [], params: null, physics: null, floorAt: () => 0, baseMesh: null, cuts: 0 };

  function hull(piece) { return piece.hull || (piece.hull = hullPoints(piece.geometry, piece.com)); }

  function lowestY(piece, rotation = piece.rotation) {
    const h = hull(piece);
    let lo = Infinity;
    for (let i = 0; i < h.length; i += 3) lo = Math.min(lo, quat.rotate(rotation, [h[i], h[i + 1], h[i + 2]])[1]);
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
    w.params = params;
    w.cuts = 0;
    if (!w.baseMesh || w.baseMesh.params !== params) w.baseMesh = { params, mesh: orangeMesh(params) };
    const piece = createPiece(gl, w.baseMesh.mesh);
    let rot = quat.identity();
    if (tilt) {
      const axis = v3.norm([rng() - 0.5, 0, rng() - 0.5]);
      rot = quat.mul(quat.axisAngle([0, 1, 0], rng() * Math.PI * 2), quat.axisAngle(axis, 0.06 + rng() * 0.12));
    }
    place(piece, [0, w.floorAt(0, 0), 0], rot);
    add(piece);
    return piece;
  }

  function originWorld() {
    const p = w.pieces[0];
    return p ? restToWorld(p, [0, 0, 0]) : [0, 0.04, 0];
  }

  function cut(point, normal, only = null, { impulse = 0.05, sound = true, juiceAmount = 1 } = {}) {
    const n = v3.norm(normal);
    let count = 0;
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
        k.rotation = piece.rotation.slice();
        k.position = restToWorld(piece, k.com);
        k.hasPrev = false;
        updateModel(k);
        k.prevModel.set(prev);
        add(k, { linvel: v3.add(vels[i], v3.scale(n, (i === 0 ? 1 : -1) * impulse)), angvel: [av.x, av.y, av.z] });
        for (const c of k.caps) if (Math.abs(Math.abs(v3.dot(c.normal, rn)) - 1) < 1e-4) juice.emitFromCap(k, c, w.params, Math.round(26 * juiceAmount), 0.22);
      });
      count++;
      w.cuts++;
    }
    if (count && sound) audio.slice(Math.min(1.4, 0.7 + count * 0.15));
    return count;
  }

  function attachPhysics(physics, colliders) {
    w.physics = physics;
    physics.setColliders(colliders);
    for (const p of w.pieces) physics.addPiece(p, { sleep: p.sleepOnAttach });
  }

  function update(dt) {
    if (w.physics) w.physics.step(dt, w.pieces);
    for (const p of w.pieces) updateModel(p);
  }

  function cutFaces() { return w.pieces.reduce((s, p) => s + p.caps.length, 0); }

  function bounds() {
    if (!w.pieces.length) return { centre: [0, 0.03, 0], radius: 0.05 };
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of w.pieces) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.position[k] - p.radius); hi[k] = Math.max(hi[k], p.position[k] + p.radius); }
    return { centre: lo.map((v, k) => (v + hi[k]) / 2), radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
  }

  Object.assign(w, { add, remove, clear, place, newOrange, cut, attachPhysics, update, cutFaces, bounds, lowestY, originWorld, drawables: () => w.pieces.map(drawable) });
  return w;
}
