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
  assert.equal(info.scene, 'studio');
  assert.equal(info.variety, 'navel');
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

test('the hand tool tosses a piece and squeeze spurts juice from a cut face', async () => {
  const page = await open('seed=9&preset=halves');
  await page.evaluate(() => window.apelsin.step(10));
  assert.equal(await page.evaluate(() => window.apelsin.setTool('squeeze')), true);
  const before = await page.evaluate(() => window.apelsin.info());
  const target = await page.evaluate(() => {
    const c = document.getElementById('gl');
    return [c.clientWidth * 0.34, c.clientHeight * 0.45];
  });
  await page.mouse.move(...target);
  await page.mouse.down();
  await page.evaluate(() => window.apelsin.step(20));
  const squeezing = await page.evaluate(() => window.apelsin.info());
  await page.mouse.up();
  assert.ok(squeezing.droplets > before.droplets, `squeeze droplets ${squeezing.droplets}`);
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

const PRESETS = { whole: 1, halves: 2, wedges: 8, wheels: 5, reference: 2 };

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
  assert.equal((await page.evaluate(() => window.apelsin.info())).scene, 'studio');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the preset url parameter composes the reference shot on studio white', async () => {
  const page = await open('preset=reference&scene=dark&seed=4');
  const info = await page.evaluate(() => window.apelsin.info());
  assert.equal(info.preset, 'reference');
  assert.equal(info.scene, 'studio');
  assert.equal(info.pieces, 2);
  const px = await pixels(page, 60);
  assert.ok(px.corner.r > 235 && px.corner.b > 230, 'background is white');
  assert.ok(px.all.orange > 0.12, `reference flesh coverage ${px.all.orange}`);
  await page.close();
});

test('every scene renders and the dark scene is dark', async () => {
  const page = await open('seed=2&preset=halves');
  const corners = {};
  for (const scene of ['studio', 'kitchen', 'dark']) {
    assert.equal(await page.evaluate((s) => window.apelsin.setScene(s), scene), true);
    const px = await pixels(page, 20);
    assert.ok(px.all.orange > 0.02, `${scene} shows orange`);
    corners[scene] = px.corner.r + px.corner.g + px.corner.b;
  }
  assert.ok(corners.dark < 200, `dark corner ${corners.dark}`);
  assert.ok(corners.studio > 650, `studio corner ${corners.studio}`);
  assert.equal(await page.evaluate(() => window.apelsin.setScene('nowhere')), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('every variety renders with its own flesh colour', async () => {
  const page = await open('seed=8&preset=halves');
  const flesh = {};
  for (const variety of ['navel', 'valencia', 'blood', 'caracara', 'mandarin']) {
    assert.equal(await page.evaluate((v) => window.apelsin.setVariety(v), variety), true);
    const info = await page.evaluate(() => window.apelsin.info());
    assert.equal(info.variety, variety);
    assert.equal(info.pieces, 2);
    flesh[variety] = (await pixels(page, 10)).all.fruit;
  }
  assert.ok(flesh.blood.g < flesh.navel.g * 0.9, `blood orange is redder ${JSON.stringify(flesh)}`);
  assert.ok(flesh.caracara.g < flesh.navel.g, 'cara cara flesh is pinker');
  assert.deepEqual(page.errors, []);
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

test('the toolbar and keyboard shortcuts drive presets, tools and scenes', async () => {
  const page = await open('seed=6');
  await page.click('[data-preset="wedges"]');
  assert.equal((await page.evaluate(() => window.apelsin.info())).pieces, 8);
  await page.keyboard.press('1');
  assert.equal((await page.evaluate(() => window.apelsin.info())).pieces, 1);
  await page.keyboard.press('h');
  assert.equal((await page.evaluate(() => window.apelsin.info())).tool, 'hand');
  await page.click('[data-tool="squeeze"]');
  assert.equal((await page.evaluate(() => window.apelsin.info())).tool, 'squeeze');
  await page.selectOption('#scene', 'dark');
  assert.equal((await page.evaluate(() => window.apelsin.info())).scene, 'dark');
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

async function faceProfile(page, variety) {
  await page.evaluate(async (v) => {
    const { quat } = await import('./src/math.js');
    const { restToWorld } = await import('./src/orange/piece.js');
    window.apelsin.setVariety(v);
    const { world, juice } = window.apelsin.internals;
    world.remove(world.pieces[1]);
    const piece = world.pieces[0];
    world.place(piece, [0, 0, 0], quat.fromTo(piece.caps[0].normal, [0, 1, 0]), { sleep: true });
    juice.clear();
    window.apelsin.step(2);
    const centre = restToWorld(piece, [0, piece.caps[0].centroid[1], 0]);
    window.apelsin.camera({ target: centre, yaw: 0, pitch: 1.5, distance: 0.26, fov: (25 * Math.PI) / 180 });
  }, variety);
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
    for (let x = Math.round(c.width / 2); x < c.width; x += 2) s += kind(x);
    return s.replace(/(.)\1+/g, '$1');
  }, url);
}

test('a cut face shows the anatomy from the core out: white core, flesh, white pith, orange rind', async () => {
  const page = await open('seed=5&preset=halves&debug', { width: 900, height: 900 });
  for (const variety of ['navel', 'valencia', 'caracara']) {
    const profile = await faceProfile(page, variety);
    assert.match(profile, /^w\.?o[o.]*w\.?o/, `${variety} radial profile ${profile}`);
    await page.evaluate(() => window.apelsin.preset('halves'));
  }
  assert.deepEqual(page.errors, []);
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
  const geometry = await page.evaluate(() => {
    const { world } = window.apelsin.internals;
    const d = world.pieces[0].geometry.data;
    let top = 0;
    for (let i = 1; i < d.length; i += 7) top = Math.max(top, d[i]);
    return { top, c: world.params.c };
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
