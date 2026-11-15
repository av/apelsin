import { quat, v3, mulberry32 } from './math.js';

export const PRESET_NAMES = ['whole', 'halves', 'wedges', 'reference'];

const deg = Math.PI / 180;
const HALF_TILT = 58 * deg;

function cameraFrame(yaw) {
  return { right: [Math.cos(yaw), 0, -Math.sin(yaw)], toCamera: [Math.sin(yaw), 0, Math.cos(yaw)] };
}

function capWithNormal(piece, restNormal) {
  return piece.caps.reduce((best, c) => (v3.dot(c.normal, restNormal) > (best ? v3.dot(best.normal, restNormal) : -2) ? c : best), null);
}

function onPlane(world, x, z) { return [x, world.floorAt(x, z), z]; }

function axialCuts(app, origin, angles, opts = {}) {
  for (const a of angles) app.world.cut(origin, [Math.cos(a), 0, Math.sin(a)], null, { impulse: 0, sound: false, juiceAmount: 0, ...opts });
}

function frame(app, view) {
  const b = app.world.bounds();
  app.camera.set({ ...app.scene.camera, ...view, target: [b.centre[0], view.height ?? 0.01, b.centre[2]], fov: 25 * deg });
}

function dripFromCaps(app, pieces, seconds) {
  for (const p of pieces) for (const c of p.caps) app.juice.fresh(p, c, seconds);
}

