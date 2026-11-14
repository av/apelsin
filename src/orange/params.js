import { mulberry32 } from '../math.js';

export const VARIETIES = {
  navel: {
    label: 'Navel', radius: 0.04, polar: 1.03, lump: 0.012, shoulder: 0.018, flavedo: 0.0013, pith: 0.0036, core: 0.0055,
    segments: [10, 11], seeds: [0, 0], navel: 0.0016, vesicle: [0.0022, 0.01],
    rind: [0.855, 0.254, 0.003], rindStem: [0.591, 0.06, 0.0], blush: [0.716, 0.076, 0.002, 0.25], flesh: [0.85, 0.46, 0.015], flesh2: [0.95, 0.3, 0.002, 0], pithColor: [0.947, 0.88, 0.546],
    gland: 740, glandDepth: 1, mottle: 0.1,
  },
  valencia: {
    label: 'Valencia', radius: 0.037, polar: 0.98, lump: 0.01, shoulder: 0.012, flavedo: 0.0011, pith: 0.0027, core: 0.004,
    segments: [10, 13], seeds: [1, 6], navel: 0, vesicle: [0.002, 0.009],
    rind: [0.83, 0.25, 0.004], rindStem: [0.323, 0.352, 0.042], blush: [0.6, 0.2, 0.01, 0], flesh: [0.905, 0.32, 0.002], flesh2: [0.68, 0.202, 0.003, 0], pithColor: [0.93, 0.86, 0.52],
    gland: 820, glandDepth: 0.75, mottle: 0.14,
  },
  blood: {
    label: 'Blood (Moro)', radius: 0.034, polar: 1.02, lump: 0.01, shoulder: 0.01, flavedo: 0.0011, pith: 0.0029, core: 0.004,
    segments: [10, 12], seeds: [0, 2], navel: 0, vesicle: [0.002, 0.0085],
    rind: [0.85, 0.3, 0.02], rindStem: [0.6, 0.12, 0.01], blush: [0.527, 0.065, 0.102, 0.6], flesh: [0.651, 0.109, 0.009], flesh2: [0.3, 0.012, 0.012, 0.6], pithColor: [0.888, 0.694, 0.578],
    gland: 800, glandDepth: 0.9, mottle: 0.18,
  },
  caracara: {
    label: 'Cara Cara', radius: 0.039, polar: 1.03, lump: 0.012, shoulder: 0.016, flavedo: 0.0012, pith: 0.0036, core: 0.005,
    segments: [10, 11], seeds: [0, 0], navel: 0.001, vesicle: [0.0022, 0.0095],
    rind: [0.87, 0.31, 0.005], rindStem: [0.6, 0.1, 0.0], blush: [0.716, 0.076, 0.002, 0.15], flesh: [0.93, 0.15, 0.06], flesh2: [0.97, 0.12, 0.05, 0.2], pithColor: [0.95, 0.89, 0.6],
    gland: 760, glandDepth: 1, mottle: 0.1,
  },
  mandarin: {
    label: 'Mandarin', radius: 0.028, polar: 0.8, lump: 0.016, shoulder: 0.025, flavedo: 0.0008, pith: 0.0014, core: 0.004,
    segments: [9, 10], seeds: [0, 2], navel: 0, vesicle: [0.0018, 0.007],
    rind: [0.784, 0.122, 0.005], rindStem: [0.55, 0.06, 0.0], blush: [0.6, 0.05, 0.0, 0], flesh: [0.7, 0.2, 0.002], flesh2: [0.753, 0.216, 0.007, 0], pithColor: [0.85, 0.75, 0.45],
    gland: 1050, glandDepth: 1.1, mottle: 0.1,
  },
};

export const VARIETY_NAMES = Object.keys(VARIETIES);

