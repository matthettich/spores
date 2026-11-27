/* js/ui/chordui.js: chords on the Steps screen (data: js/chord.js).
 *   chordRow()      the panel's "Chord" picker for the selected note step: None, or a shape built from the song's scale
 *                   (so it stays in key), with the chord's name and notes beside it. One Undo step per pick; it previews.
 *   paintNoteCell() a grid cell of a note step: the root's colour as before; a chord adds a stripe of its other notes'
 *                   colours down the right edge and shows the chord's name.
 * The melody lane's chord dots and Shift-click live in js/ui/melody.js.
 */
import {el} from './dom.js';
import {noteColor, degName, degToMidi, midiName} from '../scale.js';
import {chordShapes, shapeOf, chordName, stepDegs, isChord} from '../chord.js';
import {stepAt, setChord} from './stepedit.js';
import {previewStep} from './preview.js';

const CV_NOTE = 'A CV track has one pitch output, so it plays only the lowest note of a chord.';

/* where(): the selected step ({scene, trackId, index}). Returns {row, paint(song, track)}. */
export function chordRow({store, engine, where, t}){
  const sel = el('select', {'aria-label': 'Chord', title: 'Play several notes on this step, built from the song’s scale'});
  const name = el('span', {class: 'pval chordname'}, '');
  const help = el('p', {class: 'note small'},
    'Shift-click the melody lane to add or remove a note (up to 4).' + (t.type === 'cv' ? ' ' + CV_NOTE : ''));
  const row = el('div', {class: 'chordsec'}, el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Chord'), sel), name, help);
  let shapes = [];
  sel.addEventListener('change', () => {
    const w = where(), v = sel.value;
    if (v === 'custom') return;
    const sh = shapes.find(x => x.id === v);
    setChord(store, w, sh ? sh.c : null);
    previewStep(engine, store, w);
  });
  const paint = (song, tr) => {
    const st = stepAt(song, where());
    row.hidden = !st || !st.on || tr.type === 'drum';
    if (row.hidden) return;
    const next = chordShapes(song.scale), cur = shapeOf(st, song.scale);
    if (next !== shapes || sel.options.length !== next.length + (cur === 'custom' ? 2 : 1)){
      shapes = next; sel.innerHTML = '';
      sel.append(el('option', {value: 'none'}, 'None (one note)'));
      for (const sh of shapes) sel.append(el('option', {value: sh.id}, sh.name));
      if (cur === 'custom') sel.append(el('option', {value: 'custom', disabled: true}, 'Your own notes'));
    }
    if (document.activeElement !== sel || sel.value !== cur) sel.value = cur;
    const notes = stepDegs(st).map(d => midiName(degToMidi(d, song.key, song.scale, tr.oct ?? 3)));
    const nm = isChord(st) ? chordName(st, song.key, song.scale) : '';
    name.textContent = isChord(st) ? (nm ? nm + ' · ' : '') + notes.join(' ') : '';
  };
  return {row, paint};
}

/* A note step's grid cell (steps.js paintGrid): text and colours. --top / --bottom are the root's (as before); a chord
   also sets --n1..--n3 (its other notes, low to high) for the stripe in css/app.css (.cell.chord). */
export function paintNoteCell(b, st, s){
  const c = noteColor(st.deg || 0, s.scale);
  b.style.setProperty('--top', c.top);
  b.style.setProperty('--bottom', c.bottom);
  b.style.setProperty('--txt', c.text);
  const ch = isChord(st);
  b.classList.toggle('chord', ch);
  if (!ch){
    for (const k of ['--n1', '--n2', '--n3']) b.style.removeProperty(k);
    b.textContent = degName(st.deg || 0, s.key, s.scale);
    return;
  }
  const ds = stepDegs(st).slice(1);
  ['--n1', '--n2', '--n3'].forEach((k, i) => b.style.setProperty(k, noteColor(ds[Math.min(i, ds.length - 1)], s.scale).top));
  b.textContent = chordName(st, s.key, s.scale) || degName(st.deg || 0, s.key, s.scale) + '+';
  b.title = `Chord: ${stepDegs(st).map(d => degName(d, s.key, s.scale)).join(' ')}` + (b.title ? ' · ' + b.title : '');
}
