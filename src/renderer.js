import { program, use, set, ubo, fbo, target, formats, bind, destroy, texture, mesh } from './gl.js';
import { FRAME_UBO_FLOATS } from './shaders/common.js';
import { UBER_VS, uberFragment, MATERIALS, ATTRIBS } from './shaders/materials.js';
import { ORANGE_UBO_FLOATS } from './orange/params.js';
import { createIBL } from './ibl.js';
import { createShadows } from './shadows.js';
import { createPost } from './post.js';
import { keyLight } from './scenes.js';
import { STRIDE } from './orange/mesh.js';

export const TIERS = {
  low: { name: 'low', index: 0, scale: 0.6, shadow: 1024, ssao: false, aoSamples: 0, aoRadius: 0.04, sss: false, taa: false, bloom: false, grain: 0.004 },
  medium: { name: 'medium', index: 1, scale: 0.75, shadow: 2048, ssao: true, aoSamples: 8, aoRadius: 0.045, sss: true, taa: true, bloom: true },
  high: { name: 'high', index: 2, scale: 1, shadow: 2048, ssao: true, aoSamples: 12, aoRadius: 0.05, sss: true, taa: true, bloom: true },
  ultra: { name: 'ultra', index: 3, scale: 1, shadow: 4096, ssao: true, aoSamples: 16, aoRadius: 0.05, sss: true, taa: true, bloom: true },
};
export const TIER_NAMES = Object.keys(TIERS);

const F = { viewProj: 0, view: 16, proj: 32, invViewProj: 48, viewProjNJ: 64, prevViewProjNJ: 80, lightViewProj: 96, camPos: 112, resolution: 116, jitter: 120, keyDir: 124, occluderTint: 128, shadow: 132, env: 136, shEnv: 140, shKey: 176, wet: 212, flags: 216, background: 220 };

