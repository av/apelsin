import { program, use, fbo, bind } from './gl.js';
import { UBER_VS, uberFragment } from './shaders/materials.js';
import { mat4, v3 } from './math.js';

export function createShadows(gl, initialSize) {
  const prog = program(gl, UBER_VS, uberFragment(null, 'shadow'), { label: 'shadow', defines: { SHADOW: 1 } });
  let map = null;

  function allocate(size) {
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
  }
  allocate(initialSize);

  const state = { viewProj: mat4.create(), extent: 0.1, range: 1, size: initialSize };

  function fit(centre, radius, keyDir) {
    const extent = radius * 1.35 + 0.01;
    const dist = radius + 0.6;
    const eye = v3.add(centre, v3.scale(keyDir, dist));
    const up = Math.abs(keyDir[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const view = mat4.lookAt(mat4.create(), eye, centre, up);
    const near = 0.05, far = dist + radius * 2 + 0.6;
    const proj = mat4.ortho(mat4.create(), -extent, extent, -extent, extent, near, far);
    mat4.mul(state.viewProj, proj, view);
    state.extent = extent;
    state.range = far - near;
    return state;
  }

  function render(drawables) {
    bind(gl, map);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    use(prog);
    for (const d of drawables) {
      if (!d.castShadow) continue;
      gl.uniformMatrix4fv(prog.uniforms.uModel, false, d.model);
      gl.uniformMatrix4fv(prog.uniforms.uPrevModel, false, d.prevModel || d.model);
      gl.bindVertexArray(d.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
    }
    gl.bindVertexArray(null);
  }

  return {
    state,
    get texture() { return map.depth; },
    get size() { return map.size; },
    resize(size) { if (size !== map.size) { allocate(size); state.size = size; } },
    fit, render,
  };
}
