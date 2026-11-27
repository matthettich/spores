/* js/ui/stepedit.js: reading and changing one step of a scene (the grid, the melody lane and the panel share these).
 * Every change goes through store.edit(label, fn), so it is undoable and saved like any other song change.
 */
import {cleanChord, stepDegs, MAX_NOTES, MAX_ABOVE} from '../chord.js';

export function stepAt(song, {scene, trackId, index}){
  const sc = song.scenes && song.scenes[scene];
  const lane = sc && sc.steps && sc.steps[trackId];
  return lane ? lane[index] : null;
}

/* The key says which step changed, so a drag on one step merges into one Undo but two different steps never do. */
const keyOf = where => `${where.scene}:${where.trackId}:${where.index}`;

function editStep(store, where, label, fn, key = keyOf(where), hold = false){
  store.edit(label, song => {
    const sc = song.scenes[where.scene];
    const lane = sc && sc.steps && sc.steps[where.trackId];
    const st = lane && lane[where.index];
    if (st && st.on) fn(st, song);
  }, key, hold);
}

/* Move a note up or down the scale (deg is in scale steps, so it stays in key). */
export const nudgeNote = (store, where, by) =>
  editStep(store, where, 'Step note', st => { st.deg = Math.max(-28, Math.min(35, Math.round(st.deg || 0) + by)); });

/* One drag of a note: sets the degree outright. `key` is the same for the whole drag and `hold` makes the store merge
   every edit with it into one Undo step, however long the drag pauses (js/ui/notedrag.js). */
export const setNoteDeg = (store, where, deg, key) =>
  editStep(store, where, 'Step note', st => { st.deg = Math.max(-28, Math.min(35, Math.round(deg))); }, key, true);

// How hard the step is played (1…127, the MIDI range).
export const setVelocity = (store, where, v) =>
  editStep(store, where, 'Step velocity', st => { st.vel = Math.max(1, Math.min(127, Math.round(v))); });

// How often the step plays at all (0…100 %, only used in More — see compile() in js/engine/engine.js).
export const setChance = (store, where, v) =>
  editStep(store, where, 'Step chance', st => { st.chance = Math.max(0, Math.min(100, Math.round(v))); });

/* Chords (js/chord.js): `chord` = the other notes as scale steps above `deg`. setChord puts a picker shape on (null = one
   note); toggleChordNote adds or removes one note (a scale degree), keeping `deg` the lowest. Each is one Undo step. */
export const setChord = (store, where, chord) =>
  editStep(store, where, 'Step chord', st => { const c = cleanChord(chord); if (c) st.chord = c; else delete st.chord; });

export const toggleChordNote = (store, where, deg) =>
  editStep(store, where, 'Step chord', st => {
    deg = Math.max(-28, Math.min(35 + MAX_ABOVE, Math.round(deg)));
    let ds = stepDegs(st);
    if (ds.includes(deg)){ if (ds.length < 2) return; ds = ds.filter(d => d !== deg); }   // the last note stays (tap the step to switch it off)
    else if (ds.length < MAX_NOTES) ds.push(deg);
    else return;
    ds.sort((a, b) => a - b);
    const root = Math.max(-28, Math.min(35, ds[0])), c = cleanChord(ds.slice(1).map(d => d - root));
    st.deg = root; if (c) st.chord = c; else delete st.chord;
  });
