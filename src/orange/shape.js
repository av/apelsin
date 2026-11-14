import { mulberry32 } from '../math.js';

export const GLAND_STRIDE = 5;
export const SHAPE_SIZE = 128;
export const SHAPE_BIAS = 0.035;
const L_MAX = 8;
const SIGMA = [0, 0, 0.0095, 0.0045, 0.0055, 0.003, 0.0022, 0.0016, 0.0012];

export const GLAND_SIZE = 512;
export const RELIEF_SIZE = 256;
export const RELIEF_EXT = 0.16;
export const GLAND_RADIAL = 1.25;

export const SHAPE_GLSL = `
uniform samplerCube uShape;
uniform samplerCube uGlands;
uniform sampler2D uRelief;
vec4 shapeAt(vec3 restDir) { return textureLod(uShape, restDir, 0.0) + vec4(${SHAPE_BIAS}, ${SHAPE_BIAS}, ${SHAPE_BIAS}, 0.0); }
vec4 glandAt(vec3 restDir) { return textureLod(uGlands, restDir, 0.0); }
float envelopeRelief(vec3 p) {
  vec3 d = normalize(p);
  if (d.y < ${Math.cos(Math.atan(RELIEF_EXT)).toFixed(6)}) return 0.0;
  return textureLod(uRelief, d.xz / d.y * ${(0.5 / RELIEF_EXT).toFixed(6)} + 0.5, 0.0).r * 0.001;
}
`;

const DEFAULTS = { a: 0.04, c: 0.0412, flavedo: 0.0013, pith: 0.0034, navel: 0.0016, navelOpen: 0.1, calyx: 0.0038 };

const gauss = (rnd) => {
  let u = 0;
  while (u < 1e-12) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fact = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

const SH_K = (() => {
  const k = [];
  for (let l = 0; l <= L_MAX; l++) {
    k.push([]);
    for (let m = 0; m <= l; m++) k[l].push(Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (fact(l - m) / fact(l + m))) * (m ? Math.SQRT2 : 1));
  }
  return k;
})();

function shSum(coef, x, y, z, lmax = L_MAX) {
  let sum = 0, re = 1, im = 0;
  let dfact = 1;
  for (let m = 0; m <= lmax; m++) {
    if (m > 0) { const nr = re * x - im * z; im = re * z + im * x; re = nr; dfact *= 2 * m - 1; }
    let p2 = 0, p1 = (m & 1 ? -1 : 1) * dfact;
    for (let l = m; l <= lmax; l++) {
      let p;
      if (l === m) p = p1;
      else if (l === m + 1) { p = y * (2 * m + 1) * p1; p2 = p1; p1 = p; }
      else { p = (y * (2 * l - 1) * p1 - (l + m - 1) * p2) / (l - m); p2 = p1; p1 = p; }
      if (l < 2) continue;
      const base = l * l + l, k = SH_K[l][m] * p;
      sum += m === 0 ? coef[base] * k : coef[base + m] * k * re + coef[base - m] * k * im;
    }
  }
  return sum;
}

function frame(d) {
  const t = norm3(Math.abs(d[1]) < 0.95 ? [d[2], 0, -d[0]] : [0, -d[2], d[1]]);
  const b = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
  return [t, b];
}

