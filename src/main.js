import { createContext } from './gl.js';
import { createRenderer, TIER_NAMES } from './renderer.js';
import { createCamera } from './camera.js';
import { SCENES, SCENE_NAMES } from './scenes.js';
import { orangeParams, packOrange, VARIETY_NAMES } from './orange/params.js';
import { createWorld } from './world.js';
import { createJuice } from './juice.js';
import { createAudio } from './audio.js';
import { createTools, TOOL_NAMES } from './tools.js';
import { createUI } from './ui.js';
import { runPreset, PRESET_NAMES } from './presets.js';
import { mulberry32, v3 } from './math.js';
import { restDirToWorld } from './orange/piece.js';

const params = new URLSearchParams(location.search);
const pick = (key, list, fallback) => (list.includes(params.get(key)) ? params.get(key) : fallback);
const TEST = params.has('test');
const DEBUG = params.has('debug');
const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

function noWebGL(reason) {
  document.getElementById('nogl').hidden = false;
  document.getElementById('bar').hidden = true;
  document.getElementById('hint').hidden = true;
  window.apelsin = { ready: Promise.reject(new Error(reason)), info: () => ({ error: reason }) };
  window.apelsin.ready.catch(() => {});
}

function boot() {
  const canvas = document.getElementById('gl');
  const overlay = document.getElementById('overlay');
  const gl = createContext(canvas);
  if (!gl) return noWebGL('webgl2 unavailable');

  const state = {
    scene: pick('scene', SCENE_NAMES, 'studio'),
    variety: pick('variety', VARIETY_NAMES, 'navel'),
    seed: params.has('seed') ? (parseInt(params.get('seed'), 10) >>> 0) : (Math.random() * 1e9) >>> 0,
    tool: 'knife', preset: 'whole', macro: false, slowmo: false,
    quality: pick('q', TIER_NAMES, phone ? 'medium' : 'high'), forcedQuality: TIER_NAMES.includes(params.get('q')),
    physicsReady: false,
  };
  const rng = TEST ? mulberry32(state.seed ^ 0x9e3779b9) : Math.random;
  const renderer = createRenderer(gl, canvas, { tier: state.quality });
  const camera = createCamera();
  camera.snap = TEST;
  const audio = createAudio();
  const juice = createJuice(gl, rng);
  const world = createWorld(gl, { juice, audio });
  juice.on('splat', (speed, r) => audio.drip(speed, r, app.surfaceAt()));

  const app = {
    state, world, camera, juice, audio, renderer, physics: null,
    get scene() { return SCENES[state.scene]; },
    get sceneName() { return state.scene; },
    get seed() { return state.seed; },
    set preset(v) { state.preset = v; },
    setScene(name) {
      if (!SCENES[name]) return false;
      state.scene = name;
      const s = SCENES[name];
      renderer.setScene(s);
      world.floorAt = s.floorAt || (() => 0);
      camera.floorY = Math.min(0, world.floorAt(1, 1));
      camera.set({ ...s.camera }, TEST);
      if (app.physics) app.physics.setColliders(s.colliders);
      for (const p of world.pieces) world.place(p, [p.position[0], world.floorAt(p.position[0], p.position[2]), p.position[2]], p.rotation);
      ui?.sync();
      return true;
    },
    surfaceAt(x = 0, z = 0) {
      if (state.scene === 'kitchen') return world.floorAt(x, z) >= -0.001 ? 'wood' : 'stone';
      return state.scene === 'dark' ? 'slate' : 'paper';
    },
    applyJuiceTint() {
      const tint = juice.setVariety(state.variety);
      for (const name of ['cove', 'board', 'counter', 'slate']) {
        const prog = renderer.materialProgram(name);
        gl.useProgram(prog.handle);
        if (prog.uniforms.uJuiceTint) gl.uniform3fv(prog.uniforms.uJuiceTint, tint);
      }
    },
    settle(seconds = 3) {
      if (app.physics) app.physics.settle(world.pieces, seconds);
      else app.pendingSettle = true;
      for (const p of world.pieces) { p.hasPrev = false; }
    },
    setVariety(name) {
      if (!VARIETY_NAMES.includes(name)) return false;
      state.variety = name;
      app.applyJuiceTint();
      app.runPreset(state.preset);
      return true;
    },
    newOrange(seed, opts = {}) {
      if (seed === undefined) {
        state.seed = (rng() * 1e9) >>> 0;
        state.preset = 'whole';
      } else state.seed = seed >>> 0;
      const p = orangeParams(state.variety, state.seed);
      renderer.setOrange(packOrange(p));
      world.newOrange(p, { tilt: opts.tilt ?? true });
      ui?.sync();
      return world.pieces.length;
    },
    runPreset(name) {
      if (!PRESET_NAMES.includes(name)) return false;
      runPreset(app, name);
      if (TEST) camera.update(0, renderer.width || 1, renderer.height || 1, false);
      if (name !== 'whole') ui?.hideHint();
      ui?.sync();
      return world.pieces.length;
    },
    setTool(name) {
      if (!TOOL_NAMES.includes(name)) return false;
      tools.setTool(name);
      state.tool = name;
      ui?.sync();
      return true;
    },
    toggle(key) { state[key] = !state[key]; if (key === 'slowmo') audio.setRate(state.slowmo ? 0.6 : 1); ui?.sync(); },
    reset() { app.runPreset('whole'); camera.set({ ...app.scene.camera, fov: 25 * Math.PI / 180 }); },
    cutWith(origin, normal, pieces) {
      const n = world.cut(origin, normal, pieces);
      if (n) { ui?.sliced(); state.preset = null; ui?.sync(); app.followUntil = time + 1.6; }
      return n;
    },
    download() {
      const url = capture(2);
      const a = document.createElement('a');
      a.href = url;
      a.download = `apelsin-${state.variety}-${state.seed}.png`;
      a.click();
    },
  };

  const tools = createTools(canvas, overlay, app, gl);
  app.tools = tools;
  world.surfaceAt = () => app.surfaceAt();
  app.applyJuiceTint();
  const ui = createUI(app, { test: TEST });
  app.setScene(state.scene);
  app.newOrange(state.seed);
  if (params.has('preset')) app.runPreset(pick('preset', PRESET_NAMES, 'whole'));
  ui.sync();

  let time = 0, emaMs = 16.7, slow = 0;
  function frame(dt) {
    const sim = dt * (state.slowmo ? 0.25 : 1);
    time += dt;
    tools.update(sim);
    world.update(sim);
    if (app.followUntil > time && world.pieces.length && !tools.busy) {
      const c = world.bounds().centre, g = camera.goal.target, k = Math.min(1, dt * 1.8);
      camera.goal.target = [g[0] + (c[0] - g[0]) * k, g[1], g[2] + (c[2] - g[2]) * k];
    }
    juice.update(sim, world.pieces, world.params, world.floorAt);
    juice.prepare(sim);
    audio.rolling(world.pieces.reduce((s, p) => s + (p.contact === 'ground' && p.body && !p.body.isSleeping() ? p.rolling || 0 : 0), 0), app.surfaceAt());
    const b = world.bounds();
    renderer.render({
      camera, dt, time, drawables: [...world.drawables(), ...tools.drawables()],
      transparent: juice.count ? [(ctx) => juice.draw(ctx)] : [],
      macro: state.macro, focus: v3.len(v3.sub(b.centre, camera.eye)),
      wetness: juice.wetness, wetExtent: juice.extent, wetSize: juice.size,
    });
    tools.drawOverlay(dt);
  }

  function capture(scale = 1) {
    if (scale !== 1) {
      renderer.captureScale = scale;
      for (let i = 0; i < 12; i++) frame(0);
      const url = canvas.toDataURL('image/png');
      renderer.captureScale = 1;
      frame(0);
      return url;
    }
    frame(0);
    return canvas.toDataURL('image/png');
  }

  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  async function loadPhysics() {
    const { createPhysics } = await import('./physics.js');
    const physics = await createPhysics();
    physics.on('impact', (piece, impulse, other) => {
      const m = piece.body ? piece.body.mass() : 0.1;
      audio.thud(impulse / Math.max(m, 0.005), other === 'piece' ? 'fruit' : app.surfaceAt(piece.position[0], piece.position[2]), m);
    });
    app.physics = physics;
    world.attachPhysics(physics, app.scene.colliders);
    if (app.pendingSettle) { app.pendingSettle = false; physics.settle(world.pieces, 3); }
    state.physicsReady = true;
    if (TEST) frame(1 / 60);
    resolveReady();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!TEST) {
      frame(dt);
      emaMs += (dt * 1000 - emaMs) * 0.05;
      if (!state.forcedQuality && !document.hidden) {
        slow = emaMs > 40 ? slow + dt : Math.max(0, slow - dt * 0.5);
        const i = TIER_NAMES.indexOf(state.quality);
        if (slow > 2 && i > 0) { state.quality = TIER_NAMES[i - 1]; renderer.setTier(state.quality); slow = 0; emaMs = 16.7; }
      }
      if (DEBUG) ui.showStats(`${(1000 / emaMs).toFixed(0)} fps  ${emaMs.toFixed(1)} ms  ${state.quality}  ${renderer.width}x${renderer.height}  pieces ${world.pieces.length}  drops ${juice.count}`);
    }
    requestAnimationFrame(loop);
  }

  frame(1 / 60);
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); setTimeout(() => loadPhysics().catch((e) => { console.error(e); resolveReady(); }), 0); });

  window.apelsin = {
    ready,
    info: () => ({
      pieces: world.pieces.length, cutFaces: world.cutFaces(), scene: state.scene, variety: state.variety, seed: state.seed,
      quality: state.quality, fps: Math.round(1000 / emaMs), gpu: gl.caps.gpu, droplets: juice.count, physicsReady: state.physicsReady,
      tool: state.tool, preset: state.preset, awake: app.physics ? app.physics.awake(world.pieces) : 0, errors: gl.errors.slice(),
      width: renderer.width, height: renderer.height, floatTargets: gl.caps.floatTargets,
      knife: tools.knifeVisible, splats: juice.stats.splats, drips: juice.stats.drips, slowmo: state.slowmo, macro: state.macro,
      squash: world.pieces.reduce((m, p) => Math.max(m, p.squash), 0), muted: audio.muted,
    }),
    poses: () => world.pieces.map((p) => ({ id: p.id, position: p.position.slice(), rotation: p.rotation.slice(), sleeping: p.body ? p.body.isSleeping() : null, caps: p.caps.length, faceUp: p.caps.length ? Math.max(...p.caps.map((c) => restDirToWorld(p, c.normal)[1])) : -1 })),
    project: (p) => camera.project(p, canvas.clientWidth, canvas.clientHeight),
    contacts: () => world.contacts(),
    wetness: () => juice.stats.area,
    toggle: (key) => { if (!['slowmo', 'macro'].includes(key)) return false; app.toggle(key); return state[key]; },
    preset: (name) => app.runPreset(name),
    cut: (point, normal) => world.cut(point, normal),
    setScene: (name) => app.setScene(name),
    setVariety: (name) => app.setVariety(name),
    newOrange: (seed) => { app.newOrange(seed); state.preset = 'whole'; ui.sync(); return world.pieces.length; },
    setTool: (name) => app.setTool(name),
    step: (frames = 1) => { for (let i = 0; i < frames; i++) frame(1 / 60); return window.apelsin.info(); },
    screenshot: (scale = 1) => capture(scale),
    setQuality: (name) => { if (!TIER_NAMES.includes(name)) return false; state.quality = name; renderer.setTier(name); return true; },
    camera: (o) => { camera.set(o, true); return { yaw: camera.yaw, pitch: camera.pitch, distance: camera.distance, target: camera.target }; },
    internals: DEBUG ? { app, renderer, world, camera, juice, gl } : undefined,
    timeFrames: (n = 30) => { const t0 = performance.now(); for (let i = 0; i < n; i++) frame(1 / 60); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); return (performance.now() - t0) / n; },
  };
}

boot();
