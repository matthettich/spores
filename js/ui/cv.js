/* js/ui/cv.js: a CV track's panel section, and the Tune CV… and Test outputs… dialogs. (Phase 7, Claude.)
 *
 * Per track (in the song): pitch and gate output channels, and its tuning (track.cv.cal). Per computer (localStorage
 * 'spores.cv', not in the song): which output device CV leaves through, and its volts at full scale.
 * The voltage maths, the pitch detector and the tuning run are in js/engine/cv.js.
 */
import {el} from './dom.js';
import {openDialog, ask, toast} from './dialog.js';
import {runTune, detectHz, gateValue, DEFAULT_FS} from '../engine/cv.js';

const KEY = 'spores.cv';
export function cvSettings(){ try { return Object.assign({device: '', fs: DEFAULT_FS}, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return {device: '', fs: DEFAULT_FS}; } }
function saveSettings(o){ try { localStorage.setItem(KEY, JSON.stringify(Object.assign(cvSettings(), o))); } catch (e) {} }

// start-up: put the saved output device and scale back
export async function applyCvSettings(engine){
  const c = cvSettings();
  engine.setCvScale(c.fs);
  if (c.device) await engine.setOutputDevice(c.device);
}

async function devices(kind){ try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === kind); } catch (e) { return []; } }
const chanOptions = (sel, n, cur) => {
  sel.innerHTML = '';
  for (let i = 1; i <= Math.max(n, cur || 0); i++) sel.append(el('option', {value: String(i)}, `Output ${i}` + (i > n ? ' (missing)' : i <= 2 ? ' (music)' : '')));
  sel.value = String(cur);
};

// one 'devicechange' listener at a time: the panel rebuilds this section on every selection, and each old
// listener would otherwise stay attached to a select that is no longer on screen
let onDeviceChange = null;

