/* js/ui/clipboard.js: copy and paste of scenes and tracks, from a right-click menu on the Steps screen
 * (a scene's letter button, a track's row; also the keyboard's Menu key or Shift+F10 on them).
 *
 * Scene menu: Copy scene · Paste over this scene (asks first) · Paste as a new scene · Copy to a new scene.
 *   A scene is its length, steps and takes; pasting over keeps the target's name.
 * Track menu: Copy track · Paste over this track (asks first) · Paste steps into this scene (asks first) · Paste as a new track.
 *   A copied track is everything about it: kind, sound, settings, effects, its steps and takes in every scene.
 *   "Paste over" replaces all of that on the target (it keeps its place in the list); "Paste steps" replaces only
 *   the target's steps (or, audio to audio, its take) in the scene being edited, from the scene the copy was made in.
 * Every paste is one store.edit, so Undo brings back what was there. The copy lives in memory for this window.
 *
 *   mountClipboard({store, state, goScene, selectTrack, scenesEl, tracksEl}) → wires the two menus
 */
import {el} from './dom.js';
import {ask, toast} from './dialog.js';
import {SCENES, MAX_TRACKS, MAX_AUDIO_TRACKS, newFxId, copySceneInto, isSongTrack} from '../store.js';
import {MAX_SONG_FX} from '../engine/fx.js';

const clone = x => JSON.parse(JSON.stringify(x ?? null));
let clip = null;   // {kind: 'scene', from, sc} | {kind: 'track', from, scene, t, steps: {sceneKey: lane}, clips: {sceneKey: take}}

