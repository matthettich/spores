/* js/store.js: song data, undo / redo, saving and loading, and format migration.
 *
 * Every change to the song goes through store.edit(label, fn), so undo / redo and saving live in one place and the
 * screens never touch the song directly. Format: docs/SPEC.md "Data (one song)". Fields added in phase 1, all
 * optional (old songs open as before):
 *   track.oct        root octave of a Synth / MIDI / CV track (MIDI octave: 2 = C2 = note 36). Default 3.
 *   track.len        per-track length in steps (More mode). 0 / missing = the scene's length.
 *   track.midi.clock send MIDI clock + Start / Stop to this MIDI track's port.
 *   v2 (audio tracks): track.type 'audio' (≤ MAX_AUDIO_TRACKS), and scene.clips = {trackId: clip}, one loop take per
 *                    audio track per scene (newClip below). The samples are not in the song: js/audiostore.js.
 *   v3 (effects): track.fx = [{id, type, on, p}], up to MAX_FX (4) on drum / synth / audio tracks (none on MIDI / CV).
 *                    type: a key of js/engine/fx.js; p: {setting: value} (fx.js ranges); id: 'f…', unique in the track.
 *                    Edit them with js/fxedit.js. Old files: fx = [].
 *   track.params     {setting: value} over the sound's own values (drum / synth). Settings and their ranges:
 *                    settingsFor(track.sound) in js/engine/sounds.js. Clear it when the sound changes.
 *
 * Undo keeps the song as it was before each edit (a JSON copy — a song is a few KB), up to HISTORY steps. Consecutive
 * slider moves (Sound setting / Volume / Swing / Step velocity / Step chance within 600 ms) count as one step, so one
 * drag is one Undo — but only on the same target (edit's third argument, e.g. one step or one setting).
 */
import {DRUM_NAMES, SYNTH_NAMES, settingsFor} from './engine/sounds.js';
import {isFxType, fxClean, MAX_FX} from './engine/fx.js';

// a track's chosen colour (none = by type: drums pink, synths teal…); the colours are --tc-<key> on :root
export const TRACK_COLOURS = ['pink', 'orange', 'mustard', 'green', 'teal', 'blue', 'purple', 'grey'];
export const VERSION = 4, MAX_TRACKS = 16, MAX_AUDIO_TRACKS = 4, CLIP_BARS = [1, 2, 4, 8], SCENES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), STORAGE_KEY = 'spores.song';
const HISTORY = 80, MERGE_MS = 600;
const MERGE_LABELS = new Set(['Sound setting', 'Volume', 'Master volume', 'Swing', 'Step velocity', 'Step chance', 'Effect setting']);
const TYPES = ['drum', 'synth', 'midi', 'cv', 'audio'];
// a new loop take's playback settings (seconds for offset and fades; a few ms of fade keeps the loop seam from clicking)
export const CLIP_DEFAULTS = {gain: 1, offset: 0, fadeIn: 0.004, fadeOut: 0.004, reverse: false};

// GM drum notes, so a drum track's seedsNote is something sensible in Seeds and in any drum machine
const GM = {'Kick': 36, 'Boom kick': 35, 'Snare': 38, 'Clap': 39, 'Closed hat': 42, 'Open hat': 46, 'Tom': 45, 'Rim': 37,
  'Click': 75, 'Metal': 56, 'Zap': 54, 'Glitch': 70, 'Bell': 53};

let nextId = 1;
export function newTrack(type = 'drum', sound, name){
  const id = 't' + Date.now().toString(36) + (nextId++);
  sound = sound || (type === 'drum' ? 'Kick' : type === 'synth' ? 'Acid bass' : '');
  return {id, name: name || sound || (type === 'midi' ? 'MIDI' : type === 'audio' ? 'Voice' : 'CV'), type, sound,
    midi: {port: '', ch: 1, clock: false}, cv: {pitch: 3, gate: 4, cal: null},
    params: {}, fx: [], seedsNote: GM[sound] ?? 36, oct: type === 'drum' ? 3 : 2, vol: 0.8};   // mute / solo: per scene (scene.mute / scene.solo)
}

