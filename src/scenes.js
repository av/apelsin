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

function planeMesh(size, y, z0 = -size, z1 = size) {
  return new Float32Array([
    -size, y, z0, 0, 1, 0, 0, -size, y, z1, 0, 1, 0, 0, size, y, z1, 0, 1, 0, 0,
    -size, y, z0, 0, 1, 0, 0, size, y, z1, 0, 1, 0, 0, size, y, z0, 0, 1, 0, 0,
  ]);
}

function wallMesh(z, x0, x1, y0, y1) {
  return new Float32Array([
    x0, y0, z, 0, 0, 1, 0, x1, y0, z, 0, 0, 1, 0, x1, y1, z, 0, 0, 1, 0,
    x0, y0, z, 0, 0, 1, 0, x1, y1, z, 0, 0, 1, 0, x0, y1, z, 0, 0, 1, 0,
  ]);
}

function roundedBoardMesh([sx, sy, sz], top, corner = 0.016, bevel = 0.0065, segments = 9) {
  const data = [];
  const push = (p, n) => data.push(p[0], p[1], p[2], n[0], n[1], n[2], 0);
  const hx = sx / 2 - corner, hz = sz / 2 - corner;
  const ring = [];
  [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]].forEach(([cx, cz], k) => {
    for (let i = 0; i <= segments; i++) {
      const a = (k + i / segments) * Math.PI / 2;
      ring.push([cx + Math.cos(a) * corner, cz + Math.sin(a) * corner, Math.cos(a), Math.sin(a)]);
    }
  });
  const foot = 0.002;
  const profile = [[foot, top - sy, 0, -1], [foot * (1 - Math.cos(Math.PI / 4)), top - sy + foot * (1 - Math.sin(Math.PI / 4)), 0.7071, -0.7071], [0, top - sy + foot, 1, 0], [0, top - bevel, 1, 0]];
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * Math.PI / 2;
    profile.push([bevel * (1 - Math.cos(a)), top - bevel + Math.sin(a) * bevel, Math.cos(a), Math.sin(a)]);
  }
  const vert = (r, p) => [r[0] - r[2] * p[0], p[1], r[1] - r[3] * p[0]];
  const norm = (r, p) => [r[2] * p[2], p[3], r[3] * p[2]];
  for (let i = 0; i < ring.length; i++) {
    const r0 = ring[i], r1 = ring[(i + 1) % ring.length];
    for (let j = 0; j < profile.length - 1; j++) {
      const p0 = profile[j], p1 = profile[j + 1];
      push(vert(r0, p0), norm(r0, p0)); push(vert(r1, p0), norm(r1, p0)); push(vert(r1, p1), norm(r1, p1));
      push(vert(r0, p0), norm(r0, p0)); push(vert(r1, p1), norm(r1, p1)); push(vert(r0, p1), norm(r0, p1));
    }
  }
  const inner = ring.map((r) => vert(r, profile[profile.length - 1]));
  for (let i = 1; i < inner.length - 1; i++) { push(inner[0], [0, 1, 0]); push(inner[i], [0, 1, 0]); push(inner[i + 1], [0, 1, 0]); }
  return new Float32Array(data);
}

const light = (dir, up, size, color, intensity, soft = 0.12, shape = {}) => ({ dir: v3.norm(dir), up, size, color, intensity, soft, ...shape });

export const WINDOW = { centre: [-0.34, 0.26, -0.36], half: [0.34, 0.24] };
const windowDir = v3.norm(WINDOW.centre);
const windowSize = [Math.atan(WINDOW.half[0] / v3.len(WINDOW.centre)), Math.atan(WINDOW.half[1] / v3.len(WINDOW.centre))];

