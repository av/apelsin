import { quat, v3 } from './math.js';

export const STEP = 1 / 120;

const ROLL_DECEL = 2.4;
const ROLL_DAMP = 0.9;
const REST_SPEED = 0.006;
const REST_SPIN = 0.12;
const REST_TIME = 0.3;
const GROUP_STATIC = 0x0001, GROUP_BALL = 0x0002;
const groups = (member, filter) => (member << 16) | filter;

function exitDistance(piece, p, d, rmax) {
  const b = v3.dot(p, d), c = v3.dot(p, p) - rmax * rmax;
  let t = -b + Math.sqrt(Math.max(0, b * b - c));
  for (const cap of piece.caps) {
    const den = v3.dot(cap.normal, d);
    if (den > 1e-6) t = Math.min(t, (cap.d - v3.dot(cap.normal, p)) / den);
  }
  return Math.max(0, t);
}

function massPoints(piece) {
  const { data, count } = piece.geometry, S = 7;
  const stride = Math.max(1, Math.floor(count / 900));
  const out = new Float32Array(Math.ceil(count / stride) * 3);
  let n = 0;
  for (let i = 0; i < count; i += stride) {
    out[n++] = data[i * S] - piece.com[0]; out[n++] = data[i * S + 1] - piece.com[1]; out[n++] = data[i * S + 2] - piece.com[2];
  }
  return out.subarray(0, n);
}

export function contactBalls(piece) {
  const { data, count } = piece.geometry, S = 7, tris = count / 3;
  let rmax = 0;
  for (let i = 0; i < count; i++) rmax = Math.max(rmax, Math.hypot(data[i * S], data[i * S + 1], data[i * S + 2]));
  const flatMax = Math.min(0.009, piece.radius * 0.3);
  const cell = 0.008;
  const grid = new Map();
  const balls = [];
  const cellKey = (x, y, z) => (Math.floor(x / cell) + 512) * 1048576 + (Math.floor(y / cell) + 512) * 1024 + (Math.floor(z / cell) + 512);
  const near = (centre, gap) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const o of grid.get(cellKey(centre[0] + dx * cell, centre[1] + dy * cell, centre[2] + dz * cell)) || []) {
        if (Math.hypot(o[0] - centre[0], o[1] - centre[1], o[2] - centre[2]) < Math.max(gap, o[3])) return true;
      }
    }
    return false;
  };
  const candidates = Math.min(tris, 3200);
  const stride = tris / candidates;
  for (let k = 0; k < candidates && balls.length < 500; k++) {
    const t = ((Math.floor(k * stride) * 7919) % tris) * 3 * S;
    const c = [0, 1, 2].map((j) => (data[t + j] + data[t + S + j] + data[t + 2 * S + j]) / 3);
    const n = v3.norm([0, 1, 2].map((j) => data[t + 3 + j] + data[t + S + 3 + j] + data[t + 2 * S + 3 + j]));
    const flat = data[t + 6] > 0.5;
    const inward = v3.scale(n, -1);
    const thick = exitDistance(piece, c, inward, rmax);
    let r;
    if (flat) {
      const planar = v3.sub(c, v3.scale(n, v3.dot(c, n)));
      const room = Math.sqrt(Math.max(0, rmax * rmax - v3.dot(c, n) ** 2)) - v3.len(planar);
      r = Math.min(flatMax, thick * 0.45, Math.max(0.0012, room));
    } else r = Math.min(v3.len(c) * 0.35, thick * 0.47, 0.012);
    r = Math.max(0.001, r);
    const centre = v3.add(c, v3.scale(inward, r));
    if (near(centre, r * (flat ? 0.8 : 0.4))) continue;
    const key = cellKey(...centre);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([...centre, r * 0.4]);
    balls.push([centre[0] - piece.com[0], centre[1] - piece.com[1], centre[2] - piece.com[2], r, flat]);
  }
  return balls;
}

