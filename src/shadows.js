import { program, use, fbo, bind, target, FULLSCREEN_VS, fullscreen } from './gl.js';
import { UBER_VS, uberFragment } from './shaders/materials.js';
import { mat4, v3 } from './math.js';

const EXTENT_VS = `
layout(location = 0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uMatrix;
uniform vec4 uRect;
uniform float uMode;
out float vValue;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  if (uMode > 0.5) {
    vValue = w.y - uRect.w;
    gl_Position = vec4((w.xz - uRect.xy) * uRect.z, 0.0, 1.0);
  } else {
    vec4 c = uMatrix * w;
    vValue = c.z / c.w * 0.5 + 0.5;
    gl_Position = vec4(c.xy / c.w, 0.0, 1.0);
  }
}`;

const EXTENT_FS = `
uniform float uMode;
in float vValue;
out vec4 outColor;
void main() { outColor = uMode > 0.5 ? vec4(vValue, -vValue, 0.0, 1.0) : vec4(vValue, 0.0, 0.0, 1.0); }`;

const GROUND_AO_FS = `
uniform sampler2D uHeight;
uniform vec4 uParams;
uniform vec4 uKeyDir;
uniform vec4 uKeyUp;
uniform vec4 uLeakTint;
uniform vec4 uMfp;
uniform float uKeySamples;
in vec2 vUv;
layout(location = 0) out vec4 outAO;
layout(location = 1) out vec4 outKey;
const int DIRS = 16;
const int STEPS = 10;
vec2 heightAt(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(-1.0, 1.0);
  vec2 h = texture(uHeight, uv).rg;
  return vec2(h.r, -h.g);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float worldPerUv = uParams.x, reach = uParams.y, maxHeight = uParams.z;
  float jitter = 0.5;
  float vis = 0.0;
  vec3 bent = vec3(0.0);
  for (int i = 0; i < DIRS; i++) {
    float a = (float(i) + jitter * 0.5) * 6.2831853 / float(DIRS);
    vec2 d = vec2(cos(a), sin(a));
    float sinTop = 0.0, sinBot = 1.0;
    for (int k = 0; k < STEPS; k++) {
      float t = (float(k) + 0.5 + 0.5 * jitter) / float(STEPS);
      float r = reach * t * t + 0.0003;
      vec2 h = heightAt(vUv + d * r / worldPerUv);
      if (h.x <= 0.0) continue;
      sinTop = max(sinTop, h.x / length(vec2(h.x, r)));
      float b = max(h.y, 0.0);
      sinBot = min(sinBot, b / length(vec2(b, r)));
    }
    float lo = min(sinBot, sinTop);
    float occluded = sinTop > 0.0 ? max(sinTop * sinTop - lo * lo, 0.0) : 0.0;
    vis += 1.0 - occluded;
    bent += vec3(-d.x, 0.0, -d.y) * occluded;
  }
  vis /= float(DIRS);
  vec3 n = normalize(vec3(0.0, 1.0, 0.0) + bent / float(DIRS) * 1.2);
  outAO = vec4(n * 0.5 + 0.5, vis);
  vec3 L = uKeyDir.xyz, up = uKeyUp.xyz;
  vec3 rt = normalize(cross(L, up)), u = cross(rt, L);
  int side = int(uKeySamples);
  vec3 key = vec3(0.0);
  float wsum = 0.0;
  for (int sy = 0; sy < 8; sy++) for (int sx = 0; sx < 8; sx++) {
    if (sx >= side || sy >= side) continue;
    vec2 g = (vec2(sx, sy) + 0.5) / float(side) * 2.0 - 1.0;
    vec3 dir = normalize(L + rt * g.x * uKeyDir.w + u * g.y * uKeyUp.w);
    if (dir.y <= 0.0) continue;
    float w = dir.y * (1.0 - 0.25 * dot(g, g));
    float horiz = length(dir.xz);
    vec2 hd = dir.xz / max(horiz, 1e-4);
    float slope = dir.y / max(horiz, 1e-4);
    float maxR = min(uParams.w, maxHeight / slope);
    float path = 0.0;
    float prevR = 0.0;
    for (int k = 0; k < 14; k++) {
      float t = (float(k) + 0.5 + 0.5 * jitter) / 14.0;
      float r = maxR * t * t + 0.0002;
      float rayH = r * slope;
      vec2 h = heightAt(vUv + hd * r / worldPerUv);
      if (h.x > rayH && h.y < rayH) path += (r - prevR) * sqrt(1.0 + slope * slope);
      prevR = r;
    }
    vec3 T = path > 0.0 ? uLeakTint.rgb * exp(-path / uMfp.rgb) * uMfp.w : vec3(1.0);
    key += T * w;
    wsum += w;
  }
  outKey = vec4(wsum > 0.0 ? key / wsum : vec3(1.0), 1.0);
}`;

