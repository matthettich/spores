/* js/ui/notedrag.js: moving a note step by hand — drag it up or down, or press ↑ / ↓ while it is selected.
 *
 * Notes are stored as scale degrees (`deg`, see js/scale.js), so "one step" is the next note of the song's scale: a
 * semitone in the Chromatic scale, a tone or so in the others (the note always stays in key). Shift+arrow moves one
 * octave = the scale's note count. Every move previews (js/ui/preview.js) and goes through store.edit, so it can be undone;
 * one whole drag is ONE Undo step (a drag-specific merge key; the store merges them whatever the pauses).
 */
import {scaleOf} from '../scale.js';
import {stepAt, nudgeNote, setNoteDeg} from './stepedit.js';
import {previewStep} from './preview.js';

const PX = 14, START = 8;   // pixels per scale step; how far to move before it counts as a drag (a tap still toggles)
let dragNo = 0;
const isNote = (store, where) => { const st = where && stepAt(store.get(), where); return !!(st && st.on); };

/* where(): {scene, trackId, index} of this cell, or null for a drum / audio cell. Returns {wasDrag()}: true once after a
   drag, so the cell's click (which toggles the step) can skip itself. onStart() runs when the drag begins. */
export function attachNoteDrag(b, {store, engine, where, onStart}){
  let d = null, was = false;
  b.addEventListener('pointerdown', e => {
    was = false;
    const w = where();
    if (e.button !== 0 || !isNote(store, w)) { d = null; return; }
    d = {id: e.pointerId, y: e.clientY, w, deg: stepAt(store.get(), w).deg || 0, on: false, last: null};
    try { b.setPointerCapture(e.pointerId); } catch (err) {}   // the pointer may leave the 44 px cell while dragging
  });
  b.addEventListener('pointermove', e => {
    if (!d || e.pointerId !== d.id) return;
    const dy = d.y - e.clientY;
    if (!d.on){
      if (Math.abs(dy) < START) return;
      d.on = was = true;
      if (onStart) onStart();
      d.key = `${d.w.scene}:${d.w.trackId}:${d.w.index}:drag${++dragNo}`;
    }
    const deg = Math.max(-28, Math.min(35, d.deg + Math.round(dy / PX)));
    if (deg === d.last) return;
    d.last = deg;
    setNoteDeg(store, d.w, deg, d.key);
    previewStep(engine, store, d.w);
  });
  const end = e => { if (d && e.pointerId === d.id) d = null; };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  return {wasDrag(){ const v = was; was = false; return v; }};
}

/* ↑ / ↓ on the selected note step (Shift = octave). `current()` gives {where, song} or null (no note selected / not on the
   Steps screen). Typing fields, lists, menus and dialogs keep their own arrow keys. */
export function mountNoteKeys({store, engine, current}){
  window.addEventListener('keydown', e => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable || (t.closest && t.closest('.menu, .dialog, [role=menu], [role=dialog]')))) return;
    const where = current();
    if (!where || !isNote(store, where)) return;
    e.preventDefault();
    const song = store.get(), n = scaleOf(song.scale).iv.length;
    nudgeNote(store, where, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? n : 1));
    previewStep(engine, store, where);
  });
}