// may another audio track be added? (MAX_AUDIO_TRACKS of the MAX_TRACKS)
export const canAddAudio = song => song.tracks.length < MAX_TRACKS && song.tracks.filter(t => t.type === 'audio').length < MAX_AUDIO_TRACKS;

/* A loop take, as stored in scene.clips[trackId] (the samples themselves live in js/audiostore.js under `id`, and in a
   .spores file as audio/<id>.wav). bars: 1 | 2 | 4 | 8, the loop's length at any tempo; bpm and sr: what it was
   recorded at (another song tempo plays it faster or slower: varispeed, pitch moves); gain (1 = as recorded); offset
   (seconds, + starts later in the take); fadeIn / fadeOut (seconds, at the loop's start and end); reverse.
   pad (seconds, takes from 2026-11-27 on): extra audio recorded before and after the loop, so the samples are
   [pad | loop | pad] and offset (within ±pad) slides the loop window through them; 0 = the samples are the loop. */
export function newClip({id, bars, bpm, sr, pad = 0}, extra = {}){
  return Object.assign({id, bars, bpm, sr}, CLIP_DEFAULTS, {pad}, extra);
}
/* A song-length take, as stored in track.take of an audio track with span 'song' (samples: audiostore.js under `id`,
   audio/<id>.wav in a .spores file, exactly like loop takes). startBar: the song bar (from 0, counted through the
   blocks and their repeats: js/songmap.js) where the take's first sample plays. bpm / sr: what it was recorded at
   (another song tempo = varispeed, its bar count stays). gain; fadeIn / fadeOut (seconds, at the trimmed edges);
   trimStart / trimEnd (seconds hidden at either end; the take stays anchored, so trimming never moves the audio). */
export const SONG_TAKE_DEFAULTS = {gain: 1, fadeIn: 0.004, fadeOut: 0.004, trimStart: 0, trimEnd: 0};
export function newSongTake({id, sr, bpm, startBar = 0}, extra = {}){
  return Object.assign({id, sr, bpm, startBar: Math.max(0, startBar | 0)}, SONG_TAKE_DEFAULTS, extra);
}
// a new song-length audio track ("Song voice 1…" is the UI's job; it counts as one of the MAX_AUDIO_TRACKS)
export function newSongTrack(name){ return Object.assign(newTrack('audio', undefined, name || 'Song voice'), {span: 'song', take: null}); }
export const isSongTrack = t => !!t && t.type === 'audio' && t.span === 'song';
// copy scene `from` into the empty letter `to` (inside store.edit): its own copy of the steps and takes, not a second name for them
export function copySceneInto(song, from, to){
  const src = song.scenes[from]; if (!src || song.scenes[to]) return;
  song.scenes[to] = {name: `Copy of ${src.name || 'Scene ' + from}`, bars: src.bars || 1,
    steps: JSON.parse(JSON.stringify(src.steps || {})), clips: JSON.parse(JSON.stringify(src.clips || {})),
    mute: Object.assign({}, src.mute), solo: Object.assign({}, src.solo)};
}
/* Mute and solo belong to a scene (v4): scene.mute / scene.solo = {trackId: true}, so a track can sit out one scene of the
   song and play in the next. solo: while any track in a scene is soloed, only soloed tracks are heard in that scene. */
export const isMuted = (song, k, id) => !!(song.scenes[k] && song.scenes[k].mute && song.scenes[k].mute[id]);
export const isSolo = (song, k, id) => !!(song.scenes[k] && song.scenes[k].solo && song.scenes[k].solo[id]);
export const anySolo = (song, k) => !!(song.scenes[k] && song.scenes[k].solo && Object.keys(song.scenes[k].solo).some(id => song.scenes[k].solo[id]));
// inside store.edit: set (on = true / false) or flip (on undefined) mute or solo ('mute' | 'solo') of a track in scene k,
// or in every scene (k = null: the Song screen's lanes, whose song-length takes play across them)
export function setQuiet(song, k, id, what, on){
  const keys = k == null ? Object.keys(song.scenes) : [k];
  if (on === undefined) on = !keys.every(x => (what === 'mute' ? isMuted : isSolo)(song, x, id));
  for (const x of keys){ const sc = song.scenes[x]; if (!sc) continue; const m = sc[what] = sc[what] || {}; if (on) m[id] = true; else delete m[id]; }
}