/* ---- a small menu at the pointer ---- */
let openMenu = null;
function contextMenu(x, y, items){
  if (openMenu) openMenu();
  const menu = el('div', {class: 'menu ctxmenu', role: 'menu'});
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', close); openMenu = null; };
  const outside = e => { if (!menu.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape'){ e.preventDefault(); close(); } };
  for (const it of items){
    if (it === '-'){ menu.append(el('div', {class: 'ctxsep', role: 'separator'})); continue; }
    menu.append(el('button', {role: 'menuitem', disabled: !!it.off, title: it.off || it.title || '', onclick: () => { close(); it.fn(); }}, el('span', {}, it.label)));
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true); window.addEventListener('blur', close);
  const first = menu.querySelector('button:not(:disabled)'); if (first) first.focus();
  openMenu = close;
}
// right-click, or the Menu key / Shift+F10 on a focused element
function onMenu(root, sel, fn){
  root.addEventListener('contextmenu', e => { const t = e.target.closest(sel); if (!t || !root.contains(t)) return; e.preventDefault(); fn(t, e.clientX, e.clientY); });
  root.addEventListener('keydown', e => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    const t = e.target.closest(sel); if (!t) return;
    e.preventDefault(); const r = t.getBoundingClientRect(); fn(t, r.left + 8, r.bottom);
  });
}

export function mountClipboard({store, state, goScene, selectTrack, scenesEl, tracksEl}){
  const nameOf = (s, k) => (s.scenes[k] && s.scenes[k].name) || 'Scene ' + k;
  const freeScene = s => SCENES.find(k => !s.scenes[k]);

  /* ---- scenes ---- */
  onMenu(scenesEl, 'button.scn', (b, x, y) => {
    const k = b.textContent.trim(), s = store.get(); if (!s.scenes[k]) return;
    const have = clip && clip.kind === 'scene', free = freeScene(s);
    contextMenu(x, y, [
      {label: `Copy scene ${k}`, fn: () => { clip = {kind: 'scene', from: k, sc: clone(s.scenes[k])}; toast(`Copied scene ${k}. Right-click a scene to paste over it.`); }},
      {label: have ? `Paste scene ${clip.from} over ${k}` : 'Paste over this scene', off: !have ? 'Copy a scene first' : clip.from === k && sameScene(s.scenes[k], clip.sc) ? 'This is the scene you copied' : '', fn: () => pasteScene(k)},
      {label: 'Paste as a new scene', off: !have ? 'Copy a scene first' : !free ? 'Every letter is in use' : '', fn: () => pasteNewScene()},
      '-',
      {label: `Copy ${k} to a new scene`, off: !free ? 'Every letter is in use' : '', fn: () => { const f = freeScene(store.get()); if (!f) return; store.edit('Copy scene', s2 => copySceneInto(s2, k, f)); goScene(f); }},
    ]);
  });
  const sameScene = (a, b) => JSON.stringify([a.bars, a.steps, a.clips]) === JSON.stringify([b.bars, b.steps, b.clips]);
  // only the tracks that still exist (a track deleted since the copy leaves nothing behind)
  const fit = (s, sc) => {
    const ids = new Set(s.tracks.map(t => t.id)), loop = new Set(s.tracks.filter(t => t.type === 'audio' && !isSongTrack(t)).map(t => t.id));
    const steps = {}, clips = {};
    for (const [id, lane] of Object.entries(sc.steps || {})) if (ids.has(id) && !loop.has(id)) steps[id] = clone(lane);
    for (const [id, c] of Object.entries(sc.clips || {})) if (loop.has(id)) clips[id] = clone(c);
    return {bars: sc.bars || 1, steps, clips};
  };
  async function pasteScene(k){
    const s = store.get(); if (!clip || clip.kind !== 'scene' || !s.scenes[k]) return;
    const ok = await ask({title: `Replace ${nameOf(s, k)}?`, body: `Its steps and takes are replaced by a copy of scene ${clip.from}. Undo brings them back.`, yes: 'Replace it', no: 'Keep it'});
    if (!ok) return;
    const src = clip.sc;
    store.edit('Paste scene', s2 => { const sc = s2.scenes[k]; if (sc) Object.assign(sc, fit(s2, src)); });
    if (state.scene !== k) goScene(k);
    toast(`Scene ${k} is now a copy of scene ${clip.from}.`);
  }
  function pasteNewScene(){
    const f = freeScene(store.get()); if (!f || !clip || clip.kind !== 'scene') return;
    const src = clip.sc, from = clip.from;
    store.edit('Paste scene', s2 => { s2.scenes[f] = Object.assign({name: `Copy of ${src.name || 'Scene ' + from}`}, fit(s2, src)); });
    goScene(f);
  }

  /* ---- tracks ---- */
  onMenu(tracksEl, '.track', (row, x, y) => {
    const ti = [...tracksEl.querySelectorAll('.track')].indexOf(row), s = store.get(), t = s.tracks[ti]; if (!t) return;
    const have = clip && clip.kind === 'track', why = have ? cantPasteOver(s, t) : 'Copy a track first';
    contextMenu(x, y, [
      {label: `Copy ${t.name || 'track'}`, fn: () => { copyTrack(s, t); toast(`Copied ${t.name || 'the track'}. Right-click a track to paste over it.`); }},
      {label: have ? `Paste ${clip.t.name || 'track'} over this track` : 'Paste over this track', off: why, title: 'Its sound, settings, effects, steps and takes in every scene', fn: () => pasteTrack(t.id)},
      {label: 'Paste steps into this scene', off: have ? cantPasteSteps(t) : 'Copy a track first', title: `Only its steps in scene ${state.scene}`, fn: () => pasteSteps(t.id)},
      {label: 'Paste as a new track', off: have ? cantPasteNew(s) : 'Copy a track first', fn: () => pasteNewTrack()},
    ]);
  });
  function copyTrack(s, t){
    const steps = {}, clips = {};
    for (const [k, sc] of Object.entries(s.scenes)){ if (sc.steps && sc.steps[t.id]) steps[k] = clone(sc.steps[t.id]); if (sc.clips && sc.clips[t.id]) clips[k] = clone(sc.clips[t.id]); }
    clip = {kind: 'track', from: t.id, scene: state.scene, t: clone(t), steps, clips};
  }
  const fxOf = s => s.tracks.reduce((n, t) => n + (t.fx || []).length, 0);
  const audioCount = s => s.tracks.filter(t => t.type === 'audio').length;
  function cantPasteOver(s, t){
    const c = clip.t;
    if (c.id === t.id && JSON.stringify(c) === JSON.stringify(t)) return 'This is the track you copied';
    if (c.type === 'audio' && t.type !== 'audio' && audioCount(s) >= MAX_AUDIO_TRACKS) return `The song already has ${MAX_AUDIO_TRACKS} audio tracks`;
    if (fxOf(s) - (t.fx || []).length + (c.fx || []).length > MAX_SONG_FX) return `That would make more than ${MAX_SONG_FX} effects in the song`;
    return '';
  }
  function cantPasteSteps(t){
    const c = clip.t;
    if ((c.type === 'audio') !== (t.type === 'audio')) return c.type === 'audio' ? 'A take only pastes onto an audio track' : 'Steps don’t paste onto an audio track';
    if (isSongTrack(c) || isSongTrack(t)) return 'A song-length track has no scene takes';
    return '';
  }
  function cantPasteNew(s){
    const c = clip.t;
    if (s.tracks.length >= MAX_TRACKS) return `The song has ${MAX_TRACKS} tracks, the most it can have`;
    if (c.type === 'audio' && audioCount(s) >= MAX_AUDIO_TRACKS) return `The song already has ${MAX_AUDIO_TRACKS} audio tracks`;
    if (fxOf(s) + (c.fx || []).length > MAX_SONG_FX) return `That would make more than ${MAX_SONG_FX} effects in the song`;
    return '';
  }
  // the copied track's content under a given id: new effect ids, a CV track on free outputs
  function made(s2, id, keepOut){
    const t = Object.assign(clone(clip.t), {id, mute: false, solo: false});
    t.fx = (t.fx || []).map(f => Object.assign(f, {id: newFxId()}));
    if (t.type === 'cv' && !keepOut){
      const used = new Set(s2.tracks.filter(x => x.type === 'cv' && x.id !== id).flatMap(x => [x.cv.pitch, x.cv.gate]));
      let c = 3; while (used.has(c) || used.has(c + 1)) c += 2; t.cv = Object.assign({}, t.cv, {pitch: c, gate: c + 1, cal: null});
    }
    return t;
  }
  function putScenes(s2, id, t){
    for (const [k, sc] of Object.entries(s2.scenes)){
      if (sc.steps) delete sc.steps[id]; if (sc.clips) delete sc.clips[id];
      const loop = t.type === 'audio' && !isSongTrack(t);
      if (!loop && clip.steps[k]){ sc.steps = sc.steps || {}; sc.steps[id] = clone(clip.steps[k]); }
      if (loop && clip.clips[k]){ sc.clips = sc.clips || {}; sc.clips[id] = clone(clip.clips[k]); }
    }
  }
  async function pasteTrack(id){
    const s = store.get(), t = s.tracks.find(x => x.id === id); if (!t || !clip || cantPasteOver(s, t)) return;
    const ok = await ask({title: `Replace ${t.name || 'this track'}?`, body: `It becomes a copy of ${clip.t.name || 'the copied track'}: sound, settings, effects, and its steps and takes in every scene. Undo brings it back.`, yes: 'Replace it', no: 'Keep it'});
    if (!ok) return;
    store.edit('Paste track', s2 => {
      const i = s2.tracks.findIndex(x => x.id === id); if (i < 0) return;
      const nt = made(s2, id, clip.t.type === 'cv' && s2.tracks[i].type === 'cv' && clip.from === id);
      s2.tracks[i] = nt; putScenes(s2, id, nt);
    });
    const i = store.get().tracks.findIndex(x => x.id === id); if (i >= 0) selectTrack(i);
  }
  async function pasteSteps(id){
    const s = store.get(), t = s.tracks.find(x => x.id === id); if (!t || !clip || cantPasteSteps(t)) return;
    const k = state.scene, audio = t.type === 'audio', src = audio ? clip.clips[clip.scene] : clip.steps[clip.scene];
    const ok = await ask({title: `Replace ${t.name || 'this track'}’s ${audio ? 'take' : 'steps'} in scene ${k}?`,
      body: `${audio ? 'Its take' : 'Its steps'} in scene ${k} ${src ? `become a copy of ${clip.t.name || 'the copied track'}’s from scene ${clip.scene}` : `are cleared (${clip.t.name || 'the copied track'} had none in scene ${clip.scene})`}. Undo brings them back.`, yes: 'Replace them', no: 'Keep them'});
    if (!ok) return;
    store.edit('Paste steps', s2 => {
      const sc = s2.scenes[k]; if (!sc) return;
      const box = audio ? (sc.clips = sc.clips || {}) : (sc.steps = sc.steps || {});
      if (src) box[id] = clone(src); else delete box[id];
    });
  }
  function pasteNewTrack(){
    const s = store.get(); if (!clip || cantPasteNew(s)) return;
    const n = s.tracks.length;
    store.edit('Paste track', s2 => {
      const nt = made(s2, 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      nt.name = (clip.t.name || 'Track').slice(0, 20) + ' 2';
      s2.tracks.push(nt); putScenes(s2, nt.id, nt);
    });
    selectTrack(n);
  }
}