export async function createPhysics(rapierUrl = '../vendor/rapier/rapier.mjs') {
  const R = (await import(rapierUrl)).default;
  await R.init();
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  world.numSolverIterations = 8;
  world.lengthUnit = 0.05;
  const events = new R.EventQueue(true);
  const statics = [];
  const staticHandles = new Set();
  const owner = new Map();
  let accumulator = 0, clock = 0;
  let grab = null;
  const listeners = { impact: [] };
  const touch = new Map();

  function setColliders(list) {
    for (const b of statics) world.removeRigidBody(b);
    statics.length = 0;
    staticHandles.clear();
    for (const c of list) {
      const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...c.centre));
      const col = world.createCollider(R.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2).setFriction(0.85).setRestitution(0.1).setCollisionGroups(groups(GROUP_STATIC, GROUP_BALL)), body);
      staticHandles.add(col.handle);
      statics.push(body);
    }
    for (const p of new Set(owner.values())) if (p.body) { p.held = false; p.body.wakeUp(); }
  }

  function addPiece(piece, { linvel = [0, 0, 0], angvel = [0, 0, 0], sleep = false } = {}) {
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(...piece.position)
      .setRotation({ x: piece.rotation[0], y: piece.rotation[1], z: piece.rotation[2], w: piece.rotation[3] })
      .setLinvel(...linvel).setAngvel({ x: angvel[0], y: angvel[1], z: angvel[2] })
      .setCcdEnabled(true).setLinearDamping(0.08).setAngularDamping(0.15);
    const body = world.createRigidBody(desc);
    const mass = R.ColliderDesc.convexHull(massPoints(piece)) || R.ColliderDesc.ball(Math.max(0.004, Math.cbrt(piece.volume * 0.24)));
    world.createCollider(mass.setDensity(950).setCollisionGroups(0), body);
    const whole = piece.caps.length === 0;
    const friction = whole ? 0.75 : 0.9, restitution = whole ? 0.22 : 0.08;
    for (const [x, y, z, r, wet] of contactBalls(piece)) {
      const ball = world.createCollider(R.ColliderDesc.ball(r + 0.0001).setTranslation(x, y, z).setDensity(0)
        .setFriction(wet ? 0.35 : friction).setFrictionCombineRule(wet ? R.CoefficientCombineRule.Min : R.CoefficientCombineRule.Average)
        .setRestitution(restitution).setCollisionGroups(groups(GROUP_BALL, GROUP_STATIC | GROUP_BALL))
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0.002), body);
      owner.set(ball.handle, piece);
    }
    body.userData = piece.id;
    piece.body = body;
    piece.restTime = 0;
    piece.contact = null;
    piece.held = !!sleep;
    piece.freshUntil = clock + (sleep ? 0 : 0.6);
    return body;
  }

  function removePiece(piece) {
    if (!piece.body) return;
    if (grab && grab.piece === piece) grab = null;
    for (let i = 0; i < piece.body.numColliders(); i++) owner.delete(piece.body.collider(i).handle);
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
    piece.restTime = 0;
    piece.held = !!sleep;
  }

  function velocityAt(piece, point) {
    const b = piece.body;
    if (!b) return [0, 0, 0];
    const lv = b.linvel(), av = b.angvel();
    const t = b.translation();
    const r = v3.sub(point, [t.x, t.y, t.z]);
    return v3.add([lv.x, lv.y, lv.z], v3.cross([av.x, av.y, av.z], r));
  }

  function applyGrab() {
    if (!grab) return;
    const { piece, anchor, target } = grab;
    const b = piece.body;
    if (!b) return;
    const t = b.translation(), r = b.rotation();
    const world_ = v3.add(quat.rotate([r.x, r.y, r.z, r.w], anchor), [t.x, t.y, t.z]);
    const m = b.mass();
    const vel = velocityAt(piece, world_);
    const k = 700, c = 2 * Math.sqrt(k) * 0.85;
    const f = v3.sub(v3.scale(v3.sub(target, world_), k), v3.scale(vel, c));
    const imp = v3.scale(f, m * STEP);
    b.applyImpulseAtPoint({ x: imp[0], y: imp[1] + 9.81 * m * STEP, z: imp[2] }, { x: world_[0], y: world_[1], z: world_[2] }, true);
    const av = b.angvel();
    b.setAngvel({ x: av.x * 0.97, y: av.y * 0.97, z: av.z * 0.97 }, true);
  }

  function hold(b) {
    b.setLinvel({ x: 0, y: 0, z: 0 }, false);
    b.setAngvel({ x: 0, y: 0, z: 0 }, false);
  }

  function collectContacts(emit) {
    touch.clear();
    events.drainContactForceEvents((e) => {
      const h1 = e.collider1(), h2 = e.collider2();
      const a = owner.get(h1), b = owner.get(h2);
      const f = e.totalForceMagnitude();
      for (const [p, other] of [[a, b ? 'piece' : 'ground'], [b, a ? 'piece' : 'ground']]) {
        if (!p) continue;
        const t = touch.get(p) || { force: 0, ground: false, piece: false };
        t.force += f;
        t[other] = true;
        touch.set(p, t);
      }
    });
    if (!emit) return;
    for (const [p, t] of touch) {
      if (!p.body) continue;
      const m = p.body.mass();
      const impulse = Math.max(0, t.force - m * 9.81 * 1.6) * STEP;
      if (impulse < 2e-4) continue;
      for (const f of listeners.impact) f(p, impulse, t.ground ? 'ground' : 'piece');
    }
  }

  function settleStep(piece, dt) {
    const b = piece.body;
    if (!b || b.isSleeping() || (grab && grab.piece === piece)) { piece.contact = null; piece.rolling = 0; if (grab && grab.piece === piece) piece.held = false; return; }
    const t = touch.get(piece);
    const contact = t ? (t.ground ? 'ground' : 'piece') : null;
    piece.contact = contact;
    const lv = b.linvel(), av = b.angvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z), spin = Math.hypot(av.x, av.y, av.z);
    piece.rolling = contact ? spin * piece.radius : 0;
    if (!contact) { piece.restTime = 0; piece.held = false; return; }
    if (piece.held) {
      if (speed > REST_SPEED * 5 || spin > REST_SPIN * 5) { piece.held = false; piece.restTime = 0; }
      else { hold(b); return; }
    }
    if (spin > 1e-6) {
      const keep = Math.max(0, spin - ROLL_DECEL * dt * Math.min(1, spin / 2.5)) / spin * Math.exp(-ROLL_DAMP * dt);
      b.setAngvel({ x: av.x * keep, y: av.y * keep, z: av.z * keep }, true);
    }
    if (speed < REST_SPEED && spin < REST_SPIN && !(piece.freshUntil > clock)) {
      piece.restTime += dt;
      if (piece.restTime > REST_TIME) { hold(b); piece.held = true; piece.restTime = 0; }
    } else piece.restTime = 0;
  }

  function sync(pieces) {
    for (const p of pieces) {
      if (!p.body) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.position = [t.x, t.y, t.z];
      p.rotation = [r.x, r.y, r.z, r.w];
      if (p.position[1] < -2) setPose(p, [0, 0.1, 0], p.rotation);
    }
  }

  function step(dt, pieces) {
    accumulator = Math.min(accumulator + dt, STEP * 8);
    let n = 0;
    while (accumulator >= STEP - 1e-9) {
      applyGrab();
      world.step(events);
      clock += STEP;
      accumulator -= STEP;
      n++;
      collectContacts(true);
      for (const p of pieces) settleStep(p, STEP);
    }
    sync(pieces);
    return n;
  }

  function settle(pieces, seconds = 3) {
    const steps = Math.round(seconds / STEP);
    for (const p of pieces) { p.held = false; p.restTime = 0; p.freshUntil = 0; }
    for (let i = 0; i < steps; i++) {
      world.step(events);
      collectContacts(false);
      for (const p of pieces) settleStep(p, STEP);
      if (i > 30 && pieces.every((p) => !p.body || p.held || p.body.isSleeping())) break;
    }
    for (const p of pieces) {
      if (!p.body) continue;
      hold(p.body);
      p.held = true;
      p.rolling = 0;
    }
    accumulator = 0;
    sync(pieces);
  }

  return {
    R, world, setColliders, addPiece, removePiece, setPose, velocityAt, step, settle,
    on(name, f) { listeners[name].push(f); },
    grab(piece, anchorRest, target) { grab = { piece, anchor: v3.sub(anchorRest, piece.com), target }; piece.restTime = 0; piece.held = false; piece.body?.wakeUp(); },
    moveGrab(target) { if (grab) grab.target = target; },
    release(vel) {
      if (!grab) return;
      const b = grab.piece.body;
      if (b && vel) b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
      grab.piece.freshUntil = clock + 0.4;
      grab = null;
    },
    wake(piece) { piece.restTime = 0; piece.held = false; piece.body?.wakeUp(); },
    get grabbing() { return grab?.piece || null; },
    awake(pieces) { return pieces.filter((p) => p.body && !p.body.isSleeping()).length; },
  };
}