export function createRenderer(gl, canvas, { tier = 'high' } = {}) {
  const fmt = formats(gl);
  const frameUbo = ubo(gl, 'Frame', FRAME_UBO_FLOATS);
  const orangeUbo = ubo(gl, 'Orange', ORANGE_UBO_FLOATS);
  const ibl = createIBL(gl);
  const shadows = createShadows(gl, TIERS[tier].shadow);
  const post = createPost(gl);
  const prepassProg = program(gl, UBER_VS, uberFragment(null, 'prepass'), { label: 'prepass' });
  const materialProgs = {};
  const materialProgram = (name) => materialProgs[name] || (materialProgs[name] = program(gl, UBER_VS, uberFragment(name, 'main'), { label: `material-${name}`, defines: { [`MATERIAL_${name.toUpperCase()}`]: 1 } }));
  for (const name of Object.keys(MATERIALS)) materialProgram(name);
  const white = texture(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([255, 255, 255, 255]) });
  const black = texture(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([0, 0, 0, 255]) });

  const r = {
    gl, ibl, shadows, post, tier: TIERS[tier], width: 0, height: 0, targets: {}, fbos: {}, scene: null, backdrop: [],
    exposure: 1, tonemapMode: 'neutral', resetHistory: true, stats: { frameMs: 0 },
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr * (r.captureScale || 1)));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr * (r.captureScale || 1)));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const w = Math.max(1, Math.round(cw * r.tier.scale)), h = Math.max(1, Math.round(ch * r.tier.scale));
    if (w === r.width && h === r.height) return;
    r.width = w; r.height = h;
    const t = r.targets;
    for (const x of Object.values(r.fbos)) destroy(gl, x);
    for (const x of Object.values(t)) destroy(gl, x);
    t.depth = target(gl, w, h, fmt.depth, { filter: gl.NEAREST });
    t.normal = target(gl, w, h, fmt.rgba8, { filter: gl.NEAREST });
    t.velocity = target(gl, w, h, fmt.rg, { filter: gl.NEAREST });
    t.diffuse = target(gl, w, h, fmt.hdr);
    t.specular = target(gl, w, h, fmt.hdr);
    t.hdr = target(gl, w, h, fmt.hdr);
    t.hdrCopy = target(gl, w, h, fmt.hdr);
    r.fbos = {
      prepass: fbo(gl, [t.normal, t.velocity], t.depth),
      main: fbo(gl, [t.diffuse, t.specular], t.depth),
      hdr: fbo(gl, [t.hdr], t.depth),
      combine: fbo(gl, [t.hdr]),
      hdrCopy: fbo(gl, [t.hdrCopy]),
    };
    post.resize(w, h, t.depth);
    r.resetHistory = true;
  }

  function setTier(name) {
    r.tier = TIERS[name] || TIERS.high;
    shadows.resize(r.tier.shadow);
    r.width = 0;
    resize();
  }

  function setScene(scene) {
    r.scene = scene;
    ibl.bake(scene.env);
    for (const b of r.backdrop) b.mesh.dispose();
    r.backdrop = scene.backdrop.map((b) => {
      const data = b.data();
      const m = mesh(gl, { data, stride: STRIDE, attribs: [[ATTRIBS.aPos, 3], [ATTRIBS.aNormal, 3], [ATTRIBS.aCap, 1]], count: data.length / STRIDE });
      const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      return { material: b.material, mesh: m, model: ident, prevModel: ident, color: b.color || [1, 1, 1, 1], castShadow: false, backdrop: true };
    });
    r.exposure = scene.exposure;
    r.resetHistory = true;
  }

  function setOrange(packed) {
    orangeUbo.data.set(packed);
    orangeUbo.upload();
  }

  function fillFrame(frame, camera) {
    const d = frameUbo.data, scene = r.scene;
    d.set(camera.viewProj, F.viewProj); d.set(camera.view, F.view); d.set(camera.proj, F.proj);
    d.set(camera.invViewProj, F.invViewProj); d.set(camera.viewProjNJ, F.viewProjNJ); d.set(camera.prevViewProjNJ, F.prevViewProjNJ);
    d.set(shadows.state.viewProj, F.lightViewProj);
    d.set([...camera.eye, frame.time], F.camPos);
    d.set([r.width, r.height, 1 / r.width, 1 / r.height], F.resolution);
    d.set([...camera.jitter, 0, 0], F.jitter);
    const key = keyLight(scene);
    d.set([...key.dir, key.tanHalf], F.keyDir);
    d.set(scene.occluderTint || [1, 1, 1, 0], F.occluderTint);
    d.set([1 / shadows.size, shadows.state.extent, shadows.state.range, frame.shadowCasters ? 1 : 0], F.shadow);
    d.set([scene.envIntensity, scene.keyIntensity, ibl.cubeScale, ibl.maxMip], F.env);
    d.set(ibl.shEnv, F.shEnv); d.set(ibl.shKey, F.shKey);
    d.set([frame.wetExtent || 0.35, frame.wetness ? 1 : 0, frame.wetSize || 512, 0], F.wet);
    d.set([r.tier.index, r.tier.ssao ? 1 : 0, r.tier.sss ? 1 : 0, r.tier.taa ? 1 : 0], F.flags);
    d.set(scene.background, F.background);
    frameUbo.upload();
  }

  function bindCommon(prog, ctx) {
    set(prog, 'uEnvCube', ibl.env);
    set(prog, 'uKeyCube', ibl.key);
    set(prog, 'uBrdfLut', ibl.lut);
    set(prog, 'uShadowMap', shadows.texture);
    set(prog, 'uAO', ctx.ao || white);
    set(prog, 'uWetness', ctx.frame.wetness || black);
  }

  function draw(prog, d) {
    gl.uniformMatrix4fv(prog.uniforms.uModel, false, d.model);
    if (prog.uniforms.uPrevModel) gl.uniformMatrix4fv(prog.uniforms.uPrevModel, false, d.prevModel || d.model);
    if (prog.uniforms.uMaterialColor) gl.uniform4fv(prog.uniforms.uMaterialColor, d.color || [1, 1, 1, 1]);
    gl.bindVertexArray(d.mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
  }

  const passes = [
    { name: 'shadow', run(ctx) { shadows.render(ctx.drawables); } },
    {
      name: 'prepass',
      run(ctx) {
        bind(gl, r.fbos.prepass);
        gl.clearColor(0.5, 0.5, 1, 1);
        gl.clearDepth(1);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
        use(prepassProg);
        for (const d of ctx.drawables) draw(prepassProg, d);
      },
    },
    { name: 'ssao', enabled: (ctx) => ctx.tier.ssao, run: (ctx) => post.ssao(ctx) },
    {
      name: 'main',
      run(ctx) {
        bind(gl, r.fbos.main);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        let current = null;
        for (const d of ctx.drawables) {
          const prog = materialProgram(d.material);
          if (prog !== current) { use(prog); bindCommon(prog, ctx); current = prog; }
          draw(prog, d);
        }
        gl.depthMask(true);
        gl.bindVertexArray(null);
        ctx.diffuse = r.targets.diffuse;
      },
    },
    { name: 'sss', enabled: (ctx) => ctx.tier.sss, run: (ctx) => { gl.disable(gl.DEPTH_TEST); post.sss(ctx); } },
    { name: 'combine', run: (ctx) => { gl.disable(gl.DEPTH_TEST); post.combine(ctx); } },
    {
      name: 'transparent',
      enabled: (ctx) => ctx.frame.transparent.length > 0,
      run(ctx) {
        post.copy(r.targets.hdr, r.fbos.hdrCopy);
        bind(gl, r.fbos.hdr);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        for (const f of ctx.frame.transparent) f(ctx);
        gl.depthMask(true);
        gl.disable(gl.DEPTH_TEST);
      },
    },
    { name: 'taa', enabled: (ctx) => ctx.tier.taa, run: (ctx) => post.taa(ctx) },
    { name: 'dof', enabled: (ctx) => ctx.frame.macro, run: (ctx) => post.dof(ctx) },
    { name: 'bloom', enabled: (ctx) => ctx.tier.bloom, run: (ctx) => post.bloom(ctx) },
    { name: 'tonemap', run: (ctx) => post.tonemap(ctx) },
  ];

  function render(frame) {
    resize();
    const { camera } = frame;
    camera.near = 0.01; camera.far = 12;
    camera.update(frame.dt, r.width, r.height, r.tier.taa);
    const casters = frame.drawables.filter((d) => d.castShadow);
    const key = keyLight(r.scene);
    if (casters.length) {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const c of casters) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c.centre[k] - c.radius); hi[k] = Math.max(hi[k], c.centre[k] + c.radius); }
      const centre = lo.map((v, k) => (v + hi[k]) / 2);
      const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
      shadows.fit(centre, radius, key.dir);
    }
    fillFrame({ ...frame, shadowCasters: casters.length }, camera);
    const drawables = [...frame.drawables, ...r.backdrop];
    const ctx = {
      gl, renderer: r, frame, camera, drawables, tier: r.tier, targets: r.targets, fbos: r.fbos, ibl, post,
      width: r.width, height: r.height, ao: null, color: null, bloom: null, black, white,
      grade: { desaturation: r.scene.desaturation ?? 0.15, white: r.scene.white ?? 1, vignette: r.scene.vignette ?? 0.25 }, exposure: r.exposure * (frame.exposure ?? 1), tonemapMode: r.tonemapMode, resetHistory: r.resetHistory, focus: frame.focus || 0.4,
    };
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    for (const p of passes) {
      if (p.enabled && !p.enabled(ctx)) continue;
      p.run(ctx);
    }
    gl.bindVertexArray(null);
    r.resetHistory = false;
    return ctx;
  }

  Object.assign(r, { resize, setTier, setScene, setOrange, render, passes, materialProgram, frameUbo, orangeUbo });
  return r;
}