function glandPoints(shape, rnd) {
  const { a } = shape;
  const area = 4 * Math.PI * a * a;
  const tries = Math.round(area / 0.00000033);
  const cx = new Float32Array(tries * 3), cr = new Float32Array(tries), cs = new Uint8Array(tries), order = new Uint32Array(tries);
  for (let i = 0; i < tries; i++) {
    const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    cx[i * 3] = s * Math.cos(t); cx[i * 3 + 1] = z; cx[i * 3 + 2] = s * Math.sin(t);
    const small = rnd() < 0.22;
    const dia = small ? 0.00026 + rnd() * 0.0002 : Math.min(0.00105, Math.max(0.0004, 0.00064 * Math.exp(0.24 * gauss(rnd))));
    cr[i] = dia * 0.5 * (1 - 0.14 * Math.abs(z));
    cs[i] = small ? 1 : 0;
    order[i] = i;
  }
  order.sort((p, q) => cr[q] - cr[p]);
  const cell = 0.0018 / a, G = Math.ceil(2.2 / cell);
  const head = new Int32Array(G * G * G).fill(-1);
  const cap = Math.round(tries * 0.5);
  const px = new Float32Array(cap * 3), pr = new Float32Array(cap), pg = new Float32Array(cap), next = new Int32Array(cap), small = new Uint8Array(cap);
  let n = 0;
  const ci = (v) => Math.min(G - 1, Math.max(0, Math.floor((v + 1.1) / cell)));
  const fits = (x, y, z, r, slack, ridge, skip) => {
    const ix = ci(x), iy = ci(y), iz = ci(z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const X = ix + dx, Y = iy + dy, Z = iz + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= G || Y >= G || Z >= G) continue;
      for (let j = head[(X * G + Y) * G + Z]; j >= 0; j = next[j]) {
        if (j === skip) continue;
        const ex = px[j * 3] - x, ey = px[j * 3 + 1] - y, ez = px[j * 3 + 2] - z;
        const lim = ((r + pr[j]) * slack + Math.max(ridge, pg[j])) / a;
        if (ex * ex + ey * ey + ez * ez < lim * lim) return false;
      }
    }
    return true;
  };
  const insert = (x, y, z, r, ridge, sm) => {
    if (n >= cap) return;
    px[n * 3] = x; px[n * 3 + 1] = y; px[n * 3 + 2] = z; pr[n] = r; pg[n] = ridge; small[n] = sm;
    const k = (ci(x) * G + ci(y)) * G + ci(z);
    next[n] = head[k]; head[k] = n; n++;
  };
  const stemCut = Math.cos(shape.calyx.radius * 1.1 / a), navelCut = -Math.cos(shape.navelOpen * 1.05);
  for (let k = 0; k < tries; k++) {
    const i = order[k], x = cx[i * 3], y = cx[i * 3 + 1], z = cx[i * 3 + 2];
    if (y > stemCut || y < navelCut) continue;
    const ridge = cs[i] ? 0.00014 : 0.00034 + rnd() * 0.0002;
    if (fits(x, y, z, cr[i], 1, ridge, -1)) insert(x, y, z, cr[i], ridge, cs[i]);
  }
  const base = n;
  for (let i = 0; i < base; i++) {
    if (rnd() > 0.06) continue;
    const g = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
    const [t, b] = frame(g);
    const ang = rnd() * Math.PI * 2, r2 = pr[i] * (0.55 + 0.35 * rnd());
    const dist = (pr[i] + r2) * (0.55 + 0.3 * rnd()) / a;
    const c = Math.cos(ang) * dist, s = Math.sin(ang) * dist;
    const d = norm3([g[0] + t[0] * c + b[0] * s, g[1] + t[1] * c + b[1] * s, g[2] + t[2] * c + b[2] * s]);
    if (fits(d[0], d[1], d[2], r2, 0.75, 0, i)) insert(d[0], d[1], d[2], r2, 0, 0);
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push([[px[i * 3], px[i * 3 + 1], px[i * 3 + 2]], pr[i], small[i]]);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
  return out;
}

