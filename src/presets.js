import { quat, v3 } from './math.js';

export const PRESET_NAMES = ['whole', 'halves', 'wedges', 'wheels', 'reference'];

const deg = Math.PI / 180;

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
    const pieces = app.world.pieces.slice().sort((a, b) => b.com[1] - a.com[1]);
    pieces.forEach((p, i) => {
      const side = i === 0 ? -1 : 1;
      const up = quat.fromTo(p.caps[0].normal, [0, 1, 0]);
      const rot = quat.mul(quat.axisAngle([0, 1, 0], side * 0.7 + 0.3), up);
      const at = v3.add(v3.scale(right, side * 0.046), v3.scale(toCamera, i === 0 ? -0.018 : 0.014));
      app.world.place(p, onPlane(app.world, at[0], at[2]), rot, { drop: 0.001 });
    });
    app.settle();
    frame(app, { pitch: 0.62, distance: 0.42, height: 0.018 });
  },

  wedges(app) {
    const o = app.world.originWorld();
    app.world.cut(o, [1, 0, 0], null, { impulse: 0, juiceAmount: 0 });
    axialCuts(app, o, [45 * deg, 90 * deg, 135 * deg]);
    const yaw = app.scene.camera.yaw;
    const { right, toCamera } = cameraFrame(yaw);
    const pieces = app.world.pieces.slice().sort((a, b) => Math.atan2(a.com[2], a.com[0]) - Math.atan2(b.com[2], b.com[0]));
    const slots = [[-1, -1], [0, -1], [1, -1], [-0.5, 0], [0.5, 0], [1.5, 0], [-1, 1], [0, 1]];
    pieces.forEach((p, i) => {
      const [col, row] = slots[i];
      const big = p.caps.slice().sort((a, b) => b.area - a.area);
      const [lie, show] = i % 2 ? [big[0], big[1]] : [big[1], big[0]];
      const down = quat.fromTo(lie.normal, [0, -1, 0]);
      const up = quat.rotate(down, show.normal);
      const face = quat.rotate(quat.axisAngle([0, 1, 0], ((i * 37) % 11 - 5) * 3 * deg), toCamera);
      const rot = quat.mul(quat.fromTo([up[0], 0, up[2]], face), down);
      const at = v3.add(v3.scale(right, (col - 0.25) * 0.095 + ((i * 53) % 7 - 3) * 0.002), v3.scale(toCamera, row * 0.064));
      app.world.place(p, onPlane(app.world, at[0], at[2]), rot, { drop: 0.0015 });
    });
    app.settle();
    dripFromCaps(app, app.world.pieces, 6);
    frame(app, { pitch: 0.62, distance: 0.5, height: 0.004 });
  },

  wheels(app) {
    const o = app.world.originWorld();
    const c = app.world.params.c;
    const heights = [-0.4, -0.13, 0.13, 0.4];
    heights.forEach((h, k) => app.world.cut(v3.add(o, [0, h * c, 0]), [0, 1, 0], null, { impulse: 0, sound: k === 0, juiceAmount: 0 }));
    const yaw = app.scene.camera.yaw;
    const { right, toCamera } = cameraFrame(yaw);
    const pieces = app.world.pieces.slice().sort((a, b) => a.com[1] - b.com[1]);
    const ends = [pieces[0], pieces[pieces.length - 1]];
    const wheels = pieces.slice(1, -1);
    const step = app.world.params.a * 1.7;
    wheels.forEach((p, i) => {
      const s = i - (wheels.length - 1) / 2;
      const rot = quat.mul(quat.axisAngle(right, 0), quat.axisAngle([0, 1, 0], i * 1.3));
      const at = v3.add(v3.scale(right, s * step), v3.scale(toCamera, 0.006 - Math.abs(s) * 0.014));
      app.world.place(p, onPlane(app.world, at[0], at[2]), rot, { drop: 0.0008 + i * 0.012 });
    });
    ends.forEach((p, i) => {
      const cap = p.caps[0];
      const rot = quat.mul(quat.axisAngle([0, 1, 0], i * 2.1), quat.fromTo(cap.normal, [0, 1, 0]));
      const at = v3.add(v3.scale(right, (i ? 1 : -1) * step * 0.95), v3.scale(toCamera, -0.075));
      app.world.place(p, onPlane(app.world, at[0], at[2]), rot, { drop: 0.0008 });
    });
    app.settle(4);
    dripFromCaps(app, wheels, 5);
    frame(app, { pitch: 0.7, distance: 0.46, height: 0.008 });
  },

  reference(app) {
    const o = app.world.originWorld();
    const c = app.world.params.c;
    app.world.cut(v3.add(o, [0, 0.03 * c, 0]), [0, 1, 0], null, { impulse: 0, juiceAmount: 0 });
    app.world.cut(v3.add(o, [0, -0.66 * c, 0]), [0, 1, 0], null, { impulse: 0, sound: false, juiceAmount: 0 });
    const disc = app.world.pieces.find((p) => p.caps.length === 2);
    for (const p of app.world.pieces.slice()) if (p !== disc) app.world.remove(p);
    axialCuts(app, o, [0, 90 * deg]);
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
    app.camera.set({ target: [0.003, 0.02, -0.008], yaw: 0, pitch: 12 * deg, distance: 0.25, fov: 18 * deg });
  },
};

export function runPreset(app, name) {
  const layout = LAYOUTS[name] || LAYOUTS.whole;
  if (name === 'reference' && app.sceneName !== 'studio') app.setScene('studio');
  app.newOrange(app.seed, { tilt: name === 'whole' });
  layout(app);
  app.preset = name;
  return app.world.pieces.length;
}
