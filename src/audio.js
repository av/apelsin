export function createAudio() {
  let ctx = null, master = null, noise = null;
  let muted = false;
  let lastThud = 0, lastDrip = 0;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function burst({ at = 0, dur = 0.1, gain = 0.5, type = 'bandpass', freq = 2000, q = 1, attack = 0.002, sweep = null }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  function tone({ at = 0, dur = 0.1, gain = 0.3, freq = 200, to = null, type = 'sine' }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  const ready = () => ctx && !muted && ctx.state === 'running';

  return {
    unlock() { if (ensure() && ctx.state !== 'running') ctx.resume(); },
    get muted() { return muted; },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; },
    slice(strength = 1) {
      if (!ready()) return;
      for (let i = 0; i < 4; i++) burst({ at: i * 0.012 + Math.random() * 0.006, dur: 0.025, gain: 0.35 * strength, type: 'highpass', freq: 3500 + Math.random() * 2500, q: 0.7 });
      burst({ at: 0.01, dur: 0.22, gain: 0.3 * strength, type: 'bandpass', freq: 1400, q: 2.5, sweep: 500 });
      burst({ at: 0.03, dur: 0.3, gain: 0.18 * strength, type: 'lowpass', freq: 900, q: 1, sweep: 250 });
      tone({ at: 0.0, dur: 0.06, gain: 0.08 * strength, freq: 900, to: 300, type: 'triangle' });
    },
    thud(impulse) {
      if (!ready()) return;
      const now = ctx.currentTime;
      if (now - lastThud < 0.05) return;
      lastThud = now;
      const g = Math.min(0.6, impulse * 6);
      if (g < 0.02) return;
      tone({ dur: 0.14, gain: g, freq: 140 + Math.random() * 40, to: 60 });
      burst({ dur: 0.07, gain: g * 0.5, type: 'lowpass', freq: 700, q: 0.8 });
    },
    squelch(rate = 1) {
      if (!ready()) return;
      burst({ dur: 0.16, gain: 0.12 * rate, type: 'bandpass', freq: 600 + Math.random() * 500, q: 4, sweep: 1600 });
    },
    drip() {
      if (!ready()) return;
      const now = ctx.currentTime;
      if (now - lastDrip < 0.07) return;
      lastDrip = now;
      tone({ dur: 0.05, gain: 0.05, freq: 900 + Math.random() * 600, to: 2200 + Math.random() * 800 });
    },
  };
}
