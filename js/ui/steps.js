/* js/ui/steps.js: the Steps screen: header, track list, step grid and the bottom bar.
 *
 * Layout from docs/SPEC.md "Screens": header, tracks on the left, 16 steps per bar in the middle, the selected
 * track's settings on the right (js/ui/panel.js), + Add track / Bars / note colours along the bottom.
 * Selection (which track, which step) lives here in `state`; the panel reads it. Every change to the song goes
 * through store.edit, so phase 3's undo / save pick it up for free.
 */
import {STEPS_PER_BAR} from '../engine/engine.js';
import {KEYS, SCALES, noteColor, degName, degToMidi, midiName} from '../scale.js';
import {SCENES, MAX_TRACKS, SOUND_LISTS, newTrack} from '../store.js';
import {mountPanel} from './panel.js';
import {mountFileMenu} from './filebar.js';
import {nudgeNote} from './stepedit.js';
import {el} from './dom.js';

const TYPE = {drum: 'Drum', synth: 'Synth', midi: 'MIDI', cv: 'CV'};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function mountSteps(root, {store, engine}){
  const state = {scene: 'A', track: 0, step: null};

  /* ---- header: Play, Tempo, Key + scale, scenes, Song / Undo, Simple / More ---- */
  const playBtn = el('button', {class: 'tb play', 'aria-label': 'Play or stop', onclick: () => togglePlay()}, '▶ Play');
  const bpm = el('input', {class: 'num', type: 'number', min: 20, max: 300, step: 1, 'aria-label': 'Tempo'});
  bpm.addEventListener('change', () => store.edit('Tempo', s => { s.bpm = clamp(Math.round(+bpm.value) || 120, 20, 300); }));

  const keySel = el('select', {'aria-label': 'Key'});
  KEYS.forEach(k => keySel.append(el('option', {value: k}, k)));
  keySel.addEventListener('change', () => store.edit('Key', s => { s.key = keySel.value; }));

  const scaleSel = el('select', {'aria-label': 'Scale'});
  for (const [id, sc] of Object.entries(SCALES)) scaleSel.append(el('option', {value: id}, sc.name));
  scaleSel.addEventListener('change', () => store.edit('Scale', s => { s.scale = scaleSel.value; }));

  const lockBtn = el('button', {class: 'tb', title: 'Keep notes in this key', 'aria-pressed': 'true',
    onclick: () => store.edit('Key lock', s => { s.lock = !s.lock; })}, 'Lock');

  const scenesEl = el('div', {class: 'scenes'});
  const simpleBtn = el('button', {class: 'tb', onclick: () => setMode('simple')}, 'Simple');
  const moreBtn = el('button', {class: 'tb', onclick: () => setMode('more')}, 'More');
  const undoBtn = el('button', {class: 'tb', title: 'Undo', onclick: () => store.undo()}, 'Undo');
  const redoBtn = el('button', {class: 'tb', title: 'Redo', onclick: () => store.redo()}, 'Redo');
  const fileWrap = el('div', {class: 'menu-wrap'});

  // More only: swing (every second 16th comes late)
  const swing = el('input', {type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Swing'});
  const swingVal = el('span', {class: 'pval num'});
  const swingWrap = el('label', {class: 'field', title: 'Every second 16th note comes late'}, 'Swing', swing, swingVal);
  swing.addEventListener('input', () => {
    const pc = +swing.value;
    swingVal.textContent = pc + '%';
    store.edit('Swing', s => { s.swing = pc / 100; });
  });

  const header = el('header', {class: 'hdr'},
    el('span', {class: 'app-name'}, '...Spores'),
    playBtn,
    el('label', {class: 'field'}, 'Tempo', bpm),
    el('div', {class: 'hgroup'}, el('span', {class: 'muted small'}, 'Key'), keySel, scaleSel, lockBtn),
    el('div', {class: 'hgroup'}, el('span', {class: 'muted small'}, 'Scenes'), scenesEl),
    el('div', {class: 'hgroup'},
      el('button', {class: 'tb', disabled: true, title: 'The Song screen comes in phase 5'}, 'Song ›'),
      undoBtn, redoBtn, fileWrap),
    el('div', {class: 'hgroup seg'}, simpleBtn, moreBtn),
    swingWrap);

  /* ---- middle: track list and step grid ---- */
  const tracksEl = el('div', {class: 'tracks', 'aria-label': 'Tracks'});
  const gridEl = el('div', {class: 'grid'});
  const gridWrap = el('div', {class: 'gridwrap'});
  gridWrap.append(gridEl);
  const panelEl = el('aside', {class: 'panel', 'aria-label': 'Track settings'});

  /* melody lane: under the grid, for the selected Synth / MIDI / CV track (drums have no pitch) */
  const melodyNote = el('span', {class: 'mnote num'}, '—');
  const noteUp = el('button', {class: 'tb', title: 'Up one scale step', 'aria-label': 'Note up', onclick: () => moveNote(1)}, '▲');
  const noteDown = el('button', {class: 'tb', title: 'Down one scale step', 'aria-label': 'Note down', onclick: () => moveNote(-1)}, '▼');
  const melodyLane = el('div', {class: 'mlane'});
  const melodyEl = el('div', {class: 'melody', hidden: true},
    el('div', {class: 'mlabel'},
      el('span', {class: 'mlabel-t'}, 'Melody'), noteUp, noteDown, melodyNote,
      el('span', {class: 'hint'}, 'Tap a note to select it; ▲ ▼ move it up or down the scale.')),
    melodyLane);
  gridWrap.append(melodyEl);

  const workspace = el('div', {class: 'workspace'}, tracksEl, gridWrap, panelEl);
  // the two columns scroll together
  gridWrap.addEventListener('scroll', () => { tracksEl.scrollTop = gridWrap.scrollTop; });
  tracksEl.addEventListener('scroll', () => { gridWrap.scrollTop = tracksEl.scrollTop; });

  /* ---- bottom: add track, bars, note colours ---- */
  const addBtn = el('button', {class: 'tb', onclick: addTrack}, '+ Add track');
  const barBtns = [1, 2, 3, 4].map(n => el('button', {class: 'tb', 'aria-label': `${n} bar${n > 1 ? 's' : ''}`,
    onclick: () => setBars(n)}, String(n)));
  const keyEl = el('div', {class: 'key'});
  const bottom = el('footer', {class: 'bottom'},
    addBtn,
    el('div', {class: 'hgroup'}, el('span', {class: 'muted small'}, 'Bars'), ...barBtns),
    el('div', {class: 'hgroup'}, el('span', {class: 'muted small'}, 'Note colours'), keyEl));

  root.append(header, workspace, bottom);
  mountFileMenu(fileWrap, {store});
  const panel = mountPanel(panelEl, {store, engine, state});

  /* ---- actions ---- */
  function togglePlay(){
    if (engine.playing) engine.stop();
    else engine.play('scene', state.scene);
  }

  function setMode(m){
    if (store.get().mode === m) return;
    store.edit('Mode', s => { s.mode = m; });
  }

  function goScene(k){
    if (state.scene === k) return;
    state.scene = k; state.step = null;
    if (engine.playing) engine.scene(k);   // switches at the next bar
    sync();
  }

  function addScene(){
    const free = SCENES.find(k => !store.get().scenes[k]);
    if (!free) return;
    store.edit('Add scene', s => { s.scenes[free] = {name: 'Scene ' + free, bars: 1, steps: {}}; });
    goScene(free);
  }

  function setBars(n){
    store.edit('Bars', s => { const sc = s.scenes[state.scene]; if (sc) sc.bars = clamp(n, 1, 4); });
  }

  function addTrack(){
    if (store.get().tracks.length >= MAX_TRACKS) return;
    store.edit('Add track', s => {
      const used = new Set(s.tracks.map(t => t.sound));
      const sound = SOUND_LISTS.drum.find(n => !used.has(n)) || 'Kick';
      s.tracks.push(newTrack('drum', sound));
    });
    state.track = store.get().tracks.length - 1; state.step = null;
    sync();
  }

  function selectTrack(ti){
    state.track = ti; state.step = null;
    drawTracks(); paintGrid(); drawMelody(); panel.refresh();
  }

  function selectStep(ti, i){
    state.track = ti; state.step = i;
    drawTracks(); paintGrid(); drawMelody(); panel.refresh();
  }

  // ▲ ▼ in the melody lane: move the selected note one scale step, through store.edit
  function moveNote(by){
    const t = store.get().tracks[state.track];
    if (!t || t.type === 'drum' || state.step == null) return;
    nudgeNote(store, {scene: state.scene, trackId: t.id, index: state.step}, by);
  }

  function toggleStep(ti, i){
    const t = store.get().tracks[ti], sceneKey = state.scene;
    if (!t) return;
    store.edit('Step on / off', s => {
      const sc = s.scenes[sceneKey]; if (!sc) return;
      const lane = sc.steps[t.id] = sc.steps[t.id] || [];
      const cur = lane[i];
      lane[i] = cur && cur.on ? Object.assign({}, cur, {on: false})
        : Object.assign({deg: 0, vel: 100, chance: 100}, cur || {}, {on: true});
    });
  }

  /* ---- drawing ---- */
  function drawScenes(s = store.get()){
    scenesEl.innerHTML = '';
    for (const k of SCENES){
      if (!s.scenes[k]) continue;
      scenesEl.append(el('button', {class: 'tb scn' + (k === state.scene ? ' on' : ''), 'aria-pressed': k === state.scene ? 'true' : 'false',
        title: s.scenes[k].name || 'Scene ' + k, onclick: () => goScene(k)}, k));
    }
    if (SCENES.some(k => !s.scenes[k]))
      scenesEl.append(el('button', {class: 'tb scn', title: 'Add a scene', 'aria-label': 'Add a scene', onclick: addScene}, '+'));
  }

  function drawTracks(s = store.get()){
    tracksEl.innerHTML = '';
    s.tracks.forEach((t, ti) => {
      const sub = [TYPE[t.type] || t.type]; if (t.sound) sub.push(t.sound);
      const mute = el('button', {class: 'mute' + (t.mute ? ' on' : ''), title: 'Mute this track',
        'aria-label': 'Mute ' + (t.name || TYPE[t.type]), 'aria-pressed': t.mute ? 'true' : 'false',
        onclick: e => { e.stopPropagation(); store.edit('Mute', s2 => { s2.tracks[ti].mute = !s2.tracks[ti].mute; }); }}, 'M');
      const row = el('div', {class: 'track' + (ti === state.track ? ' sel' : ''), role: 'button', tabindex: '0',
        'aria-label': `${t.name} (${TYPE[t.type]})`, 'aria-pressed': ti === state.track ? 'true' : 'false'},
        el('span', {class: 'tbar ' + t.type}),
        el('span', {class: 'tinfo'}, el('span', {class: 'tname'}, t.name), el('span', {class: 'tsub'}, sub.join(' · '))),
        mute);
      row.addEventListener('click', () => selectTrack(ti));
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); selectTrack(ti); } });
      tracksEl.append(row);
    });
  }

  let gridSig = '', cells = [];

  function gridStructure(s){
    const sc = s.scenes[state.scene] || {};
    return [state.scene, sc.bars || 1, s.mode, s.key, s.scale, s.tracks.map(t => t.id + t.type).join(',')].join('|');
  }

  function drawGrid(s = store.get()){
    const sc = s.scenes[state.scene];
    if (!sc) return;
    const sig = gridStructure(s);
    if (sig === gridSig){ paintGrid(s); return; }
    gridSig = sig;
    const len = clamp(sc.bars | 0 || 1, 1, 4) * STEPS_PER_BAR;
    gridEl.innerHTML = ''; cells = [];
    s.tracks.forEach((t, ti) => {
      const lane = el('div', {class: 'lane ' + t.type});
      const rc = [];
      for (let i = 0; i < len; i++){
        const b = el('button', {type: 'button', 'aria-label': `Step ${i + 1}`});
        b.className = 'cell' + (i % 16 === 0 && i > 0 ? ' barstart' : i % 4 === 0 && i > 0 ? ' beatstart' : '');
        bindCell(b, ti, i);
        lane.append(b); rc.push(b);
      }
      gridEl.append(el('div', {class: 'srow'}, lane));
      cells.push(rc);
    });
    paintGrid(s);
  }

  function paintGrid(s = store.get()){
    const sc = s.scenes[state.scene];
    if (!sc) return;
    s.tracks.forEach((t, ti) => {
      const lane = sc.steps[t.id] || [], rc = cells[ti];
      if (!rc) return;
      rc.forEach((b, i) => {
        const st = lane[i], on = !!(st && st.on);
        b.classList.toggle('on', on);
        b.classList.toggle('sel', state.track === ti && state.step === i);
        if (on && t.type !== 'drum'){
          const c = noteColor(st.deg || 0, s.scale);
          b.style.setProperty('--top', c.top);
          b.style.setProperty('--bottom', c.bottom);
          b.style.setProperty('--txt', c.text);
          b.textContent = degName(st.deg || 0, s.key, s.scale);
        } else {
          b.style.removeProperty('--top'); b.style.removeProperty('--bottom'); b.style.removeProperty('--txt');
          b.textContent = '';
        }
      });
    });
  }

  /* Melody lane: one bar per step, height = pitch, drawn under the grid for the selected melodic track. Tap a bar to
     select that step; the lane's ▲ ▼ move the selected note. Drum tracks have no pitch, so the lane hides. */
  let melodySig = '', melodyCells = [];

  function drawMelody(s = store.get()){
    const sc = s.scenes[state.scene], t = s.tracks[state.track];
    const melodic = !!(sc && t && t.type !== 'drum');
    melodyEl.hidden = !melodic;
    if (!melodic){
      // forget the old lane, so coming back to a melodic track builds it again
      if (melodySig){ melodySig = ''; melodyCells = []; melodyLane.innerHTML = ''; }
      return;
    }

    const len = clamp(sc.bars | 0 || 1, 1, 4) * STEPS_PER_BAR;
    const sig = [state.scene, state.track, t.id, len].join('|');
    if (sig !== melodySig){
      melodySig = sig;
      melodyLane.innerHTML = '';
      melodyCells = [];
      for (let i = 0; i < len; i++){
        const b = el('button', {type: 'button',
          class: 'mcell' + (i % 16 === 0 && i > 0 ? ' barstart' : i % 4 === 0 && i > 0 ? ' beatstart' : '')});
        b.addEventListener('click', () => selectStep(state.track, i));
        const bar = el('span', {class: 'mbar'});
        const name = el('span', {class: 'mname'});
        b.append(bar, name);
        melodyLane.append(b);
        melodyCells.push({b, bar, name});
      }
    }

    const lane = (sc.steps && sc.steps[t.id]) || [];
    const degs = [];
    for (let i = 0; i < len; i++){ const st = lane[i]; if (st && st.on) degs.push(st.deg || 0); }
    const lo = Math.min(0, ...degs), hi = Math.max(0, ...degs), span = Math.max(7, hi - lo);
    melodyCells.forEach(({b, bar, name}, i) => {
      const st = lane[i], on = !!(st && st.on), d = on ? (st.deg || 0) : 0;
      b.classList.toggle('sel', state.step === i);
      b.style.setProperty('--h', (8 + Math.round(((d - lo) / span) * 52)) + 'px');
      bar.hidden = !on;
      if (on){
        const c = noteColor(d, s.scale);
        bar.style.setProperty('--top', c.top);
        bar.style.setProperty('--bottom', c.bottom);
        name.textContent = degName(d, s.key, s.scale);
        b.setAttribute('aria-label', `Step ${i + 1}, ${name.textContent}`);
      } else {
        name.textContent = '';
        b.setAttribute('aria-label', `Step ${i + 1}, empty`);
      }
    });

    const sel = state.step != null ? lane[state.step] : null;
    const movable = !!(sel && sel.on);
    melodyNote.textContent = movable ? midiName(degToMidi(sel.deg || 0, s.key, s.scale, t.oct ?? 3)) : '—';
    noteUp.disabled = noteDown.disabled = !movable;
  }

  // tap = on / off; hold 400 ms or right-click = select the step for the panel
  function bindCell(b, ti, i){
    let timer = 0, held = false;
    b.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      held = false;
      timer = setTimeout(() => { held = true; selectStep(ti, i); }, 400);
    });
    const up = () => clearTimeout(timer);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('click', () => {
      clearTimeout(timer);
      if (held){ held = false; return; }   // it was a hold, not a tap
      toggleStep(ti, i);
    });
    b.addEventListener('contextmenu', e => { e.preventDefault(); selectStep(ti, i); });
  }

  function syncBars(s = store.get()){
    const bars = (s.scenes[state.scene] || {}).bars || 1;
    barBtns.forEach((b, i) => { b.classList.toggle('on', bars === i + 1); b.setAttribute('aria-pressed', bars === i + 1 ? 'true' : 'false'); });
  }

  function syncKey(s = store.get()){
    keyEl.innerHTML = '';
    for (let d = 0; d < 7; d++){
      const c = noteColor(d, s.scale);
      keyEl.append(el('span', {class: 'swatch', title: degName(d, s.key, s.scale),
        style: {background: `linear-gradient(${c.top},${c.bottom})`, color: c.text}}, degName(d, s.key, s.scale)));
    }
  }

  function sync(s = store.get()){
    if (!s.scenes[state.scene]) state.scene = Object.keys(s.scenes)[0] || 'A';
    state.track = Math.max(0, Math.min(state.track, s.tracks.length - 1));
    if (document.activeElement !== bpm) bpm.value = s.bpm;
    keySel.value = s.key;
    scaleSel.value = s.scale;
    lockBtn.classList.toggle('on', !!s.lock);
    lockBtn.setAttribute('aria-pressed', s.lock ? 'true' : 'false');
    simpleBtn.classList.toggle('on', s.mode === 'simple');
    moreBtn.classList.toggle('on', s.mode === 'more');
    swingWrap.hidden = s.mode !== 'more';
    swingVal.textContent = Math.round((s.swing || 0) * 100) + '%';
    if (document.activeElement !== swing) swing.value = Math.round((s.swing || 0) * 100);
    addBtn.textContent = `+ Add track (${s.tracks.length} of ${MAX_TRACKS})`;
    addBtn.disabled = s.tracks.length >= MAX_TRACKS;
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
    drawScenes(s);
    drawTracks(s);
    drawGrid(s);
    drawMelody(s);
    syncBars(s);
    syncKey(s);
    panel.refresh();
  }

  // edits that only touch one small thing skip the full redraw (sliders fire on every pixel)
  const light = {
    'Step on / off': () => { paintGrid(); drawMelody(); panel.refresh(); },
    'Step note': () => { paintGrid(); drawMelody(); panel.refresh(); },
    'Tempo': () => { if (document.activeElement !== bpm) bpm.value = store.get().bpm; },
    'Swing': () => {
      const v = Math.round((store.get().swing || 0) * 100);
      swingVal.textContent = v + '%';
      if (document.activeElement !== swing) swing.value = v;
    },
    'Volume': () => panel.refresh(),
    'Sound setting': () => panel.refresh(),
    'Track length': () => panel.refresh(),
  };
  store.subscribe((s, label) => {
    // Undo / Redo availability changes on every edit, including the quick ones below
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
    const h = light[label];
    if (h) h(s); else sync(s);
  });

  // Ctrl/Cmd+Z, Shift+Z (or Ctrl+Y) anywhere except while typing in a field
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z'){ e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
    else if (k === 'y'){ e.preventDefault(); store.redo(); }
  });

  engine.on('start', () => { playBtn.classList.add('on'); playBtn.textContent = '■ Stop'; playBtn.setAttribute('aria-pressed', 'true'); });
  engine.on('stop', () => { playBtn.classList.remove('on'); playBtn.textContent = '▶ Play'; playBtn.setAttribute('aria-pressed', 'false'); });

  sync();
  playBtn.setAttribute('aria-pressed', 'false');

  /* ---- playhead: engine 'step' fires when the step is heard ---- */
  let lit = [];
  const clearLit = () => { lit.forEach(b => b.classList.remove('now')); lit = []; };
  return {
    playhead(m){
      clearLit();
      if (m.scene !== state.scene) return;   // a scene switch is waiting for the next bar
      const s = store.get();
      s.tracks.forEach((t, ti) => {
        const rc = cells[ti] || [];
        const L = s.mode === 'more' && t.len > 0 ? Math.min(t.len, rc.length) : rc.length;
        if (!L) return;
        const b = rc[m.counter % L];
        if (b){ b.classList.add('now'); lit.push(b); }
        if (ti === state.track && !melodyEl.hidden && melodyCells.length){
          const M = melodyCells.length;
          const ML = s.mode === 'more' && t.len > 0 ? Math.min(t.len, M) : M;
          const mb = melodyCells[m.counter % ML];
          if (mb){ mb.b.classList.add('now'); lit.push(mb.b); }
        }
      });
    },
    stopped(){ clearLit(); },
  };
}
