/* js/ui/steps.js: the Steps screen: header, track list, step grid and the bottom bar.
 *
 * Layout from docs/SPEC.md "Screens": header, tracks on the left, 16 steps per bar in the middle, the selected
 * track's settings on the right (js/ui/panel.js), + Add track / Bars / note colours along the bottom.
 * Selection (which track, which step) lives here in `state`; the panel reads it. Every change to the song goes
 * through store.edit, so phase 3's undo / save pick it up for free.
 */
import {STEPS_PER_BAR} from '../engine/engine.js';
import {KEYS, SCALES, noteColor, degName, degToMidi, midiName} from '../scale.js';
import {renameTrack} from './trackctl.js';
import {SCENES, MAX_TRACKS, MAX_AUDIO_TRACKS, SOUND_LISTS, newTrack, newSongTrack, isSongTrack, canAddAudio, copySceneInto} from '../store.js';
import {trackMeters} from './trackmeters.js';
import {trackColour, openColourPicker} from './trackcolor.js';
import {mountPanel} from './panel.js';
import {mountFileMenu} from './filebar.js';
import {openHelp} from './help.js';
import {fileTag} from './filetag.js';
import {nudgeNote} from './stepedit.js';
import {audioLane} from './audiolane.js';
import {createRecStatus} from './recstatus.js';
import {el} from './dom.js';

