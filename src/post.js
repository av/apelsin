import { program, use, set, FULLSCREEN_VS, fullscreen, fbo, target, formats, bind, destroy } from './gl.js';
import { SSAO_FS, BLUR_FS, SSS_FS, COMBINE_FS, TAA_FS, FOCUS_FS, DOF_FS, DOWN_FS, UP_FS, TONEMAP_FS, COPY_FS } from './shaders/post.js';
import { mat4 } from './math.js';

const BLOOM_LEVELS = 5;
const SENSOR_HEIGHT = 0.024;

export const SSS_PROFILES = new Float32Array([
  0, 0, 0, 0,
  0.0010, 0.00035, 0.00012, 0.5,
  0.0020, 0.0016, 0.0010, 0.65,
  0.0070, 0.0028, 0.0006, 0.92,
]);

export function createPost(gl) {
  const fmt = formats(gl);
  const p = (fs, label) => program(gl, FULLSCREEN_VS, fs, { label });
  const progs = {
    ssao: p(SSAO_FS, 'ssao'), blur: p(BLUR_FS, 'ssao-blur'), sss: p(SSS_FS, 'sss'), combine: p(COMBINE_FS, 'combine'),
    taa: p(TAA_FS, 'taa'), focus: p(FOCUS_FS, 'focus'), dof: p(DOF_FS, 'dof'), down: p(DOWN_FS, 'bloom-down'), up: p(UP_FS, 'bloom-up'),
    tonemap: p(TONEMAP_FS, 'tonemap'), copy: p(COPY_FS, 'copy'),
  };
  let t = {};
  let historyIndex = 0;
  let historyValid = false;
  let focusIndex = 0;
  let focusValid = false;
  let seed = 0;
  const focusTargets = [0, 1].map(() => fbo(gl, [target(gl, 1, 1, fmt.hdr, { filter: gl.NEAREST })]));

  function resize(w, h, depth) {
    for (const v of Object.values(t)) Array.isArray(v) ? v.forEach((x) => destroy(gl, x, x.colors?.[0])) : v?.fb && destroy(gl, v, v.colors?.[0]);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const mk = (W, H, f) => fbo(gl, [target(gl, W, H, f)]);
    t = {
      ao: mk(hw, hh, fmt.r), aoBlur: mk(hw, hh, fmt.r),
      sssTmp: mk(w, h, fmt.hdr), sssOut: mk(w, h, fmt.hdr),
      history: [mk(w, h, fmt.hdr), mk(w, h, fmt.hdr)],
      dof: mk(w, h, fmt.hdr),
      bloom: Array.from({ length: BLOOM_LEVELS }, (_, i) => mk(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)), fmt.hdr)),
    };
    t.depth = depth;
    historyValid = false;
  }

  const nearFar = (ctx) => [ctx.camera.near, ctx.camera.far];

  function ssao(ctx) {
    const { camera } = ctx;
    bind(gl, t.ao);
    use(progs.ssao, { uDepth: ctx.targets.depth, uNormal: ctx.targets.normal, uInvProj: mat4.invert(mat4.create(), camera.proj), uProjM: camera.proj, uRadius: ctx.tier.aoRadius, uSamples: ctx.tier.aoSamples, uNearFar: nearFar(ctx) });
    fullscreen(gl);
    bind(gl, t.aoBlur);
    use(progs.blur, { uSource: t.ao.colors[0], uDepth: ctx.targets.depth, uDir: [1 / t.ao.width, 0], uNearFar: nearFar(ctx) });
    fullscreen(gl);
    bind(gl, t.ao);
    use(progs.blur, { uSource: t.aoBlur.colors[0], uDepth: ctx.targets.depth, uDir: [0, 1 / t.ao.height] });
    fullscreen(gl);
    ctx.ao = t.ao.colors[0];
  }

  function sss(ctx) {
    const scale = ctx.camera.proj[5] * 0.5 * ctx.height;
    seed = (seed + 1) % 64;
    bind(gl, t.sssTmp);
    use(progs.sss, { uColor: ctx.targets.diffuse, uDepth: ctx.targets.depth, uDir: [1 / ctx.width, 0], uProjScale: scale, uNearFar: nearFar(ctx), uTaps: ctx.tier.sssTaps, uSeed: seed, uProfiles: SSS_PROFILES });
    fullscreen(gl);
    bind(gl, t.sssOut);
    use(progs.sss, { uColor: t.sssTmp.colors[0], uDir: [0, 1 / ctx.height], uSeed: seed + 0.5 });
    fullscreen(gl);
    ctx.diffuse = t.sssOut.colors[0];
  }

  function combine(ctx) {
    bind(gl, ctx.fbos.combine);
    use(progs.combine, { uDiffuse: ctx.diffuse, uSpecular: ctx.targets.specular, uAlbedo: ctx.targets.albedo, uDepth: ctx.targets.depth, uEnvSource: ctx.ibl.envSource });
    fullscreen(gl);
    ctx.color = ctx.targets.hdr;
  }

  function taa(ctx) {
    const prev = t.history[historyIndex], next = t.history[1 - historyIndex];
    bind(gl, next);
    use(progs.taa, { uCurrent: ctx.color, uHistory: prev.colors[0], uVelocity: ctx.targets.velocity, uDepth: ctx.targets.depth, uNearFar: nearFar(ctx), uReset: historyValid && !ctx.resetHistory ? 0 : 1 });
    fullscreen(gl);
    historyIndex = 1 - historyIndex;
    historyValid = true;
    ctx.color = next.colors[0];
  }

  function lens(ctx) {
    const f = (SENSOR_HEIGHT / 2) / Math.tan(ctx.camera.fov / 2);
    return [f, f / ctx.fStop, SENSOR_HEIGHT, 0];
  }

  function focus(ctx) {
    const prev = focusTargets[focusIndex], next = focusTargets[1 - focusIndex];
    bind(gl, next);
    const blend = ctx.camera.snap || !focusValid ? 1 : 1 - Math.exp(-(ctx.frame.dt || 0.016) * 7);
    use(progs.focus, { uDepth: ctx.targets.depth, uNearFar: nearFar(ctx), uPrevFocus: prev.colors[0], uFocusUv: ctx.focusUv, uTexel: [1 / ctx.width, 1 / ctx.height], uBlend: focusValid ? blend : 1, uFallback: ctx.focus });
    fullscreen(gl);
    focusIndex = 1 - focusIndex;
    focusValid = true;
    return next.colors[0];
  }

  function dof(ctx) {
    const focusTex = focus(ctx);
    bind(gl, t.dof);
    const maxRadius = (ctx.tier.dofRadius ?? 16) * ctx.height / 800;
    use(progs.dof, { uColor: ctx.color, uDepth: ctx.targets.depth, uFocus: focusTex, uLens: lens(ctx), uMaxRadius: maxRadius, uTaps: ctx.tier.dofTaps ?? 40, uNearFar: nearFar(ctx) });
    fullscreen(gl);
    ctx.color = t.dof.colors[0];
  }

  function bloom(ctx) {
    let src = ctx.color, sw = ctx.width, sh = ctx.height;
    t.bloom.forEach((level, i) => {
      bind(gl, level);
      use(progs.down, { uSource: src, uTexel: [1 / sw, 1 / sh], uFirst: i === 0 ? 1 : 0, uThreshold: ctx.grade.bloomThreshold / Math.max(ctx.exposure, 1e-3) });
      fullscreen(gl);
      src = level.colors[0]; sw = level.width; sh = level.height;
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
      const from = t.bloom[i], to = t.bloom[i - 1];
      bind(gl, to);
      use(progs.up, { uSource: from.colors[0], uTexel: [1 / from.width, 1 / from.height] });
      fullscreen(gl);
    }
    gl.disable(gl.BLEND);
    ctx.bloom = t.bloom[0].colors[0];
  }

  function tonemap(ctx, out = null) {
    if (out) bind(gl, out); else bind(gl, null);
    const g = ctx.grade;
    use(progs.tonemap, {
      uColor: ctx.color, uBloom: ctx.bloom || ctx.black, uExposure: ctx.exposure, uBloomStrength: ctx.bloom ? g.bloom : 0,
      uSharpen: ctx.tier.taa ? ctx.tier.sharpen ?? 0.2 : 0, uMode: ctx.tonemapMode === 'agx' ? 1 : 0, uVignette: g.vignette, uGrain: g.grain * (ctx.tier.grainScale ?? 1),
      uSourceTexel: [1 / ctx.width, 1 / ctx.height], uWhite: g.white, uContrast: g.contrast, uSaturation: g.saturation, uBalance: g.balance,
      uPathToWhite: g.pathToWhite, uToe: g.toe,
    });
    fullscreen(gl);
  }

  function copy(src, dst) {
    bind(gl, dst);
    use(progs.copy, { uSource: src });
    fullscreen(gl);
  }

  return { progs, resize, ssao, sss, combine, taa, dof, bloom, tonemap, copy, invalidate() { historyValid = false; focusValid = false; } };
}
