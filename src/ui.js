import { VARIETIES } from './orange/params.js';
import { SCENES } from './scenes.js';
import { PRESET_NAMES } from './presets.js';

const TOOL_HINTS = {
  knife: { touch: 'Swipe across the orange to slice it', mouse: 'Drag across the orange to slice it' },
  hand: { touch: 'Drag a piece to lift it, flick to toss', mouse: 'Drag a piece to lift it, flick to toss' },
  squeeze: { touch: 'Press and hold a cut face to squeeze', mouse: 'Press and hold a cut face to squeeze' },
};

export function createUI(app, { test = false } = {}) {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const variety = $('#variety'), scene = $('#scene'), hint = $('#hint'), hintText = $('#hint-text'), fps = $('#fps');
  const touch = matchMedia('(pointer: coarse)').matches;
  const store = (() => { try { return test ? null : window.localStorage; } catch { return null; } })();
  let hintTimer = 0, sliced = store?.getItem('apelsin.sliced') === '1';
  variety.innerHTML = Object.entries(VARIETIES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  scene.innerHTML = Object.entries(SCENES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  function showHint(text, ms = 0) {
    hintText.textContent = text;
    hint.classList.remove('gone');
    clearTimeout(hintTimer);
    if (ms) hintTimer = setTimeout(() => hint.classList.add('gone'), ms);
  }
  function hideHint() { clearTimeout(hintTimer); hint.classList.add('gone'); }

  showHint(TOOL_HINTS.knife[touch ? 'touch' : 'mouse']);
  if (sliced) setTimeout(hideHint, 3500);

  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => { app.setTool(b.dataset.tool); toolHint(b.dataset.tool); }));
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => app.runPreset(b.dataset.preset)));
  variety.addEventListener('change', () => { app.setVariety(variety.value); variety.blur(); });
  scene.addEventListener('change', () => { app.setScene(scene.value); scene.blur(); });
  $('#new').addEventListener('click', () => app.newOrange());
  $('#macro').addEventListener('click', () => app.toggle('macro'));
  $('#slowmo').addEventListener('click', () => app.toggle('slowmo'));
  $('#sound').addEventListener('click', toggleSound);
  $('#shot').addEventListener('click', () => app.download());
  document.addEventListener('pointerdown', () => app.audio.unlock(), { once: true, capture: true });
  for (const type of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('#bar')) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('select')) e.preventDefault(); });

  function toggleSound() { app.audio.unlock(); app.audio.setMuted(!app.audio.muted); sync(); }

  function toolHint(name) {
    if (name === 'knife' && sliced) return;
    showHint(TOOL_HINTS[name][touch ? 'touch' : 'mouse'], 2800);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const tools = { k: 'knife', h: 'hand', s: 'squeeze' };
    if (tools[k]) { app.setTool(tools[k]); toolHint(tools[k]); }
    else if (k >= '1' && k <= '5') app.runPreset(PRESET_NAMES[+k - 1]);
    else if (k === 'n') app.newOrange();
    else if (k === 'r') app.reset();
    else if (k === 'm') app.toggle('macro');
    else if (k === 't') app.toggle('slowmo');
    else if (k === 'a') toggleSound();
    else if (k === 'p') app.download();
    else return;
    e.preventDefault();
  });

  function sync() {
    const s = app.state;
    $$('[data-tool]').forEach((b) => { b.classList.toggle('on', b.dataset.tool === s.tool); b.setAttribute('aria-pressed', b.dataset.tool === s.tool); });
    $$('[data-preset]').forEach((b) => { b.classList.toggle('on', b.dataset.preset === s.preset); b.setAttribute('aria-pressed', b.dataset.preset === s.preset); });
    for (const id of ['macro', 'slowmo']) { $(`#${id}`).classList.toggle('on', s[id]); $(`#${id}`).setAttribute('aria-pressed', s[id]); }
    $('#sound .wave').style.display = app.audio.muted ? 'none' : '';
    $('#sound .mute').style.display = app.audio.muted ? '' : 'none';
    $('#sound').setAttribute('aria-pressed', !app.audio.muted);
    variety.value = s.variety;
    scene.value = s.scene;
    $('#variety-label').textContent = VARIETIES[s.variety].label.replace(/ \(.*\)/, '');
    $('#scene-label').textContent = SCENES[s.scene].label;
    document.body.classList.toggle('dark', s.scene === 'dark');
  }

  return {
    sync,
    hideHint,
    sliced() {
      if (!sliced) { sliced = true; store?.setItem('apelsin.sliced', '1'); }
      hideHint();
    },
    showStats(text) { fps.hidden = false; fps.textContent = text; },
  };
}
