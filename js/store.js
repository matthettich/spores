/* js/store.js: song data, and (phase 3) save / load, undo / redo and format migration.
 *
 * Every change to the song goes through store.edit(label, fn), so phase 3 can add undo / redo and saving in one
 * place without touching the screens. Format: docs/SPEC.md "Data (one song)". Fields added in phase 1, all
 * optional (old songs open as before):
 *   track.oct        root octave of a Synth / MIDI / CV track (MIDI octave: 2 = C2 = note 36). Default 3.
 *   track.len        per-track length in steps (More mode). 0 / missing = the scene's length.
 *   track.midi.clock send MIDI clock + Start / Stop to this MIDI track's port.
 *   track.params     {setting: value} over the sound's own values (drum / synth). Settings and their ranges:
 *                    settingsFor(track.sound) in js/engine/sounds.js. Clear it when the sound changes.
 */
import {DRUM_NAMES, SYNTH_NAMES} from './engine/sounds.js';

export const VERSION = 1, MAX_TRACKS = 16, SCENES = 'ABCDEFGH'.split('');

// GM drum notes, so a drum track's seedsNote is something sensible in Seeds and in any drum machine
const GM = {'Kick': 36, 'Boom kick': 35, 'Snare': 38, 'Clap': 39, 'Closed hat': 42, 'Open hat': 46, 'Tom': 45, 'Rim': 37,
  'Click': 75, 'Metal': 56, 'Zap': 54, 'Glitch': 70, 'Bell': 53};

let nextId = 1;
export function newTrack(type = 'drum', sound, name){
  const id = 't' + Date.now().toString(36) + (nextId++);
  sound = sound || (type === 'drum' ? 'Kick' : type === 'synth' ? 'Acid bass' : '');
  return {id, name: name || sound || (type === 'midi' ? 'MIDI' : 'CV'), type, sound,
    midi: {port: '', ch: 1, clock: false}, cv: {pitch: 3, gate: 4, cal: null},
    params: {}, seedsNote: GM[sound] ?? 36, oct: type === 'drum' ? 3 : 2, vol: 0.8, mute: false, solo: false};
}

export function newSong(){
  const tracks = [
    newTrack('drum', 'Kick'), newTrack('drum', 'Snare'), newTrack('drum', 'Clap'), newTrack('drum', 'Closed hat'),
    newTrack('drum', 'Open hat'), newTrack('drum', 'Tom'), newTrack('synth', 'Acid bass', 'Bass'), newTrack('synth', 'Square lead', 'Lead'),
  ];
  tracks[7].oct = 4;
  return {v: VERSION, bpm: 120, swing: 0, key: 'C', scale: 'minor', lock: true, tracks,
    scenes: {A: {name: 'Scene A', bars: 1, steps: {}}}, song: [{scene: 'A', repeat: 4}],
    link: {seedsPort: '', seedsCh: 16, clock: true}, mode: 'simple'};
}

// A little beat to hear straight away (used by the phase 1 test page; phase 2 can keep or drop it).
export function demoSong(){
  const s = newSong(), on = (ti, steps, extra = {}) => {
    const id = s.tracks[ti].id, lane = s.scenes.A.steps[id] = s.scenes.A.steps[id] || [];
    for (const i of steps) lane[i] = Object.assign({on: true, deg: 0, vel: 100, chance: 100}, typeof extra === 'function' ? extra(i) : extra);
  };
  on(0, [0, 4, 8, 12]); on(1, [4, 12]); on(3, [2, 6, 10, 14]); on(4, [7, 15], {vel: 80});
  const bass = [0, 0, 7, 0, 3, 0, 5, 4, 0, 0, 7, 0, 2, 3, 4, 7];
  on(6, [0, 3, 6, 8, 10, 11, 14], i => ({deg: bass[i], vel: i === 6 || i === 14 ? 120 : 100}));
  return s;
}

/* Old song files must keep opening: bump VERSION and add a step here whenever the format changes. */
export function migrate(s){
  if (!s || typeof s !== 'object') return newSong();
  s.v = s.v || 1;
  // (v1 is the first format; future: if (s.v === 1){ …; s.v = 2; })
  const base = newSong();
  for (const k of ['bpm', 'swing', 'key', 'scale', 'lock', 'mode']) if (s[k] === undefined) s[k] = base[k];
  s.tracks = Array.isArray(s.tracks) && s.tracks.length ? s.tracks.slice(0, MAX_TRACKS) : base.tracks;
  s.scenes = s.scenes && Object.keys(s.scenes).length ? s.scenes : base.scenes;
  s.song = Array.isArray(s.song) ? s.song : base.song;
  s.link = Object.assign({}, base.link, s.link || {});
  return s;
}

export function createStore(initial){
  let song = migrate(initial || demoSong());
  const subs = [];
  return {
    get: () => song,
    // fn changes the song in place. label: what the change was, for Undo (phase 3).
    edit(label, fn){ fn(song); subs.forEach(f => f(song, label)); },
    replace(s){ song = migrate(s); subs.forEach(f => f(song, 'load')); },
    subscribe(f){ subs.push(f); return () => subs.splice(subs.indexOf(f), 1); },
  };
}

// Sound names for each track type, in Prev / Next order (the panel's picker can group them by engine: SOUNDS in sounds.js)
export const SOUND_LISTS = {drum: DRUM_NAMES, synth: SYNTH_NAMES};