export function createShape(seed = 1, opts = {}) {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => typeof v === 'number')) };
  const rnd = mulberry32(((seed >>> 0) * 2246822519 + 0x3c6ef372) >>> 0);
  const a = o.a, c = o.c;
  const tiltA = rnd() * Math.PI * 2, tiltM = (0.02 + rnd() * 0.07);
  const axis = norm3([Math.cos(tiltA) * tiltM, 1, Math.sin(tiltA) * tiltM]);
  const coef = new Float64Array((L_MAX + 1) * (L_MAX + 1));
  for (let l = 2; l <= L_MAX; l++) {
    const s = SIGMA[l] * (0.7 + 0.6 * rnd()) * Math.sqrt((4 * Math.PI) / (2 * l + 1));
    for (let m = -l; m <= l; m++) coef[l * l + l + m] = gauss(rnd) * s;
  }
  const peelCoef = new Float64Array((L_MAX + 1) * (L_MAX + 1));
  for (let l = 2; l <= 4; l++) for (let m = -l; m <= l; m++) peelCoef[l * l + l + m] = gauss(rnd) * 0.05 * Math.sqrt((4 * Math.PI) / (2 * l + 1));
  const shoulder = 0.007 + rnd() * 0.012, shoulderAt = 0.42 + rnd() * 0.18, shoulderW = 0.2 + rnd() * 0.08;
  const lobes = 2 + Math.floor(rnd() * 3), lobePhase = rnd() * Math.PI * 2, lobeAmt = 0.3 + rnd() * 0.5;
  const stemDip = 0.0012 + rnd() * 0.0014, stemW = (0.0075 + rnd() * 0.004) / a;
  const navelOpen = o.navelOpen * (0.55 + 0.9 * rnd()), navelDepth = o.navel * (0.8 + 0.6 * rnd());
  const navelDip = 0.0006 + rnd() * 0.0012, navelW = 0.16 + rnd() * 0.08;
  const flat = 0.026 + rnd() * 0.024;
  const baseTilt = rnd() < 0.75 ? rnd() * 0.32 : 0.9 + rnd() * 0.6, baseAz = rnd() * Math.PI * 2;
  const base = norm3([Math.sin(baseTilt) * Math.cos(baseAz), -Math.cos(baseTilt), Math.sin(baseTilt) * Math.sin(baseAz)]);
  const flatK = 0.012 + rnd() * 0.008;
  const flavedo = o.flavedo * (0.88 + 0.24 * rnd()), pith = o.pith * (0.88 + 0.24 * rnd());
  const sepals = rnd() < 0.85 ? 5 : rnd() < 0.5 ? 4 : 6;
  const calyxR = o.calyx * (0.85 + 0.35 * rnd()), phase0 = rnd() * Math.PI * 2;
  const calyx = {
    radius: calyxR, inner: calyxR * (0.5 + 0.12 * rnd()), sepals: [],
    stemR: 0.0013 + rnd() * 0.0006, stemH: 0.0003 + rnd() * 0.0016, stemTilt: [(rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25], stemCut: [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5],
    brown: rnd(),
  };
  for (let k = 0; k < sepals; k++) {
    calyx.sepals.push({ angle: phase0 + (k + (rnd() - 0.5) * 0.35) * (Math.PI * 2 / sepals), length: calyxR * (0.75 + 0.3 * rnd()), width: (Math.PI / sepals) * (0.75 + 0.35 * rnd()), lift: rnd() * rnd() * 0.0007, brown: rnd() });
  }

  function sample(d) {
    const x = d[0], y = d[1], z = d[2];
    const ya = x * axis[0] + y * axis[1] + z * axis[2];
    const r0 = 1 / Math.sqrt((1 - ya * ya) / (a * a) + (ya * ya) / (c * c));
    const th = Math.acos(Math.max(-1, Math.min(1, y)));
    const psi = Math.atan2(z, x);
    const sh = shSum(coef, x, y, z);
    const sw = (th - shoulderAt) / shoulderW;
    const sh2 = shoulder * Math.exp(-sw * sw) * (1 + lobeAmt * Math.cos(lobes * psi + lobePhase + 0.8 * Math.sin(psi * 3 + lobePhase)));
    let r = r0 * (1 + sh + sh2);
    const smooth0 = r;
    const sd = th / stemW;
    r -= stemDip * Math.exp(-sd * sd);
    const tn = Math.PI - th;
    const nd = tn / navelW;
    r -= navelDip * Math.exp(-nd * nd);
    const open = tn / Math.max(navelOpen, 1e-3);
    const hole = 1 - smooth(0.72, 1.0, open);
    const lw = (open - 1.08) / 0.16;
    const lip = Math.exp(-lw * lw);
    r += -navelDepth * hole + 0.00025 * lip * (navelOpen > 0.02 ? 1 : 0);
    const cb = x * base[0] + y * base[1] + z * base[2];
    const plane = (a * (1 - flat)) / Math.max(cb, 1e-3);
    if (cb > 0.5) {
      const k = a * flatK, h = Math.max(k - Math.abs(r - plane), 0) / k;
      r = Math.min(r, plane) - h * h * k * 0.25;
    }
    const peelVar = 1 + shSum(peelCoef, x, y, z, 4) + 0.22 * smooth(0.6, 0.0, th) + 0.08 * smooth(0.7, 0.0, tn);
    const fl = flavedo * (1 + 0.5 * (peelVar - 1));
    const peel = fl + pith * peelVar;
    const pulp = Math.min(smooth0 - peel, r - peel * 0.55);
    return [r, pulp, r - fl, peel];
  }

  const calyxOutline = (psi) => {
    let best = calyx.inner;
    for (const sp of calyx.sepals) {
      let x = psi - sp.angle;
      x -= Math.PI * 2 * Math.round(x / (Math.PI * 2));
      const f = Math.max(0, 1 - Math.abs(x) / sp.width);
      best = Math.max(best, calyx.inner * 0.9 + (sp.length - calyx.inner * 0.9) * Math.pow(f, 1.25));
    }
    return best;
  };
  const sepalLift = (psi) => {
    let best = 0;
    for (const sp of calyx.sepals) {
      let x = psi - sp.angle;
      x -= Math.PI * 2 * Math.round(x / (Math.PI * 2));
      best = Math.max(best, sp.lift * Math.max(0, 1 - Math.abs(x) / sp.width));
    }
    return best;
  };
  const poleR = sample([0, 1, 0])[0];
  function relief(d) {
    if (d[1] < RELIEF_COS) return 0;
    const sxz = Math.hypot(d[0], d[2]);
    const rho = Math.atan2(sxz, d[1]) * poleR;
    if (rho > calyx.radius * 1.4) return 0;
    const psi = Math.atan2(d[2], d[0]);
    const X = rho * Math.cos(psi), Z = rho * Math.sin(psi);
    const rc = calyxOutline(psi), u = rho / rc;
    const edge = smooth(rc + 0.00007, rc - 0.0001, rho);
    const thick = 0.00014 + 0.00055 * Math.pow(Math.max(0, 1 - u * u), 0.8) + 0.00025 * Math.exp(-((rho / (calyx.stemR * 1.5)) ** 2));
    const lift = sepalLift(psi) * smooth(0.45, 1, u) ** 2;
    const cal = edge * (thick + lift);
    const [tx, tz] = calyx.stemTilt, [kx, kz] = calyx.stemCut;
    const ox = tx * calyx.stemH * 0.6, oz = tz * calyx.stemH * 0.6;
    const rs = Math.hypot(X - ox, Z - oz), ps = Math.atan2(Z - oz, X - ox);
    const sr = calyx.stemR * (1 + 0.06 * Math.sin(ps * 2 + calyx.brown * 6) + 0.03 * Math.sin(ps * 5 + 1.3));
    const wall = smooth(sr + 0.00012, sr - 0.00012, rs);
    const top = calyx.stemH + 0.0008 + (kx * (X - ox) + kz * (Z - oz)) * 0.35 - 0.00012 * Math.exp(-((rs / (sr * 0.45)) ** 2));
    const flare = 0.00035 * Math.exp(-(((rs - sr) / 0.00045) ** 2)) * (rs > sr ? 1 : 0);
    return Math.max(cal + flare * edge, wall * top);
  }
  const shape = {
    seed, calyxOutline, sepalLift, a, c, axis, base, tilt: Math.acos(axis[1]), navelOpen, navelDepth, calyx, flavedoMean: flavedo, pithMean: pith, poleR,
    sample,
    relief,
    radius: (d) => sample(d)[0],
    envelope: (d) => sample(d)[0] + relief(d),
    pulpRadius: (d) => sample(d)[1],
    flavedo: (d) => { const s = sample(d); return s[0] - s[2]; },
    peel: (d) => sample(d)[3],
    glands: null,
    glandShape: null,
    bake: null,
  };
  const pts = glandPoints(shape, rnd);
  const glands = new Float32Array(pts.length * GLAND_STRIDE);
  const glandShape = new Float32Array(pts.length * 2);
  pts.forEach(([d, r, small], i) => {
    const s = sample(d);
    const R = s[0];
    glands.set([d[0] * R, d[1] * R, d[2] * R, r, Math.min(s[0] - s[2] - r * GLAND_RADIAL, r * (1.1 + 0.5 * rnd()) + 0.00005)], i * GLAND_STRIDE);
    glandShape.set([1 + rnd() * 0.35, rnd() * Math.PI], i * 2);
  });
  shape.glands = glands;
  shape.glandShape = glandShape;
  shape.glandCount = pts.length;
  let glandFaces = null;
  shape.glandCube = (size = GLAND_SIZE) => glandFaces || (glandFaces = glandCubeData(glands, pts.length, size));
  shape.glandAt = (d) => {
    const faces = shape.glandCube();
    const size = Math.round(Math.sqrt(faces[0].length / 4));
    const [f, s0, t0] = cubeLookup(d);
    const i = Math.min(size - 1, Math.max(0, Math.floor((s0 + 1) / 2 * size))), j = Math.min(size - 1, Math.max(0, Math.floor((t0 + 1) / 2 * size)));
    return Array.from(faces[f].subarray((j * size + i) * 4, (j * size + i) * 4 + 4));
  };
  const baked = new WeakMap();
  shape.dispose = (gl) => {
    const b = baked.get(gl);
    if (!b) return;
    for (const t of [b.shape, b.glands, b.relief]) gl.deleteTexture(t.tex);
    baked.delete(gl);
  };
  shape.bake = (gl) => {
    if (baked.has(gl)) return baked.get(gl);
    const cube = bakeShapeCube(gl, sample);
    const glandTex = uploadCube(gl, shape.glandCube(), gl.RGBA32F, gl.FLOAT, gl.NEAREST);
    const reliefTex = bakeRelief(gl, relief);
    const out = { ...cube, shape: cube.texture, glands: glandTex, relief: reliefTex, uniforms: { uShape: cube.texture, uGlands: glandTex, uRelief: reliefTex } };
    baked.set(gl, out);
    return out;
  };
  return shape;
}