export function orangeParams(variety = 'navel', seed = 1) {
  const v = VARIETIES[variety] || VARIETIES.navel;
  const rnd = mulberry32((seed * 2654435761) ^ (VARIETY_NAMES.indexOf(variety) + 1) * 40503);
  const jitter = (x, f) => x * (1 + (rnd() * 2 - 1) * f);
  const a = jitter(v.radius, 0.05);
  const c = a * jitter(v.polar, 0.02);
  const lumps = [];
  for (let i = 0; i < 4; i++) {
    const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    lumps.push([s * Math.cos(t), z, s * Math.sin(t), v.lump * (0.25 + 0.5 * rnd()) / 2]);
  }
  const lumpPhase = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const n = v.segments[0] + Math.floor(rnd() * (v.segments[1] - v.segments[0] + 1));
  const widths = Array.from({ length: n }, () => 0.75 + rnd() * 0.5);
  const total = widths.reduce((s, w) => s + w, 0);
  const start = rnd() * Math.PI * 2;
  const bounds = [];
  let acc = start;
  for (let i = 0; i < 12; i++) {
    bounds.push(i < n ? acc : 0);
    if (i < n) acc += widths[i] / total * Math.PI * 2;
  }
  const flavedo = jitter(v.flavedo, 0.12), pith = jitter(v.pith, 0.18), core = jitter(v.core, 0.15);
  const seedCount = v.seeds[0] + Math.floor(rnd() * (v.seeds[1] - v.seeds[0] + 1));
  const seeds = [];
  for (let i = 0; i < 6; i++) {
    if (i >= seedCount) { seeds.push([0, 0, 0, 0]); continue; }
    const seg = Math.floor(rnd() * n);
    const ang = bounds[seg] + widths[seg] / total * Math.PI * (0.7 + rnd() * 0.6);
    const rr = core + 0.0035 + rnd() * 0.004;
    const y = (rnd() * 2 - 1) * c * 0.35;
    seeds.push([Math.cos(ang) * rr, y, Math.sin(ang) * rr, 0.0045 + rnd() * 0.0025]);
  }
  return {
    variety, seed, label: v.label,
    a, c, shoulder: v.shoulder * (0.6 + 0.8 * rnd()), stemDip: 0.0012 + rnd() * 0.0009, stemDipWidth: 0.2 + rnd() * 0.06,
    navel: v.navel * (0.7 + 0.6 * rnd()), calyx: 0.0034 + rnd() * 0.0008, lumpFreq: 2.2 + rnd() * 0.8,
    lumps, lumpPhase, flavedo, pith, core, membrane: 0.00022,
    segments: n, wave: 0.03 + rnd() * 0.03, vesicleWidth: jitter(v.vesicle[0], 0.1), vesicleLength: jitter(v.vesicle[1], 0.1),
    bounds, seeds, seedCount,
    rind: v.rind, rindStem: v.rindStem, blush: v.blush, flesh: v.flesh, flesh2: v.flesh2, pithColor: v.pithColor,
    gland: jitter(v.gland, 0.08), glandDepth: v.glandDepth, mottle: v.mottle, hue: rnd(),
    noiseOffset: [rnd() * 100, rnd() * 100, rnd() * 100],
  };
}

export const ORANGE_UBO_FLOATS = 4 * 26;

export function packOrange(p, out = new Float32Array(ORANGE_UBO_FLOATS)) {
  let o = 0;
  const put = (...xs) => { for (let i = 0; i < 4; i++) out[o++] = xs[i] ?? 0; };
  put(p.a, p.c, p.shoulder, p.stemDip);
  put(p.stemDipWidth, p.navel, p.calyx, p.lumpFreq);
  for (const l of p.lumps) put(...l);
  put(...p.lumpPhase);
  put(p.flavedo, p.pith, p.core, p.membrane);
  put(p.segments, p.wave, p.vesicleWidth, p.vesicleLength);
  for (let i = 0; i < 3; i++) put(...p.bounds.slice(i * 4, i * 4 + 4));
  for (const s of p.seeds) put(...s);
  put(...p.rind, p.hue);
  put(...p.rindStem, 0);
  put(...p.blush);
  put(...p.flesh, 0);
  put(...p.flesh2);
  put(...p.pithColor, 0);
  put(p.gland, p.glandDepth, p.mottle, p.seedCount);
  put(...p.noiseOffset, 0);
  return out;
}
