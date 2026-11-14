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

function boxMesh([sx, sy, sz], [cx, cy, cz]) {
  const data = [];
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const h = [sx / 2, sy / 2, sz / 2];
  for (const [n, u, v] of faces) {
    const corner = (a, b) => [0, 1, 2].map((k) => cx * (k === 0) + cy * (k === 1) + cz * (k === 2) + (n[k] + u[k] * a + v[k] * b) * h[k]);
    const p = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (const i of [0, 1, 2, 0, 2, 3]) data.push(...p[i], ...n, 0);
  }
  return new Float32Array(data);
}

function planeMesh(size, y) {
  return new Float32Array([
    -size, y, -size, 0, 1, 0, 0, -size, y, size, 0, 1, 0, 0, size, y, size, 0, 1, 0, 0,
    -size, y, -size, 0, 1, 0, 0, size, y, size, 0, 1, 0, 0, size, y, -size, 0, 1, 0, 0,
  ]);
}

const light = (dir, up, size, color, intensity, soft = 0.12) => ({ dir: v3.norm(dir), up, size, color, intensity, soft });

export const SCENES = {
  studio: {
    label: 'Studio',
    env: {
      top: [0.3, 0.3, 0.31], horizon: [0.36, 0.36, 0.36], bottom: [0.8, 0.79, 0.78],
      lights: [
        light([0.235, 0.883, -0.407], [0, 1, 0], [0.64, 0.51], [1, 0.99, 0.97], 4.2, 0.3),
        light([0.0, 0.84, 1], [0, 1, 0], [0.6, 0.3], [1, 0.99, 0.98], 2.2, 0.35),
        light([-0.75, 0.35, -0.55], [0, 1, 0], [0.4, 0.12], [1, 1, 1], 2, 0.2),
      ],
    },
    envIntensity: 1, keyIntensity: 1, exposure: 1.12, desaturation: 0.04, white: 0.965, vignette: 0, occluderTint: [0.62, 0.3, 0.17, 1], background: [2, 1, 0, 0],
    backdrop: [{ material: 'cove', data: coveMesh, color: [0.9, 0.9, 0.9, 1] }],
    colliders: [{ size: [10, 1, 10], centre: [0, -0.5, 0] }, { size: [10, 4, 1], centre: [0, 2, -1.65] }],
    camera: { target: [0, 0.03, 0], yaw: 0.35, pitch: 0.3, distance: 0.42 },
  },
  kitchen: {
    label: 'Kitchen',
    env: {
      top: [0.16, 0.13, 0.11], horizon: [0.26, 0.19, 0.13], bottom: [0.07, 0.05, 0.035],
      lights: [
        light([-0.92, 0.36, -0.18], [0, 1, 0], [0.38, 0.4], [1, 0.86, 0.66], 14, 0.08),
        light([-0.92, 0.36, -0.18], [0, 1, 0], [0.6, 0.55], [1, 0.9, 0.75], 0.5, 0.6),
        light([0.15, 0.08, -1], [0, 1, 0], [1.1, 0.16], [0.78, 0.7, 0.6], 0.55, 0.3),
        light([0.65, 0.45, -0.6], [0, 1, 0], [0.45, 0.25], [0.4, 0.22, 0.11], 0.35, 0.3),
        light([0.75, 0.3, 0.6], [0, 1, 0], [0.5, 0.4], [0.85, 0.9, 1], 0.6, 0.4),
        light([0.1, 1, 0.1], [0, 0, 1], [0.25, 0.25], [1, 0.92, 0.8], 2, 0.3),
      ],
    },
    envIntensity: 1, keyIntensity: 1, exposure: 1.0, vignette: 0.3, occluderTint: [0.6, 0.32, 0.16, 0.8], background: [3.2, 1, 1, 0],
    backdrop: [
      { material: 'board', data: () => boxMesh([0.46, 0.026, 0.32], [0, -0.013, 0]) },
      { material: 'counter', data: () => planeMesh(4, -0.026) },
    ],
    colliders: [{ size: [0.46, 0.026, 0.32], centre: [0, -0.013, 0] }, { size: [10, 1, 10], centre: [0, -0.526, 0] }],
    camera: { target: [0, 0.03, 0], yaw: 0.55, pitch: 0.32, distance: 0.44 },
    floorAt: (x, z) => (Math.abs(x) < 0.23 && Math.abs(z) < 0.16 ? 0 : -0.026),
  },
  dark: {
    label: 'Dark',
    env: {
      top: [0.006, 0.006, 0.007], horizon: [0.004, 0.004, 0.0045], bottom: [0.001, 0.001, 0.001],
      lights: [
        light([-0.85, 0.38, 0.3], [0, 1, 0], [0.26, 0.18], [1, 0.95, 0.88], 30, 0.15),
        light([0.55, 0.4, -0.75], [0, 1, 0], [0.35, 0.05], [0.9, 0.95, 1], 12, 0.2),
        light([0.4, 0.3, 0.85], [0, 1, 0], [0.4, 0.3], [0.8, 0.88, 1], 0.25, 0.4),
      ],
    },
    envIntensity: 1, keyIntensity: 1, exposure: 1.35, vignette: 0.45, occluderTint: [0.5, 0.2, 0.1, 0.6], background: [3, 1, 1, 0],
    backdrop: [{ material: 'slate', data: () => planeMesh(4, 0) }],
    colliders: [{ size: [10, 1, 10], centre: [0, -0.5, 0] }],
    camera: { target: [0, 0.03, 0], yaw: 0.25, pitch: 0.26, distance: 0.42 },
  },
};

export const SCENE_NAMES = Object.keys(SCENES);

export function keyLight(scene) {
  const l = scene.env.lights[0];
  return { dir: l.dir, tanHalf: Math.tan(Math.max(l.size[0], l.size[1])) };
}