export const newClipId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// every clip id the song refers to (Save writes these; the engine loads these)
export function clipIds(song){
  const ids = new Set();
  for (const sc of Object.values(song.scenes || {})) for (const c of Object.values(sc.clips || {})) if (c && c.id) ids.add(c.id);
  for (const t of song.tracks || []) if (isSongTrack(t) && t.take && t.take.id) ids.add(t.take.id);
  return ids;
}

const num = (x, d, lo, hi) => typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
function fixClip(c){
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[\w-]{1,64}$/.test(c.id)) return null;
  return {id: c.id, bars: CLIP_BARS.includes(c.bars) ? c.bars : 1, bpm: num(c.bpm, 120, 20, 300), sr: num(c.sr, 48000, 8000, 192000),
    gain: num(c.gain, 1, 0, 4), offset: num(c.offset, 0, -60, 60), pad: num(c.pad, 0, 0, 30), fadeIn: num(c.fadeIn, CLIP_DEFAULTS.fadeIn, 0, 10),
    fadeOut: num(c.fadeOut, CLIP_DEFAULTS.fadeOut, 0, 10), reverse: !!c.reverse};
}
function fixSongTake(c){
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[\w-]{1,64}$/.test(c.id)) return null;
  const D = SONG_TAKE_DEFAULTS;
  return {id: c.id, sr: num(c.sr, 48000, 8000, 192000), bpm: num(c.bpm, 120, 20, 300), startBar: Math.round(num(c.startBar, 0, 0, 9999)),
    gain: num(c.gain, D.gain, 0, 4), fadeIn: num(c.fadeIn, D.fadeIn, 0, 60), fadeOut: num(c.fadeOut, D.fadeOut, 0, 60),
    trimStart: num(c.trimStart, 0, 0, 3600), trimEnd: num(c.trimEnd, 0, 0, 3600)};
}

export function newSong(){
  const tracks = [
    newTrack('drum', 'Kick'), newTrack('drum', 'Snare'), newTrack('drum', 'Clap'), newTrack('drum', 'Closed hat'),
    newTrack('drum', 'Open hat'), newTrack('drum', 'Tom'), newTrack('synth', 'Acid bass', 'Bass'), newTrack('synth', 'Square lead', 'Lead'),
  ];
  tracks[7].oct = 4;
  return {v: VERSION, bpm: 120, swing: 0, key: 'C', scale: 'minor', lock: true, master: 1, loopSong: true, tracks,
    scenes: {A: {name: 'Scene A', bars: 1, steps: {}, clips: {}}}, song: [{scene: 'A', repeat: 4}],
    presets: [], link: {seedsPort: '', seedsCh: 16, clock: true}, mode: 'simple'};
}

// A little song to hear straight away the first time Spores is opened (until she makes it her own): two scenes, so
// the Song screen has something to arrange — A ×4 and then B ×2 (docs/SPEC.md "Songs").
export function demoSong(){
  const s = newSong();
  const put = (sc, ti, steps, extra = {}) => {
    const id = s.tracks[ti].id, lane = sc.steps[id] = sc.steps[id] || [];
    for (const i of steps) lane[i] = Object.assign({on: true, deg: 0, vel: 100, chance: 100}, typeof extra === 'function' ? extra(i) : extra);
  };
  const A = s.scenes.A, B = (s.scenes.B = {name: 'Chorus', bars: 1, steps: {}, clips: {}});
  const drums = sc => { put(sc, 0, [0, 4, 8, 12]); put(sc, 1, [4, 12]); put(sc, 3, [2, 6, 10, 14]); put(sc, 4, [7, 15], {vel: 80}); };
  drums(A);
  const bassA = [0, 0, 7, 0, 3, 0, 5, 4, 0, 0, 7, 0, 2, 3, 4, 7];
  put(A, 6, [0, 3, 6, 8, 10, 11, 14], i => ({deg: bassA[i], vel: i === 6 || i === 14 ? 120 : 100}));
  drums(B);
  put(B, 2, [14]);
  const bassB = [0, 0, 5, 0, 3, 3, 0, 5, 0, 0, 5, 0, 7, 5, 3, 0];
  put(B, 6, [0, 3, 5, 6, 8, 10, 12, 14], i => ({deg: bassB[i]}));
  const leadB = [0, 2, 3, 4, 4, 3, 2, 0];
  put(B, 7, [0, 2, 4, 6, 8, 10, 12, 14], i => ({deg: leadB[i / 2] || 0, vel: 110}));
  s.song = [{scene: 'A', repeat: 4}, {scene: 'B', repeat: 2}];
  return s;
}

