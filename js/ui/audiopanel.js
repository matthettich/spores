/* js/ui/audiopanel.js: the right-hand panel for an audio track (called from panel.js).
 *
 * Simple: a big Record button (count-in "1 2 3 4", then "Recording… bar 2 of 4"), loop length 1 / 2 / 4 / 8 bars, the
 * input (device, and channel on an interface with more than two), a live level meter, "Hear myself" (off) and Keep going.
 * More: this scene's take: gain, start offset, fade in / out, reverse, remove; and latency with a test dialog.
 * Song changes (loop length, take settings, the take itself) go through store.edit, so Undo works; takes are put in
 * with keepTake (js/takes.js). The input, Hear myself and latency belong to this computer, not the song: they are kept
 * by the engine in localStorage 'spores.rec', like the CV device.
 */
import {el} from './dom.js';
import {ask} from './dialog.js';
import {keepTake, clearTake} from '../takes.js';
import {CLIP_BARS} from '../store.js';
import {inputControls, latencyControls, prow} from './audioinput.js';

export const DEFAULT_LOOP = 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const barsText = n => `${n} bar${n === 1 ? '' : 's'}`;
export const loopOf = t => CLIP_BARS.includes(t.loop) ? t.loop : DEFAULT_LOOP;
let keepGoing = false;   // this page only: each new take replaces the last one (Undo goes back)

