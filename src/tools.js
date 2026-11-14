import { v3 } from './math.js';
import { raycastPiece } from './orange/piece.js';
import { createKnife } from './knife.js';

export const TOOL_NAMES = ['knife', 'hand', 'squeeze'];

export function createTools(canvas, overlay, app, gl) {
  const ctx2d = overlay.getContext('2d');
  const pointers = new Map();
  const knife = createKnife(gl);
  let mode = null;
  let stroke = [];
  const trails = [];
  let grab = null, squeeze = null, pinch = null, blade = null;
  let tool = 'knife';

  const css = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const ray = (x, y) => app.camera.ray(x, y, canvas.clientWidth, canvas.clientHeight);
  const camAxes = () => {
    const m = app.camera.view;
    return { right: [m[0], m[4], m[8]], up: [m[1], m[5], m[9]], back: [m[2], m[6], m[10]] };
  };

  function pick(x, y) {
    const { origin, dir } = ray(x, y);
    let best = null;
    for (const p of app.world.pieces) {
      const h = raycastPiece(p, origin, dir);
      if (h && (!best || h.t < best.t)) best = { ...h, piece: p };
    }
    return best;
  }

  function bladeContact(x, y) {
    const { origin, dir } = ray(x, y);
    let best = null;
    for (const p of app.world.pieces) {
      const t = Math.max(0.02, v3.dot(v3.sub(p.position, origin), dir));
      const closest = v3.add(origin, v3.scale(dir, t));
      const miss = v3.len(v3.sub(closest, p.position)) - p.radius;
      if (!best || miss < best.miss) best = { t, miss };
    }
    const t = best ? best.t : app.camera.distance;
    if (blade) blade.t += (t - blade.t) * (best && best.miss < 0 ? 0.5 : 0.2);
    const depth = blade ? blade.t : t;
    return { point: v3.add(origin, v3.scale(dir, depth)), view: dir, depth };
  }

  function bladeEdge(dx, dy) {
    const { right, up } = camAxes();
    return v3.norm(v3.add(v3.scale(right, dx), v3.scale(up, -dy)));
  }

  function finishStroke() {
    const pts = stroke;
    trails.push({ pts, age: 0 });
    stroke = [];
    if (pts.length < 2) { knife.release(false); return 0; }
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 24) { knife.release(false); return 0; }
    const hit = new Set();
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 5));
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * (k / n), y = y0 + (y1 - y0) * (k / n);
        const { origin, dir } = ray(x, y);
        for (const p of app.world.pieces) if (!hit.has(p) && raycastPiece(p, origin, dir)) hit.add(p);
      }
    }
    if (!hit.size) { knife.release(false); return 0; }
    const r0 = ray(a[0], a[1]), r1 = ray(b[0], b[1]);
    const normal = v3.norm(v3.cross(r0.dir, r1.dir));
    if (!Number.isFinite(normal[0])) { knife.release(false); return 0; }
    const count = app.cutWith(r0.origin, normal, [...hit]);
    if (count) trails[trails.length - 1].hit = true;
    knife.release(count > 0);
    return count;
  }

  function planeTarget(x, y, point, normal) {
    const { origin, dir } = ray(x, y);
    const denom = v3.dot(dir, normal);
    if (Math.abs(denom) < 1e-5) return point;
    const t = v3.dot(v3.sub(point, origin), normal) / denom;
    return v3.add(origin, v3.scale(dir, t));
  }

  function startKnife(p) {
    mode = 'knife';
    stroke = [p];
    blade = { t: 0, dx: 1, dy: 0, last: p };
    const c = bladeContact(p[0], p[1]);
    blade.t = c.depth;
    knife.begin(c.point, bladeEdge(1, 0), c.view, camAxes().up);
  }

  function moveKnife(p) {
    stroke.push(p);
    const dx = p[0] - blade.last[0], dy = p[1] - blade.last[1];
    const d = Math.hypot(dx, dy);
    if (d > 1.5) {
      const w = Math.min(1, d / 26);
      blade.dx += (dx / d - blade.dx) * w;
      blade.dy += (dy / d - blade.dy) * w;
      blade.last = p;
    }
    const c = bladeContact(p[0], p[1]);
    knife.move(c.point, bladeEdge(blade.dx, blade.dy), c.view, camAxes().up);
  }

  function down(e) {
    canvas.setPointerCapture?.(e.pointerId);
    app.audio.unlock();
    const p = css(e);
    pointers.set(e.pointerId, { x: p[0], y: p[1], button: e.button, type: e.pointerType });
    if (pointers.size === 2) {
      cancelTool();
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      mode = 'pinch';
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 2) { mode = 'orbit'; return; }
    if (e.button === 1 || e.shiftKey) { mode = 'pan'; return; }
    if (tool === 'knife') { startKnife(p); return; }
    const hit = pick(p[0], p[1]);
    if (tool === 'hand' && hit && app.physics) {
      const normal = v3.norm(v3.sub(app.camera.eye, hit.world));
      const lifted = v3.add(hit.world, [0, 0.03, 0]);
      grab = { piece: hit.piece, point: hit.world, normal, history: [[lifted, performance.now()]] };
      app.physics.grab(hit.piece, hit.rest, lifted);
      app.audio.pick?.();
      mode = 'grab';
      return;
    }
    if (tool === 'squeeze' && hit) {
      const cap = hit.piece.caps.length ? hit.piece.caps.reduce((best, c) => {
        const d = Math.abs(v3.dot(v3.sub(hit.rest, c.centroid), c.normal));
        return !best || d < best.d ? { c, d } : best;
      }, null).c : null;
      squeeze = { piece: hit.piece, cap, time: 0, state: {} };
      app.audio.squeezeStart?.();
      mode = 'squeeze';
      return;
    }
    mode = 'orbit';
  }

  function move(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = css(e);
    const dx = p[0] - prev.x, dy = p[1] - prev.y;
    prev.x = p[0]; prev.y = p[1];
    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (pinch.d > 0 && d > 0) app.camera.zoom(pinch.d / d);
      app.camera.orbit(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy };
      return;
    }
    if (mode === 'orbit') app.camera.orbit(dx, dy);
    else if (mode === 'pan') app.camera.pan(dx, dy);
    else if (mode === 'knife') moveKnife(p);
    else if (mode === 'grab' && grab) {
      let t = planeTarget(p[0], p[1], grab.point, grab.normal);
      t = [t[0], Math.max(t[1] + 0.03, app.world.floorAt(t[0], t[2]) + 0.02), t[2]];
      grab.history.push([t, performance.now()]);
      if (grab.history.length > 6) grab.history.shift();
      app.physics.moveGrab(t);
    }
  }

  function cancelTool() {
    if (mode === 'knife') { trails.push({ pts: stroke, age: 0 }); stroke = []; knife.release(false); }
    if (grab) { app.physics?.release(null); grab = null; }
    if (squeeze) app.audio.squeezeStop?.();
    squeeze = null;
    blade = null;
  }

  function up(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (mode === 'knife') { finishStroke(); blade = null; }
    if (mode === 'grab' && grab) {
      const h = grab.history;
      let vel = [0, 0, 0];
      if (h.length > 1) {
        const [p0, t0] = h[0], [p1, t1] = h[h.length - 1];
        const dt = Math.max((t1 - t0) / 1000, 1e-3);
        vel = v3.scale(v3.sub(p1, p0), 1 / dt);
        const s = v3.len(vel);
        if (s > 3) vel = v3.scale(vel, 3 / s);
      }
      app.physics.release(vel);
      grab = null;
    }
    if (mode === 'squeeze') { squeeze = null; app.audio.squeezeStop?.(); }
    if (pointers.size === 0) mode = null;
    else if (mode === 'pinch' && pointers.size < 2) { mode = 'pinch-end'; pinch = null; }
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) up(e); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); app.camera.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

  function update(dt) {
    knife.update(dt);
    if (squeeze) {
      const s = squeeze;
      if (!app.world.pieces.includes(s.piece)) { squeeze = null; app.audio.squeezeStop?.(); }
      else {
        s.time += dt;
        if (s.cap) app.juice.squeeze(s.piece, s.cap, app.world.params, dt, s.time, s.state);
        app.audio.squeezeLevel?.(Math.min(1, 0.25 + s.time * 0.6), !!s.cap);
        const target = s.cap ? 0.07 + 0.03 * Math.min(1, s.time) : 0.03;
        s.piece.squash += (target - s.piece.squash) * Math.min(1, dt * 7);
        app.physics?.wake(s.piece);
      }
    }
    for (const p of app.world.pieces) if ((!squeeze || squeeze.piece !== p) && p.squash > 0) p.squash = Math.max(0, p.squash - dt * 0.35 - p.squash * dt * 6);
  }

  function drawOverlay(dt) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(overlay.clientWidth * dpr), h = Math.round(overlay.clientHeight * dpr);
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);
    const all = [...trails.map((t) => ({ ...t, fade: Math.max(0, 1 - t.age / (t.hit ? 0.28 : 0.4)) })), stroke.length ? { pts: stroke, fade: 1, live: true } : null].filter(Boolean);
    for (const t of trails) t.age += dt;
    while (trails.length && trails[0].age > 0.5) trails.shift();
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    for (const t of all) {
      const pts = t.pts.slice(-28);
      if (pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        const k = i / (pts.length - 1);
        ctx2d.strokeStyle = `rgba(255, 253, 246, ${0.5 * k * k * t.fade})`;
        ctx2d.shadowColor = `rgba(255, 220, 160, ${0.5 * t.fade})`;
        ctx2d.shadowBlur = 6;
        ctx2d.lineWidth = 0.4 + 1.4 * k;
        ctx2d.beginPath();
        ctx2d.moveTo(pts[i - 1][0], pts[i - 1][1]);
        ctx2d.lineTo(pts[i][0], pts[i][1]);
        ctx2d.stroke();
      }
    }
  }

  return {
    get tool() { return tool; },
    setTool(name) { if (TOOL_NAMES.includes(name)) { cancelTool(); mode = null; tool = name; } },
    update, drawOverlay,
    drawables: () => knife.drawables(),
    get knifeVisible() { return knife.visible; },
    get busy() { return mode !== null; },
  };
}