// A saved file may be the song itself, or {app, song} if one is ever written with a wrapper.
function unwrap(o){
  return o && typeof o === 'object' && o.song && Array.isArray(o.song.tracks) ? o.song : o;
}

/* Is this something we can open? Used before a file replaces the song on screen, so a stray JSON cannot wipe it. */
export function isSong(input){
  const o = unwrap(input);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  if (!Array.isArray(o.tracks) || !o.tracks.length) return false;
  if (!o.scenes || typeof o.scenes !== 'object' || !Object.keys(o.scenes).length) return false;
  return o.tracks.every(t => t && typeof t.id === 'string' && TYPES.includes(t.type));
}

/* Old song files must keep opening: bump VERSION and add a step here whenever the format changes.
   Missing or odd fields are filled in so a half-old file cannot crash a screen. */
export function migrate(input){
  const s = unwrap(input);
  if (!s || typeof s !== 'object') return newSong();
  s.v = s.v || 1;
  // v1 → v2 (2026-11-26): audio tracks; a scene may hold one loop take per audio track in scene.clips (none before)
  if (s.v === 1){ for (const sc of Object.values(s.scenes && typeof s.scenes === 'object' ? s.scenes : {})) if (sc && typeof sc === 'object') sc.clips = {}; s.v = 2; }
  // v2 → v3 (2026-11-26): track effects; none before (fixTrack fills track.fx = [] and checks it in every version)
  if (s.v === 2){ for (const t of Array.isArray(s.tracks) ? s.tracks : []) if (t && typeof t === 'object') t.fx = []; s.v = 3; }
  // v3 → v4 (2026-11-27): mute and solo per scene: a track muted / soloed before is muted / soloed in every scene
  if (s.v === 3){
    const ts = (Array.isArray(s.tracks) ? s.tracks : []).filter(t => t && typeof t === 'object' && typeof t.id === 'string');
    for (const sc of Object.values(s.scenes && typeof s.scenes === 'object' ? s.scenes : {})) if (sc && typeof sc === 'object'){
      sc.mute = {}; sc.solo = {};
      for (const t of ts){ if (t.mute) sc.mute[t.id] = true; if (t.solo) sc.solo[t.id] = true; }
    }
    s.v = 4;
  }
  const base = newSong();
  for (const k of ['bpm', 'swing', 'key', 'scale', 'lock', 'mode', 'master', 'loopSong']) if (s[k] === undefined) s[k] = base[k];
  // master: the master volume (gain, 1 = 0 dB, up to 2 ≈ +6 dB; the Song screen's fader); loopSong: the song starts again at its end
  s.master = typeof s.master === 'number' && isFinite(s.master) ? Math.max(0, Math.min(2, s.master)) : 1; s.loopSong = s.loopSong !== false;
  s.tracks = Array.isArray(s.tracks) && s.tracks.length ? s.tracks.slice(0, MAX_TRACKS) : base.tracks;
  s.tracks.forEach(fixTrack);
  const audioIds = new Set(s.tracks.filter(t => t.type === 'audio' && !isSongTrack(t)).map(t => t.id));   // (loop tracks: song-length ones have no clips)
  const scenes = {}, trackIds = new Set(s.tracks.map(t => t.id));
  for (const [k, sc] of Object.entries(s.scenes && typeof s.scenes === 'object' ? s.scenes : {})){
    if (!SCENES.includes(k) || !sc || typeof sc !== 'object') continue;
    scenes[k] = {name: typeof sc.name === 'string' && sc.name ? sc.name : 'Scene ' + k,
      bars: Math.max(1, Math.min(4, sc.bars | 0 || 1)),
      steps: sc.steps && typeof sc.steps === 'object' ? sc.steps : {}, clips: {}, mute: {}, solo: {}};
    // mute / solo: only tracks that exist
    for (const w of ['mute', 'solo']) for (const [tid, on] of Object.entries(sc[w] && typeof sc[w] === 'object' ? sc[w] : {})) if (on === true && trackIds.has(tid)) scenes[k][w][tid] = true;
    // loop takes: only for audio tracks that exist (a deleted track's take goes with it; Undo brings both back)
    for (const [tid, c] of Object.entries(sc.clips && typeof sc.clips === 'object' ? sc.clips : {})){
      const f = audioIds.has(tid) && fixClip(c); if (f) scenes[k].clips[tid] = f;
    }
  }
  s.scenes = Object.keys(scenes).length ? scenes : base.scenes;
  // song blocks: only scenes that exist, repeat 1..64 (the Song screen's own limit), loop a boolean; all dropped = empty song
  s.song = Array.isArray(s.song) ? s.song
    .filter(b => b && typeof b === 'object' && s.scenes[b.scene])
    .slice(0, 128)
    .map(b => ({scene: b.scene, repeat: Math.max(1, Math.min(64, b.repeat | 0 || 1)), loop: !!b.loop}))
    : base.song;
  s.link = Object.assign({}, base.link, s.link || {});
  // sound presets: {name, sound, params}, optional (songs from before they existed just have none)
  s.presets = Array.isArray(s.presets) ? s.presets
    .filter(p => p && typeof p.sound === 'string' && p.sound && typeof p.name === 'string' && p.name)
    .map(p => ({name: p.name.slice(0, 40), sound: p.sound,
      params: p.params && typeof p.params === 'object' && !Array.isArray(p.params) ? p.params : {}})) : [];
  return s;
}

