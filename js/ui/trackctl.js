/* js/ui/trackctl.js: rename and delete a track. Both go through store.edit, so Undo brings them back, and both use the
   shared dialogs in dialog.js (delete asks first, with the safe answer focused). */
import {ask, openDialog} from './dialog.js';
import {el} from './dom.js';

export const NAME_MAX = 24;

// the name a typed value turns into: trimmed, at most NAME_MAX characters, empty = keep the old one
export const cleanName = (typed, old) => String(typed || '').trim().slice(0, NAME_MAX) || old;

export function renameTrack(store, trackId){
  const t = store.get().tracks.find(x => x.id === trackId);
  if (!t) return;
  const inp = el('input', {type: 'text', maxlength: String(NAME_MAX), value: t.name || '', 'aria-label': 'Track name'});
  const dlg = openDialog({
    title: 'Rename track',
    body: `Up to ${NAME_MAX} letters. Leave it empty to keep “${t.name}”.`,
    content: [el('label', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Name'), inp)],
    actions: [{label: 'Keep the name'}, {label: 'Rename', primary: true, onClick: () => {
      const name = cleanName(inp.value, t.name);
      store.edit('Rename track', s => { const x = s.tracks.find(y => y.id === trackId); if (x) x.name = name; });
    }}],
    focus: inp,
  });
  inp.select();
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); dlg.root.querySelector('.dacts .tb.on').click(); }
  });
}

/* Ask, then remove the track and its steps from every scene in one edit. state.track moves to the next track (or the
   one before, if this was the last) before the edit, so every screen redraws on a valid selection. */
export async function deleteTrack(store, state, trackId){
  const song = store.get();
  const ti = song.tracks.findIndex(x => x.id === trackId);
  if (ti < 0 || song.tracks.length < 2) return false;
  const name = song.tracks[ti].name || 'this track';
  const ok = await ask({title: `Delete ${name}?`,
    body: `${name} and its steps and takes go. Undo brings it back.`, yes: `Delete ${name}`, no: 'Keep it'});
  if (!ok) return false;
  const cur = store.get();
  const i = cur.tracks.findIndex(x => x.id === trackId);
  if (i < 0 || cur.tracks.length < 2) return false;
  state.track = Math.min(i, cur.tracks.length - 2); state.step = null;
  store.edit('Delete track', s => {
    s.tracks.splice(i, 1);
    for (const sc of Object.values(s.scenes)){ if (sc.steps) delete sc.steps[trackId]; if (sc.clips) delete sc.clips[trackId]; }
  });
  return true;
}