export function audioSection(root, {store, engine, state, rec, t, ti, mode, volume}){
  let starting = false;   // between pressing Record and the count-in starting
  const offs = [];                                    // unsubscribe functions, run when the panel is rebuilt
  const sc = () => store.get().scenes[state.scene];
  const clipOf = s => (s.scenes[state.scene] && s.scenes[state.scene].clips || {})[t.id];
  const row = prow;
  const inp0 = inputControls(engine, offs), {err, showErr} = inp0;

  /* ---- Record ---- */
  root.append(el('div', {class: 'psec'}, 'Record'));
  const big = el('button', {class: 'tb bigrec', 'aria-label': 'Record'});
  const line = el('p', {class: 'recline num', role: 'status', 'aria-live': 'polite'});
  const counts = [1, 2, 3, 4].map(n => el('span', {class: 'cnt'}, String(n)));
  const countEl = el('div', {class: 'counts', 'aria-hidden': 'true'}, ...counts);
  root.append(big, countEl, line, err);

  async function startRecording(){
    if (!await inp0.ensureOpen()) return;
    const scene = state.scene, bars = loopOf(store.get().tracks.find(x => x.id === t.id) || t);
    rec.begin({trackId: t.id, scene, bars});
    starting = true; paintRec();
    try { await engine.record({scene, track: t.id, bars, keepGoing, onTake: take => keepTake(store, take)}); }
    catch (e){ showErr(e && e.message || 'Recording didn’t start.'); }
    starting = false; paintRec();
  }
  big.addEventListener('click', () => {
    if (rec.st.phase !== 'idle' || engine.recording){ engine.stopRecording(); return; }
    if (starting) return;
    startRecording();
  });

  /* ---- loop length ---- */
  const segBtns = CLIP_BARS.map(n => el('button', {class: 'tb', 'aria-label': barsText(n), 'aria-pressed': 'false',
    onclick: () => store.edit('Loop length', s => { const x = s.tracks.find(y => y.id === t.id); if (x) x.loop = n; })}, String(n)));
  const loopNote = el('p', {class: 'note'});
  root.append(el('div', {class: 'pseg'}, el('span', {class: 'plabel'}, 'Loop length (bars)'),
    el('div', {class: 'seg', role: 'group', 'aria-label': 'Loop length in bars'}, ...segBtns)), loopNote);

  /* ---- input: device, channel, level, Hear myself (audioinput.js, shared with the Song screen) ---- */
  const keep = el('input', {type: 'checkbox'});
  keep.checked = keepGoing;
  keep.addEventListener('change', () => { keepGoing = keep.checked; });
  root.append(...inp0.nodes,
    el('label', {class: 'checkrow'}, keep, el('span', {}, 'Keep going')),
    el('p', {class: 'note'}, 'Each new take replaces the last one. Undo goes back.'));

  /* ---- Track: Volume and Colour (panel.js) ---- */
  volume();

  /* ---- More: this scene's take and the latency ---- */
  let takeCtl = null;
  if (mode === 'more'){
    root.append(el('div', {class: 'psec'}, 'This scene’s take'));
    const none = el('p', {class: 'note'}, 'No take in this scene yet. Record one to change how it sounds.');
    const edit = (label, fn) => store.edit(label, s => { const c = ((s.scenes[state.scene] || {}).clips || {})[t.id]; if (c) fn(c); });
    // a slider shows its value as it moves and writes one Undo step when let go ('change')
    const slider = (label, min, max, step, get, set, show, editLabel) => {
      const inp = el('input', {type: 'range', min, max, step, 'aria-label': label}), val = el('span', {class: 'pval num'});
      inp.addEventListener('input', () => { val.textContent = show(+inp.value); });
      inp.addEventListener('change', () => edit(editLabel, c => set(c, +inp.value)));
      const r = el('div', {class: 'prow'}, el('span', {class: 'plabel', title: label}, label), inp, val);
      return {r, update(c){ const v = get(c); val.textContent = show(v); if (document.activeElement !== inp) inp.value = v; }};
    };
    const db = g => g > 0 ? 20 * Math.log10(g) : -24, ms = v => `${Math.round(v * 1000)} ms`;
    const S = [
      slider('Gain', -24, 12, 0.5, c => Math.round(clamp(db(c.gain), -24, 12) * 2) / 2, (c, v) => { c.gain = v <= -24 ? 0 : Math.pow(10, v / 20); }, v => `${v > 0 ? '+' : ''}${v} dB`, 'Take gain'),
      slider('Start offset', -250, 250, 1, c => Math.round(c.offset * 1000), (c, v) => { c.offset = v / 1000; }, v => `${v} ms`, 'Take offset'),
      slider('Fade in', 0, 1000, 5, c => Math.round(c.fadeIn * 1000), (c, v) => { c.fadeIn = v / 1000; }, v => `${v} ms`, 'Take fade in'),
      slider('Fade out', 0, 1000, 5, c => Math.round(c.fadeOut * 1000), (c, v) => { c.fadeOut = v / 1000; }, v => `${v} ms`, 'Take fade out'),
    ];
    const rev = el('input', {type: 'checkbox'});
    rev.addEventListener('change', () => edit('Take reverse', c => { c.reverse = rev.checked; }));
    const revRow = el('label', {class: 'checkrow'}, rev, el('span', {}, 'Reverse'));
    const rm = el('button', {class: 'tb', title: 'Take this scene’s recording off the track (Undo brings it back)', onclick: async () => {
      const ok = await ask({title: 'Remove this take?', body: 'The track will be silent in this scene. Undo brings the take back.', yes: 'Remove it', no: 'Keep it'});
      if (ok) clearTake(store, state.scene, t.id);
    }}, 'Remove this take');
    root.append(none, ...S.map(x => x.r), revRow, el('div', {class: 'prow wide'}, el('span'), rm));
    takeCtl = c => { none.hidden = !!c; S.forEach(x => x.r.hidden = !c); revRow.hidden = rm.parentElement.hidden = !c; if (c){ S.forEach(x => x.update(c)); if (document.activeElement !== rev) rev.checked = c.reverse; } };

    root.append(...latencyControls(engine, offs));
  }

  /* ---- keeps the controls honest: song changes, Undo / Redo, recording phases ---- */
  let raf = 0;
  const paintRec = () => {
    const s = rec.st, mine = s.phase !== 'idle' && s.trackId === t.id, busy = s.phase !== 'idle' || starting;
    big.classList.toggle('on', busy); big.textContent = busy ? '■ Stop' : '● Record';
    big.title = busy ? 'Stop recording (this take is thrown away)' : `Record ${barsText(loopOf(store.get().tracks.find(x => x.id === t.id) || t))} from the start of scene ${state.scene}`;
    big.setAttribute('aria-label', busy ? 'Stop recording' : 'Record');
    const w = mine ? rec.where() : null;
    countEl.hidden = !(w && w.beat);
    counts.forEach((c, i) => c.classList.toggle('now', !!(w && w.beat === i + 1)));
    line.textContent = w && w.beat ? 'Count-in… get ready' : w && w.bar ? `Recording… bar ${w.bar} of ${s.bars}${s.n ? ` (take ${w.take})` : ''}`
      : busy ? 'Another track is recording' : '';
    cancelAnimationFrame(raf);
    if (mine) raf = requestAnimationFrame(paintRec);
  };
  const paintSong = song => {
    const tr = song.tracks.find(x => x.id === t.id) || t, loop = loopOf(tr), clip = clipOf(song);
    segBtns.forEach((b, i) => { const on = CLIP_BARS[i] === loop; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    loopNote.hidden = !clip || clip.bars === loop;
    if (clip) loopNote.textContent = `This scene’s take is ${barsText(clip.bars)}. The next one will be ${barsText(loop)}.`;
    if (takeCtl) takeCtl(clip);
    paintRec();
  };
  offs.push(rec.onChange(paintRec));
  paintSong(store.get());
  return {update: paintSong, dispose(){ offs.forEach(f => f()); cancelAnimationFrame(raf); }};
}
