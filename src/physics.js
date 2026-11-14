import { hullPoints } from './orange/mesh.js';
import { quat, v3 } from './math.js';

export const STEP = 1 / 120;

export async function createPhysics(rapierUrl = '../vendor/rapier/rapier.mjs') {
  const R = (await import(rapierUrl)).default;
  await R.init();
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const events = new R.EventQueue(true);
  const statics = [];
  const bodies = new Map();
  let accumulator = 0;
  let grab = null;
  const listeners = { impact: [] };

  function setColliders(list) {
    for (const b of statics) world.removeRigidBody(b);
    statics.length = 0;
    for (const c of list) {
      const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...c.centre));
      world.createCollider(R.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2).setFriction(0.8).setRestitution(0.05), body);
      statics.push(body);
    }
  }

  function addPiece(piece, { linvel = [0, 0, 0], angvel = [0, 0, 0], sleep = false } = {}) {
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(...piece.position)
      .setRotation({ x: piece.rotation[0], y: piece.rotation[1], z: piece.rotation[2], w: piece.rotation[3] })
      .setLinvel(...linvel).setAngvel({ x: angvel[0], y: angvel[1], z: angvel[2] })
      .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.9);
    const body = world.createRigidBody(desc);
    const pts = hullPoints(piece.geometry, piece.com);
    let cd = R.ColliderDesc.convexHull(pts);
    if (!cd) cd = R.ColliderDesc.ball(Math.max(0.004, Math.cbrt(piece.volume * 0.24)));
    cd.setDensity(950).setFriction(0.8).setRestitution(0.05)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0.02);
    const collider = world.createCollider(cd, body);
    body.userData = piece.id;
    piece.body = body;
    bodies.set(collider.handle, piece);
    if (sleep) body.sleep();
    return body;
  }

  function removePiece(piece) {
    if (!piece.body) return;
    if (grab && grab.piece === piece) grab = null;
    for (let i = 0; i < piece.body.numColliders(); i++) bodies.delete(piece.body.collider(i).handle);
    world.removeRigidBody(piece.body);
    piece.body = null;
  }

  function setPose(piece, position, rotation, { linvel = [0, 0, 0], angvel = [0, 0, 0], sleep = false } = {}) {
    piece.position = position.slice();
    piece.rotation = rotation.slice();
    const b = piece.body;
    if (!b) return;
    b.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    b.setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] }, true);
    b.setLinvel({ x: linvel[0], y: linvel[1], z: linvel[2] }, true);
    b.setAngvel({ x: angvel[0], y: angvel[1], z: angvel[2] }, true);
    if (sleep) b.sleep();
  }

  function velocityAt(piece, point) {
    const b = piece.body;
    if (!b) return [0, 0, 0];
    const lv = b.linvel(), av = b.angvel();
    const r = v3.sub(point, piece.position);
    return v3.add([lv.x, lv.y, lv.z], v3.cross([av.x, av.y, av.z], r));
  }

  function applyGrab() {
    if (!grab) return;
    const { piece, anchor, target } = grab;
    const b = piece.body;
    if (!b) return;
    const world_ = v3.add(quat.rotate(piece.rotation, anchor), piece.position);
    const m = b.mass();
    const vel = velocityAt(piece, world_);
    const k = 900, c = 2 * Math.sqrt(k) * 0.9;
    const f = v3.sub(v3.scale(v3.sub(target, world_), k), v3.scale(vel, c));
    const imp = v3.scale(f, m * STEP);
    b.applyImpulseAtPoint({ x: imp[0], y: imp[1] + 9.81 * m * STEP, z: imp[2] }, { x: world_[0], y: world_[1], z: world_[2] }, true);
    const av = b.angvel();
    b.setAngvel({ x: av.x * 0.96, y: av.y * 0.96, z: av.z * 0.96 }, true);
  }

  function step(dt, pieces) {
    accumulator = Math.min(accumulator + dt, STEP * 8);
    let n = 0;
    while (accumulator >= STEP - 1e-9) {
      applyGrab();
      world.step(events);
      accumulator -= STEP;
      n++;
      events.drainContactForceEvents((e) => {
        const piece = bodies.get(e.collider1()) || bodies.get(e.collider2());
        const impulse = e.totalForceMagnitude() * STEP;
        if (piece) for (const f of listeners.impact) f(piece, impulse);
      });
    }
    for (const p of pieces) {
      if (!p.body) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.position = [t.x, t.y, t.z];
      p.rotation = [r.x, r.y, r.z, r.w];
      if (p.position[1] < -2) setPose(p, [0, 0.1, 0], p.rotation);
    }
    return n;
  }

  return {
    R, world, setColliders, addPiece, removePiece, setPose, velocityAt, step,
    on(name, f) { listeners[name].push(f); },
    grab(piece, anchorRest, target) { grab = { piece, anchor: v3.sub(anchorRest, piece.com), target }; piece.body?.wakeUp(); },
    moveGrab(target) { if (grab) grab.target = target; },
    release(vel) {
      if (!grab) return;
      const b = grab.piece.body;
      if (b && vel) b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
      grab = null;
    },
    get grabbing() { return grab?.piece || null; },
    awake(pieces) { return pieces.filter((p) => p.body && !p.body.isSleeping()).length; },
  };
}