function fixTrack(t){
  if (typeof t.id !== 'string' || !t.id) t.id = 't' + Date.now().toString(36) + (nextId++);
  if (!TYPES.includes(t.type)) t.type = 'drum';
  if ((t.type === 'drum' || t.type === 'synth') && (typeof t.sound !== 'string' || !t.sound))
    t.sound = t.type === 'drum' ? 'Kick' : 'Acid bass';
  if (!t.name) t.name = t.sound || (t.type === 'midi' ? 'MIDI' : t.type === 'cv' ? 'CV' : t.type === 'audio' ? 'Voice' : 'Track');
  t.midi = Object.assign({port: '', ch: 1, clock: false}, t.midi && typeof t.midi === 'object' ? t.midi : {});
  t.cv = Object.assign({pitch: 3, gate: 4, cal: null}, t.cv && typeof t.cv === 'object' ? t.cv : {});
  t.params = t.params && typeof t.params === 'object' && !Array.isArray(t.params) ? t.params : {};
  if (t.type === 'drum' || t.type === 'synth'){   // keep only the sound's own settings, finite and in range (a bad value must not reach the voice)
    const p = {};
    for (const r of settingsFor(t.sound).all){
      const v = t.params[r.s];
      if (typeof v === 'number' && isFinite(v)) p[r.s] = Math.min(r.max, Math.max(r.min, r.int ? Math.round(v) : v));
    }
    t.params = p;
  }
  if (typeof t.vol !== 'number' || !isFinite(t.vol)) t.vol = 0.8;
  if (typeof t.oct !== 'number') t.oct = 3;
  if (typeof t.len !== 'number') t.len = 0;
  if (t.loop !== undefined && !CLIP_BARS.includes(t.loop)) delete t.loop;   // audio track: bars of the next take (1 | 2 | 4 | 8; missing = 2)
  if (isSongTrack(t)) t.take = fixSongTake(t.take);   // song-length audio track: its one take (or null)
  else { delete t.span; delete t.take; }
  if (t.color !== undefined && !TRACK_COLOURS.includes(t.color)) delete t.color;   // optional; old songs have none
  if (typeof t.seedsNote !== 'number') t.seedsNote = GM[t.sound] ?? 36;
  delete t.mute; delete t.solo;   // (per scene since v4)
  t.fx = fixFx(t);
}

