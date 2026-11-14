import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const GPU = {
  nvidia: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'],
  intel: ['--use-gl=angle', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'],
  swiftshader: [],
};

let server, browser, base;

before(async () => {
  server = http.createServer(async (req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!path.extname(file)) file = path.join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU[process.env.APELSIN_GPU || 'nvidia'] });
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function open(query = '', viewport = { width: 1000, height: 640 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?test&${query}`);
  await page.waitForFunction(() => window.apelsin?.ready);
  await page.evaluate(() => window.apelsin.ready);
  page.errors = errors;
  return page;
}

async function pixels(page, frames = 20) {
  await page.evaluate((n) => window.apelsin.step(n), frames);
  const url = await page.evaluate(() => window.apelsin.screenshot());
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const region = (x0, y0, x1, y1) => {
      let n = 0, orange = 0, r = 0, g = 0, b = 0, fn = 0, fr = 0, fg = 0, fb = 0;
      for (let y = Math.floor(y0 * c.height); y < y1 * c.height; y += 2) for (let x = Math.floor(x0 * c.width); x < x1 * c.width; x += 2) {
        const k = (y * c.width + x) * 4, R = data[k], G = data[k + 1], B = data[k + 2];
        n++; r += R; g += G; b += B;
        if (R > 140 && R > G * 1.12 && G > B * 1.25) orange++;
        if (R - B > 70) { fn++; fr += R; fg += G; fb += B; }
      }
      return { orange: orange / n, r: r / n, g: g / n, b: b / n, fruit: { r: fr / fn, g: fg / fn, b: fb / fn } };
    };
    return { width: c.width, height: c.height, centre: region(0.35, 0.3, 0.65, 0.7), all: region(0, 0, 1, 1), corner: region(0, 0, 0.12, 0.12) };
  }, url);
}

test('the page renders a whole orange on the studio cove without errors', async () => {
  const page = await open('seed=11');
  const info = await page.evaluate(() => window.apelsin.info());
  assert.equal(info.pieces, 1);
  assert.equal(info.cutFaces, 0);
  assert.equal(info.seed, 11);
  assert.equal(info.physicsReady, true);
  assert.ok(info.gpu.length > 0);
  const px = await pixels(page);
  assert.ok(px.centre.orange > 0.3, `centre orange fraction ${px.centre.orange}`);
  assert.ok(px.corner.r > 200 && px.corner.g > 200 && px.corner.b > 200, 'studio backdrop is near white');
  assert.deepEqual(page.errors, []);
  assert.deepEqual(info.errors, []);
  await page.close();
});

test('a cut through the orange splits it into two pieces with cut faces and juice', async () => {
  const page = await open('seed=3');
  const centre = await page.evaluate(() => window.apelsin.info());
  const cut = await page.evaluate(() => window.apelsin.cut([0, 0.04, 0], [1, 0.1, 0.2]));
  assert.equal(cut, 1);
  const info = await page.evaluate(() => window.apelsin.step(3));
  assert.equal(info.pieces, centre.pieces + 1);
  assert.equal(info.cutFaces, 2);
  assert.ok(info.droplets > 0, 'juice droplets are spawned on a cut');
  const again = await page.evaluate(() => window.apelsin.cut([0, 0.04, 0], [0, 1, 0]));
  assert.equal(again, 2);
  assert.equal((await page.evaluate(() => window.apelsin.info())).pieces, 4);
  const miss = await page.evaluate(() => window.apelsin.cut([0, 0.5, 0], [0, 1, 0]));
  assert.equal(miss, 0);
  const px = await pixels(page, 60);
  assert.ok(px.centre.orange > 0.15);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a knife stroke across the orange slices it, a stroke beside it does not', async () => {
  const page = await open('seed=5');
  await page.evaluate(() => window.apelsin.step(2));
  const stroke = async (x0, y0, x1, y1) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 16, y0 + ((y1 - y0) * i) / 16);
    await page.mouse.up();
    return page.evaluate(() => window.apelsin.step(2));
  };
  assert.equal((await stroke(40, 40, 200, 60)).pieces, 1);
  const info = await stroke(380, 160, 640, 470);
  assert.equal(info.pieces, 2);
  assert.ok(info.cutFaces >= 2);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the hand tool lifts and tosses a piece', async () => {
  const page = await open('seed=9&preset=halves');
  await page.evaluate(() => window.apelsin.step(10));
  assert.equal(await page.evaluate(() => window.apelsin.setTool('squeeze')), false);
  const target = await page.evaluate(() => {
    const c = document.getElementById('gl');
    return [c.clientWidth * 0.34, c.clientHeight * 0.45];
  });
  await page.evaluate(() => window.apelsin.setTool('hand'));
  await page.mouse.move(...target);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(target[0] - i * 12, target[1] - i * 14); await page.evaluate(() => window.apelsin.step(2)); }
  const lifted = await page.evaluate(() => window.apelsin.info());
  await page.mouse.up();
  assert.ok(lifted.awake >= 1, 'grabbed piece is simulated');
  assert.deepEqual(page.errors, []);
  await page.close();
});

const PRESETS = { whole: 1, halves: 2, wedges: 8, reference: 2 };

test('every preset performs real cuts and renders an orange composition', async () => {
  const page = await open('seed=21');
  for (const [name, count] of Object.entries(PRESETS)) {
    await page.evaluate((n) => window.apelsin.preset(n), name);
    const info = await page.evaluate(() => window.apelsin.step(90));
    assert.equal(info.pieces, count, `${name} pieces`);
    assert.equal(info.preset, name);
    if (name !== 'whole') assert.ok(info.cutFaces >= count, `${name} cut faces ${info.cutFaces}`);
    const px = await pixels(page, 5);
    assert.ok(px.all.orange > 0.03, `${name} shows orange (${px.all.orange})`);
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the preset url parameter composes the reference shot on studio white', async () => {
  const page = await open('preset=reference&seed=4');
  const info = await page.evaluate(() => window.apelsin.info());
  assert.equal(info.preset, 'reference');
  assert.equal(info.pieces, 2);
  const px = await pixels(page, 60);
  assert.ok(px.corner.r > 235 && px.corner.b > 230, 'background is white');
  assert.ok(px.all.orange > 0.12, `reference flesh coverage ${px.all.orange}`);
  await page.close();
});

test('new oranges are seeded: same seed same orange, new seed different orange', async () => {
  const page = await open('seed=100');
  const a = await pixels(page, 10);
  await page.evaluate(() => window.apelsin.newOrange(100));
  const b = await pixels(page, 10);
  await page.evaluate(() => window.apelsin.newOrange(101));
  const c = await pixels(page, 10);
  assert.equal((await page.evaluate(() => window.apelsin.info())).seed, 101);
  assert.ok(Math.abs(a.centre.r - b.centre.r) < 2 && Math.abs(a.centre.g - b.centre.g) < 2);
  assert.ok(Math.abs(a.all.orange - c.all.orange) > 0.0005 || Math.abs(a.centre.g - c.centre.g) > 0.3);
  await page.close();
});

test('screenshot returns a png of the canvas, also at twice the resolution', async () => {
  const page = await open('seed=1&q=medium');
  assert.equal((await page.evaluate(() => window.apelsin.info())).quality, 'medium');
  const url = await page.evaluate(() => window.apelsin.screenshot());
  assert.match(url, /^data:image\/png;base64,/);
  const size = await page.evaluate(async (src) => { const i = new Image(); i.src = src; await i.decode(); return [i.width, i.height]; }, await page.evaluate(() => window.apelsin.screenshot(2)));
  assert.deepEqual(size, [2000, 1280]);
  assert.equal(await page.evaluate(() => window.apelsin.setTool('hand')), true);
  assert.equal(await page.evaluate(() => window.apelsin.setTool('spoon')), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the toolbar and keyboard shortcuts drive presets and tools', async () => {
  const page = await open('seed=6');
  await page.click('[data-preset="wedges"]');
  assert.equal((await page.evaluate(() => window.apelsin.info())).pieces, 8);
  await page.keyboard.press('4');
  assert.equal((await page.evaluate(() => window.apelsin.info())).preset, 'reference');
  await page.keyboard.press('5');
  assert.equal((await page.evaluate(() => window.apelsin.info())).preset, 'reference');
  await page.keyboard.press('1');
  assert.equal((await page.evaluate(() => window.apelsin.info())).pieces, 1);
  await page.keyboard.press('h');
  assert.equal((await page.evaluate(() => window.apelsin.info())).tool, 'hand');
  await page.click('[data-tool="knife"]');
  assert.equal((await page.evaluate(() => window.apelsin.info())).tool, 'knife');
  await page.keyboard.press('s');
  assert.equal((await page.evaluate(() => window.apelsin.info())).tool, 'knife');
  await page.keyboard.press('n');
  assert.notEqual((await page.evaluate(() => window.apelsin.info())).seed, 6);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('every quality tier renders without errors', async () => {
  const page = await open('seed=12&preset=halves');
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    assert.equal(await page.evaluate((t) => window.apelsin.setQuality(t), q), true);
    const px = await pixels(page, 12);
    assert.ok(px.all.orange > 0.02, `${q} renders`);
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('without webgl2 the page shows a short message instead of a blank page', async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  });
  await page.goto(`${base}?test`);
  await page.waitForSelector('#nogl:not([hidden])');
  assert.match(await page.textContent('#nogl'), /WebGL2/);
  await page.close();
});

async function stats(page, frames = 20) {
  await page.evaluate((n) => window.apelsin.step(n), frames);
  const url = await page.evaluate(() => window.apelsin.screenshot());
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const at = (x, y) => { const k = (y * c.width + x) * 4; return [data[k], data[k + 1], data[k + 2]]; };
    let white = 0, warm = 0, n = 0;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      const [r, g, b] = at(x, y);
      n++;
      if (r >= 250 && g >= 250 && b >= 248) white++;
      if (r > 150 && r < 238 && r - b > 45 && r - b < 110 && g > b && g < r - 20) warm++;
    }
    const band = (y0, y1) => {
      let bright = 0, m = 0, grad = 0;
      for (let y = Math.floor(y0 * c.height); y < y1 * c.height - 1; y++) for (let x = 0; x < c.width - 1; x++) {
        const a = at(x, y), r = at(x + 1, y), d = at(x, y + 1);
        const l = (a[0] + a[1] + a[2]) / 3;
        m++;
        if (l > 235) bright++;
        grad += Math.abs(l - (r[0] + r[1] + r[2]) / 3) + Math.abs(l - (d[0] + d[1] + d[2]) / 3);
      }
      return { bright: bright / m, grad: grad / m };
    };
    return { white: white / n, warm: warm / n, top: band(0, 0.12), all: band(0, 1) };
  }, url);
}

test('the reference shot is high key with warm contact shadows under the pieces', async () => {
  const page = await open('preset=reference&seed=7', { width: 1280, height: 800 });
  const s = await stats(page, 60);
  assert.ok(s.white > 0.45, `clipped white background fraction ${s.white}`);
  assert.ok(s.warm > 0.004, `warm shadow fraction ${s.warm}`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

async function faceProfile(page) {
  await page.evaluate(async () => {
    const { quat } = await import('./src/math.js');
    const { restToWorld } = await import('./src/orange/piece.js');
    const { world, juice } = window.apelsin.internals;
    world.remove(world.pieces[1]);
    const piece = world.pieces[0];
    world.place(piece, [0, 0, 0], quat.fromTo(piece.caps[0].normal, [0, 1, 0]), { sleep: true });
    juice.clear();
    window.apelsin.step(2);
    const centre = restToWorld(piece, [0, piece.caps[0].centroid[1], 0]);
    window.apelsin.camera({ target: centre, yaw: 0, pitch: 1.5, distance: 0.26, fov: (25 * Math.PI) / 180 });
  });
  await page.evaluate(() => window.apelsin.step(20));
  const url = await page.evaluate(() => window.apelsin.screenshot());
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const y = Math.round(c.height / 2), row = ctx.getImageData(0, y - 1, c.width, 3).data;
    const kind = (x) => {
      const k = (c.width + x) * 4, R = row[k], G = row[k + 1], B = row[k + 2];
      if (R > 215 && G > 200 && B > 140) return 'w';
      if (R > 150 && R > G * 1.15 && B < R * 0.55) return 'o';
      return '.';
    };
    let s = '';
    for (let x = 0; x < c.width; x += 2) s += kind(x);
    return s.replace(/(.)\1+/g, '$1');
  }, url);
}

test('a cut face shows the anatomy across: rind, white pith, flesh, white core, flesh, pith, rind', async () => {
  const page = await open('seed=5&preset=halves&debug', { width: 900, height: 900 });
  const profile = await faceProfile(page);
  const runs = (k) => profile.split('').filter((ch) => ch === k).length;
  assert.ok(profile.startsWith('w') && profile.endsWith('w') && runs('w') >= 5 && runs('o') >= 4, `profile across the face ${profile}`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

async function capture(page) {
  const url = await page.evaluate(() => window.apelsin.screenshot());
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    window.__shot = { w: c.width, h: c.height, d };
    return { w: c.width, h: c.height };
  }, url);
}

async function faceUpHalf(page) {
  return page.evaluate(async () => {
    const { quat } = await import('./src/math.js');
    const { restToWorld } = await import('./src/orange/piece.js');
    const { world, juice } = window.apelsin.internals;
    world.remove(world.pieces[1]);
    const piece = world.pieces[0];
    world.place(piece, [0, 0, 0], quat.fromTo(piece.caps[0].normal, [0, 1, 0]), { sleep: true });
    juice.clear();
    window.apelsin.step(2);
    return { centre: restToWorld(piece, [0, piece.caps[0].centroid[1], 0]), side: restToWorld(piece, [0.012, piece.caps[0].centroid[1], 0.008]) };
  });
}

test('a cut face is a field of separate wet sac highlights, not a flat painted cap', async () => {
  const page = await open('seed=5&preset=halves&debug', { width: 900, height: 900 });
  const { side } = await faceUpHalf(page);
  await page.evaluate((c) => window.apelsin.camera({ target: c, yaw: 0.3, pitch: 1.1, distance: 0.14, fov: (20 * Math.PI) / 180 }), side);
  await page.evaluate(() => window.apelsin.step(20));
  await capture(page);
  const { peaks, flesh } = await page.evaluate(() => {
    const { w, h, d } = window.__shot;
    const L = new Float32Array(w * h);
    let fleshN = 0;
    for (let i = 0; i < w * h; i++) {
      L[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
      if (d[i * 4] - d[i * 4 + 2] > 70 && d[i * 4] > 150) fleshN++;
    }
    let n = 0;
    const R = 3;
    for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
      const k = y * w + x, v = L[k];
      if (d[k * 4] - d[k * 4 + 2] <= 50) continue;
      let max = true, sum = 0;
      for (let dy = -R; dy <= R && max; dy++) for (let dx = -R; dx <= R; dx++) { const u = L[k + dy * w + dx]; sum += u; if (u > v) { max = false; break; } }
      if (max && v > sum / ((2 * R + 1) ** 2) + 8) n++;
    }
    return { peaks: n, flesh: fleshN / (w * h) };
  });
  assert.ok(flesh > 0.7, `the macro is filled with flesh ${flesh}`);
  assert.ok(peaks > 400, `distinct sac highlights on the face ${peaks}`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('ray-marched pieces match their real meshes from any orbit angle: no holes, no strays', async () => {
  const page = await open('seed=4&preset=wedges&debug', { width: 1280, height: 800 });
  const base = await page.evaluate(() => window.apelsin.camera({}).yaw);
  for (const [dy, pitch] of [[0, 0.5], [0.6, 0.5], [-0.9, 0.3], [2.2, 0.2], [3.4, 0.9]]) {
    await page.evaluate(([y, p]) => window.apelsin.camera({ yaw: y, pitch: p }), [base + dy, pitch]);
    const result = await page.evaluate(() => {
      window.apelsin.step(4);
      const { renderer, gl, world, camera } = window.apelsin.internals;
      const W = renderer.width, H = renderer.height;
      const read = (fb) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const src = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, src);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderer.targets.normal.tex, 0);
      const marched = read(src);
      gl.deleteFramebuffer(src);
      const sh = (t, code) => { const x = gl.createShader(t); gl.shaderSource(x, code); gl.compileShader(x); return x; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nlayout(location=0) in vec3 aPos;\nuniform mat4 uM;\nvoid main(){ gl_Position = uM * vec4(aPos, 1.0); }'));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\nuniform float uId;\nout vec4 o;\nvoid main(){ o = vec4(0.0, 0.0, 0.0, uId / 255.0); }'));
      gl.linkProgram(prog);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      world.pieces.forEach((piece, k) => {
        const m = new Float32Array(16), a = camera.viewProj, b = piece.model;
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uM'), false, m);
        gl.uniform1f(gl.getUniformLocation(prog, 'uId'), k + 1);
        gl.bufferData(gl.ARRAY_BUFFER, piece.geometry.data, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
        gl.drawArrays(gl.TRIANGLES, 0, piece.geometry.count);
      });
      const mesh = read(fb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      [fb].forEach((x) => gl.deleteFramebuffer(x));
      gl.deleteTexture(tex); gl.deleteRenderbuffer(depth); gl.deleteBuffer(buf); gl.deleteVertexArray(vao); gl.deleteProgram(prog);
      const n = world.pieces.length;
      const idAt = (px, x, y) => { const v = px[(y * W + x) * 4 + 3]; return v >= 1 && v <= n ? v : 0; };
      const R = 5;
      const uniform = (px, x, y, id) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || idAt(px, xx, yy) !== id) return false; } return true; };
      let holes = 0, strays = 0, drawn = 0;
      for (let y = R; y < H - R; y += 2) for (let x = R; x < W - R; x += 2) {
        const want = idAt(mesh, x, y), got = idAt(marched, x, y);
        if (got) drawn++;
        if (want === got) continue;
        if (want && uniform(mesh, x, y, want)) holes++;
        if (got && uniform(mesh, x, y, want)) strays++;
      }
      return { holes, strays, drawn };
    });
    assert.ok(result.drawn > 5000, `pieces are on screen at yaw offset ${dy}: ${JSON.stringify(result)}`);
    assert.ok(result.holes <= 3 && result.strays <= 3, `marched pieces match the meshes at yaw offset ${dy}: ${JSON.stringify(result)}`);
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the cut face renders solid from every viewing angle, with no holes', async () => {
  const page = await open('seed=5&preset=halves&debug', { width: 900, height: 900 });
  const { side } = await faceUpHalf(page);
  for (const [yaw, pitch] of [[0, 0.12], [1.3, 0.3], [2.6, 0.7], [3.9, 1.2], [5.2, 1.5]]) {
    await page.evaluate(([c, y, p]) => window.apelsin.camera({ target: c, yaw: y, pitch: p, distance: 0.2, fov: (25 * Math.PI) / 180 }), [side, yaw, pitch]);
    await page.evaluate(() => window.apelsin.step(8));
    const [px, py] = await page.evaluate((c) => window.apelsin.project(c), side);
    await capture(page);
    const v = await page.evaluate(([px, py]) => {
      const { w, h, d } = window.__shot;
      const sx = Math.round((px * w) / innerWidth), sy = Math.round((py * h) / innerHeight);
      let white = 0, orange = 0, n = 0;
      for (let y = sy - 12; y <= sy + 12; y += 2) for (let x = sx - 12; x <= sx + 12; x += 2) {
        const k = (y * w + x) * 4;
        n++;
        if (d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 240) white++;
        if (d[k] > 150 && d[k] - d[k + 2] > 60) orange++;
      }
      return { white: white / n, orange: orange / n };
    }, [px, py]);
    assert.ok(v.orange > 0.45, `yaw ${yaw} pitch ${pitch}: the face shows flesh ${JSON.stringify(v)}`);
    if (pitch >= 0.3) assert.ok(v.white < 0.01, `yaw ${yaw} pitch ${pitch}: no background shows through the face ${JSON.stringify(v)}`);
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the reference cut face is saturated orange, not pastel', async () => {
  const page = await open('preset=reference&seed=4', { width: 1300, height: 860 });
  await page.evaluate(() => window.apelsin.step(40));
  await capture(page);
  const med = await page.evaluate(() => {
    const { w, h, d } = window.__shot;
    const r = [], g = [], b = [];
    for (let y = Math.floor(h * 0.25); y < h * 0.65; y += 2) for (let x = Math.floor(w * 0.5); x < w * 0.9; x += 2) {
      const k = (y * w + x) * 4;
      if (d[k] > 200 && d[k] - d[k + 2] > 100) { r.push(d[k]); g.push(d[k + 1]); b.push(d[k + 2]); }
    }
    const m = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    return { n: r.length, r: m(r), g: m(g), b: m(b) };
  });
  assert.ok(med.n > 2000, `the face is in frame ${JSON.stringify(med)}`);
  assert.ok(med.r >= 235 && med.g >= 120 && med.g <= 215 && med.b <= 90, `flesh median ${JSON.stringify(med)}`);
  await page.close();
});

test('the stem end carries an olive calyx button with a stem stub', async () => {
  const page = await open('seed=6&debug', { width: 800, height: 800 });
  await page.evaluate(async () => {
    const { quat } = await import('./src/math.js');
    const { restToWorld } = await import('./src/orange/piece.js');
    const { world } = window.apelsin.internals;
    const piece = world.pieces[0];
    world.place(piece, [0, 0, 0], quat.identity(), { sleep: true });
    window.apelsin.step(2);
    window.apelsin.camera({ target: restToWorld(piece, [0, world.params.c, 0]), yaw: 0, pitch: 1.5, distance: 0.12, fov: (25 * Math.PI) / 180 });
  });
  const px = await pixels(page, 20);
  const geometry = await page.evaluate(async () => {
    const { shapeOf } = await import('./src/orange/mesh.js');
    const { world } = window.apelsin.internals;
    const d = world.pieces[0].geometry.data;
    let top = 0;
    for (let i = 1; i < d.length; i += 7) top = Math.max(top, d[i]);
    return { top, c: shapeOf(world.params).radius([0, 1, 0]) };
  });
  const calyx = await page.evaluate(async () => {
    const url = window.apelsin.screenshot();
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let olive = 0;
    for (let k = 0; k < data.length; k += 4) if (data[k] < 190 && data[k + 1] > data[k] * 0.8 && data[k + 1] > data[k + 2] * 1.4) olive++;
    return { olive: olive / (data.length / 4) };
  });
  assert.ok(px.all.orange > 0.3, 'the rind fills the view');
  assert.ok(calyx.olive > 0.002, `an olive calyx is visible ${JSON.stringify(calyx)}`);
  assert.ok(geometry.top > geometry.c + 0.0005, `the stem stub stands proud of the rind ${JSON.stringify(geometry)}`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('without float render targets the studio background still clips to white', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name) { return /color_buffer_float|float_blend/i.test(name) ? null : original.call(this, name); };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?test&preset=reference&seed=7`);
  await page.waitForFunction(() => window.apelsin?.ready);
  await page.evaluate(() => window.apelsin.ready);
  assert.equal((await page.evaluate(() => window.apelsin.info())).floatTargets, false);
  const px = await pixels(page, 30);
  assert.ok(px.corner.r >= 250 && px.corner.g >= 250 && px.corner.b >= 248, `fallback background ${JSON.stringify(px.corner)}`);
  assert.ok(px.all.orange > 0.05, 'fallback still renders the fruit');
  assert.deepEqual(errors, []);
  await page.close();
});

async function openTouch(query = '', viewport = { width: 390, height: 780 }) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?test&${query}`);
  await page.waitForFunction(() => window.apelsin?.ready);
  await page.evaluate(() => window.apelsin.ready);
  page.errors = errors;
  page.context = context;
  return page;
}

function project(page, point) {
  return page.evaluate((p) => window.apelsin.project(p), point);
}

test('a knife follows the pointer stroke and the cut lands on release with sound and juice', async () => {
  const page = await open('seed=5');
  await page.evaluate(() => window.apelsin.step(2));
  const [cx, cy] = await project(page, [0, 0.04, 0]);
  await page.mouse.move(cx - 220, cy - 60);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx - 220 + i * 37, cy - 60 + i * 10); await page.evaluate(() => window.apelsin.step(1)); }
  const mid = await page.evaluate(() => window.apelsin.info());
  assert.equal(mid.knife, true, 'the blade is drawn while the stroke is in progress');
  assert.equal(mid.pieces, 1, 'nothing is cut before release');
  await page.mouse.up();
  const after = await page.evaluate(() => window.apelsin.step(2));
  assert.equal(after.pieces, 2);
  assert.ok(after.droplets > 20, `juice burst ${after.droplets}`);
  const later = await page.evaluate(() => window.apelsin.step(60));
  assert.equal(later.knife, false, 'the blade leaves after the cut');
  assert.ok(later.splats > 0, 'juice lands on the floor');
  assert.ok(await page.evaluate(() => window.apelsin.wetness()) > 0, 'the floor gets a wet stain');
  await page.evaluate(() => window.apelsin.camera({ pitch: 1.3, yaw: 1.1 }));
  await page.evaluate(() => window.apelsin.step(240));
  const pieces = await page.evaluate(() => window.apelsin.poses());
  const [px, py] = await project(page, pieces[0].position);
  await page.mouse.move(px - 160, py + 40);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(px - 160 + i * 27, py + 40 - i * 7);
  await page.mouse.up();
  const top = await page.evaluate(() => window.apelsin.step(2));
  assert.ok(top.pieces >= 3, 'a piece is cut again from a top-down angle');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('cut pieces settle without sinking into the floor or into each other', async () => {
  const page = await open('seed=7');
  await page.evaluate(() => window.apelsin.cut([0, 0.035, 0], [0.8, 0.5, 0.2]));
  await page.evaluate(() => window.apelsin.cut([0, 0.03, 0], [0.1, 0.2, 1]));
  const info = await page.evaluate(() => window.apelsin.step(600));
  assert.ok(info.pieces >= 3);
  const gaps = await page.evaluate(() => window.apelsin.contacts());
  assert.ok(gaps.floor > -0.0015, `pieces rest on the floor (${gaps.floor})`);
  assert.ok(gaps.overlap < 0.002, `pieces do not interpenetrate (${gaps.overlap})`);
  const a = await page.evaluate(() => window.apelsin.poses());
  await page.evaluate(() => window.apelsin.step(300));
  const b = await page.evaluate(() => window.apelsin.poses());
  const drift = Math.max(...a.map((p, i) => Math.hypot(...p.position.map((v, k) => v - b[i].position[k]))));
  assert.ok(drift < 0.002, `settled pieces stay put (${drift})`);
  await page.close();
});

test('presets are deterministic and stay still for 600 more frames', async () => {
  const pageA = await open('seed=31');
  const pageB = await open('seed=31');
  for (const name of ['halves', 'wedges', 'reference']) {
    const poses = [];
    for (const page of [pageA, pageB]) {
      await page.evaluate((n) => window.apelsin.preset(n), name);
      poses.push(await page.evaluate(() => window.apelsin.step(30) && window.apelsin.poses()));
    }
    assert.deepEqual(poses[0].map((p) => p.position), poses[1].map((p) => p.position), `${name} is deterministic`);
    await pageA.evaluate(() => window.apelsin.step(600));
    const later = await pageA.evaluate(() => window.apelsin.poses());
    const drift = Math.max(...later.map((p, i) => Math.hypot(...p.position.map((v, k) => v - poses[0][i].position[k]))));
    assert.ok(drift < 1e-4, `${name} drift ${drift}`);
    const gaps = await pageA.evaluate(() => window.apelsin.contacts());
    assert.ok(gaps.floor > -0.0015 && gaps.overlap < 0.0025, `${name} rests cleanly ${JSON.stringify(gaps)}`);
  }
  assert.deepEqual(pageA.errors, []);
  await pageA.close();
  await pageB.close();
});

test('on a phone a one-finger swipe slices, two fingers orbit and zoom, the toolbar fits', async () => {
  const page = await openTouch('seed=5');
  await page.evaluate(() => window.apelsin.step(2));
  const bar = await page.evaluate(() => [...document.querySelectorAll('#bar button')].map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom, r.height]; }));
  assert.equal(bar.length, 9, 'tools, four presets, new orange, sound and screenshot');
  for (const [l, r, t, b, h] of bar) {
    assert.ok(l >= 0 && r <= 390 && t >= 0 && b <= 780, 'toolbar buttons are on screen');
    assert.ok(h >= 44 && r - l >= 36, `touch target ${r - l}x${h}`);
  }
  assert.equal(new Set(bar.map((b) => Math.round(b[2]))).size, 1, 'the toolbar is a single row');
  const cdp = await page.context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const [cx, cy] = await project(page, [0, 0.04, 0]);
  const cam0 = await page.evaluate(() => window.apelsin.camera({}));
  await touch('touchStart', [[cx - 60, cy - 30], [cx + 60, cy + 30]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 60 - i * 6, cy - 30 - i * 3], [cx + 60 + i * 6, cy + 30 + i * 3]]); await page.evaluate(() => window.apelsin.step(1)); }
  await touch('touchEnd', []);
  const cam1 = await page.evaluate(() => window.apelsin.step(2) && window.apelsin.camera({}));
  assert.ok(cam1.distance < cam0.distance * 0.95, `pinch zooms ${cam0.distance} -> ${cam1.distance}`);
  assert.equal((await page.evaluate(() => window.apelsin.info())).pieces, 1, 'two fingers never cut');
  const [sx, sy] = await project(page, [0, 0.04, 0]);
  await touch('touchStart', [[sx - 130, sy - 20]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[sx - 130 + i * 26, sy - 20 + i * 4]]); await page.evaluate(() => window.apelsin.step(1)); }
  await touch('touchEnd', []);
  const info = await page.evaluate(() => window.apelsin.step(2));
  assert.equal(info.pieces, 2, 'a swipe slices');
  const scroll = await page.evaluate(() => [window.scrollX, window.scrollY, window.visualViewport.scale]);
  assert.deepEqual(scroll, [0, 0, 1], 'the page never scrolls or zooms');
  assert.deepEqual(page.errors, []);
  await page.context.close();
});

test('the page has a title, description, social tags and an orange favicon; the hint fades after the first cut', async () => {
  const page = await open('seed=5');
  assert.match(await page.title(), /Apelsin/);
  const meta = await page.evaluate(() => ({
    description: document.querySelector('meta[name=description]')?.content,
    og: document.querySelector('meta[property="og:title"]')?.content,
    icon: document.querySelector('link[rel=icon]')?.href,
    tips: [...document.querySelectorAll('#bar [data-tip]')].map((b) => b.dataset.tip),
  }));
  assert.ok(meta.description.length > 40);
  assert.ok(meta.og);
  assert.match(meta.icon, /^data:image\/svg\+xml/);
  assert.ok(meta.tips.includes('Knife · K'));
  assert.equal(await page.evaluate(() => document.getElementById('hint').classList.contains('gone')), false);
  await page.evaluate(() => window.apelsin.cut([0, 0.04, 0], [1, 0, 0]));
  assert.equal(await page.evaluate(() => document.getElementById('hint').classList.contains('gone')), false, 'api cuts are not user cuts');
  const [cx, cy] = await project(page, [0, 0.04, 0]);
  await page.mouse.move(cx + 10, cy - 200);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + 10, cy - 200 + i * 40);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => document.getElementById('hint').classList.contains('gone')), true);
  await page.close();
});

test('settled pieces touch the floor: no visible gap and no sinking', async () => {
  const page = await open('seed=21');
  const check = async (label) => {
    const { gaps } = await page.evaluate(() => window.apelsin.contacts());
    for (const g of gaps) {
      assert.ok(g > -0.0005, `${label}: a piece sinks ${(g * 1000).toFixed(2)} mm into the floor`);
      assert.ok(g < 0.0005 || g > 0.003, `${label}: a piece hovers ${(g * 1000).toFixed(2)} mm above the floor`);
    }
    assert.ok(gaps.some((g) => Math.abs(g) < 0.0005), `${label}: something rests on the floor`);
    if (/halves|reference|knife/.test(label)) assert.ok(gaps.every((g) => Math.abs(g) < 0.0005), `${label}: every piece rests on the floor ${gaps}`);
  };
  for (const name of ['halves', 'wedges', 'reference']) {
    await page.evaluate((n) => window.apelsin.preset(n), name);
    await page.evaluate(() => window.apelsin.step(30));
    await check(name);
  }
  await page.evaluate(() => window.apelsin.newOrange(21));
  await page.evaluate(() => window.apelsin.cut([0.01, 0.04, 0], [1, 0.15, 0.3]));
  await page.evaluate(() => window.apelsin.step(600));
  await check('knife cut');
  await page.close();
});
