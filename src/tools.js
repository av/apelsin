import { v3 } from './math.js';
import { raycastPiece } from './orange/piece.js';

export const TOOL_NAMES = ['knife', 'hand', 'squeeze'];

export function createTools(canvas, overlay, app) {
  const ctx2d = overlay.getContext('2d');
  const pointers = new Map();
  let mode = null;
  let stroke = [];
  const trails = [];
  let grab = null, squeeze = null, pinch = null;
  let tool = 'knife';

  const css = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const ray = (x, y) => app.camera.ray(x, y, canvas.clientWidth, canvas.clientHeight);

  function pick(x, y) {
    const { origin, dir } = ray(x, y);
    let best = null;
    for (const p of app.world.pieces) {
      const h = raycastPiece(p, origin, dir);
      if (h && (!best || h.t < best.t)) best = { ...h, piece: p };
    }
    return best;
  }

  function finishStroke() {
    const pts = stroke;
    trails.push({ pts, age: 0 });
    stroke = [];
    if (pts.length < 2) return;
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 24) return;
    const hit = new Set();
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * (k / n), y = y0 + (y1 - y0) * (k / n);
        const { origin, dir } = ray(x, y);
        for (const p of app.world.pieces) if (!hit.has(p) && raycastPiece(p, origin, dir)) hit.add(p);
      }
    }
    if (!hit.size) return;
    const r0 = ray(a[0], a[1]), r1 = ray(b[0], b[1]);
    const normal = v3.norm(v3.cross(r0.dir, r1.dir));
    if (!Number.isFinite(normal[0])) return;
    const count = app.cutWith(r0.origin, normal, [...hit]);
    if (count) trails[trails.length - 1].hit = true;
  }

  function planeTarget(x, y, point, normal) {
    const { origin, dir } = ray(x, y);
    const denom = v3.dot(dir, normal);
    if (Math.abs(denom) < 1e-5) return point;
    const t = v3.dot(v3.sub(point, origin), normal) / denom;
    return v3.add(origin, v3.scale(dir, t));
  }

  function down(e) {
    canvas.setPointerCapture(e.pointerId);
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
    if (tool === 'knife') { mode = 'knife'; stroke = [p]; return; }
    const hit = pick(p[0], p[1]);
    if (tool === 'hand' && hit && app.physics) {
      const normal = v3.norm(v3.sub(app.camera.eye, hit.world));
      const lifted = v3.add(hit.world, [0, 0.025, 0]);
      grab = { piece: hit.piece, point: hit.world, normal, history: [[lifted, performance.now()]] };
      app.physics.grab(hit.piece, hit.rest, lifted);
      mode = 'grab';
      return;
    }
    if (tool === 'squeeze' && hit && hit.piece.caps.length) {
      const cap = hit.piece.caps.reduce((best, c) => {
        const d = Math.abs(v3.dot(v3.sub(hit.rest, c.centroid), c.normal));
        return !best || d < best.d ? { c, d } : best;
      }, null).c;
      squeeze = { piece: hit.piece, cap, time: 0, emitted: 0 };
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
      if (pinch.d > 0) app.camera.zoom(pinch.d / Math.max(d, 1));
      app.camera.orbit(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy };
      return;
    }
    if (mode === 'orbit') app.camera.orbit(dx, dy);
    else if (mode === 'pan') app.camera.pan(dx, dy);
    else if (mode === 'knife') stroke.push(p);
    else if (mode === 'grab' && grab) {
      let t = planeTarget(p[0], p[1], grab.point, grab.normal);
      t = [t[0], Math.max(t[1] + 0.025, 0.015), t[2]];
      grab.history.push([t, performance.now()]);
      if (grab.history.length > 6) grab.history.shift();
      app.physics.moveGrab(t);
    }
  }

  function cancelTool() {
    if (mode === 'knife') { trails.push({ pts: stroke, age: 0 }); stroke = []; }
    if (grab) { app.physics?.release(null); grab = null; }
    squeeze = null;
  }

  function up(e) {
    pointers.delete(e.pointerId);
    if (mode === 'knife') finishStroke();
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
    if (mode === 'squeeze') squeeze = null;
    if (pointers.size === 0) mode = null;
    else if (mode === 'pinch' && pointers.size < 2) { mode = null; pinch = null; }
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); app.camera.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

  function update(dt) {
    if (squeeze) {
      const s = squeeze;
      if (!app.world.pieces.includes(s.piece)) { squeeze = null; return; }
      s.time += dt;
      const rate = Math.min(260, 30 + s.time * 160);
      s.emitted += rate * dt;
      const n = Math.floor(s.emitted);
      if (n > 0) {
        s.emitted -= n;
        app.juice.emitFromCap(s.piece, s.cap, app.world.params, n, 0.35 + Math.min(s.time, 2) * 0.25);
        if (Math.random() < dt * 6) app.audio.squelch(Math.min(1, 0.4 + s.time));
      }
      s.piece.squash = Math.min(0.1, s.piece.squash + dt * 0.12);
      s.piece.body?.wakeUp();
    }
    for (const p of app.world.pieces) if ((!squeeze || squeeze.piece !== p) && p.squash > 0) p.squash = Math.max(0, p.squash - dt * 0.4);
  }

  function drawOverlay(dt) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(overlay.clientWidth * dpr), h = Math.round(overlay.clientHeight * dpr);
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);
    const all = [...trails.map((t) => ({ ...t, fade: Math.max(0, 1 - t.age / (t.hit ? 0.35 : 0.5)) })), stroke.length ? { pts: stroke, fade: 1 } : null].filter(Boolean);
    for (const t of trails) t.age += dt;
    while (trails.length && trails[0].age > 0.6) trails.shift();
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    for (const t of all) {
      const pts = t.pts.slice(-40);
      if (pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        const k = i / (pts.length - 1);
        ctx2d.strokeStyle = `rgba(255, 250, 235, ${0.85 * k * t.fade})`;
        ctx2d.shadowColor = `rgba(255, 190, 90, ${0.9 * t.fade})`;
        ctx2d.shadowBlur = 12;
        ctx2d.lineWidth = 0.6 + 2.6 * k;
        ctx2d.beginPath();
        ctx2d.moveTo(pts[i - 1][0], pts[i - 1][1]);
        ctx2d.lineTo(pts[i][0], pts[i][1]);
        ctx2d.stroke();
      }
    }
  }

  return {
    get tool() { return tool; },
    setTool(name) { if (TOOL_NAMES.includes(name)) { cancelTool(); tool = name; } },
    update, drawOverlay,
    get busy() { return mode !== null; },
  };
}
