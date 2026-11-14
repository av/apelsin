import { program, use, set, ubo, fbo, target, formats, bind, destroy, texture, mesh } from './gl.js';
import { FRAME_UBO_FLOATS } from './shaders/common.js';
import { UBER_VS, uberFragment, MATERIALS, ATTRIBS, GROUND_RECEIVERS } from './shaders/materials.js';
import { ORANGE_UBO_FLOATS } from './orange/params.js';
import { ORANGE_UBO } from './orange/glsl.js';
import { createIBL } from './ibl.js';
import { createShadows } from './shadows.js';
import { createPost } from './post.js';
import { keyLight, gradeOf } from './scenes.js';
import { STRIDE } from './orange/mesh.js';
import { mat4 } from './math.js';
import { PIECE_VS, pieceFragment } from './orange/march-glsl.js';
import { bindPiece } from './orange/piece.js';

export const TIERS = {
  low: { name: 'low', index: 0, scale: 0.6, shadow: 1024, ground: 192, ssao: false, aoSamples: 0, aoRadius: 0.04, sss: false, sssTaps: 0, keySamples: 3, taa: false, bloom: false, grainScale: 0.5, dofTaps: 24, dofRadius: 10 },
  medium: { name: 'medium', index: 1, scale: 0.75, shadow: 2048, ground: 256, ssao: true, aoSamples: 8, aoRadius: 0.03, sss: true, sssTaps: 7, keySamples: 3, taa: true, bloom: true, sharpen: 0.25, dofTaps: 14, dofRadius: 14 },
  high: { name: 'high', index: 2, scale: 1, shadow: 2048, ground: 512, ssao: true, aoSamples: 12, aoRadius: 0.03, sss: true, sssTaps: 11, keySamples: 5, taa: true, bloom: true, sharpen: 0.2, dofTaps: 32, dofRadius: 18 },
  ultra: { name: 'ultra', index: 3, scale: 1, shadow: 4096, ground: 768, ssao: true, aoSamples: 16, aoRadius: 0.03, sss: true, sssTaps: 16, keySamples: 7, taa: true, bloom: true, sharpen: 0.2, dofTaps: 48, dofRadius: 22 },
};
export const TIER_NAMES = Object.keys(TIERS);

const F = { viewProj: 0, view: 16, proj: 32, invViewProj: 48, viewProjNJ: 64, prevViewProjNJ: 80, lightViewProj: 96, camPos: 112, resolution: 116, jitter: 120, keyDir: 124, occluderTint: 128, shadow: 132, env: 136, shEnv: 140, shKey: 176, wet: 212, flags: 216, background: 220, ground: 224, ground2: 228, occluderMfp: 232, keyShape: 236 };

function uboOffset(glsl, name) {
  const body = glsl.slice(glsl.indexOf('{') + 1, glsl.lastIndexOf('}'));
  let offset = 0;
  for (const decl of body.split(';')) {
    const m = decl.trim().match(/^(vec4|mat4)\s+(\w+)(?:\[(\d+)\])?/);
    if (!m) continue;
    if (m[2] === name) return offset;
    offset += (m[1] === 'mat4' ? 16 : 4) * (m[3] ? +m[3] : 1);
  }
  return -1;
}
const FLESH_OFFSET = uboOffset(ORANGE_UBO, 'oFlesh');
const RIND_OFFSET = uboOffset(ORANGE_UBO, 'oRind');

