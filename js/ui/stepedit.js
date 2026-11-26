/* js/ui/stepedit.js: reading and changing one step of a scene (the grid, the melody lane and the panel share these).
 * Every change goes through store.edit(label, fn), so it is undoable and saved like any other song change.
 */
export function stepAt(song, {scene, trackId, index}){
  const sc = song.scenes && song.scenes[scene];
  const lane = sc && sc.steps && sc.steps[trackId];
  return lane ? lane[index] : null;
}

function editStep(store, where, label, fn){
  store.edit(label, song => {
    const sc = song.scenes[where.scene];
    const lane = sc && sc.steps && sc.steps[where.trackId];
    const st = lane && lane[where.index];
    if (st && st.on) fn(st, song);
  });
}

/* Move a note up or down the scale (deg is in scale steps, so it stays in key). */
export const nudgeNote = (store, where, by) =>
  editStep(store, where, 'Step note', st => { st.deg = Math.max(-28, Math.min(35, Math.round(st.deg || 0) + by)); });