const LAYOUTS = {
  whole(app) {
    app.camera.set({ ...app.scene.camera, fov: 25 * deg });
  },

  halves(app) {
    const o = app.world.originWorld();
    app.world.cut(o, [0, 1, 0], null, { impulse: 0, juiceAmount: 0 });
    const yaw = app.scene.camera.yaw;
    const { right, toCamera } = cameraFrame(yaw);
    const [top, bottom] = app.world.pieces.slice().sort((a, b) => b.com[1] - a.com[1]);
    const a = app.world.params.a;
    const back = quat.mul(quat.axisAngle([0, 1, 0], 0.9), quat.fromTo(bottom.caps[0].normal, [0, 1, 0]));
    const backAt = v3.add(v3.scale(right, 0.02), v3.scale(toCamera, -a * 0.75));
    app.world.place(bottom, onPlane(app.world, backAt[0], backAt[2]), back, { drop: 0.001 });
    const face = v3.norm(v3.add(v3.scale(v3.norm(v3.sub(toCamera, v3.scale(right, 0.45))), Math.cos(HALF_TILT)), [0, Math.sin(HALF_TILT), 0]));
    const front = quat.mul(quat.axisAngle(face, 0.4), quat.fromTo(top.caps[0].normal, face));
    const frontAt = v3.add(v3.scale(right, -0.022), v3.scale(toCamera, a * 0.85));
    app.world.place(top, onPlane(app.world, frontAt[0], frontAt[2]), front, { drop: 0.001 });
    app.settle();
    frame(app, { pitch: 0.42, distance: 0.34, height: 0.022 });
  },

  wedges(app) {
    const rng = mulberry32((app.seed ^ 0x2545f491) >>> 0);
    const jit = (a) => (rng() * 2 - 1) * a;
    const o = v3.add(app.world.originWorld(), [jit(0.0008), 0, jit(0.0008)]);
    const a0 = jit(2 * deg);
    app.world.cut(o, [Math.cos(a0), 0, Math.sin(a0)], null, { impulse: 0, juiceAmount: 0 });
    axialCuts(app, o, [45 * deg + jit(3.5 * deg), 90 * deg + jit(3 * deg), 135 * deg + jit(3.5 * deg)]);
    const yaw = app.scene.camera.yaw;
    const { right, toCamera } = cameraFrame(yaw);
    const pieces = app.world.pieces.slice().sort((a, b) => Math.atan2(a.com[2], a.com[0]) - Math.atan2(b.com[2], b.com[0]));
    const at = (r, c) => v3.add(v3.scale(right, r), v3.scale(toCamera, c));
    const boat = (p, dirYaw, flip) => {
      const bis = v3.norm([p.com[0], 0, p.com[2]]);
      const down = quat.fromTo(bis, [0, -1, 0]);
      const axisNow = quat.rotate(down, [0, flip ? -1 : 1, 0]);
      const dir = quat.rotate(quat.axisAngle([0, 1, 0], dirYaw), toCamera);
      return quat.mul(quat.fromTo([axisNow[0], 0, axisNow[2]], dir), down);
    };
    const side = (p, faceYaw, which) => {
      const big = p.caps.slice().sort((a, b) => b.area - a.area);
      const [lie, show] = which ? [big[0], big[1]] : [big[1], big[0]];
      const down = quat.fromTo(lie.normal, [0, -1, 0]);
      const up = quat.rotate(down, show.normal);
      const face = quat.rotate(quat.axisAngle([0, 1, 0], faceYaw), toCamera);
      return quat.mul(quat.fromTo([up[0], 0, up[2]], face), down);
    };
    const plan = [
      { rot: (p) => boat(p, 62 * deg, 0), pos: at(-0.075, -0.04), drop: 0.002 },
      { rot: (p) => boat(p, 84 * deg, 1), pos: at(-0.02, -0.062), drop: 0.004 },
      { rot: (p) => boat(p, 100 * deg, 0), pos: at(0.04, -0.06), drop: 0.003 },
      { rot: (p) => side(p, 32 * deg, 1), pos: at(0.088, -0.022), drop: 0.003 },
      { rot: (p) => boat(p, 70 * deg, 1), pos: at(0.002, -0.022), drop: 0.016 },
      { rot: (p) => side(p, -24 * deg, 0), pos: at(-0.062, 0.03), drop: 0.003 },
      { rot: (p) => side(p, 10 * deg, 1), pos: at(0.04, 0.036), drop: 0.003 },
      { rot: (p) => side(p, -4 * deg, 0), pos: at(-0.012, 0.022), drop: 0.024 },
    ];
    pieces.forEach((p, i) => app.world.place(p, onPlane(app.world, plan[i].pos[0], plan[i].pos[2]), plan[i].rot(p), { drop: plan[i].drop }));
    app.settle(3);
    dripFromCaps(app, app.world.pieces, 6);
    for (const p of app.world.pieces) for (const c of p.caps) if (c.area > 1e-3) app.juice.cutBurst(p, c, app.world.params, 0.15);
    frame(app, { pitch: 0.5, distance: 0.44, height: 0.012 });
  },

  reference(app) {
    const o = app.world.originWorld();
    const c = app.world.params.c;
    const rng = mulberry32((app.seed ^ 0x68e31da4) >>> 0);
    const jit = (a) => (rng() * 2 - 1) * a;
    app.world.cut(v3.add(o, [0, 0.03 * c, 0]), [jit(0.03), 1, jit(0.03)], null, { impulse: 0, juiceAmount: 0 });
    const half = app.world.pieces.slice().sort((a, b) => a.com[1] - b.com[1])[0];
    for (const p of app.world.pieces.slice()) if (p !== half) app.world.remove(p);
    axialCuts(app, v3.add(o, [jit(0.001), 0, jit(0.001)]), [jit(3 * deg), 90 * deg + jit(3 * deg)]);
    const quarters = app.world.pieces.slice().sort((a, b) => Math.atan2(a.com[2], a.com[0]) - Math.atan2(b.com[2], b.com[0]));
    const keep = [quarters[0], quarters[1]];
    for (const p of quarters) if (!keep.includes(p)) app.world.remove(p);
    const layout = [
      { pos: [-0.02, 0, 0.01], yaw: 12 * deg },
      { pos: [0.025, 0, -0.03], yaw: -30 * deg },
    ];
    keep.forEach((p, i) => {
      const face = capWithNormal(p, [0, 1, 0]);
      const bis = v3.norm([p.com[0], 0, p.com[2]]);
      const down = quat.fromTo(bis, [0, -1, 0]);
      const faceNow = quat.rotate(down, face.normal);
      const target = quat.rotate(quat.axisAngle([0, 1, 0], layout[i].yaw), [0, 0, 1]);
      const turn = quat.fromTo([faceNow[0], 0, faceNow[2]], target);
      const rot = quat.mul(turn, down);
      app.world.place(p, layout[i].pos, rot, { drop: 0.0005 });
    });
    app.settle();
    app.juice.clear();
    app.camera.set({ target: [0.006, 0.02, -0.008], yaw: 0, pitch: 12 * deg, distance: 0.275, fov: 18 * deg });
  },
};

export function runPreset(app, name) {
  const layout = LAYOUTS[name] || LAYOUTS.whole;
  app.newOrange(app.seed, { tilt: name === 'whole' });
  layout(app);
  app.preset = name;
  return app.world.pieces.length;
}