// a track's effects: known types only, up to MAX_FX, settings in range, each with its own id; none on MIDI / CV tracks
let fxSeq = 1;
export const newFxId = () => 'f' + Date.now().toString(36) + (fxSeq++);
function fixFx(t){
  if (!(t.type === 'drum' || t.type === 'synth' || t.type === 'audio') || !Array.isArray(t.fx)) return [];
  const seen = new Set();
  return t.fx.filter(f => f && typeof f === 'object' && isFxType(f.type)).slice(0, MAX_FX).map(f => {
    let id = typeof f.id === 'string' && /^[\w-]{1,40}$/.test(f.id) && !seen.has(f.id) ? f.id : newFxId();
    seen.add(id);
    return {id, type: f.type, on: f.on !== false, p: fxClean(f.type, f.p)};
  });
}

// The song saved in this browser (localStorage), or null if there is none or it cannot be read.
function loadSaved(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return isSong(o) ? o : null;
  } catch (e){ return null; }
}

export function createStore(initial, {onSaveError} = {}){
  let song = migrate(initial || loadSaved() || demoSong());
  let saveFailed = false;
  const subs = [];
  const past = [], future = [];          // JSON copies: the song before each edit, and what Redo brings back
  let lastLabel = '', lastKey = '', lastAt = 0, saveTimer = 0;

  const snap = () => JSON.stringify(song);
  // one screen failing must not stop the others (or the engine) hearing about the change
  const notify = label => { for (const f of subs.slice()) { try { f(song, label); } catch (e) { console.error(e); } } };
  const push = json => { past.push(json); if (past.length > HISTORY) past.shift(); future.length = 0; };

  /* The song saves itself to this browser a moment after each change, so a reload keeps it. The short delay keeps a
     slider drag from writing to localStorage sixty times a second; js/main.js calls saveNow() when the tab is hidden. */
  function save(){
    clearTimeout(saveTimer); saveTimer = 0;
    try { localStorage.setItem(STORAGE_KEY, snap()); saveFailed = false; }
    catch (e) {
      // private mode or full: carry on in memory, but say so once, so she knows to use File › Save a copy…
      if (!saveFailed && onSaveError) onSaveError(e);
      saveFailed = true;
    }
  }
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); };

  // replace the whole song (New song, Open a file). Still undoable: nothing is lost.
  function replace(s, label = 'load'){
    const before = snap();
    song = migrate(s);
    if (snap() !== before) push(before);
    lastLabel = lastKey = '';
    persist();
    notify(label);
  }

  return {
    get: () => song,

    /* fn changes the song in place. label: what the change was (for Undo).
       key: which thing it changed (a track, a setting, a step). Two edits merge into one Undo only when they share
       the label AND the key, so dragging a slider is one Undo but touching a second step starts a new one. */
    edit(label, fn, key){
      const before = snap();
      try { fn(song); }
      catch (e) { song = JSON.parse(before); throw e; }   // a half-made change is put back, never left un-undoable
      const after = snap();
      if (after === before) return;        // nothing actually changed: no history entry
      const now = Date.now();
      const mergeKey = key || label;
      const merge = MERGE_LABELS.has(label) && label === lastLabel && mergeKey === lastKey
        && now - lastAt < MERGE_MS && past.length > 0;
      if (!merge) push(before);            // one drag of a slider is one Undo, not sixty
      lastLabel = label; lastKey = mergeKey; lastAt = now;
      persist();
      notify(label);
    },

    replace,

    // Open a song object (from a file). Returns false, and changes nothing, if it is not a Spores song.
    load(o){
      if (!isSong(o)) return false;
      replace(unwrap(o), 'load');
      return true;
    },

    undo(){
      if (!past.length) return false;
      future.push(snap());
      song = migrate(JSON.parse(past.pop()));
      lastLabel = lastKey = '';
      persist();
      notify('undo');
      return true;
    },

    redo(){
      if (!future.length) return false;
      past.push(snap());
      song = migrate(JSON.parse(future.pop()));
      lastLabel = lastKey = '';
      persist();
      notify('redo');
      return true;
    },

    get canUndo(){ return past.length > 0; },
    get canRedo(){ return future.length > 0; },

    saveNow: save,
    serialize: () => JSON.stringify(song, null, 2),

    subscribe(f){ subs.push(f); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; },
  };
}

// Sound names for each track type, in Prev / Next order (the panel's picker can group them by engine: SOUNDS in sounds.js)
export const SOUND_LISTS = {drum: DRUM_NAMES, synth: SYNTH_NAMES};