export function createRenderer(gl, canvas, { tier = 'high' } = {}) {
  const fmt = formats(gl);
  const frameUbo = ubo(gl, 'Frame', FRAME_UBO_FLOATS);
  const orangeUbo = ubo(gl, 'Orange', ORANGE_UBO_FLOATS);
  const ibl = createIBL(gl);
  const shadows = createShadows(gl, TIERS[tier].shadow, TIERS[tier].ground);
  const post = createPost(gl);
  const prepassProg = program(gl, UBER_VS, uberFragment(null, 'prepass'), { label: 'prepass' });
  const pieceProgs = {
    prepass: program(gl, PIECE_VS, pieceFragment('prepass'), { label: 'piece-prepass' }),
    main: program(gl, PIECE_VS, pieceFragment('main'), { label: 'piece-main', defines: gl.caps.floatTargets ? {} : { OUTPUT_SCALE: 0.25 } }),
    shadow: program(gl, PIECE_VS, pieceFragment('shadow'), { label: 'piece-shadow', defines: { SHADOW: 1 } }),
  };
  shadows.setPieces({ prog: pieceProgs.shadow, draw: (prog, d, dir) => bindPiece(gl, prog, d, [-dir[0], -dir[1], -dir[2], 0], r.orangeTextures) });
  const materialProgs = {};
  const materialProgram = (name) => materialProgs[name] || (materialProgs[name] = program(gl, UBER_VS, uberFragment(name, 'main'), { label: `material-${name}`, defines: { [`MATERIAL_${name.toUpperCase()}`]: 1, ...(GROUND_RECEIVERS.includes(name) ? { GROUND_RECEIVER: 1 } : {}), ...(gl.caps.floatTargets ? {} : { OUTPUT_SCALE: 0.25 }) } }));
  for (const name of Object.keys(MATERIALS)) materialProgram(name);
  const white = texture(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([255, 255, 255, 255]) });
  const black = texture(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([0, 0, 0, 255]) });

  const r = {
    gl, ibl, shadows, post, tier: TIERS[tier], width: 0, height: 0, targets: {}, fbos: {}, scene: null, backdrop: [],
    exposure: 1, tonemapMode: 'photo', orangeTextures: {}, resetHistory: true, stats: { frameMs: 0 }, fleshTint: [1, 0.55, 0.02], rindTint: [1, 0.3, 0.004],
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
    t.albedo = target(gl, w, h, fmt.rgba8, { filter: gl.NEAREST });
    t.hdr = target(gl, w, h, fmt.hdr);
    t.hdrCopy = target(gl, w, h, fmt.hdr);
    r.fbos = {
      prepass: fbo(gl, [t.normal, t.velocity], t.depth),
      main: fbo(gl, [t.diffuse, t.specular, t.albedo], t.depth),
      pieces: fbo(gl, [t.diffuse, t.specular, t.albedo]),
      hdr: fbo(gl, [t.hdr], t.depth),
      combine: fbo(gl, [t.hdr]),
      hdrCopy: fbo(gl, [t.hdrCopy]),
    };
    post.resize(w, h, t.depth);
    r.resetHistory = true;
  }

  function setTier(name) {
    r.tier = TIERS[name] || TIERS.high;
    shadows.resize(r.tier.shadow, r.tier.ground);
    r.width = 0;
    resize();
  }

  function setScene(scene) {
    r.scene = scene;
    ibl.bake(scene.env);
    shadows.invalidate();
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

  function drawPieces(prog, ctx) {
    const eye = [...ctx.camera.eye, 1];
    gl.enable(gl.CULL_FACE);
    for (const d of ctx.drawables) if (d.march) bindPiece(gl, prog, d, eye, r.orangeTextures);
    gl.disable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  function setOrange(packed, textures) {
    if (textures) { r.orangeTextures = textures; shadows.invalidate(); }
    orangeUbo.data.set(packed);
    orangeUbo.upload();
    const tint = (offset) => { const f = Array.from(packed.slice(offset, offset + 3)); const m = Math.max(...f, 1e-3); return f.map((x) => x / m); };
    if (FLESH_OFFSET >= 0) r.fleshTint = tint(FLESH_OFFSET);
    if (RIND_OFFSET >= 0) r.rindTint = tint(RIND_OFFSET);
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
    const occ = scene.occluder || {};
    d.set([...r.rindTint.map((x) => x + (1 - x) * (occ.bounceWhite ?? 0.3)), occ.bounce ?? 0.5], F.occluderTint);
    d.set([1 / shadows.size, shadows.state.extent, shadows.state.range, frame.shadowCasters ? (shadows.hasBack ? 2 : 1) : 0], F.shadow);
    d.set([scene.envIntensity, scene.keyIntensity, ibl.cubeScale, ibl.maxMip], F.env);
    d.set(ibl.shEnv, F.shEnv); d.set(ibl.shKey, F.shKey);
    d.set([frame.wetExtent || 0.35, frame.wetness ? 1 : 0, frame.wetSize || 512, 0], F.wet);
    d.set([r.tier.index, r.tier.ssao ? 1 : 0, r.tier.sss ? 1 : 0, r.tier.taa ? 1 : 0], F.flags);
    d.set(scene.background, F.background);
    d.set(shadows.state.ground, F.ground);
    d.set([frame.shadowCasters && shadows.ground ? 1 : 0, ...r.fleshTint], F.ground2);
    d.set([...(occ.mfp || [0.009, 0.0032, 0.0012]), occ.leak ?? 0.5], F.occluderMfp);
    d.set([key.tanX, key.tanY, ...(scene.pool || [1, 0])], F.keyShape);
    frameUbo.upload();
  }

  function bindCommon(prog, ctx) {
    set(prog, 'uEnvCube', ibl.env);
    set(prog, 'uKeyCube', ibl.key);
    set(prog, 'uBrdfLut', ibl.lut);
    set(prog, 'uShadowMap', shadows.texture);
    set(prog, 'uShadowBack', shadows.back || black);
    set(prog, 'uGroundAO', shadows.ground || white);
    set(prog, 'uGroundKey', shadows.groundKey || white);
    set(prog, 'uAO', ctx.ao || white);
    set(prog, 'uWetness', ctx.frame.wetness || black);
    for (const k in r.orangeTextures) set(prog, k, r.orangeTextures[k]);
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
        for (const d of ctx.drawables) if (!d.march) draw(prepassProg, d);
        use(pieceProgs.prepass);
        drawPieces(pieceProgs.prepass, ctx);
      },
    },
    { name: 'ssao', enabled: (ctx) => ctx.tier.ssao, run: (ctx) => post.ssao(ctx) },
    {
      name: 'main',
      run(ctx) {
        bind(gl, r.fbos.main);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (ctx.drawables.some((d) => d.march)) {
          bind(gl, r.fbos.pieces);
          gl.disable(gl.DEPTH_TEST);
          const prog = pieceProgs.main;
          use(prog);
          bindCommon(prog, ctx);
          set(prog, 'uSceneDepth', r.targets.depth);
          set(prog, 'uSceneNormal', r.targets.normal);
          drawPieces(prog, ctx);
          bind(gl, r.fbos.main);
          gl.enable(gl.DEPTH_TEST);
        }
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        let current = null;
        for (const d of ctx.drawables) {
          if (d.march) continue;
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
    { name: 'dof', enabled: (ctx) => ctx.dof && (ctx.frame.macro || ctx.tier.index >= 2), run: (ctx) => post.dof(ctx) },
    { name: 'taa', enabled: (ctx) => ctx.tier.taa, run: (ctx) => post.taa(ctx) },
    { name: 'bloom', enabled: (ctx) => ctx.tier.bloom, run: (ctx) => post.bloom(ctx) },
    { name: 'tonemap', run: (ctx) => { if (r.debugTexture) { ctx.color = r.debugTexture(ctx); ctx.bloom = null; } post.tonemap(ctx); } },
  ];

  function focusUv(frame, camera, casters) {
    const project = (p) => { const c = mat4.transformPoint(camera.viewProjNJ, p); return [c[0] * 0.5 + 0.5, c[1] * 0.5 + 0.5]; };
    if (frame.focusPoint) return project(frame.focusPoint);
    let best = null, bestD = Infinity;
    for (const c of casters) {
      const uv = project(c.centre);
      const d = Math.hypot(uv[0] - 0.5, (uv[1] - 0.5) * 0.8);
      if (d < bestD) { bestD = d; best = uv; }
    }
    return best ? best.map((x) => Math.min(0.98, Math.max(0.02, x))) : [0.5, 0.5];
  }

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
      const floorY = r.scene.floorAt ? r.scene.floorAt(centre[0], centre[2]) : 0;
      const occ = r.scene.occluder || {};
      shadows.keySamples = r.tier.keySamples;
      shadows.fitGround(centre, Math.hypot(hi[0] - lo[0], hi[2] - lo[2]) / 2, floorY, r.scene.groundReach ?? 0.09, key, { tint: r.fleshTint, mfp: occ.mfp || [0.009, 0.0032, 0.0012], strength: occ.leak ?? 0.5 });
    }
    fillFrame({ ...frame, shadowCasters: casters.length }, camera);
    const drawables = [...frame.drawables, ...r.backdrop];
    let pieceId = 1;
    for (const d of drawables) if (d.march) d.pieceId = Math.min(pieceId++, 254);
    const grade = gradeOf(r.scene);
    const ctx = {
      gl, renderer: r, frame, camera, drawables, tier: r.tier, targets: r.targets, fbos: r.fbos, ibl, post,
      width: r.width, height: r.height, ao: null, color: null, bloom: null, black, white,
      grade, exposure: r.exposure * (frame.exposure ?? 1), tonemapMode: grade.tonemap || r.tonemapMode, resetHistory: r.resetHistory,
      focus: frame.focus || 0.4, dof: !!(frame.macro || r.scene.dof), focusUv: focusUv(frame, camera, casters), fStop: frame.fStop || (frame.macro ? 2.8 : r.scene.dof || 4),
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
