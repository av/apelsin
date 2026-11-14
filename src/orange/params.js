import { mulberry32 } from '../math.js';

export const VARIETIES = {
  navel: {
    label: 'Navel', radius: 0.04, polar: 1.03, lump: 0.012, shoulder: 0.018, flavedo: 0.0013, pith: 0.0034, core: 0.0055,
    segments: [10, 11], seeds: [0, 0], navel: 0.0016, vesicle: [0.0015, 0.0115],
    rind: [0.855, 0.254, 0.003], rindStem: [0.591, 0.06, 0.0], stemMix: 0.8, blush: [0.716, 0.076, 0.002, 0.25], flesh: [0.92, 0.57, 0.012], flesh2: [0.95, 0.3, 0.002, 0], pithColor: [0.95, 0.91, 0.68],
    fleshDeep: [0.9, 0.46, 0.006], fleshWall: [0.97, 0.78, 0.1], corePale: 0.3, wax: 0.75, pebble: 0.00012, navelOpen: 0.1, hollow: 0,
    gland: 680, glandDepth: 1, mottle: 0.1,
  },
  valencia: {
    label: 'Valencia', radius: 0.037, polar: 0.98, lump: 0.01, shoulder: 0.012, flavedo: 0.0011, pith: 0.0027, core: 0.004,
    segments: [10, 13], seeds: [1, 6], navel: 0, vesicle: [0.0014, 0.011],
    rind: [0.83, 0.25, 0.004], rindStem: [0.323, 0.352, 0.042], stemMix: 0.4, blush: [0.6, 0.2, 0.01, 0], flesh: [0.9, 0.36, 0.004], flesh2: [0.68, 0.202, 0.003, 0], pithColor: [0.94, 0.9, 0.66],
    fleshDeep: [0.8, 0.25, 0.002], fleshWall: [0.93, 0.6, 0.05], corePale: 0.3, wax: 0.7, pebble: 0.00003, navelOpen: 0, hollow: 0,
    gland: 740, glandDepth: 0.75, mottle: 0.14,
  },
  blood: {
    label: 'Blood (Moro)', radius: 0.034, polar: 1.02, lump: 0.01, shoulder: 0.01, flavedo: 0.0011, pith: 0.0029, core: 0.004,
    segments: [10, 12], seeds: [0, 2], navel: 0, vesicle: [0.0014, 0.0105],
    rind: [0.85, 0.3, 0.02], rindStem: [0.6, 0.12, 0.01], stemMix: 0.6, blush: [0.62, 0.07, 0.05, 0.55], flesh: [0.72, 0.16, 0.018], flesh2: [0.36, 0.012, 0.014, 0.68], pithColor: [0.93, 0.8, 0.62],
    fleshDeep: [0.62, 0.1, 0.018], fleshWall: [0.85, 0.32, 0.12], corePale: 0.2, wax: 0.6, pebble: 0.00006, navelOpen: 0, hollow: 0,
    gland: 720, glandDepth: 0.9, mottle: 0.18,
  },
  caracara: {
    label: 'Cara Cara', radius: 0.039, polar: 1.03, lump: 0.012, shoulder: 0.016, flavedo: 0.0012, pith: 0.0036, core: 0.005,
    segments: [10, 11], seeds: [0, 0], navel: 0.001, vesicle: [0.0015, 0.011],
    rind: [0.87, 0.31, 0.005], rindStem: [0.6, 0.1, 0.0], stemMix: 0.7, blush: [0.716, 0.076, 0.002, 0.15], flesh: [0.93, 0.15, 0.06], flesh2: [0.97, 0.12, 0.05, 0], pithColor: [0.95, 0.91, 0.7],
    fleshDeep: [0.973, 0.246, 0.074], fleshWall: [1.0, 0.32, 0.12], corePale: -0.4, wax: 0.75, pebble: 0.0001, navelOpen: 0.045, hollow: 0,
    gland: 690, glandDepth: 1, mottle: 0.1,
  },
  mandarin: {
    label: 'Mandarin', radius: 0.028, polar: 0.8, lump: 0.016, shoulder: 0.025, flavedo: 0.0008, pith: 0.0014, core: 0.004,
    segments: [9, 10], seeds: [0, 2], navel: 0, vesicle: [0.0013, 0.009],
    rind: [0.784, 0.122, 0.005], rindStem: [0.55, 0.06, 0.0], stemMix: 0.6, blush: [0.6, 0.05, 0.0, 0], flesh: [0.8, 0.24, 0.002], flesh2: [0.753, 0.216, 0.007, 0], pithColor: [0.9, 0.85, 0.6],
    fleshDeep: [0.72, 0.18, 0.001], fleshWall: [0.9, 0.48, 0.03], corePale: 0.25, wax: 0.55, pebble: 0.00009, navelOpen: 0, hollow: 0.55,
    gland: 940, glandDepth: 1.3, mottle: 0.1,
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
  const flavedo = jitter(v.flavedo, 0.12), pith = jitter(v.pith, 0.12), core = jitter(v.core, 0.15);
  const seedCount = v.seeds[0] + Math.floor(rnd() * (v.seeds[1] - v.seeds[0] + 1));
  const seeds = [];
  for (let i = 0; i < 6; i++) {
    if (i >= seedCount) { seeds.push([0, 0, 0, 0]); continue; }
    const seg = Math.floor(rnd() * n);
    const ang = bounds[seg] + widths[seg] / total * Math.PI * (0.7 + rnd() * 0.6);
    const rr = core + 0.0045 + rnd() * 0.004;
    const y = (rnd() * 2 - 1) * c * 0.35;
    seeds.push([Math.cos(ang) * rr, y, Math.sin(ang) * rr, 0.008 + rnd() * 0.003]);
  }
  return {
    variety, seed, label: v.label,
    a, c, shoulder: v.shoulder * (0.6 + 0.8 * rnd()), stemDip: 0.0012 + rnd() * 0.0009, stemDipWidth: 0.2 + rnd() * 0.06,
    navel: v.navel * (0.7 + 0.6 * rnd()), calyx: 0.0034 + rnd() * 0.0008, lumpFreq: 2.2 + rnd() * 0.8,
    lumps, lumpPhase, flavedo, pith, core, membrane: 0.0003,
    segments: n, wave: 0.03 + rnd() * 0.03, vesicleWidth: jitter(v.vesicle[0], 0.1), vesicleLength: jitter(v.vesicle[1], 0.1),
    bounds, seeds, seedCount,
    rind: v.rind, rindStem: v.rindStem, stemMix: v.stemMix, blush: v.blush, flesh: v.flesh, flesh2: v.flesh2, pithColor: v.pithColor,
    fleshDeep: v.fleshDeep, fleshWall: v.fleshWall, corePale: v.corePale, wax: v.wax, pebble: v.pebble * (0.6 + 0.8 * rnd()), navelOpen: v.navelOpen * (0.6 + 0.8 * rnd()), hollow: v.hollow,
    gland: jitter(v.gland, 0.08), glandDepth: v.glandDepth, mottle: v.mottle, hue: rnd(),
    noiseOffset: [rnd() * 100, rnd() * 100, rnd() * 100],
  };
}

export const ORANGE_UBO_FLOATS = 4 * 29;

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
  put(...p.rindStem, p.stemMix);
  put(...p.blush);
  put(...p.flesh, 0);
  put(...p.flesh2);
  put(...p.pithColor, 0);
  put(p.gland, p.glandDepth, p.mottle, p.seedCount);
  put(...p.noiseOffset, 0);
  put(...p.fleshDeep, p.corePale);
  put(...p.fleshWall, 0);
  put(p.wax, p.pebble, p.navelOpen, p.hollow);
  return out;
}