const TYPE = {drum: 'Drum', synth: 'Synth', midi: 'MIDI', cv: 'CV', audio: 'Audio'};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function mountSteps(root, {store, engine, midi, files, openSong}){
  const state = {scene: 'A', track: 0, step: null};
  const rec = createRecStatus(engine);   // what recording is doing (count-in, which bar): the grid lane and the panel show it

  /* ---- header: Play, Tempo, Key + scale, scenes, Song / Undo, Simple / More ---- */
  const playBtn = el('button', {class: 'tb play', 'aria-label': 'Play or stop', onclick: () => togglePlay()}, '▶ Play');
  const bpm = el('input', {type: 'number', min: 20, max: 300, step: 1, 'aria-label': 'Tempo'});
  bpm.addEventListener('change', () => {
    store.edit('Tempo', s => { s.bpm = clamp(Math.round(+bpm.value) || 120, 20, 300); });
    bpm.value = store.get().bpm;   // a typed 999 or a blank shows the tempo that is really playing
  });

  const keySel = el('select', {'aria-label': 'Key'});
  KEYS.forEach(k => keySel.append(el('option', {value: k}, k)));
  keySel.addEventListener('change', () => store.edit('Key', s => { s.key = keySel.value; }));

  const scaleSel = el('select', {'aria-label': 'Scale'});
  for (const [id, sc] of Object.entries(SCALES)) scaleSel.append(el('option', {value: id}, sc.name));
  scaleSel.addEventListener('change', () => store.edit('Scale', s => { s.scale = scaleSel.value; }));

  // Lock: song.lock is stored but nothing uses it yet (open question in docs/NOTES.md), so the button stays hidden
  // rather than offer a control that does nothing. Show it again once it has a job.
  const lockBtn = el('button', {class: 'tb', hidden: true, title: 'Keep notes in this key', 'aria-pressed': 'true',
    onclick: () => store.edit('Key lock', s => { s.lock = !s.lock; })}, 'Lock');

  // Scene letters scroll sideways (up to 26 scenes, A–Z) so the top bar stays one row; "+" stays outside the strip.
  const scenesEl = el('div', {class: 'scenes seg', role: 'group', 'aria-label': 'Scenes'});
  const addSceneBtn = el('button', {class: 'tb scn addscn', title: 'Add a scene', 'aria-label': 'Add a scene', onclick: () => addScene()}, '+');
  const copySceneBtn = el('button', {class: 'tb scn addscn', title: 'Copy this scene into a new scene', 'aria-label': 'Copy this scene into a new scene', onclick: () => dupScene()}, '⧉');
  // fades at the edges show there are more letters that way (Mac hides scrollbars); a mouse wheel scrolls sideways
  const sceneWrap = el('div', {class: 'scenewrap'}, scenesEl);
  const sceneFades = () => {
    const l = scenesEl.scrollLeft, max = scenesEl.scrollWidth - scenesEl.clientWidth;
    sceneWrap.classList.toggle('more-l', l > 1);
    sceneWrap.classList.toggle('more-r', l < max - 1);
  };
  scenesEl.addEventListener('scroll', sceneFades, {passive: true});
  scenesEl.addEventListener('wheel', e => {
    if (scenesEl.scrollWidth <= scenesEl.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault(); scenesEl.scrollLeft += e.deltaY;
  }, {passive: false});
  window.addEventListener('resize', () => sceneFades());
  const simpleBtn = el('button', {class: 'tb', onclick: () => setMode('simple')}, 'Simple');
  const moreBtn = el('button', {class: 'tb', onclick: () => setMode('more')}, 'More');
  const undoBtn = el('button', {class: 'tb quiet', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => store.undo()},
    el('span', {class: 'ico'}, '↶'), el('span', {class: 'lbl'}, 'Undo'));
  const redoBtn = el('button', {class: 'tb quiet', title: 'Redo (Shift+Ctrl+Z)', 'aria-label': 'Redo', onclick: () => store.redo()},
    el('span', {class: 'ico'}, '↷'), el('span', {class: 'lbl'}, 'Redo'));
  const fileWrap = el('div', {class: 'menu-wrap'});

  // More only: swing (every second 16th comes late)
  const swing = el('input', {type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Swing'});
  const swingVal = el('span', {class: 'pval num'});
  const swingWrap = el('label', {class: 'field hgroup', title: 'Every second 16th note comes late'}, 'Swing', swing, swingVal);
  swing.addEventListener('input', () => {
    const pc = +swing.value;
    swingVal.textContent = pc + '%';
    store.edit('Swing', s => { s.swing = pc / 100; });
  });

  // the same left side on both screens (js/ui/song.js): name, Steps | Song, then Play and the tempo
  const header = el('header', {class: 'hdr'},
    el('span', {class: 'app-name'}, '...Spores'), fileTag(files),
    el('div', {class: 'seg', role: 'group', 'aria-label': 'Screen'},
      el('button', {class: 'tb on', 'aria-pressed': 'true', title: 'The step grid'}, 'Steps'),
      el('button', {class: 'tb', 'aria-pressed': 'false', title: 'Arrange the scenes into a song', onclick: () => openSong()}, 'Song')),
    el('div', {class: 'hgroup'}, playBtn, el('label', {class: 'tempo'}, bpm, el('span', {class: 'cap'}, 'BPM'))),
    el('div', {class: 'hgroup'}, el('span', {class: 'cap opt'}, 'Key'), keySel, scaleSel, lockBtn),
    el('div', {class: 'hgroup scenegrp'}, el('span', {class: 'cap opt'}, 'Scene'), sceneWrap, addSceneBtn, copySceneBtn),
    el('span', {class: 'hspace'}),
    el('div', {class: 'hgroup'}, undoBtn, redoBtn),
    fileWrap,
    el('div', {class: 'seg', role: 'group', 'aria-label': 'Simple or More'}, simpleBtn, moreBtn),
    el('button', {class: 'tb help', title: 'How Spores works', 'aria-label': 'Help', onclick: () => openHelp()}, '?'));

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
  // the button adds a drum (one tap, the common case); the small ▾ next to it offers the other two kinds
  const addMenu = el('div', {class: 'menu up', role: 'menu', hidden: true});
  const addBtn = el('button', {class: 'tb', title: 'Add a drum track', onclick: () => addTrack('drum')}, '+ Add track');
  const addMoreBtn = el('button', {class: 'tb', title: 'Add a synth, MIDI or CV track, or an audio track', 'aria-label': 'Add a synth, MIDI or CV track, or an audio track',
    'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: e => { e.stopPropagation(); addMenu.hidden ? openAdd() : closeAdd(); }}, '▾');
  for (const [type, label] of [['synth', 'Synth track'], ['midi', 'MIDI track'], ['cv', 'CV track']])
    addMenu.append(el('button', {role: 'menuitem', onclick: () => { closeAdd(); addTrack(type); }}, label));
  const audioItem = el('button', {role: 'menuitem', onclick: () => { closeAdd(); addTrack('audio'); }}, 'Audio track (record your voice)');
  const songItem = el('button', {role: 'menuitem', onclick: () => { closeAdd(); addTrack('song'); }}, 'Song-length audio track (record over the whole song)');
  addMenu.append(audioItem, songItem);
  const addWrap = el('div', {class: 'menu-wrap'}, el('div', {class: 'seg'}, addBtn, addMoreBtn), addMenu);
  // the audio item says why it is off: up to MAX_AUDIO_TRACKS of them, within MAX_TRACKS tracks
  function paintAudioItem(s = store.get()){
    const n = s.tracks.filter(t => t.type === 'audio').length, ok = canAddAudio(s);
    audioItem.disabled = !ok;
    audioItem.title = ok ? 'Add a track you record your voice (or an instrument) onto' : s.tracks.length >= MAX_TRACKS ? `${MAX_TRACKS} tracks is the most` : `${MAX_AUDIO_TRACKS} audio tracks is the most`;
    const why = ok ? '' : el('span', {class: 'kbd'}, s.tracks.length >= MAX_TRACKS ? `${MAX_TRACKS} tracks is the most` : `${n} of ${MAX_AUDIO_TRACKS} used`);
    audioItem.replaceChildren('Audio track (record your voice)', why);
    songItem.disabled = !ok;   // shares the same limit
    songItem.title = ok ? 'Add a track you record once over the whole song (then record on the Song screen)' : audioItem.title;
    songItem.replaceChildren('Song-length audio track (record over the whole song)', ok ? '' : why.cloneNode(true));
  }
  function openAdd(){
    paintAudioItem();
    addMenu.hidden = false;
    addMoreBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outsideAdd, true);
    document.addEventListener('keydown', escAdd, true);
  }
  function closeAdd(){
    if (addMenu.hidden) return;
    addMenu.hidden = true;
    addMoreBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outsideAdd, true);
    document.removeEventListener('keydown', escAdd, true);
  }
  function outsideAdd(e){ if (!addWrap.contains(e.target)) closeAdd(); }
  function escAdd(e){ if (e.key === 'Escape') closeAdd(); }
  const barBtns = [1, 2, 3, 4].map(n => el('button', {class: 'tb', 'aria-label': `${n} bar${n > 1 ? 's' : ''}`,
    onclick: () => setBars(n)}, String(n)));
  const keyEl = el('div', {class: 'key'});
  const bottom = el('footer', {class: 'bottom'},
    addWrap,
    el('div', {class: 'hgroup'}, el('span', {class: 'cap'}, 'Bars'), el('div', {class: 'seg', role: 'group', 'aria-label': 'Bars'}, ...barBtns)),
    el('div', {class: 'hgroup'}, el('span', {class: 'cap'}, 'Note colours'), keyEl),
    swingWrap);   // More only; down here so the header stays on one row on a laptop

  root.append(header, workspace, bottom);
  mountFileMenu(fileWrap, {store, files, scene: () => state.scene});
  const panel = mountPanel(panelEl, {store, engine, state, rec, openSong});

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
  function dupScene(){   // a copy of the scene being edited, in the next free letter
    const free = SCENES.find(k => !store.get().scenes[k]);
    if (!free) return;
    store.edit('Copy scene', s => { copySceneInto(s, state.scene, free); });
    goScene(free);
  }

  function setBars(n){
    // a selected step past the new end would keep showing (and editing) a step she can no longer see
    if (state.step != null && state.step >= clamp(n, 1, 4) * STEPS_PER_BAR) state.step = null;
    store.edit('Bars', s => { const sc = s.scenes[state.scene]; if (sc) sc.bars = clamp(n, 1, 4); });
  }

  // a new track of the kind picked in the menu: the first sound not already in use, a numbered name for MIDI
  function addTrack(type = 'drum'){
    if (store.get().tracks.length >= MAX_TRACKS) return;
    store.edit('Add track', s => {
      const used = new Set(s.tracks.map(t => t.sound));
      const n = s.tracks.filter(t => t.type === type && !isSongTrack(t)).length + 1;
      if (type === 'song'){
        if (!canAddAudio(s)) return;
        const t = newSongTrack('Song voice ' + (s.tracks.filter(isSongTrack).length + 1)); s.tracks.push(t);
      } else if (type === 'audio'){
        if (!canAddAudio(s)) return;
        const t = newTrack('audio'); t.name = 'Voice ' + n; s.tracks.push(t);
      } else if (type === 'midi' || type === 'cv'){
        const t = newTrack(type); t.name = (type === 'midi' ? 'MIDI ' : 'CV ') + n;
        if (type === 'cv'){   // the next free pair of outputs, from 3 (1–2 carry the music)
          const usedCh = new Set(s.tracks.filter(x => x.type === 'cv').flatMap(x => [x.cv.pitch, x.cv.gate]));
          let c = 3; while (usedCh.has(c) || usedCh.has(c + 1)) c += 2;
          t.cv.pitch = c; t.cv.gate = c + 1;
        }
        s.tracks.push(t);
      } else {
        const sound = (SOUND_LISTS[type] || []).find(x => !used.has(x)) || (SOUND_LISTS[type] || ['Kick'])[0];
        s.tracks.push(newTrack(type, sound));
      }
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
    if (!t || t.type === 'drum' || t.type === 'audio' || state.step == null) return;
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
    addSceneBtn.hidden = copySceneBtn.hidden = !SCENES.some(k => !s.scenes[k]);
    // keep the scene being edited in view, then update the edge fades
    requestAnimationFrame(() => {
      const on = scenesEl.querySelector('.on');
      if (on) on.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
      sceneFades();
    });
  }

  // the name of a MIDI port, even after a reload changed its id (js/midi.js looks ports up by id, then by name)
  const portName = id => (midi.outputs().find(o => o.id === id || o.name === id) || {}).name || id;

  function drawTracks(s = store.get()){
    tracksEl.innerHTML = '';
    const anySolo = s.tracks.some(t => t.solo);
    s.tracks.forEach((t, ti) => {
      const sub = [TYPE[t.type] || t.type];
      if (t.sound) sub.push(t.sound);
      if (t.type === 'midi') sub.push(t.midi && t.midi.port ? portName(t.midi.port) : 'no port yet', 'ch ' + ((t.midi && t.midi.ch) || 1));
      if (t.type === 'cv') sub.push(`out ${t.cv.pitch} / ${t.cv.gate}` + (t.cv.cal ? ' · tuned' : ''));
      if (isSongTrack(t)) sub[0] = 'Audio · whole song', sub.push(t.take ? 'has a take' : 'no take yet');
      else if (t.type === 'audio'){ const c = ((s.scenes[state.scene] || {}).clips || {})[t.id]; sub.push(c ? `${c.bars} bar${c.bars === 1 ? '' : 's'}` : 'no take yet'); }
      if (t.fx && t.fx.length) sub.push('fx ' + t.fx.length);   // js/ui/fxpanel.js
      const mute = el('button', {class: 'mute' + (t.mute ? ' on' : ''), title: 'Mute this track',
        'aria-label': 'Mute ' + (t.name || TYPE[t.type]), 'aria-pressed': t.mute ? 'true' : 'false',
        onclick: e => { e.stopPropagation(); store.edit('Mute', s2 => { s2.tracks[ti].mute = !s2.tracks[ti].mute; }); }}, el('span', {class: 'mbox'}, 'M'));
      const solo = el('button', {class: 'mute solo' + (t.solo ? ' on' : ''), title: 'Solo: hear only this track (and other soloed ones)',
        'aria-label': 'Solo ' + (t.name || TYPE[t.type]), 'aria-pressed': t.solo ? 'true' : 'false',
        onclick: e => { e.stopPropagation(); store.edit('Solo', s2 => { s2.tracks[ti].solo = !s2.tracks[ti].solo; }); }}, el('span', {class: 'mbox'}, 'S'));
      const tname = el('span', {class: 'tname', title: 'Double-click to rename'}, t.name);
      tname.addEventListener('dblclick', e => { e.stopPropagation(); renameTrack(store, t.id); });
      const row = el('div', {class: 'track' + (t.type === 'audio' ? ' audiotrack' : '') + (t.fx && t.fx.length ? ' hasfx' : '') + (ti === state.track ? ' sel' : '') + (anySolo && !t.solo ? ' quiet' : ''), role: 'button', tabindex: '0',
        'aria-label': `${t.name} (${TYPE[t.type]})`, 'aria-pressed': ti === state.track ? 'true' : 'false'},
        el('button', {type: 'button', class: 'tbar ' + t.type, style: {'--tcol': trackColour(t)},
          title: 'Change colour', 'aria-label': 'Change colour of ' + t.name,
          onclick: e => { e.stopPropagation(); openColourPicker(store, t.id); }}),
        el('span', {class: 'tinfo'}, tname, el('span', {class: 'tsub'}, sub.join(' · ')), t.fx && t.fx.length ? el('span', {class: 'tfx', title: 'Effects on this track'}, 'fx ' + t.fx.length) : null,
          el('span', {class: 'tmeter', 'data-id': t.id, style: {'--tcol': trackColour(t)}, 'aria-hidden': 'true'}, el('span', {class: 'tmfill'}))),   // trackmeters.js
        mute, solo);
      row.addEventListener('click', () => selectTrack(ti));
      // Enter selects; Space is left to play / stop (main.js)
      row.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === row){ e.preventDefault(); selectTrack(ti); } });
      tracksEl.append(row);
    });
  }

  let gridSig = '', cells = [], audioLanes = {};

  function gridStructure(s){
    const sc = s.scenes[state.scene] || {};
    return [state.scene, sc.bars || 1, s.mode, s.key, s.scale, s.tracks.map(t => t.id + t.type + (t.color || '')).join(',')].join('|');
  }

  function drawGrid(s = store.get()){
    const sc = s.scenes[state.scene];
    if (!sc) return;
    const sig = gridStructure(s);
    if (sig === gridSig){ paintGrid(s); return; }
    gridSig = sig;
    const len = clamp(sc.bars | 0 || 1, 1, 4) * STEPS_PER_BAR;
    gridEl.innerHTML = ''; cells = []; audioLanes = {};
    s.tracks.forEach((t, ti) => {
      if (isSongTrack(t)){   // no loop lane: one line that points at the Song screen, where this track lives
        const lane = el('button', {type: 'button', class: 'lane songpointer', style: {'--rowc': trackColour(t)}, title: 'This track is recorded and shown on the Song screen',
          onclick: () => { selectTrack(ti); openSong(); }}, 'Song-length take · on the Song screen');
        gridEl.append(el('div', {class: 'srow'}, lane)); cells.push([]);
        return;
      }
      if (t.type === 'audio'){   // a waveform lane in place of the steps (js/ui/audiolane.js)
        const L = audioLanes[ti] = audioLane({t, ti, bars: clamp(sc.bars | 0 || 1, 1, 4), onSelect: selectTrack});
        gridEl.append(el('div', {class: 'srow'}, L.lane)); cells.push(L.cells);
        return;
      }
      const lane = el('div', {class: 'lane ' + t.type});
      if (t.color) lane.style.setProperty('--rowc', trackColour(t));   // drum steps take the chosen colour
      const rc = [];
      for (let i = 0; i < len; i++){
        const b = el('button', {type: 'button', 'aria-label': `Step ${i + 1}`});
        b.className = 'cell' + (i % 8 < 4 ? ' dk' : '') + (i % 16 === 0 && i > 0 ? ' barstart' : i % 4 === 0 && i > 0 ? ' beatstart' : '');
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
    const anySolo = s.tracks.some(t => t.solo);
    s.tracks.forEach((t, ti) => {
      const lane = sc.steps[t.id] || [], rc = cells[ti];
      if (!rc) return;
      if (rc[0]) rc[0].parentElement.classList.toggle('quiet', anySolo && !t.solo);   // silent while others are soloed
      if (isSongTrack(t)) return;
      if (t.type === 'audio'){ if (audioLanes[ti]) audioLanes[ti].paint(s, state.scene, rec); return; }
      rc.forEach((b, i) => {
        const st = lane[i], on = !!(st && st.on);
        const vel = st ? (st.vel ?? 100) : 100, chance = st ? (st.chance ?? 100) : 100;
        b.classList.toggle('on', on);
        b.classList.toggle('sel', state.track === ti && state.step === i);
        // a white corner means velocity (or, in More, chance) was changed; Simple ignores chance, so it doesn't show it
        const more = s.mode === 'more';
        b.classList.toggle('mark', on && (vel !== 100 || (more && chance !== 100)));
        b.classList.toggle('chance', on && more && chance < 100);
        b.title = on ? (more ? `Velocity ${vel} · chance ${chance}%` : `Velocity ${vel}`) : '';
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
    const melodic = !!(sc && t && t.type !== 'drum' && t.type !== 'audio');
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
    addBtn.disabled = addMoreBtn.disabled = s.tracks.length >= MAX_TRACKS;
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
    'Step velocity': () => { paintGrid(); panel.refresh(); },
    'Step chance': () => { paintGrid(); panel.refresh(); },
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

  // Ctrl/Cmd+Z, Shift+Z (or Ctrl+Y) anywhere except while typing in a field. Sliders and tick boxes keep focus
  // after a drag, so they don't count as typing: Ctrl+Z straight after a slider move undoes it.
  const NOT_TYPING = new Set(['range', 'checkbox', 'button', 'radio']);
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !NOT_TYPING.has(t.type)))) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z'){ e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
    else if (k === 'y'){ e.preventDefault(); store.redo(); }
  });

  trackMeters(engine, tracksEl);
  engine.on('start', () => { playBtn.classList.add('on'); playBtn.textContent = '■ Stop'; playBtn.setAttribute('aria-pressed', 'true'); });
  engine.on('stop', () => { playBtn.classList.remove('on'); playBtn.textContent = '▶ Play'; playBtn.setAttribute('aria-pressed', 'false'); });

  rec.onChange(() => paintGrid());   // "Counting in…" / "Recording…" on the lane
  sync();
  playBtn.setAttribute('aria-pressed', 'false');

  /* ---- playhead: engine 'step' fires when the step is heard ---- */
  let lit = [];
  const clearLit = () => { lit.forEach(b => b.classList.remove('now')); lit = []; };
  return {
    togglePlay,
    get scene(){ return state.scene; },
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