export function createShadows(gl, initialSize, initialGround = 384) {
  const prog = program(gl, UBER_VS, uberFragment(null, 'shadow'), { label: 'shadow', defines: { SHADOW: 1 } });
  const floats = gl.caps.floatTargets;
  const extentProg = floats ? program(gl, EXTENT_VS, EXTENT_FS, { label: 'shadow-extent' }) : null;
  const groundProg = floats ? program(gl, FULLSCREEN_VS, GROUND_AO_FS, { label: 'ground-ao' }) : null;
  const backFormat = gl.caps.halfBlend ? { internal: gl.R32F, format: gl.RED, type: gl.FLOAT } : { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT };
  let map = null, back = null, height = null, ground = null, groundSize = 0, keySamples = 5;

  function allocate(size, gs) {
    if (map) { gl.deleteFramebuffer(map.fb); gl.deleteTexture(map.depth.tex); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    map = fbo(gl, [], { tex, width: size, height: size });
    map.size = size;
    if (floats) {
      if (back) { gl.deleteFramebuffer(back.fb); gl.deleteTexture(back.colors[0].tex); }
      back = fbo(gl, [target(gl, size >> 1, size >> 1, backFormat, { filter: gl.NEAREST })]);
      if (gs !== groundSize) {
        if (height) { gl.deleteFramebuffer(height.fb); gl.deleteTexture(height.colors[0].tex); gl.deleteFramebuffer(ground.fb); ground.colors.forEach((c) => gl.deleteTexture(c.tex)); }
        height = fbo(gl, [target(gl, gs, gs, { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT }, { filter: gl.NEAREST })]);
        ground = fbo(gl, [target(gl, gs, gs, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }), target(gl, gs, gs, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE })]);
        groundSize = gs;
      }
    }
  }
  allocate(initialSize, initialGround);

  const state = { viewProj: mat4.create(), extent: 0.1, range: 1, size: initialSize, ground: [0, 0, 1, 0], groundReady: false, groundReach: 0.1 };

  function fit(centre, radius, keyDir) {
    const extent = radius * 1.4 + 0.015;
    const dist = radius + 0.25;
    const eye = v3.add(centre, v3.scale(keyDir, dist));
    const up = Math.abs(keyDir[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const view = mat4.lookAt(mat4.create(), eye, centre, up);
    const near = 0.02, far = dist + radius * 3.2 + 0.12;
    const proj = mat4.ortho(mat4.create(), -extent, extent, -extent, extent, near, far);
    mat4.mul(state.viewProj, proj, view);
    state.extent = extent;
    state.range = far - near;
    return state;
  }

  function fitGround(centre, radius, floorY, reach, key, leak) {
    const top = centre[1] + radius - floorY;
    const elevation = Math.max(0.15, Math.asin(Math.min(1, Math.max(0, key.dir[1]))) - Math.atan(key.tanY));
    const shadowReach = Math.min(0.5, top / Math.tan(elevation));
    const half = radius + Math.max(reach, shadowReach * 0.8);
    state.ground = [centre[0], centre[2], 1 / (2 * half), floorY];
    state.groundHalf = half;
    state.groundReach = reach;
    state.groundTop = top + 0.01;
    state.groundShadowReach = Math.max(reach, shadowReach);
    state.key = key;
    state.leak = leak;
  }

  function drawCasters(p, drawables) {
    for (const d of drawables) {
      if (!d.castShadow) continue;
      gl.uniformMatrix4fv(p.uniforms.uModel, false, d.model);
      if (p.uniforms.uPrevModel) gl.uniformMatrix4fv(p.uniforms.uPrevModel, false, d.prevModel || d.model);
      gl.bindVertexArray(d.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
    }
  }

  let lastSignature = '';
  function signature(drawables) {
    let sig = `${map.size}|${state.viewProj.join(',')}|${state.ground.join(',')}|${keySamples}|${state.key?.dir.join(',')}|${state.leak?.strength}|${state.leak?.tint.join(',')}`;
    for (const d of drawables) if (d.castShadow) sig += `|${d.mesh.count}:${Array.prototype.join.call(d.model, ',')}`;
    return sig;
  }

  function render(drawables) {
    const sig = signature(drawables);
    if (sig === lastSignature) return;
    lastSignature = sig;
    bind(gl, map);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    use(prog);
    drawCasters(prog, drawables);
    state.groundReady = false;
    if (!floats) { gl.bindVertexArray(null); return; }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    bind(gl, back);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    use(extentProg, { uMatrix: state.viewProj, uMode: 0, uRect: state.ground });
    drawCasters(extentProg, drawables);
    bind(gl, height);
    gl.clearColor(-1, -1, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    use(extentProg, { uMatrix: state.viewProj, uMode: 1, uRect: [state.ground[0], state.ground[1], 1 / state.groundHalf, state.ground[3]] });
    drawCasters(extentProg, drawables);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    bind(gl, ground);
    const k = state.key;
    use(groundProg, {
      uHeight: height.colors[0], uParams: [2 * state.groundHalf, state.groundReach, state.groundTop, state.groundShadowReach],
      uKeyDir: [...k.dir, k.tanX], uKeyUp: [...(k.up || [0, 1, 0]), k.tanY], uLeakTint: [...state.leak.tint, 0], uMfp: [...state.leak.mfp, state.leak.strength], uKeySamples: keySamples,
    });
    fullscreen(gl);
    gl.clearColor(0, 0, 0, 1);
    state.groundReady = true;
  }

  return {
    state,
    get texture() { return map.depth; },
    get back() { return back ? back.colors[0] : null; },
    get ground() { return ground ? ground.colors[0] : null; },
    get groundKey() { return ground ? ground.colors[1] : null; },
    set keySamples(n) { keySamples = n; },
    get hasBack() { return !!back; },
    get size() { return map.size; },
    resize(size, gs = groundSize) { if (size !== map.size || gs !== groundSize) { allocate(size, gs); state.size = size; } lastSignature = ''; },
    invalidate() { lastSignature = ''; },
    fit, fitGround, render,
  };
}