export const SCENES = {
  studio: {
    label: 'Studio',
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
  },
  kitchen: {
    label: 'Kitchen',
    env: {
      top: [0.13, 0.12, 0.11], horizon: [0.17, 0.14, 0.11], bottom: [0.08, 0.06, 0.04],
      lights: [
        light(windowDir, [0, 1, 0], windowSize, [1, 0.9, 0.76], 5.0, 0.06),
        light([0.55, 0.75, 0.45], [0, 1, 0], [0.9, 0.7], [0.9, 0.93, 1], 0.5, 0.6),
        light([0.35, 0.3, 1], [0, 1, 0], [0.9, 0.55], [1, 0.95, 0.88], 1.0, 0.6),
        light([-0.9, 0.4, 0.3], [0, 1, 0], [0.5, 0.4], [0.9, 0.85, 0.8], 0.12, 0.5),
      ],
    },
    envIntensity: 1, keyIntensity: 1, exposure: 1.1, background: [3, 1, 1, 0], groundReach: 0.07,
    pool: [0.5, 0.45],
    occluder: { bounce: 0.35, leak: 0.9, mfp: [0.009, 0.0032, 0.0012], bounceWhite: 0.15 },
    grade: { white: 1.7, contrast: 1.18, saturation: 1.08, balance: [1.0, 0.98, 0.95], vignette: 0.25, grain: 0.007, bloom: 0.06, bloomThreshold: 1.6, toe: 0.003 },
    dof: 8,
    window: WINDOW,
    backdrop: [
      { material: 'board', data: () => roundedBoardMesh([0.46, 0.026, 0.32], 0) },
      { material: 'counter', data: () => planeMesh(1.6, -0.026, -0.36, 1.6) },
      { material: 'wall', data: () => wallMesh(-0.36, -1.6, 1.6, -0.026, 1.4) },
    ],
    colliders: [{ size: [0.46, 0.026, 0.32], centre: [0, -0.013, 0] }, { size: [10, 1, 10], centre: [0, -0.526, 0] }, { size: [10, 4, 1], centre: [0, 2, -0.86] }],
    camera: { target: [0, 0.03, 0], yaw: 0.55, pitch: 0.3, distance: 0.44 },
    floorAt: (x, z) => (Math.abs(x) < 0.23 && Math.abs(z) < 0.16 ? 0 : -0.026),
  },
  dark: {
    label: 'Dark',
    env: {
      top: [0.004, 0.004, 0.0045], horizon: [0.002, 0.002, 0.0022], bottom: [0.0005, 0.0005, 0.0005],
      lights: [
        light([-0.62, 0.42, -0.66], [0, 1, 0], [0.3, 0.12], [1, 0.94, 0.86], 26, 0.25, { core: [5, 0.38] }),
        light([0.5, 0.45, 0.75], [0, 1, 0], [0.7, 0.5], [0.95, 0.95, 1], 0.14, 0.6),
      ],
    },
    envIntensity: 1, keyIntensity: 1, exposure: 1.3, background: [3, 1, 1, 0], groundReach: 0.07,
    pool: [0.12, 1],
    occluder: { bounce: 0.4, leak: 1.0, mfp: [0.009, 0.0032, 0.0012], bounceWhite: 0.05 },
    grade: { white: 1.8, contrast: 1.12, saturation: 1.05, balance: [1.0, 0.99, 0.98], vignette: 0.35, grain: 0.008, bloom: 0.08, bloomThreshold: 1.2, toe: 0.004 },
    backdrop: [{ material: 'slate', data: () => planeMesh(4, 0) }],
    colliders: [{ size: [10, 1, 10], centre: [0, -0.5, 0] }],
    camera: { target: [0, 0.03, 0], yaw: 0.25, pitch: 0.26, distance: 0.42 },
  },
};

export const SCENE_NAMES = Object.keys(SCENES);

export function keyLight(scene) {
  const l = scene.env.lights[0];
  return { dir: l.dir, up: l.up, tanHalf: Math.tan((l.size[0] + l.size[1]) / 2), tanX: Math.tan(l.size[0]), tanY: Math.tan(l.size[1]) };
}

const GRADE = { tonemap: 'photo', white: 1.3, contrast: 1, saturation: 1, balance: [1, 1, 1], pathToWhite: 2, toe: 0, vignette: 0, grain: 0.006, bloom: 0.05, bloomThreshold: 2 };

export function gradeOf(scene) {
  return { ...GRADE, ...(scene.grade || {}) };
}
