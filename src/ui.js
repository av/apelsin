import { VARIETIES } from './orange/params.js';
import { SCENES } from './scenes.js';
import { PRESET_NAMES } from './presets.js';

export function createUI(app) {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const variety = $('#variety'), scene = $('#scene'), hint = $('#hint'), fps = $('#fps');
  variety.innerHTML = Object.entries(VARIETIES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  scene.innerHTML = Object.entries(SCENES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => app.setTool(b.dataset.tool)));
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => app.runPreset(b.dataset.preset)));
  variety.addEventListener('change', () => { app.setVariety(variety.value); variety.blur(); });
  scene.addEventListener('change', () => { app.setScene(scene.value); scene.blur(); });
  $('#new').addEventListener('click', () => app.newOrange());
  $('#macro').addEventListener('click', () => app.toggle('macro'));
  $('#slowmo').addEventListener('click', () => app.toggle('slowmo'));
  $('#sound').addEventListener('click', () => { app.audio.unlock(); app.audio.setMuted(!app.audio.muted); sync(); });
  $('#shot').addEventListener('click', () => app.download());
  document.addEventListener('pointerdown', () => app.audio.unlock(), { once: true });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const tools = { k: 'knife', h: 'hand', s: 'squeeze' };
    if (tools[k]) app.setTool(tools[k]);
    else if (k >= '1' && k <= '5') app.runPreset(PRESET_NAMES[+k - 1]);
    else if (k === 'n') app.newOrange();
    else if (k === 'r') app.reset();
    else if (k === 'm') app.toggle('macro');
    else if (k === 'p') app.download();
    else return;
    e.preventDefault();
  });

  function sync() {
    const s = app.state;
    $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === s.tool));
    $$('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === s.preset));
    $('#macro').classList.toggle('on', s.macro);
    $('#slowmo').classList.toggle('on', s.slowmo);
    $('#sound .wave').style.opacity = app.audio.muted ? 0.15 : 1;
    variety.value = s.variety;
    scene.value = s.scene;
    document.body.classList.toggle('dark', s.scene === 'dark');
  }

  return {
    sync,
    hideHint() { hint.classList.add('gone'); },
    showStats(text) { fps.hidden = false; fps.textContent = text; },
  };
}
