function biquad(type, freq, q, sr) {
  const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function tick(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
  return y;
}

function retune(f, type, freq, q, sr) {
  const n = biquad(type, freq, q, sr);
  f.b0 = n.b0; f.b1 = n.b1; f.b2 = n.b2; f.a1 = n.a1; f.a2 = n.a2;
}

const SURFACES = {
  paper: { modes: [[105, 0.035, 1], [190, 0.02, 0.5]], noise: [520, 0.7, 0.045, 0.8], click: 0.08, roll: [260, 0.9] },
  wood: { modes: [[210, 0.07, 1], [530, 0.035, 0.6], [1180, 0.018, 0.35], [2350, 0.008, 0.15]], noise: [1400, 1.2, 0.015, 0.5], click: 0.35, roll: [420, 1.1] },
  stone: { modes: [[760, 0.03, 0.7], [1650, 0.016, 0.5], [3300, 0.007, 0.3], [170, 0.03, 0.6]], noise: [2600, 1, 0.01, 0.4], click: 0.6, roll: [650, 1.2] },
  slate: { modes: [[880, 0.035, 0.7], [2050, 0.018, 0.55], [3700, 0.008, 0.35], [160, 0.03, 0.6]], noise: [3000, 1, 0.01, 0.4], click: 0.7, roll: [700, 1.3] },
  fruit: { modes: [[150, 0.025, 1], [310, 0.014, 0.4]], noise: [700, 0.8, 0.03, 0.9], click: 0.02, roll: [300, 0.8] },
};

export function createAudio() {
  let ctx = null, master = null, dry = null, verb = null, noise = null;
  let muted = false, rate = 1;
  let lastThud = 0, lastDrip = 0, rnd = Math.random;
  let roll = null, squeezeNode = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
    dry = ctx.createGain();
    verb = ctx.createConvolver();
    verb.buffer = roomImpulse();
    const wet = ctx.createGain();
    wet.gain.value = 0.14;
    dry.connect(master);
    dry.connect(verb).connect(wet).connect(master);
    master.connect(comp).connect(limit).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function roomImpulse() {
    const sr = ctx.sampleRate, n = Math.round(sr * 0.45);
    const buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      const lp = biquad('lowpass', 5200, 0.7, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = tick(lp, Math.random() * 2 - 1) * Math.exp(-t / 0.09) * (t < 0.004 ? t / 0.004 : 1);
      }
    }
    return buf;
  }

  function synth(dur, fill, peak = 0.5) {
    const sr = ctx.sampleRate, n = Math.max(1, Math.ceil(dur * sr));
    const out = new Float32Array(n);
    fill(out, sr);
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i]));
    const g = max > 0 ? peak / max : 0;
    const fade = Math.min(n, Math.round(sr * 0.004));
    for (let i = 0; i < n; i++) out[i] *= g * (i > n - fade ? (n - i) / fade : 1);
    const buf = ctx.createBuffer(1, n, sr);
    buf.copyToChannel(out, 0);
    return buf;
  }

  function play(buf, gain = 1, at = 0) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dry);
    src.start(ctx.currentTime + at);
  }

  function mode(out, sr, t0, f, decay, amp, chirp = 0) {
    const i0 = Math.round(t0 * sr), len = Math.min(out.length - i0, Math.round(decay * 7 * sr));
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * f * (1 + chirp * Math.min(1, t / (decay * 3)))) / sr;
      out[i0 + i] += amp * Math.exp(-t / decay) * Math.sin(ph) * Math.min(1, i / 8);
    }
  }

  function burst(out, sr, t0, dur, amp, type, freq, q, attack = 0.002, shape = 1) {
    const f = biquad(type, freq, q, sr);
    const i0 = Math.round(t0 * sr), len = Math.min(out.length - i0, Math.round(dur * sr));
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = t < attack ? t / attack : Math.pow(Math.max(0, 1 - (t - attack) / (dur - attack)), shape * 2);
      out[i0 + i] += amp * env * tick(f, rnd() * 2 - 1);
    }
  }

  function crackle(out, sr, t0, t1, density, amp, fLo = 2200, fHi = 6500) {
    const n = Math.max(1, Math.round((t1 - t0) * density));
    for (let k = 0; k < n; k++) {
      const t = t0 + rnd() * (t1 - t0);
      mode(out, sr, t, fLo + rnd() * (fHi - fLo), 0.0004 + rnd() * 0.0009, amp * (0.3 + rnd() * 0.7) * (rnd() < 0.5 ? -1 : 1));
    }
  }

  function squelch(out, sr, t0, t1, amp, bubbles = 120) {
    const i0 = Math.round(t0 * sr), i1 = Math.min(out.length, Math.round(t1 * sr));
    const fa = biquad('bandpass', 700, 5, sr), fb = biquad('bandpass', 1600, 6, sr), lp = biquad('lowpass', 3500, 0.7, sr);
    let ca = 700, cb = 1600, ta = 700, tb = 1600, wob = 1, twob = 1;
    for (let i = i0; i < i1; i++) {
      if ((i - i0) % 96 === 0) {
        if (rnd() < 0.3) { ta = 380 + rnd() * 900; tb = 1100 + rnd() * 1700; twob = 0.35 + rnd() * 0.9; }
        ca += (ta - ca) * 0.35; cb += (tb - cb) * 0.35; wob += (twob - wob) * 0.4;
        retune(fa, 'bandpass', ca, 5, sr); retune(fb, 'bandpass', cb, 6, sr);
      }
      const t = (i - i0) / sr, d = (t1 - t0);
      const env = Math.min(1, t / 0.012) * Math.min(1, (d - t) / 0.07) * wob;
      const x = rnd() * 2 - 1;
      out[i] += amp * env * tick(lp, tick(fa, x) * 1.1 + tick(fb, x) * 0.7);
    }
    const n = Math.round((t1 - t0) * bubbles);
    for (let k = 0; k < n; k++) {
      const t = t0 + rnd() * (t1 - t0) * 0.95;
      mode(out, sr, t, 650 + rnd() * 2400, 0.002 + rnd() * 0.005, amp * (0.25 + rnd() * 0.5), 0.25 + rnd() * 0.4);
    }
  }

  function impactInto(out, sr, t0, surface, strength, pitch = 1) {
    const s = SURFACES[surface] || SURFACES.paper;
    for (const [f, d, a] of s.modes) mode(out, sr, t0, f * pitch * (0.94 + rnd() * 0.12), d * (0.8 + 0.4 * rnd()), a * strength);
    const [nf, nq, nd, na] = s.noise;
    burst(out, sr, t0, nd, na * strength, 'bandpass', nf * (0.9 + 0.2 * rnd()), nq, 0.0008, 1.5);
    if (s.click > 0) burst(out, sr, t0, 0.0025, s.click * strength, 'highpass', 3500, 0.7, 0.0002);
  }

  const ready = () => ctx && !muted && ctx.state === 'running';

  function ensureRoll() {
    if (roll) return roll;
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(lp).connect(g).connect(dry);
    src.start();
    roll = { src, bp, g, level: 0 };
    return roll;
  }

  return {
    unlock() { if (ensure() && ctx.state !== 'running') ctx.resume(); },
    get muted() { return muted; },
    get context() { return ctx; },
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02); },
    setRate(r) { rate = r; },
    slice({ area = 0.004, pieces = 1, surface = 'paper' } = {}) {
      if (!ready()) return;
      const body = Math.min(0.55, 0.09 + Math.sqrt(area) * 3.4) * Math.min(1.6, 0.8 + pieces * 0.2);
      const dur = body + 0.25;
      const buf = synth(dur, (out, sr) => {
        burst(out, sr, 0, 0.03, 0.35, 'highpass', 6500, 0.8, 0.001);
        crackle(out, sr, 0, 0.035, 260, 0.9);
        crackle(out, sr, 0.02, body * 0.85, 55, 0.35, 1800, 4800);
        squelch(out, sr, 0.012, body, 0.55, 90 + area * 20000);
        crackle(out, sr, body - 0.04, body + 0.01, 220, 0.75);
        mode(out, sr, 0.01, 140, 0.05, 0.25, -0.3);
        impactInto(out, sr, body + 0.005, surface, 0.45);
      }, 0.55);
      play(buf);
    },
    thud(dv, surface = 'paper', mass = 0.1) {
      if (!ready()) return;
      const now = ctx.currentTime;
      if (now - lastThud < 0.035) return;
      const strength = Math.min(1, dv / 1.6);
      if (strength < 0.03) return;
      lastThud = now;
      const pitch = Math.min(1.8, Math.max(0.75, Math.pow(0.12 / Math.max(mass, 0.005), 0.25)));
      const buf = synth(0.25, (out, sr) => {
        impactInto(out, sr, 0, surface, 1, pitch);
        if (surface !== 'fruit' && strength > 0.25) squelch(out, sr, 0.004, 0.05, 0.25 * strength, 40);
      }, 0.45);
      play(buf, Math.pow(strength, 1.3));
    },
    rolling(speed, surface = 'paper') {
      if (!ctx || ctx.state !== 'running') return;
      if (!roll && speed < 0.01) return;
      const r = ensureRoll();
      const s = SURFACES[surface] || SURFACES.paper;
      const target = muted ? 0 : Math.min(0.5, speed * 2.2) * (0.75 + 0.5 * Math.random());
      r.g.gain.setTargetAtTime(target, ctx.currentTime, 0.04);
      r.bp.frequency.setTargetAtTime(s.roll[0] * (0.85 + Math.min(0.6, speed * 4)), ctx.currentTime, 0.05);
    },
    drip(speed = 1, r = 0.001, surface = 'paper') {
      if (!ready() || r < 0.0006) return;
      const now = ctx.currentTime;
      if (now - lastDrip < 0.045) return;
      lastDrip = now;
      const soft = surface === 'paper' ? 0.5 : surface === 'wood' ? 0.7 : 1;
      const size = Math.min(1, r / 0.002);
      const buf = synth(0.08, (out, sr) => {
        burst(out, sr, 0, 0.004, 0.6, 'bandpass', 2500 + 2000 * (1 - size), 1.2, 0.0003);
        mode(out, sr, 0.002, (1300 + rnd() * 900) / Math.sqrt(size + 0.3), 0.006 + 0.006 * size, 0.7 * soft, 0.6);
      }, 0.4);
      play(buf, Math.min(0.5, 0.08 + size * size * 0.35 * Math.min(1, speed)) * soft);
    },
    squeezeStart() {
      if (!ready()) return;
      if (squeezeNode) squeezeNode.stop();
      const src = ctx.createBufferSource();
      src.buffer = noise; src.loop = true;
      const a = ctx.createBiquadFilter(); a.type = 'bandpass'; a.frequency.value = 600; a.Q.value = 5;
      const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 1500; b.Q.value = 4;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(a).connect(g); src.connect(b).connect(g); g.connect(dry);
      src.start();
      let nextBubble = 0;
      squeezeNode = {
        level(l, juicy) {
          const t = ctx.currentTime;
          g.gain.setTargetAtTime((juicy ? 0.5 : 0.18) * l * (0.6 + 0.8 * Math.random()), t, 0.025);
          a.frequency.setTargetAtTime(350 + Math.random() * 700, t, 0.03);
          b.frequency.setTargetAtTime(1000 + Math.random() * 1600, t, 0.03);
          if (juicy && t > nextBubble) {
            nextBubble = t + 0.03 + Math.random() * 0.12 / (0.3 + l);
            play(synth(0.06, (out, sr) => mode(out, sr, 0.001, 700 + Math.random() * 1800, 0.004 + Math.random() * 0.006, 1, 0.5)), 0.12 + 0.2 * l);
          }
        },
        stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 0.04); src.stop(ctx.currentTime + 0.3); },
      };
    },
    squeezeLevel(l, juicy) { if (squeezeNode && ready()) squeezeNode.level(l, juicy); },
    squeezeStop() { if (squeezeNode) { squeezeNode.stop(); squeezeNode = null; } },
    pick() {
      if (!ready()) return;
      play(synth(0.06, (out, sr) => { burst(out, sr, 0, 0.05, 0.4, 'bandpass', 900, 0.8, 0.004); mode(out, sr, 0, 180, 0.015, 0.4); }), 0.15);
    },
    setRandom(f) { rnd = f; },
  };
}
