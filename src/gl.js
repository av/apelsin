export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const caps = {
    floatTargets: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    halfBlend: !!gl.getExtension('EXT_float_blend'),
    gpu: 'unknown',
  };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  if (info) caps.gpu = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  gl.caps = caps;
  gl.errors = [];
  return gl;
}

function numbered(src) {
  return src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join('\n');
}

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n');
    const hits = [...log.matchAll(/ERROR: \d+:(\d+)/g)].map((m) => +m[1]);
    const context = hits.slice(0, 3).map((n) => lines.slice(Math.max(0, n - 3), n + 2).map((l, i) => `${n - 2 + i}: ${l}`).join('\n')).join('\n---\n');
    const msg = `shader compile error [${label}] ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}\n${log}\n${context || numbered(src)}`;
    gl.errors.push(msg);
    console.error(msg);
    throw new Error(msg);
  }
  return s;
}

export const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp samplerCube;\n';

export function program(gl, vs, fs, { defines = {}, label = 'program', attribs = {} } = {}) {
  const defs = Object.entries(defines).map(([k, v]) => `#define ${k} ${v === true ? '' : v}`).join('\n') + '\n';
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, HEADER + defs + vs, label));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, HEADER + defs + fs, label));
  for (const [name, loc] of Object.entries(attribs)) gl.bindAttribLocation(p, loc, name);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const msg = `program link error [${label}]\n${gl.getProgramInfoLog(p)}`;
    gl.errors.push(msg);
    console.error(msg);
    throw new Error(msg);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const u = gl.getActiveUniform(p, i);
    const loc = gl.getUniformLocation(p, u.name);
    if (loc) uniforms[u.name.replace(/\[0\]$/, '')] = loc;
  }
  for (const [name, binding] of Object.entries(UBO_BINDINGS)) {
    const idx = gl.getUniformBlockIndex(p, name);
    if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, idx, binding);
  }
  let unit = 0;
  const samplers = {};
  gl.useProgram(p);
  for (let i = 0; i < n; i++) {
    const u = gl.getActiveUniform(p, i);
    if ([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_SHADOW].includes(u.type)) {
      samplers[u.name] = unit;
      gl.uniform1i(uniforms[u.name], unit++);
    }
  }
  return { gl, handle: p, uniforms, samplers, label };
}

export const UBO_BINDINGS = { Frame: 0, Orange: 1, Scene: 2 };

export function use(prog, values = {}) {
  const { gl } = prog;
  gl.useProgram(prog.handle);
  for (const [name, v] of Object.entries(values)) set(prog, name, v);
  return prog;
}

export function set(prog, name, v) {
  const { gl } = prog;
  const loc = prog.uniforms[name];
  if (loc === undefined) return;
  if (name in prog.samplers) {
    const unit = prog.samplers[name];
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (v && v.cube) gl.bindTexture(gl.TEXTURE_CUBE_MAP, v.tex || v);
    else gl.bindTexture(gl.TEXTURE_2D, v ? (v.tex || v) : null);
    return;
  }
  if (typeof v === 'number') gl.uniform1f(loc, v);
  else if (typeof v === 'boolean') gl.uniform1i(loc, v ? 1 : 0);
  else if (v.length === 2) gl.uniform2fv(loc, v);
  else if (v.length === 3) gl.uniform3fv(loc, v);
  else if (v.length === 4) gl.uniform4fv(loc, v);
  else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
  else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
  else gl.uniform4fv(loc, v);
}

export function texture(gl, { width, height, internal, format, type, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE, data = null, mips = false }) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  return { tex, width, height, internal };
}

export function formats(gl) {
  const f = gl.caps.floatTargets;
  return {
    hdr: f ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
    rg: f ? { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
    r: { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE },
    rgba8: { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
    depth: { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT },
  };
}

export function target(gl, width, height, fmt, opts = {}) {
  return texture(gl, { width, height, ...fmt, filter: opts.filter ?? gl.LINEAR, mips: opts.mips });
}

export function fbo(gl, colors, depth = null) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  colors.forEach((c, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c.tex, 0));
  if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.tex, 0);
  gl.drawBuffers(colors.length ? colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i) : [gl.NONE]);
  if (!colors.length) gl.readBuffer(gl.NONE);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    const msg = `framebuffer incomplete 0x${status.toString(16)}`;
    gl.errors.push(msg);
    console.error(msg);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const w = (colors[0] || depth).width, h = (colors[0] || depth).height;
  return { fb, colors, depth, width: w, height: h };
}

export function bind(gl, target) {
  if (!target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    return;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
  gl.viewport(0, 0, target.width, target.height);
}

export function destroy(gl, ...things) {
  for (const t of things) {
    if (!t) continue;
    if (t.fb) gl.deleteFramebuffer(t.fb);
    else if (t.tex) gl.deleteTexture(t.tex);
  }
}

export const FULLSCREEN_VS = `
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function fullscreen(gl) {
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function ubo(gl, name, floats) {
  const buf = gl.createBuffer();
  const data = new Float32Array(floats);
  gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
  gl.bufferData(gl.UNIFORM_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, UBO_BINDINGS[name], buf);
  return {
    data,
    upload() {
      gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, UBO_BINDINGS[name], buf);
    },
  };
}

export function mesh(gl, { data, stride, attribs, count, usage }) {
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
  let offset = 0;
  attribs.forEach(([loc, size]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
    offset += size;
  });
  gl.bindVertexArray(null);
  return { vao, buf, count, dispose() { gl.deleteVertexArray(vao); gl.deleteBuffer(buf); } };
}
