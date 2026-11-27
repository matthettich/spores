/* js/ui/audioinput.js: the recording input controls shared by every audio track screen (the Steps panel in
 * audiopanel.js and the Song screen's lane in songlane.js): input device, channel (only on an interface with more than
 * two), a live level meter, "Hear myself", and the latency value with its test. These belong to this computer (the
 * engine keeps them in localStorage 'spores.rec'), not to the song, so none of it is an Undo step.
 *
 *   const inp = inputControls(engine, offs)   offs: an array; unsubscribe functions are pushed on it
 *   inp.nodes → elements to append (heading "Input", device, channel, level, Hear myself, headphones note)
 *   inp.err   → the (hidden until needed) error line; inp.showErr(text)
 *   await inp.ensureOpen() → true when the input is open (opens it; shows the plain-English problem if it can't)
 *   inp.refresh()           redraw the device list / channel / meter after the input changed
 *   latencyControls(engine, offs) → elements for the latency value, Adjust and Test latency…
 */
import {el} from './dom.js';
import {openLatencyTest} from './audiolatency.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const prow = (label, ...kids) => el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, label), ...kids);

// plain words for what went wrong opening the input
export function inputProblem(e){
  const m = String(e || '');
  if (/permission/i.test(m)) return 'Recording needs permission to use the microphone. Click the lock icon in the address bar, allow the microphone, then press Record again.';
  return `${m || 'Couldn’t open an audio input.'} Check that a microphone is plugged in and chosen above.`;
}

export function inputControls(engine, offs){
  const err = el('p', {class: 'note errnote', role: 'alert', hidden: true});
  const showErr = m => { err.textContent = m || ''; err.hidden = !m; };
  const devSel = el('select', {'aria-label': 'Input device'});
  const chSel = el('select', {'aria-label': 'Input channel'});
  const chRow = prow('Channel', chSel);
  const offNote = el('p', {class: 'note'}, 'The microphone is off. Turn it on to see the level; Record turns it on too.');
  const onBtn = el('button', {class: 'tb', onclick: () => ensureOpen()}, 'Turn on the microphone');
  const onRow = el('div', {class: 'prow wide'}, el('span'), onBtn);
  const fill = el('i', {class: 'mfill'}), meter = el('div', {class: 'meter', role: 'img', 'aria-label': 'Input level'}, fill);
  const hear = el('input', {type: 'checkbox'});
  hear.checked = engine.monitor;
  hear.addEventListener('change', () => engine.setMonitor(hear.checked));
  const nodes = [el('div', {class: 'psec'}, 'Input'), prow('Device', devSel), chRow, offNote, onRow, prow('Level', meter),
    el('label', {class: 'checkrow'}, hear, el('span', {}, 'Hear myself')),
    el('p', {class: 'note'}, 'Wear headphones so the speakers don’t get recorded.')];

  async function refresh(){
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
    hear.checked = engine.monitor;
    if (!inp.open){ fill.style.transform = 'scaleX(1)'; meter.classList.remove('clip'); }
  }
  async function ensureOpen(opts = {}){
    showErr('');
    if (engine.input.open && !opts.force){ return true; }
    const r = await engine.openInput(opts.args || {});
    if (!r.ok) showErr(inputProblem(r.error));
    refresh();
    return !!r.ok;
  }
  devSel.addEventListener('change', async () => { showErr(''); const r = await engine.openInput({deviceId: devSel.value, channel: 1}); if (!r.ok) showErr(inputProblem(r.error)); refresh(); });
  chSel.addEventListener('change', async () => { const r = await engine.openInput({channel: +chSel.value, deviceId: engine.input.deviceId}); if (!r.ok) showErr(inputProblem(r.error)); refresh(); });
  offs.push(engine.on('input', () => refresh()));
  let shown = 0;
  offs.push(engine.on('level', m => {   // dB scale: -60 dB (nothing) … 0 dB (full); rises at once, falls a little slower; the cover hides the part above
    const now = m.peak > 0 ? clamp((20 * Math.log10(m.peak) + 60) / 60, 0, 1) : 0;
    const v = shown = Math.max(now, shown * 0.9);
    fill.style.transform = `scaleX(${(1 - v).toFixed(3)})`;
    meter.classList.toggle('clip', !!m.clip);
  }));
  refresh();
  // permission already given: show the level straight away, no prompt
  if (!engine.input.open && navigator.permissions && navigator.permissions.query)
    navigator.permissions.query({name: 'microphone'}).then(p => { if (p.state === 'granted' && !engine.input.open && meter.isConnected) engine.openInput({}).then(refresh); }).catch(() => {});
  return {nodes, err, showErr, ensureOpen, refresh};
}

export function latencyControls(engine, offs){
  const latVal = el('p', {class: 'note num'}), adj = el('input', {type: 'number', step: 1, min: -500, max: 1000, 'aria-label': 'Latency adjustment in milliseconds'});
  adj.addEventListener('change', () => { engine.setLatencyOffset(+adj.value || 0); paint(); });
  const paint = () => { const l = engine.latency; latVal.textContent = `Latency: ${l.totalMs.toFixed(1)} ms (the browser says ${l.reportedMs.toFixed(1)} ms, adjusted by ${l.offsetMs.toFixed(1)} ms). New takes are moved earlier by this much.`; if (document.activeElement !== adj) adj.value = String(Math.round(l.offsetMs * 10) / 10); };
  paint(); offs.push(engine.on('input', paint));
  return [el('div', {class: 'psec'}, 'Latency'), latVal, prow('Adjust (ms)', adj),
    el('div', {class: 'prow wide'}, el('span'), el('button', {class: 'tb', onclick: () => openLatencyTest(engine, paint)}, 'Test latency…')),
    el('p', {class: 'note'}, 'Takes land late? Test latency, or nudge Adjust: a bigger number moves new takes earlier. This is kept for this computer.')];
}