const RELIEF_COS = Math.cos(Math.atan(RELIEF_EXT));

export const CUBE_FACES = [
  (s, t) => [1, -t, -s], (s, t) => [-1, -t, s], (s, t) => [s, 1, t],
  (s, t) => [s, -1, -t], (s, t) => [s, -t, 1], (s, t) => [-s, -t, -1],
];

const FACE_ST = [
  (x, y, z) => [-z / x, -y / x, x], (x, y, z) => [z / -x, -y / -x, -x], (x, y, z) => [x / y, z / y, y],
  (x, y, z) => [x / -y, -z / -y, -y], (x, y, z) => [x / z, -y / z, z], (x, y, z) => [-x / -z, -y / -z, -z],
];

export function cubeLookup(d) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  const f = ax >= ay && ax >= az ? (d[0] > 0 ? 0 : 1) : ay >= az ? (d[1] > 0 ? 2 : 3) : (d[2] > 0 ? 4 : 5);
  const [s, t] = FACE_ST[f](d[0], d[1], d[2]);
  return [f, s, t];
}

const FACE_M = CUBE_FACES.map((F) => {
  const o = F(0, 0), ds = F(1, 0), dt = F(0, 1);
  return [ds[0] - o[0], dt[0] - o[0], o[0], ds[1] - o[1], dt[1] - o[1], o[1], ds[2] - o[2], dt[2] - o[2], o[2]];
});

