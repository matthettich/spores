/* js/engine/recorder.js: the page's side of recording loop takes. 🔴 Claude only. engine.js mixes these into the
 * engine object (see the API list in docs/NOTES.md, 2026-11-26 "audio tracks B1"). Input handling follows ...Thunder
 * Plus (rcdOpen1 / rcdRoute / rcdLat): every phone-style clean-up off, the picked device or the default, one channel of
 * a multi-channel interface picked with a splitter, latency = output + input (as the browser reports them) + an offset
 * per computer, which the latency test sets.
 *
 * The capture itself happens in the engine's worklet (worklet.js recordStart), on the same clock as the music.
 * Settings kept on this computer (not in the song): localStorage 'spores.rec' = {deviceId, channel, offsetMs, monitor}.
 */
import {newClipId} from '../store.js';

const KEY = 'spores.rec';
const load = () => { const d = {deviceId: '', channel: 1, offsetMs: 0, monitor: false}; try { return Object.assign(d, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e){ return d; } };

export function createRecorder({ctx, node, master, emit}){
  const set = load();
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e){} };
  let inp = null;            // {stream, src, split, pick, mon, channels, label, inLat, deviceId, channel}
  let rec = null;            // {resolve, onTake, last, keepGoing}
  let pong = null, peek = null;
  const peekWorklet = () => new Promise(res => { peek = res; node.port.postMessage({t: 'peek'}); });   // tests

  // the worklet's recording messages (engine.js passes them on)
  function onMessage(m){
    if (m.t === 'level'){ emit('level', {peak: m.peak, rms: m.rms, db: m.peak > 0 ? 20 * Math.log10(m.peak) : -Infinity, clip: m.peak >= 0.999}); return true; }
    if (m.t === 'peek'){ if (peek){ const f = peek; peek = null; f(m); } return true; }
    if (m.t === 'pong'){ if (pong){ const f = pong; pong = null; f(m); } return true; }
    if (m.t === 'take' && m.kind === 'song'){   // a song-length take: join the worklet's chunks
      const data = new Float32Array(m.len); let at = 0;
      for (const c of m.chunks){ const k = Math.min(c.length, m.len - at); if (k <= 0) break; data.set(k < c.length ? c.subarray(0, k) : c, at); at += k; }
      const take = {id: newClipId(), kind: 'song', trackId: m.trackId, data, sr: m.sr, bpm: m.bpm, startBar: m.startBar, n: m.len};
      emit('take', take);
      if (rec){ rec.last = take; try { rec.onTake && rec.onTake(take); } catch (e){ console.error(e); } }
      return true;
    }
    if (m.t === 'take'){
      const take = {id: newClipId(), trackId: m.trackId, scene: m.scene, data: m.data, sr: m.sr, bars: m.bars, bpm: m.bpm, n: m.n, pad: (m.pad || 0) / m.sr};   // pad: seconds of extra audio each side
      emit('take', take);
      if (rec){ rec.last = take; try { rec.onTake && rec.onTake(take); } catch (e){ console.error(e); } }
      return true;
    }
    if (m.t === 'rec'){
      // (engine.recording is already false when 'done' / 'cancelled' reaches the listeners)
      const r = rec && (m.state === 'done' || m.state === 'cancelled') ? rec : null;
      if (r) rec = null;
      emit('rec', m);
      if (r) r.resolve(r.last || null);
      return true;
    }
    return false;
  }

  async function audioInputs(){
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => ({deviceId: d.deviceId, label: d.label || 'Audio input'})); }
    catch (e){ return []; }
  }

  function closeInput(){
    if (!inp) return;
    node.port.postMessage({t: 'input', on: false});
    for (const n of [inp.src, inp.split, inp.pick, inp.mon]) try { n && n.disconnect(); } catch (e){}
    if (inp.stream) inp.stream.getTracks().forEach(t => t.stop());
    inp = null;
    emit('input', {open: false});
  }

  /* Open an input. deviceId '' = the default; channel from 1 (multi-channel interfaces). testNode: any AudioNode in
     this context instead of a device (tests feed a known signal; inLat then counts as 0).
     → {ok, channels, channel, label, error} */
  async function openInput({deviceId = set.deviceId, channel = set.channel, testNode = null} = {}){
    closeInput();
    let stream = null, src = testNode, inLat = 0, label = 'Test signal', channels = testNode ? testNode.channelCount || 1 : 1;
    if (!testNode){
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) return {ok: false, error: 'This browser can’t record audio.'};
      const base = {echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: {ideal: 32}};
      try { stream = await md.getUserMedia({audio: deviceId ? Object.assign({}, base, {deviceId: {exact: deviceId}}) : base}); }
      catch (e){
        if (deviceId) try { stream = await md.getUserMedia({audio: base}); deviceId = ''; } catch (e2){}   // the picked one is gone: the default
        if (!stream) return {ok: false, error: e && e.name === 'NotAllowedError' ? 'Recording needs permission to use an audio input.' : 'Couldn’t open an audio input.'};
      }
      const tr = stream.getAudioTracks()[0], st = tr && tr.getSettings ? tr.getSettings() : {};
      channels = Math.max(1, +st.channelCount || 1); inLat = +st.latency || 0; label = (tr && tr.label) || 'Audio input';
      src = ctx.createMediaStreamSource(stream);
      channels = Math.max(channels, src.channelCount || 1);
      if (tr) tr.addEventListener('ended', () => { if (inp && inp.stream === stream){ closeInput(); emit('input', {open: false, lost: true}); } });
    }
    channel = Math.max(1, Math.min(channels, channel | 0 || 1));
    // one channel → a mono gain node → the worklet's input; and → "Hear myself" (off unless asked) → the mix
    const pick = ctx.createGain(); pick.channelCount = 1; pick.channelCountMode = 'explicit'; pick.channelInterpretation = 'discrete';
    let split = null;
    if (channels > 1){ split = ctx.createChannelSplitter(channels); src.connect(split); split.connect(pick, channel - 1); }
    else src.connect(pick);
    const mon = ctx.createGain(); mon.gain.value = set.monitor ? 1 : 0;
    pick.connect(node); pick.connect(mon).connect(master);
    // (a test node is left connected to whatever else it feeds: only what was made here is disconnected on close)
    inp = {stream, src: testNode ? null : src, split, pick, mon, channels, channel, label, inLat, deviceId};
    node.port.postMessage({t: 'input', on: true});
    if (!testNode){ set.deviceId = deviceId; set.channel = channel; keep(); }
    emit('input', {open: true, channels, channel, label});
    return {ok: true, channels, channel, label};
  }

  function setMonitor(on){
    set.monitor = !!on; keep();
    if (inp) inp.mon.gain.setTargetAtTime(set.monitor ? 1 : 0, ctx.currentTime, 0.01);
  }

  const reportedMs = () => ((ctx.outputLatency || ctx.baseLatency || 0) + (inp ? inp.inLat : 0)) * 1000;
  const latency = () => { const r = reportedMs(); return {reportedMs: +r.toFixed(2), offsetMs: set.offsetMs, totalMs: +(r + set.offsetMs).toFixed(2)}; };
  function setLatencyOffset(ms){ set.offsetMs = Math.max(-500, Math.min(1000, +ms || 0)); keep(); }

  /* Latency test: 8 short bursts go out; the input hears them (headphones held to the mic, the speakers, or a cable
     from an output to an input); the median delay is the whole round trip. apply: keep it (as the offset over what
     the browser reports). → {ok, totalMs, reportedMs, offsetMs, jitterMs, found, error} */
  async function measureLatency({count = 8, apply = true} = {}){
    if (!inp) return {ok: false, error: 'Open an input first.'};
    if (rec) return {ok: false, error: 'Not while recording.'};
    if (ctx.state !== 'running') await ctx.resume();
    const gap = Math.round(ctx.sampleRate / 4);
    const m = await new Promise(res => { pong = res; node.port.postMessage({t: 'ping', count, gap}); setTimeout(() => { if (pong === res){ pong = null; res(null); } }, 1000 * (0.5 + count * gap / ctx.sampleRate) + 3000); });
    if (!m) return {ok: false, error: 'The test didn’t finish (is the sound running?).'};
    const d = m.data, sr = ctx.sampleRate, lags = [];
    for (const a of m.at){
      const end = Math.min(d.length, a + gap);
      let pk = 0; for (let i = a; i < end; i++){ const x = Math.abs(d[i]); if (x > pk) pk = x; }
      if (pk < 0.01) continue;                     // nothing heard for this one
      for (let i = a; i < end; i++) if (Math.abs(d[i]) >= pk * 0.3){ lags.push(i - a); break; }
    }
    if (lags.length < Math.ceil(count / 2)) return {ok: false, found: lags.length, error: 'The test bursts weren’t heard. Hold your headphones to the microphone (or turn the speakers up) and try again.'};
    lags.sort((x, y) => x - y);
    const med = lags[lags.length >> 1], totalMs = med / sr * 1000, jitterMs = (lags[lags.length - 1] - lags[0]) / sr * 1000;
    const r = reportedMs();
    if (apply) setLatencyOffset(totalMs - r);
    return {ok: true, totalMs: +totalMs.toFixed(2), reportedMs: +r.toFixed(2), offsetMs: +(totalMs - r).toFixed(2), jitterMs: +jitterMs.toFixed(2), found: lags.length};
  }

  /* Record a loop take on an audio track. → Promise of the last finished take ({id, trackId, scene, data, sr, bars, bpm})
     or null if it was stopped first. onTake(take) runs for every take (keepGoing: one per loop, until stopRecording()). */
  function record({scene, track, bars = 1, keepGoing = false, metronome = false, onTake = null}){
    if (!inp) return Promise.reject(new Error('Open an input first.'));
    if (rec) return Promise.reject(new Error('Already recording.'));
    return (async () => {
      if (ctx.state !== 'running') await ctx.resume();
      return new Promise(resolve => {
        rec = {resolve, onTake, last: null};
        node.port.postMessage({t: 'record', trackId: track, scene, bars, keep: !!keepGoing, metronome: !!metronome,
          lat: Math.round(latency().totalMs / 1000 * ctx.sampleRate)});
      });
    })();
  }
  /* Record a song-length take on an audio track with span 'song'. The song plays from block `fromBlock` (0 = the
     start) after one bar of count-in (whatever was playing stops first); records until stopRecording() / Stop (the
     take is kept) or the song's end. → Promise of {id, kind: 'song', trackId, data, sr, bpm, startBar, n} (startBar =
     that block's first song bar, js/songmap.js) or null (stopRecording({discard: true}), or nothing recorded). */
  function recordSong({track, fromBlock = 0, metronome = false, onTake = null}){
    if (!inp) return Promise.reject(new Error('Open an input first.'));
    if (rec) return Promise.reject(new Error('Already recording.'));
    return (async () => {
      if (ctx.state !== 'running') await ctx.resume();
      return new Promise(resolve => {
        rec = {resolve, onTake, last: null};
        node.port.postMessage({t: 'record', kind: 'song', trackId: track, block: fromBlock | 0, metronome: !!metronome,
          lat: Math.round(latency().totalMs / 1000 * ctx.sampleRate)});
      });
    })();
  }
  // stop recording, the music goes on. A loop take not finished is dropped; a song take ends here and is kept
  // (discard: true drops it)
  const stopRecording = ({discard = false} = {}) => node.port.postMessage({t: 'recstop', discard: !!discard});

  return {onMessage, api: {
    peekWorklet, audioInputs, openInput, closeInput, setMonitor, measureLatency, record, recordSong, stopRecording, setLatencyOffset,
    get latency(){ return latency(); },
    get monitor(){ return set.monitor; },
    get recording(){ return !!rec; },
    get input(){ return inp ? {open: true, channels: inp.channels, channel: inp.channel, label: inp.label, deviceId: inp.deviceId}
      : {open: false, deviceId: set.deviceId, channel: set.channel}; },
  }};
}
