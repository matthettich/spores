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
import {openLatencyTest} from './audiolatency.js';

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
  const row = (label, ...kids) => el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, label), ...kids);
  const err = el('p', {class: 'note errnote', role: 'alert', hidden: true});
  const showErr = m => { err.textContent = m || ''; err.hidden = !m; };

  /* ---- Record ---- */
  root.append(el('div', {class: 'psec'}, 'Record'));
  const big = el('button', {class: 'tb bigrec', 'aria-label': 'Record'});
  const line = el('p', {class: 'recline num', role: 'status', 'aria-live': 'polite'});
  const counts = [1, 2, 3, 4].map(n => el('span', {class: 'cnt'}, String(n)));
  const countEl = el('div', {class: 'counts', 'aria-hidden': 'true'}, ...counts);
  root.append(big, countEl, line, err);

  async function startRecording(){
    showErr('');
    if (!engine.input.open){
      const r = await engine.openInput({});
      if (!r.ok){ showErr(inputProblem(r.error)); refreshInput(); return; }
      refreshInput();
    }
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

  /* ---- input: device, channel, level, Hear myself ---- */
  root.append(el('div', {class: 'psec'}, 'Input'));
  const devSel = el('select', {'aria-label': 'Input device'});
  const chSel = el('select', {'aria-label': 'Input channel'});
  const chRow = row('Channel', chSel);
  const onBtn = el('button', {class: 'tb', onclick: async () => { showErr(''); const r = await engine.openInput({}); if (!r.ok) showErr(inputProblem(r.error)); refreshInput(); }}, 'Turn on the microphone');
  const offNote = el('p', {class: 'note'}, 'The microphone is off. Turn it on to see the level; Record turns it on too.');
  const fill = el('i', {class: 'mfill'}), meter = el('div', {class: 'meter', role: 'img', 'aria-label': 'Input level'}, fill);
  const hear = el('input', {type: 'checkbox'});
  hear.checked = engine.monitor;
  hear.addEventListener('change', () => engine.setMonitor(hear.checked));
  const keep = el('input', {type: 'checkbox'});
  keep.checked = keepGoing;
  keep.addEventListener('change', () => { keepGoing = keep.checked; });
  const onRow = el('div', {class: 'prow wide'}, el('span'), onBtn);
  root.append(row('Device', devSel), chRow, offNote, onRow, row('Level', meter),
    el('label', {class: 'checkrow'}, hear, el('span', {}, 'Hear myself')),
    el('p', {class: 'note'}, 'Wear headphones so the speakers don’t get recorded.'),
    el('label', {class: 'checkrow'}, keep, el('span', {}, 'Keep going')),
    el('p', {class: 'note'}, 'Each new take replaces the last one. Undo goes back.'));

  async function refreshInput(){
    const inp = engine.input, list = await engine.audioInputs();
    devSel.replaceChildren(el('option', {value: ''}, 'Default input'),
      ...list.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map(d => el('option', {value: d.deviceId}, d.label)));
    if (inp.deviceId && ![...devSel.options].some(o => o.value === inp.deviceId)) devSel.append(el('option', {value: inp.deviceId}, 'Saved input'));
    devSel.value = inp.deviceId || '';
    const n = inp.open ? inp.channels : 0;
    chRow.hidden = !(n > 2);
    chSel.replaceChildren(...Array.from({length: n > 2 ? n : 0}, (_, i) => el('option', {value: String(i + 1)}, `Input ${i + 1}`)));
    chSel.value = String(inp.channel || 1);
    onRow.hidden = offNote.hidden = inp.open;
    if (!inp.open) fill.style.transform = 'scaleX(1)';
  }
  devSel.addEventListener('change', async () => { showErr(''); const r = await engine.openInput({deviceId: devSel.value, channel: 1}); if (!r.ok) showErr(inputProblem(r.error)); refreshInput(); });
  chSel.addEventListener('change', async () => { const r = await engine.openInput({channel: +chSel.value, deviceId: engine.input.deviceId}); if (!r.ok) showErr(inputProblem(r.error)); refreshInput(); });
  offs.push(engine.on('input', () => refreshInput()));
  let shown = 0;
  offs.push(engine.on('level', m => {   // dB scale: -60 dB (nothing) … 0 dB (full); rises at once, falls a little slower; the cover hides the part above
    const now = m.peak > 0 ? clamp((20 * Math.log10(m.peak) + 60) / 60, 0, 1) : 0;
    const v = shown = Math.max(now, shown * 0.9);
    fill.style.transform = `scaleX(${(1 - v).toFixed(3)})`;
    meter.classList.toggle('clip', !!m.clip);
  }));
  refreshInput();
  // permission already given: show the level straight away, no prompt
  if (!engine.input.open && navigator.permissions && navigator.permissions.query)
    navigator.permissions.query({name: 'microphone'}).then(p => { if (p.state === 'granted' && !engine.input.open && big.isConnected) engine.openInput({}).then(refreshInput); }).catch(() => {});

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

    root.append(el('div', {class: 'psec'}, 'Latency'));
    const latVal = el('p', {class: 'note num'}), adj = el('input', {type: 'number', step: 1, min: -500, max: 1000, 'aria-label': 'Latency adjustment in milliseconds'});
    adj.addEventListener('change', () => { engine.setLatencyOffset(+adj.value || 0); paintLat(); });
    const paintLat = () => { const l = engine.latency; latVal.textContent = `Latency: ${l.totalMs.toFixed(1)} ms (the browser says ${l.reportedMs.toFixed(1)} ms, adjusted by ${l.offsetMs.toFixed(1)} ms). New takes are moved earlier by this much.`; if (document.activeElement !== adj) adj.value = String(Math.round(l.offsetMs * 10) / 10); };
    root.append(latVal, row('Adjust (ms)', adj),
      el('div', {class: 'prow wide'}, el('span'), el('button', {class: 'tb', onclick: () => openLatencyTest(engine, paintLat)}, 'Test latency…')),
      el('p', {class: 'note'}, 'Takes land late? Test latency, or nudge Adjust: a bigger number moves new takes earlier. This is kept for this computer.'));
    paintLat(); offs.push(engine.on('input', paintLat));
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

// plain words for what went wrong opening the input
function inputProblem(e){
  const m = String(e || '');
  if (/permission/i.test(m)) return 'Recording needs permission to use the microphone. Click the lock icon in the address bar, allow the microphone, then press Record again.';
  return `${m || 'Couldn’t open an audio input.'} Check that a microphone is plugged in and chosen above.`;
}