function glandCubeData(glands, count, size) {
  const faces = [], best = [];
  for (let f = 0; f < 6; f++) { faces.push(new Float32Array(size * size * 4)); best.push(new Float32Array(size * size).fill(Infinity)); }
  const reach = 0.0016, h = 2 / size;
  for (let g = 0; g < count; g++) {
    const k = g * GLAND_STRIDE;
    const sx = glands[k], sy = glands[k + 1], sz = glands[k + 2], r = glands[k + 3], depth = glands[k + 4];
    const R = Math.hypot(sx, sy, sz), ux = sx / R, uy = sy / R, uz = sz / R;
    const cs = 1 - depth / R, cx = sx * cs, cy = sy * cs, cz = sz * cs;
    const ang = reach / R, lim = ang * ang;
    for (let f = 0; f < 6; f++) {
      const [s, t, m] = FACE_ST[f](ux, uy, uz);
      if (m < 0.55) continue;
      const q = 1 + s * s + t * t;
      const ws = Math.ceil(ang * q / Math.sqrt(1 + t * t) / h) + 1, wt = Math.ceil(ang * q / Math.sqrt(1 + s * s) / h) + 1;
      const ci = Math.floor((s + 1) / h), cj = Math.floor((t + 1) / h);
      const i0 = Math.max(0, ci - ws), i1 = Math.min(size - 1, ci + ws), j0 = Math.max(0, cj - wt), j1 = Math.min(size - 1, cj + wt);
      if (i0 > i1 || j0 > j1) continue;
      const M = FACE_M[f], data = faces[f], bf = best[f];
      for (let j = j0; j <= j1; j++) {
        const tt = (j + 0.5) * h - 1;
        const bx = M[1] * tt + M[2], by = M[4] * tt + M[5], bz = M[7] * tt + M[8];
        for (let i = i0; i <= i1; i++) {
          const ss = (i + 0.5) * h - 1;
          const vx = M[0] * ss + bx, vy = M[3] * ss + by, vz = M[6] * ss + bz;
          const il = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
          const dx = vx * il - ux, dy = vy * il - uy, dz = vz * il - uz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const idx = j * size + i;
          if (d2 > lim || d2 >= bf[idx]) continue;
          bf[idx] = d2;
          const o = idx * 4;
          data[o] = cx; data[o + 1] = cy; data[o + 2] = cz; data[o + 3] = r;
        }
      }
    }
  }
  return faces;
}

