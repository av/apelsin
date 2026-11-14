import { v3 } from './math.js';

function quadStrip(profile, x0, x1) {
  const data = [];
  const push = (p, n) => data.push(p[0], p[1], p[2], n[0], n[1], n[2], 0);
  for (let i = 0; i < profile.length - 1; i++) {
    const [z0, y0, nz0, ny0] = profile[i], [z1, y1, nz1, ny1] = profile[i + 1];
    const a = [x0, y0, z0], b = [x1, y0, z0], c = [x1, y1, z1], d = [x0, y1, z1];
    const na = [0, ny0, nz0], nc = [0, ny1, nz1];
    push(a, na); push(b, na); push(c, nc);
    push(a, na); push(c, nc); push(d, nc);
  }
  return new Float32Array(data);
}

function coveMesh() {
  const profile = [];
  const front = 4, start = -0.6, radius = 0.55, top = 3;
  for (let i = 0; i <= 30; i++) { const z = front + (start - front) * (i / 30) ** 0.7; profile.push([z, 0, 0, 1]); }
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * Math.PI / 2;
    profile.push([start - Math.sin(a) * radius, radius - Math.cos(a) * radius, Math.sin(a), Math.cos(a)]);
  }
  for (let i = 1; i <= 8; i++) profile.push([start - radius, radius + (top - radius) * (i / 8), 1, 0]);
  return quadStrip(profile, -5, 5);
}

const light = (dir, up, size, color, intensity, soft = 0.12, shape = {}) => ({ dir: v3.norm(dir), up, size, color, intensity, soft, ...shape });

export const STUDIO = {
  env: {
    top: [0.4, 0.4, 0.41], horizon: [0.5, 0.5, 0.5], bottom: [0.85, 0.84, 0.83],
    hdri: { url: new URL('../assets/hdri/monochrome_studio_03_1k.hdr', import.meta.url).href, scale: 0.75, yaw: 0, clamp: 3 },
    lights: [
      light([0.235, 0.883, -0.407], [0, 1, 0], [0.38, 0.3], [1, 0.99, 0.97], 10.2, 0.2, { core: [4, 0.35] }),
      light([-0.45, 0.45, 0.75], [0, 1, 0], [0.45, 0.35], [1, 0.995, 0.99], 2.0, 0.5, { core: [2, 0.4] }),
      light([-0.75, 0.35, -0.55], [0, 1, 0], [0.4, 0.12], [1, 1, 1], 1.2, 0.25),
    ],
  },
  envIntensity: 1, keyIntensity: 1, exposure: 1.3, background: [2, 1, 0, 0],
  occluder: { bounce: 0.6, leak: 0.6, mfp: [0.009, 0.0032, 0.0012] },
  grade: { white: 1.3, contrast: 1.0, saturation: 1.06, vignette: 0, grain: 0.004, bloom: 0.04, bloomThreshold: 2.4 },
  backdrop: [{ material: 'cove', data: coveMesh, color: [0.9, 0.9, 0.9, 1] }],
  colliders: [{ size: [10, 1, 10], centre: [0, -0.5, 0] }, { size: [10, 4, 1], centre: [0, 2, -1.65] }],
  camera: { target: [0, 0.03, 0], yaw: 0.35, pitch: 0.3, distance: 0.42 },
};

export function keyLight(scene) {
  const l = scene.env.lights[0];
  return { dir: l.dir, up: l.up, tanHalf: Math.tan((l.size[0] + l.size[1]) / 2), tanX: Math.tan(l.size[0]), tanY: Math.tan(l.size[1]) };
}

const GRADE = { tonemap: 'photo', white: 1.3, contrast: 1, saturation: 1, balance: [1, 1, 1], pathToWhite: 2, toe: 0, vignette: 0, grain: 0.006, bloom: 0.05, bloomThreshold: 2 };

export function gradeOf(scene) {
  return { ...GRADE, ...(scene.grade || {}) };
}