/* The panel section. Returns an updater (Undo / Redo keep the controls honest). */
export function cvSection(root, {store, engine, t, ti, mode}){
  root.append(el('div', {class: 'psec'}, 'CV outputs'));

  const dev = el('select', {'aria-label': 'Output device for CV'});
  const fillDevices = async () => {
    const outs = await devices('audiooutput'), cur = cvSettings().device;
    dev.innerHTML = '';
    dev.append(el('option', {value: ''}, 'This computer’s default output'));
    outs.filter(d => d.deviceId && d.deviceId !== 'default').forEach((d, i) => dev.append(el('option', {value: d.deviceId}, d.label || `Output device ${i + 1}`)));
    if (cur && ![...dev.options].some(o => o.value === cur)) dev.append(el('option', {value: cur}, 'Saved device (not plugged in)'));
    dev.value = cur;
  };
  dev.addEventListener('change', async () => {
    const ok = await engine.setOutputDevice(dev.value);
    if (!ok && dev.value) toast('This browser can’t choose an output device (Chrome can).');
    saveSettings({device: dev.value}); fillChannels(); warn();
  });
  fillDevices();
  const md = navigator.mediaDevices;
  if (md && md.addEventListener){
    if (onDeviceChange) md.removeEventListener('devicechange', onDeviceChange);
    onDeviceChange = fillDevices;
    md.addEventListener('devicechange', onDeviceChange);
  }
  root.append(el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Device'), dev));

  const pitch = el('select', {'aria-label': 'Pitch output'}), gate = el('select', {'aria-label': 'Gate output'});
  // read the track fresh: after an Undo the song is a new copy, and `t` is the old one
  const fillChannels = () => {
    const tr = store.get().tracks[ti] || t, n = engine.outputChannels;
    chanOptions(pitch, n, tr.cv.pitch || 3); chanOptions(gate, n, tr.cv.gate || 4);
  };
  fillChannels();
  pitch.addEventListener('change', () => store.edit('CV pitch output', s => { s.tracks[ti].cv.pitch = +pitch.value; }));
  gate.addEventListener('change', () => store.edit('CV gate output', s => { s.tracks[ti].cv.gate = +gate.value; }));
  root.append(el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Pitch'), pitch),
    el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Gate'), gate));

  const warning = el('p', {class: 'note'});
  const warn = () => {
    const tr = store.get().tracks[ti], n = engine.outputChannels, w = [];
    if (tr.cv.pitch === tr.cv.gate) w.push('Pitch and gate are on the same output.');
    if (tr.cv.pitch <= 2 || tr.cv.gate <= 2) w.push('Outputs 1–2 carry the music too: CV there goes to your speakers. Pick 3 or higher.');
    if (Math.max(tr.cv.pitch, tr.cv.gate) > n) w.push(`This device has ${n} outputs, so CV on a higher one goes nowhere.`);
    warning.textContent = w.join(' '); warning.hidden = !w.length;
  };
  warn(); root.append(warning);

  if (mode === 'more'){
    const fs = el('input', {type: 'number', min: '1', max: '30', step: '0.1', class: 'num', 'aria-label': 'Volts at full scale', value: String(cvSettings().fs)});
    fs.addEventListener('change', () => { const v = Math.max(1, Math.min(30, +fs.value || DEFAULT_FS)); fs.value = String(v); saveSettings({fs: v}); engine.setCvScale(v); });
    root.append(el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Volts at full scale'), fs),
      el('p', {class: 'note'}, 'How many volts the interface puts out at full level. Expert Sleepers ES-8 / ES-9: 10. Tuning makes this matter less.'));
  }

  const status = el('p', {class: 'note'});
  const showStatus = tr => {
    const c = tr.cv.cal;
    status.textContent = c ? `Tuned ${c.at || ''}: ${c.perVolt ? c.perVolt.toFixed(3) + ' octaves per volt' : ''}${c.dc === false ? ' · outputs may be AC-coupled' : ''}.`
      : 'Not tuned yet: notes go out at 1 V per octave, the track’s root C at 0 V.';
  };
  showStatus(t); root.append(status);
  const forget = el('button', {class: 'tb', onclick: async () => {
    if (await ask({title: 'Forget this tuning?', body: 'Notes go back to plain 1 V per octave. Undo brings the tuning back.', yes: 'Forget it'}))
      store.edit('Forget CV tuning', s => { s.tracks[ti].cv.cal = null; });
  }}, 'Forget tuning');
  forget.hidden = !t.cv.cal;
  root.append(el('div', {class: 'sndrow'},
    el('button', {class: 'tb', onclick: () => tuneDialog({store, engine, ti})}, 'Tune CV…'),
    el('button', {class: 'tb', onclick: () => testDialog({store, engine, ti})}, 'Test outputs…'), forget));

  return (s, tr) => {
    if (document.activeElement !== pitch) pitch.value = String(tr.cv.pitch || 3);
    if (document.activeElement !== gate) gate.value = String(tr.cv.gate || 4);
    showStatus(tr); forget.hidden = !tr.cv.cal; warn();
  };
}

/* ---- Test outputs: hold a voltage, for a multimeter, a module's LED, or the DC check by eye ---- */
function testDialog({store, engine, ti}){
  const tr = store.get().tracks[ti], P = tr.cv.pitch - 1, G = tr.cv.gate - 1, fs = cvSettings().fs;
  if (engine.playing) engine.stop();
  const said = el('p', {class: 'note'}, 'Nothing held.');
  const hold = (label, ch, volts) => el('button', {class: 'tb', onclick: () => { engine.cvHold(ch, volts / fs); said.textContent = `Holding ${label}.`; }}, label);
  openDialog({title: 'Test the CV outputs',
    body: 'Holds a steady voltage so you can check it with a multimeter or a module. Hold +5 V on the pitch output: if it reads about 5 V and stays there, the outputs are DC-coupled and CV will work. If it jumps and then sinks back to 0 V within a second, they are AC-coupled.',
    content: [
      el('div', {class: 'psec'}, `Pitch (output ${P + 1})`),
      el('div', {class: 'sndrow'}, hold('0 V', P, 0), hold('+1 V', P, 1), hold('+5 V', P, 5)),
      el('div', {class: 'psec'}, `Gate (output ${G + 1})`),
      el('div', {class: 'sndrow'}, hold('Gate open (+5 V)', G, 5), hold('Gate closed', G, 0)),
      said],
    actions: [{label: 'Done', primary: true}],
    onClose: () => { engine.cvHold(P, null); engine.cvHold(G, null); }});
}

/* ---- Tune CV: oscillator out → an interface input; Spores steps the pitch output and listens ---- */
function tuneDialog({store, engine, ti}){
  const tr = store.get().tracks[ti], P = tr.cv.pitch - 1, G = tr.cv.gate - 1, fs = cvSettings().fs;
  if (engine.playing) engine.stop();
  let stream = null, nodes = [], running = false, stop = false, result = null;
  const input = el('select', {'aria-label': 'Input the oscillator comes in on'}), chan = el('select', {'aria-label': 'Input channel'});
  const msg = el('p', {class: 'note'}, ''), bar = el('progress', {max: '1', value: '0', style: {width: '100%'}});
  const table = el('div', {class: 'note'});
  const start = el('button', {class: 'tb on'}, 'Start tuning'), save = el('button', {class: 'tb on'}, 'Save this tuning');
  save.hidden = true;

  async function openInput(){
    if (stream) stream.getTracks().forEach(x => x.stop());
    stream = await navigator.mediaDevices.getUserMedia({audio: {deviceId: input.value ? {exact: input.value} : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: {ideal: 32}}});
    const n = (stream.getAudioTracks()[0].getSettings().channelCount) || 2, cur = +chan.value || 1;
    chan.innerHTML = ''; for (let i = 1; i <= n; i++) chan.append(el('option', {value: String(i)}, 'Input ' + i));
    chan.value = String(Math.min(cur, n));
  }
  async function fillInputs(){
    try { if (!stream) await openInput(); } catch (e) { msg.textContent = 'Spores needs the microphone permission to hear the oscillator. Allow it, then try again.'; return; }
    const ins = await devices('audioinput'), cur = input.value;
    input.innerHTML = ''; input.append(el('option', {value: ''}, 'Default input'));
    ins.filter(d => d.deviceId && d.deviceId !== 'default').forEach((d, i) => input.append(el('option', {value: d.deviceId}, d.label || `Input ${i + 1}`)));
    input.value = cur;
  }
  input.addEventListener('change', () => openInput().catch(e => { msg.textContent = 'That input could not be opened: ' + e.message; }));

  // listen to one channel of the input
  function listener(){
    const ctx = engine.ctx, src = ctx.createMediaStreamSource(stream), n = src.channelCount || 2;
    const split = ctx.createChannelSplitter(Math.max(2, n)), an = ctx.createAnalyser(); an.fftSize = 8192;
    src.connect(split); split.connect(an, Math.min((+chan.value || 1) - 1, Math.max(2, n) - 1));
    nodes = [src, split, an];
    const buf = new Float32Array(an.fftSize);
    return () => { an.getFloatTimeDomainData(buf); const r = detectHz(buf, ctx.sampleRate); return Promise.resolve(r && r.clarity > 0.6 ? r.hz : null); };
  }

  start.addEventListener('click', async () => {
    if (running){ stop = true; return; }
    try { if (!stream) await openInput(); } catch (e) { msg.textContent = 'Spores needs the microphone permission to hear the oscillator.'; return; }
    if (engine.ctx.state !== 'running') await engine.ctx.resume();
    running = true; stop = false; save.hidden = true; table.textContent = ''; start.textContent = 'Stop';
    const measure = listener();
    engine.cvHold(G, gateValue(fs));   // gate open, in case the oscillator goes through a VCA
    result = await runTune({setValue: v => engine.cvHold(P, v), measure, wait: ms => new Promise(r => setTimeout(r, ms))},
      {fs, stopped: () => stop, onProgress: (text, f) => { msg.textContent = text; bar.value = f; }});
    engine.cvHold(P, null); engine.cvHold(G, null); nodes.forEach(n => n.disconnect()); nodes = [];
    running = false; start.textContent = 'Start again'; bar.value = 1;
    table.textContent = result.table ? result.table.map(r => `${r.volts > 0 ? '+' : ''}${r.volts} V: ${r.hz ? r.hz.toFixed(1) + ' Hz' : '—'}`).join(' · ') : '';
    if (result.error){ msg.textContent = result.error; return; }
    msg.textContent = `Done. ${result.cal.perVolt.toFixed(3)} octaves per volt (1.000 is perfect); ` +
      (result.dc ? 'the outputs held the voltage (DC-coupled).' : 'the DC check could not tell, as the pitch was unclear while held.') +
      ' Save it and every note goes out tuned to this oscillator.';
    save.hidden = false;
  });
  save.addEventListener('click', () => {
    if (!result || !result.cal) return;
    store.edit('Tune CV', s => { s.tracks[ti].cv.cal = result.cal; });
    toast('Tuning saved. Undo takes it back.'); dlg.close();
  });

  const dlg = openDialog({title: 'Tune CV (1 V per octave)',
    body: `Patch the oscillator’s pitch (1 V/oct) input to output ${P + 1}, and its audio out into an input of your interface. ` +
      'Set it to a plain wave and turn it up. Spores holds 7 voltages and listens to each one, about 10 seconds in all. It also checks the outputs can hold a voltage.',
    content: [el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Input'), input),
      el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Channel'), chan),
      el('div', {class: 'sndrow'}, start, save), bar, msg, table],
    actions: [{label: 'Close'}],
    onClose: () => { stop = true; engine.cvHold(P, null); engine.cvHold(G, null); nodes.forEach(n => n.disconnect()); if (stream) stream.getTracks().forEach(x => x.stop()); }});
  fillInputs();
}