export function shapeCubeData(sample, size = SHAPE_SIZE) {
  const faces = [];
  for (let f = 0; f < 6; f++) {
    const data = new Float32Array(size * size * 4);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const d = norm3(CUBE_FACES[f](((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1));
      const s = sample(d);
      data.set([s[0] - SHAPE_BIAS, s[1] - SHAPE_BIAS, s[2] - SHAPE_BIAS, 0], (j * size + i) * 4);
    }
    faces.push(data);
  }
  return faces;
}

function uploadCube(gl, faces, internal, type, filter) {
  const size = Math.round(Math.sqrt(faces[0].length / 4));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, internal, size, size);
  for (let f = 0; f < 6; f++) gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, 0, 0, size, size, gl.RGBA, type, faces[f]);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, filter);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, p, gl.CLAMP_TO_EDGE);
  return { tex, cube: true, size };
}

function bakeShapeCube(gl, sample, size = SHAPE_SIZE) {
  const texture = uploadCube(gl, shapeCubeData(sample, size), gl.RGBA16F, gl.FLOAT, gl.LINEAR);
  return { cube: texture.tex, texture, size };
}

export function reliefData(relief, size = RELIEF_SIZE) {
  const data = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const X = (((i + 0.5) / size) * 2 - 1) * RELIEF_EXT, Z = (((j + 0.5) / size) * 2 - 1) * RELIEF_EXT;
    data[j * size + i] = relief(norm3([X, 1, Z])) * 1000;
  }
  return data;
}

function bakeRelief(gl, relief, size = RELIEF_SIZE) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, size, size);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RED, gl.FLOAT, reliefData(relief, size));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { tex, width: size, height: size };
}
