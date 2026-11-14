import { quat, v3 } from './math.js';
import { restToWorld, restDirToWorld } from './orange/piece.js';

export const PRESET_NAMES = ['whole', 'halves', 'wedges', 'wheels', 'reference'];

const deg = Math.PI / 180;

function cameraFrame(yaw) {
  return { right: [Math.cos(yaw), 0, -Math.sin(yaw)], toCamera: [Math.sin(yaw), 0, Math.cos(yaw)] };
}

function capWithNormal(piece, restNormal) {
  return piece.caps.reduce((best, c) => (v3.dot(c.normal, restNormal) > (best ? v3.dot(best.normal, restNormal) : -2) ? c : best), null);
}

function faceToward(piece, capNormal, dir, spin = 0) {
  const q = quat.fromTo(capNormal, dir);
  return quat.mul(quat.axisAngle(dir, spin), q);
}

function axialCuts(app, origin, angles) {
  for (const a of angles) app.world.cut(origin, [Math.cos(a), 0, Math.sin(a)], null, { impulse: 0, sound: false, juiceAmount: 0.25 });
}

const LAYOUTS = {
  whole(app) {
    app.camera.set({ ...app.scene.camera, fov: 25 * deg });
  },

  halves(app) {
    const o = app.world.originWorld();
    app.world.cut(o, [0, 1, 0], null, { impulse: 0, juiceAmount: 0.4 });
    const yaw = app.scene.camera.yaw;
    const { right, toCamera } = cameraFrame(yaw);
    const pieces = app.world.pieces.slice().sort((a, b) => b.com[1] - a.com[1]);
    pieces.forEach((p, i) => {
      const cap = p.caps[0];
      const side = i === 0 ? -1 : 1;
      const dir = v3.norm(v3.add(v3.add(v3.scale(toCamera, Math.cos(38 * deg)), [0, Math.sin(38 * deg), 0]), v3.scale(right, -side * 0.18)));
      const rot = faceToward(p, cap.normal, dir, side * 0.4);
      const pos = v3.add(v3.scale(right, side * 0.047), v3.scale(toCamera, i === 0 ? -0.012 : 0.012));
      app.world.place(p, pos, rot, { sleep: true });
    });
    app.camera.set({ ...app.scene.camera, pitch: 0.36, distance: 0.46, target: [0, 0.03, 0], fov: 25 * deg });
  },

  wedges(app) {
    const o = app.world.originWorld();
    axialCuts(app, o, [0, 45 * deg, 90 * deg, 135 * deg]);
    const yaw = app.scene.camera.yaw;
    const { right, toCamera } = cameraFrame(yaw);
    const pieces = app.world.pieces.slice().sort((a, b) => Math.atan2(a.com[2], a.com[0]) - Math.atan2(b.com[2], b.com[0]));
    pieces.forEach((p, i) => {
      const bis = v3.norm([p.com[0], 0, p.com[2]]);
      const down = quat.fromTo(bis, [0, -1, 0]);
      const axisNow = quat.rotate(down, [0, 1, 0]);
      const fan = (i - 3.5) * 13 * deg;
      const along = quat.rotate(quat.axisAngle([0, 1, 0], yaw + fan), [1, 0, 0]);
      const align = quat.fromTo([axisNow[0], 0, axisNow[2]], along);
      const rot = quat.mul(align, down);
      const ring = 0.1;
      const ang = (i - 3.5) * 15 * deg;
      const pos = v3.add(v3.scale(right, Math.sin(ang) * ring * 1.15), v3.scale(toCamera, (Math.cos(ang) - 1) * ring + (i % 2 ? 0.018 : -0.018)));
      app.world.place(p, pos, rot, { drop: 0.002 });
    });
    app.camera.set({ ...app.scene.camera, pitch: 0.42, distance: 0.5, target: [0, 0.01, -0.025], fov: 25 * deg });
  },

  wheels(app) {
    const o = app.world.originWorld();
    const c = app.world.params.c;
    for (const h of [-0.55, -0.22, 0.11, 0.44]) app.world.cut(v3.add(o, [0, h * c, 0]), [0, 1, 0], null, { impulse: 0, sound: h === -0.55, juiceAmount: 0.25 });
    const yaw = app.scene.camera.yaw;
    const { right, toCamera } = cameraFrame(yaw);
    const pieces = app.world.pieces.slice().sort((a, b) => a.com[1] - b.com[1]);
    const ends = [pieces[0], pieces[pieces.length - 1]];
    const wheels = pieces.slice(1, -1);
    wheels.forEach((p, i) => {
      const tilt = quat.axisAngle(toCamera, -10 * deg);
      const rot = quat.mul(tilt, quat.axisAngle([0, 1, 0], i * 0.9));
      const pos = v3.add(v3.scale(right, (i - (wheels.length - 1) / 2) * 0.042), v3.scale(toCamera, 0.01 - i * 0.004));
      pos[1] = i * 0.007;
      app.world.place(p, pos, rot, { drop: 0.004 + i * 0.006 });
    });
    ends.forEach((p, i) => {
      const cap = p.caps[0];
      const rot = faceToward(p, cap.normal, v3.norm(v3.add(v3.scale(toCamera, 0.5), [0, 0.85, 0])), i);
      const pos = v3.add(v3.scale(right, i ? 0.075 : -0.07), v3.scale(toCamera, -0.075));
      app.world.place(p, pos, rot, { sleep: true });
    });
    app.camera.set({ ...app.scene.camera, pitch: 0.5, distance: 0.52, target: [0, 0.01, -0.02], fov: 25 * deg });
  },

  reference(app) {
    const o = app.world.originWorld();
    const c = app.world.params.c;
    app.world.cut(v3.add(o, [0, 0.03 * c, 0]), [0, 1, 0], null, { impulse: 0 });
    app.world.cut(v3.add(o, [0, -0.66 * c, 0]), [0, 1, 0], null, { impulse: 0, sound: false });
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
      app.world.place(p, layout[i].pos, rot, { drop: 0.001 });
    });
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
