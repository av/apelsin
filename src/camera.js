import { mat4, v3, clamp } from './math.js';

const HALTON = Array.from({ length: 16 }, (_, i) => {
  const h = (b, n) => { let f = 1, r = 0; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; };
  return [h(2, i + 1) - 0.5, h(3, i + 1) - 0.5];
});

export function createCamera() {
  const cam = {
    target: [0, 0.035, 0], yaw: 0.35, pitch: 0.3, distance: 0.42, fov: (25 * Math.PI) / 180,
    goal: null, near: 0.02, far: 20, aspect: 1,
    eye: [0, 0, 0], view: mat4.create(), proj: mat4.create(), projNJ: mat4.create(), viewProj: mat4.create(), viewProjNJ: mat4.create(),
    prevViewProjNJ: mat4.create(), invViewProj: mat4.create(), jitter: [0, 0], frame: 0, minDistance: 0.12, maxDistance: 1.6,
    floorY: 0,
  };
  cam.goal = { target: cam.target.slice(), yaw: cam.yaw, pitch: cam.pitch, distance: cam.distance };

  cam.set = (o, immediate = false) => {
    Object.assign(cam.goal, o.target ? { ...o, target: o.target.slice() } : o);
    if (immediate) { Object.assign(cam, { yaw: cam.goal.yaw, pitch: cam.goal.pitch, distance: cam.goal.distance, target: cam.goal.target.slice() }); }
    if (o.fov) cam.fov = o.fov;
  };
  cam.orbit = (dx, dy) => {
    cam.goal.yaw -= dx * 0.006;
    cam.goal.pitch = clamp(cam.goal.pitch + dy * 0.005, -0.05, 1.45);
  };
  cam.zoom = (f) => { cam.goal.distance = clamp(cam.goal.distance * f, cam.minDistance, cam.maxDistance); };
  cam.pan = (dx, dy) => {
    const s = cam.goal.distance * Math.tan(cam.fov / 2) * 2 / (cam.viewportHeight || 800);
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const up = [0, 1, 0];
    cam.goal.target = v3.add(cam.goal.target, v3.add(v3.scale(right, -dx * s), v3.scale(up, dy * s)));
    cam.goal.target[1] = clamp(cam.goal.target[1], 0, 0.3);
  };

  cam.update = (dt, width, height, jitterOn) => {
    const k = cam.snap ? 1 : 1 - Math.exp(-dt * 12);
    cam.yaw += (cam.goal.yaw - cam.yaw) * k;
    cam.pitch += (cam.goal.pitch - cam.pitch) * k;
    cam.distance += (cam.goal.distance - cam.distance) * k;
    cam.target = v3.lerp(cam.target, cam.goal.target, k);
    cam.viewportHeight = height;
    const cp = Math.cos(cam.pitch);
    const portrait = Math.max(1, 0.8 / (width / height));
    cam.eye = v3.add(cam.target, v3.scale([Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp], cam.distance * portrait));
    if (cam.eye[1] < cam.floorY + 0.008) cam.eye[1] = cam.floorY + 0.008;
    cam.aspect = width / height;
    cam.prevViewProjNJ.set(cam.viewProjNJ);
    mat4.lookAt(cam.view, cam.eye, cam.target, [0, 1, 0]);
    mat4.perspective(cam.projNJ, cam.fov, cam.aspect, cam.near, cam.far);
    cam.proj.set(cam.projNJ);
    cam.frame++;
    if (jitterOn) {
      const j = HALTON[cam.frame % HALTON.length];
      cam.jitter = [(j[0] * 2) / width, (j[1] * 2) / height];
      cam.proj[8] += cam.jitter[0];
      cam.proj[9] += cam.jitter[1];
    } else cam.jitter = [0, 0];
    mat4.mul(cam.viewProj, cam.proj, cam.view);
    mat4.mul(cam.viewProjNJ, cam.projNJ, cam.view);
    mat4.invert(cam.invViewProj, cam.viewProj);
    if (!cam.initialised) { cam.prevViewProjNJ.set(cam.viewProjNJ); cam.initialised = true; }
  };

  cam.ray = (x, y, width, height) => {
    const ndc = [(x / width) * 2 - 1, 1 - (y / height) * 2];
    const inv = mat4.invert(mat4.create(), mat4.mul(mat4.create(), cam.projNJ, cam.view));
    const a = mat4.transformPoint(inv, [ndc[0], ndc[1], -1]), b = mat4.transformPoint(inv, [ndc[0], ndc[1], 1]);
    return { origin: cam.eye.slice(), dir: v3.norm(v3.sub(b, a)) };
  };

  cam.project = (p, width, height) => {
    const c = mat4.transformPoint(cam.viewProjNJ, p);
    return [(c[0] * 0.5 + 0.5) * width, (0.5 - c[1] * 0.5) * height];
  };

  return cam;
}
