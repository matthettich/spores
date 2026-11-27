/* js/fxedit.js: changing a track's effects, each one Undo step (store.edit). For the Effects panel.
 *
 *   canHaveFx(track)                    drum / synth / audio (MIDI and CV tracks make no sound in Spores)
 *   canAddFx(track, song)               … and fewer than MAX_FX (4) on it, and fewer than MAX_SONG_FX (32) in the song
 *   fxCount(song)                       effects in the whole song (for "24 of 32 used")
 *   addFx(store, trackId, type, at?)    → the new effect's id (at: index, default the end) · 'Add effect'
 *   removeFx(store, trackId, fxId)      'Remove effect' (the panel asks first; Undo brings it back with its settings)
 *   moveFx(store, trackId, fxId, by)    by -1 / +1: earlier / later in the chain · 'Move effect'
 *   setFxOn(store, trackId, fxId, on)   'Effect on' / 'Effect off'
 *   setFxParam(store, trackId, fxId, key, value)   'Effect setting' (a drag is one Undo; clamped to the setting's range)
 *   resetFx(store, trackId, fxId)       every setting back to its default · 'Reset effect'
 *   applyFxPreset(store, trackId, fxId, values)   a preset's settings (js/engine/fxpresets.js) in ONE step · 'Effect preset'
 * The list for the Add menu, names, groups, settings and value text: FX_LIST, FX_GROUPS, fxInfo, fxText in
 * js/engine/fx.js. The sound follows by itself (main.js sends every edit to the engine).
 */
import {MAX_FX, MAX_SONG_FX, isFxType, fxDefaults, fxClean} from './engine/fx.js';
import {newFxId} from './store.js';

export const canHaveFx = t => !!t && (t.type === 'drum' || t.type === 'synth' || t.type === 'audio');
export const fxCount = song => song.tracks.reduce((n, t) => n + (canHaveFx(t) ? (t.fx || []).length : 0), 0);
export const canAddFx = (t, song) => canHaveFx(t) && (t.fx || []).length < MAX_FX && (!song || fxCount(song) < MAX_SONG_FX);

const track = (s, id) => s.tracks.find(t => t.id === id);
const find = (t, fxId) => (t && t.fx || []).find(f => f.id === fxId);

export function addFx(store, trackId, type, at){
  if (!isFxType(type)) throw new Error('no such effect: ' + type);
  const t0 = track(store.get(), trackId); if (!canAddFx(t0, store.get())) return null;
  const id = newFxId();
  store.edit('Add effect', s => {
    const t = track(s, trackId); t.fx = t.fx || [];
    const i = at == null ? t.fx.length : Math.max(0, Math.min(t.fx.length, at | 0));
    t.fx.splice(i, 0, {id, type, on: true, p: fxDefaults(type)});
  }, trackId);
  return id;
}
export function removeFx(store, trackId, fxId){
  store.edit('Remove effect', s => { const t = track(s, trackId); if (t && t.fx) t.fx = t.fx.filter(f => f.id !== fxId); }, trackId);
}
export function moveFx(store, trackId, fxId, by){
  store.edit('Move effect', s => {
    const t = track(s, trackId), a = t && t.fx; if (!a) return;
    const i = a.findIndex(f => f.id === fxId), j = i + (by < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
  }, trackId);
}
export function setFxOn(store, trackId, fxId, on){
  store.edit(on ? 'Effect on' : 'Effect off', s => { const f = find(track(s, trackId), fxId); if (f) f.on = !!on; }, fxId);
}
export function setFxParam(store, trackId, fxId, key, value){
  store.edit('Effect setting', s => {
    const f = find(track(s, trackId), fxId); if (!f || !(key in fxDefaults(f.type))) return;
    f.p = fxClean(f.type, Object.assign({}, f.p, {[key]: value}));
  }, fxId + ':' + key);
}
export function resetFx(store, trackId, fxId){
  store.edit('Reset effect', s => { const f = find(track(s, trackId), fxId); if (f) f.p = fxDefaults(f.type); }, fxId);
}
// every setting at once (missing ones go to their default, the rest clamped), so Undo restores all of them together
export function applyFxPreset(store, trackId, fxId, values){
  store.edit('Effect preset', s => {
    const f = find(track(s, trackId), fxId); if (f) f.p = fxClean(f.type, Object.assign(fxDefaults(f.type), values));
  }, fxId);
}
