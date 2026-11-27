/* js/ui/songmore.js: the "More" controls of a song-length audio track on the Song screen (called from songlane.js):
 * where the take starts (whole bars, − / +), trim start / end, fades, gain, Remove this take, then the shared input
 * picker / level meter / Hear myself (audioinput.js) and latency. Every song change is one store.edit (Undo works);
 * sliders write when let go. The input and latency belong to this computer, not the song.
 *   const m = moreControls({store, engine, id, offs, inp, mapOf}) → {nodes, update(track)}
 */
import {el} from './dom.js';
import {ask} from './dialog.js';
import {isSongTrack} from '../store.js';
import {clearSongTake} from '../takes.js';
import {peaksFor} from './peaks.js';
import {latencyControls} from './audioinput.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function moreControls({store, engine, id, offs, inp, mapOf}){
  const edit = (label, fn) => store.edit(label, s => { const t = s.tracks.find(x => x.id === id); if (isSongTrack(t) && t.take) fn(t.take); });
  const none = el('p', {class: 'note'}, 'No take yet. Record one to change where it starts and how it sounds.');
  const bar = el('span', {class: 'sblk-rep num', title: 'The bar of the song where the take begins'});
  const less = el('button', {class: 'tb', 'aria-label': 'Start one bar earlier', onclick: () => move(-1)}, '−');
  const more = el('button', {class: 'tb', 'aria-label': 'Start one bar later', onclick: () => move(1)}, '+');
  const startRow = el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Start bar'),
    el('div', {class: 'seg stepper'}, less, bar, more));
  function move(d){
    edit('Take start bar', c => { c.startBar = clamp((c.startBar | 0) + d, 0, Math.max(0, mapOf().totalBars - 1)); });
  }
  // a slider shows its value as it moves and writes one Undo step when let go
  const slider = (label, min, max, step, get, set, show, editLabel) => {
    const r = el('input', {type: 'range', min, max, step, 'aria-label': label}), val = el('span', {class: 'pval num'});
    r.addEventListener('input', () => { val.textContent = show(+r.value); });
    r.addEventListener('change', () => edit(editLabel, c => set(c, +r.value)));
    const row = el('div', {class: 'prow'}, el('span', {class: 'plabel', title: label}, label), r, val);
    return {row, r, update(c){ const v = get(c); r.max = typeof max === 'function' ? max(c) : max; val.textContent = show(v); if (document.activeElement !== r) r.value = v; }};
  };
  const lenOf = c => { const pk = peaksFor(c.id); return pk ? pk.length / (pk.sr || c.sr || 48000) : 60; };
  const db = g => g > 0 ? 20 * Math.log10(g) : -24, ms = v => `${Math.round(v * 1000)} ms`, sec = v => `${(+v).toFixed(2)} s`;
  const S = [
    slider('Trim start', 0, c => lenOf(c), 0.05, c => c.trimStart || 0, (c, v) => { c.trimStart = Math.min(v, Math.max(0, lenOf(c) - (c.trimEnd || 0) - 0.05)); }, sec, 'Take trim start'),
    slider('Trim end', 0, c => lenOf(c), 0.05, c => c.trimEnd || 0, (c, v) => { c.trimEnd = Math.min(v, Math.max(0, lenOf(c) - (c.trimStart || 0) - 0.05)); }, sec, 'Take trim end'),
    slider('Fade in', 0, 2000, 5, c => Math.round(c.fadeIn * 1000), (c, v) => { c.fadeIn = v / 1000; }, v => `${v} ms`, 'Take fade in'),
    slider('Fade out', 0, 2000, 5, c => Math.round(c.fadeOut * 1000), (c, v) => { c.fadeOut = v / 1000; }, v => `${v} ms`, 'Take fade out'),
    slider('Gain', -24, 12, 0.5, c => Math.round(clamp(db(c.gain), -24, 12) * 2) / 2, (c, v) => { c.gain = v <= -24 ? 0 : Math.pow(10, v / 20); }, v => `${v > 0 ? '+' : ''}${v} dB`, 'Take gain'),
  ];
  const rm = el('button', {class: 'tb', title: 'Take the recording off this track (Undo brings it back)', onclick: async () => {
    const ok = await ask({title: 'Remove this take?', body: 'The track will be silent. Undo brings the take back.', yes: 'Remove it', no: 'Keep it'});
    if (ok) clearSongTake(store, id);
  }}, 'Remove this take');
  const rmRow = el('div', {class: 'prow wide'}, el('span'), rm);
  const nodes = [el('div', {class: 'psec'}, 'This take'), none, startRow, ...S.map(x => x.row), rmRow, ...inp.nodes, ...latencyControls(engine, offs)];
  return {nodes, update(t){
    const c = t && t.take;
    none.hidden = !!c;
    startRow.hidden = rmRow.hidden = !c; S.forEach(x => x.row.hidden = !c);
    if (!c) return;
    bar.textContent = `Bar ${(c.startBar | 0) + 1}`;
    less.disabled = c.startBar <= 0; more.disabled = c.startBar >= Math.max(0, mapOf().totalBars - 1);
    S.forEach(x => x.update(c));
  }};
}
