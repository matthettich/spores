/* js/engine/worklet.js: the step clock and the voices, in one AudioWorklet. 🔴 Claude only (see AGENTS.md).
 *
 * Timing lives here, on the audio thread, counted in samples, so the beat never depends on the page being busy.
 * Each step is decided a little ahead of time (LOOKAHEAD): chance is rolled, its sounds are queued at their exact
 * sample, and the page is told what will happen and when (context time), so MIDI notes, MIDI clock and the playhead
 * can be lined up with what is heard.
 *
 * Messages in (port):  {t:'song', song}            the compiled song (engine.js compile())
 *                      {t:'play', mode, scene, block}  mode 'scene' loops a scene, 'song' plays the blocks
 *                      {t:'scene', scene}           change scene (at the next bar, so it stays in time)
 *                      {t:'stop'}
 *                      {t:'hit', ti, note, vel}     play one track now (tapping a step, Prev / Next sound)
 *                      {t:'wasm', bytes}            pump-synth.wasm's bytes, compiled here (COIL, ORBIT, FOLD, BOING)
 *                      {t:'buf', id, note, data}    a recorded note of a Modal / Scanned track (render-worker.js)
 *                      {t:'cvtest', ch, value}      hold a CV output at a value (Tune CV, Test outputs); value null = let go
 *                      {t:'clip', id, data}         a loop take's samples (Float32Array, transferred); {t:'unclip', id} drops one
 *                      {t:'input', on}              the input (inputs[0], channel 0) is connected: send level meter values
 *                      {t:'record', trackId, scene, bars, keep, lat, metronome}   record a loop take (see recordStart)
 *                      {t:'record', kind:'song', trackId, block, lat, metronome}   record a song-length take (recordSongStart)
 *                      {t:'recstop', discard}       stop recording: a loop take not finished is dropped (Stop does the
 *                                                   same); a song take ends here and is kept (unless discard)
 *                      {t:'ping', count, gap}       latency test: bursts every `gap` frames, the input recorded meanwhile
 *                      {t:'tfx', bytes}             tfx.wasm's bytes, compiled here: the track effects (fxhost.js)
 *                      {t:'peek'}                   → {t:'peek', clips, tapes, recording} (tests)
 *                      {t:'halt'}                   export only: stop at once (Cancel), see bounce.js
 * Outputs: 0 = the stereo mix, 1 = CV_CHANNELS of CV (cv.js), sample values, straight to the interface.
 * Messages out:        {t:'start', time}            first step's time, for MIDI Start
 *                      {t:'step', time, frame, len, scene, block, rep, counter, events, clocks}
 *                      {t:'stop', time}
 *                      {t:'level', peak, rms}       input level (~ every 16 ms while the input is on)
 *                      {t:'rec', state, …}          'count-in' {countTime, startTime, endTime} · 'recording' · 'done' ·
 *                                                   'cancelled' (times = context seconds of the music, not the input)
 *                      {t:'take', trackId, scene, data, sr, bars, bpm, n}   a finished take, already in loop order
 *                      {t:'take', kind:'song', trackId, chunks, len, sr, bpm, startBar}   a song take (chunks joined = len)
 *                      {t:'pong', data, at}         the latency test's input and the bursts' frames within it
 */
import {BlipVoice, AcidCore} from './voices.js';
import {pumpInit, PumpVoice} from './pump.js';
import {TapeVoice, Clicks, Capture} from './tape.js';
import {SongTape, SongCapture} from './songtape.js';
import {FxHost} from './fxhost.js';
import {Bounce} from './bounce.js';

/* A wasm module from the page: its bytes (compiled here: a compiled WebAssembly.Module can't be posted into a realtime
   AudioWorklet in current Chrome, it arrives as a 'messageerror'), or a Module (offline renders' processorOptions). */
function wasmModule(m){
  if (m.module instanceof WebAssembly.Module) return m.module;
  try { return m.bytes ? new WebAssembly.Module(m.bytes) : null; } catch (e){ return null; }
}

const LOOKAHEAD = 0.12;      // seconds: how far ahead a step is decided (MIDI needs this lead)
const START_DELAY = 0.06;    // seconds between pressing Play and the first step
const PPQ_PER_STEP = 6;      // MIDI clock: 24 per quarter note = 6 per 16th

class SporesEngine extends AudioWorkletProcessor {
  constructor(opts){
    super();
    this.song = null; this.voices = new Map(); this.queue = []; this.playing = false; this.cvHold = new Map();
    this.tmpL = new Float32Array(128); this.tmpR = new Float32Array(128); this.mono = new Float32Array(128);
    this.rnd = 0x9e3779b9;
    this.clips = new Map(); this.tapes = new Map(); this.clicks = new Clicks(sampleRate); this.runStep = 0;
    this.fx = new FxHost(sampleRate);
    this.inputOn = false; this.lvl = {pk: 0, sq: 0, n: 0, blocks: 0}; this.rec = null; this.ping = null;
    this.port.onmessage = e => this.msg(e.data);
    // processorOptions {song, play, wasm, bufs}: start straight away (used by offline renders and tests, where port messages
    // only arrive after rendering)
    const o = opts && opts.processorOptions;
    if (o && o.wasm) pumpInit(o.wasm);
    if (o && o.tfx) this.fx.init(o.tfx);
    if (o && o.bounce) this.bounce = new Bounce(o.bounce, sampleRate, this.port);   // an export (bounce.js)
    if (o && o.song){ for (const c of o.clips || []) this.msg(Object.assign({t: 'clip'}, c)); this.msg({t: 'song', song: o.song}); for (const b of o.bufs || []) this.msg(Object.assign({t: 'buf'}, b)); if (o.play) this.msg(Object.assign({t: 'play'}, o.play)); }
  }

  msg(m){
    if (m.t === 'song'){ this.song = m.song; this.syncVoices(); this.fx.sync(m.song.tracks, m.song.bpm); }
    else if (m.t === 'tfx'){ const ok = this.fx.init(wasmModule(m)); if (ok) this.fx.wake(); this.port.postMessage({t: 'tfx', ok}); }
    else if (m.t === 'play') this.start(m);
    else if (m.t === 'stop') this.stop();
    else if (m.t === 'scene') this.pendingScene = m.scene;
    else if (m.t === 'wasm'){ const mod = wasmModule(m); if (pumpInit(mod) && this.song) this.syncVoices(); this.port.postMessage({t: 'wasm', ok: !!mod && pumpInit(mod)}); }
    else if (m.t === 'buf'){ const v = this.voices.get(m.id); if (v && v.bufs) v.bufs.set(m.note, m.data); }
    else if (m.t === 'cvtest'){ if (m.value == null) this.cvHold.delete(m.ch); else this.cvHold.set(m.ch, m.value); }
    else if (m.t === 'clip') this.clips.set(m.id, m.data);
    else if (m.t === 'unclip') this.clips.delete(m.id);
    else if (m.t === 'input'){ this.inputOn = !!m.on; }
    else if (m.t === 'halt'){ if (this.bounce) this.bounce.finish('halted'); }
    else if (m.t === 'record') this.recordStart(m);
    else if (m.t === 'recstop') this.recordStop(m);
    else if (m.t === 'ping') this.pingStart(m);
    else if (m.t === 'peek') this.port.postMessage({t: 'peek', clips: [...this.clips.keys()], fx: this.fx.count,   // (tests / debugging)
      songStep: this.songStep, tapes: Object.fromEntries([...this.tapes].map(([id, v]) => [id, v.cur ? v.cur.id : null])), recording: !!this.rec});
    else if (m.t === 'hit'){ const tr = this.song && this.song.tracks[m.ti]; if (tr) this.trigger(m.ti, currentFrame, m.note, m.vel, (m.len || 0.25) * sampleRate); }
  }

  /* one voice per track, kept across song updates (so a setting changing mid-note doesn't cut it). The kind of voice
     follows the track's engine: blip (2 voices, round robin), acid (mono), pump (a wasm handle, poly), rendered
     (recorded notes, up to 6 ringing at once). */
  syncVoices(){
    const keep = new Map();
    for (const tr of this.song.tracks){
      if (tr.type === 'cv'){ keep.set(tr.id, this.voices.get(tr.id) || {engine: 'cv', val: 0, gate: false, note: -1}); continue; }
      if (tr.type === 'audio'){
        const K = tr.span === 'song' ? SongTape : TapeVoice, v = this.tapes.get(tr.id);
        if (!v || v.constructor !== K) this.tapes.set(tr.id, new K(sampleRate));
        continue;
      }
      if (tr.type !== 'drum' && tr.type !== 'synth') continue;
      let v = this.voices.get(tr.id);
      const live = v && v.engine === tr.engine;
      if (!live){
        if (v && v.pump) v.pump.free();
        v = {engine: tr.engine, gain: 1, key: ''};
        if (tr.engine === 'blip') v.drum = [new BlipVoice(sampleRate), new BlipVoice(sampleRate)], v.rr = 0;
        else if (tr.engine === 'acid') v.synth = new AcidCore(sampleRate), v.rate = 1;
        else if (tr.rendered) v.bufs = new Map(), v.plays = [];
        else { v.pump = new PumpVoice(tr.engine, tr.vals); v.key = JSON.stringify(tr.vals); }
      }
      const key = JSON.stringify(tr.vals);
      if (v.key !== key){
        v.key = key;
        if (v.drum) for (const d of v.drum) d.set(tr.vals);
        if (v.synth){ v.synth.p = null; v.synth.set(Object.assign({}, tr.vals, {oct: 0})); }
        if (v.pump) v.pump.set(tr.vals);
        // (rendered tracks keep their old recordings until the page sends the new ones: no gap while they're made)
      }
      if (v.pump && v.pump.h < 0 && !v.pump.bad){ const p = new PumpVoice(tr.engine, tr.vals); if (p.h >= 0) v.pump = p; }   // the wasm arrived after the track was made
      keep.set(tr.id, v);
    }
    for (const [id, v] of this.voices) if (!keep.has(id) && v.pump) v.pump.free();
    for (const id of [...this.tapes.keys()]) if (!this.song.tracks.some(t => t.id === id && t.type === 'audio')) this.tapes.delete(id);
    this.voices = keep;
  }

  start(m){
    if (!this.song) return;
    const s = this.song;
    this.mode = m.mode === 'song' && s.song.length ? 'song' : 'scene';
    this.block = Math.max(0, Math.min(s.song.length - 1, m.block | 0)); this.rep = 0;
    this.sceneKey = this.mode === 'song' ? s.song[this.block].scene : (s.scenes[m.scene] ? m.scene : Object.keys(s.scenes)[0]);
    this.pendingScene = null; this.counter = 0; this.global = 0; this.runStep = 0;
    this.songStep = this.mode === 'song' ? s.song[this.block].start || 0 : 0;   // song steps from bar 0 (song-length takes)
    this.nextFrame = currentFrame + START_DELAY * sampleRate;
    if (m.countIn){   // one bar of clicks first (recording); the scene starts on the bar after
      const beat = 4 * this.stepLen();
      for (let k = 0; k < 4; k++) this.clicks.add(this.nextFrame + k * beat, k ? 'click' : 'accent');
      this.nextFrame += 4 * beat;
    }
    this.playing = true; this.fx.start(this.nextFrame);
    if (this.bounce && this.bounce.start < 0) this.bounce.start = Math.round(this.nextFrame);
    this.port.postMessage({t: 'start', time: this.nextFrame / sampleRate});
  }

  stop(){
    if (!this.playing) return;
    this.playing = false; this.fx.stop();
    if (this.rec && this.rec.kind === 'song') this.rec.cap.finish(currentFrame + this.rec.lat);   // kept: it ends here
    else if (this.rec) this.recordEnd('cancelled');
    for (const v of this.tapes.values()) v.release();
    this.queue = this.queue.filter(q => !q.on && !q.sync);   // drop notes not yet started; let note-offs through
    for (const [, v] of this.voices){ if (v.synth) v.synth.off(); if (v.pump) v.pump.allOff(); if (v.engine === 'cv') v.gate = false; }
    this.port.postMessage({t: 'stop', time: currentFrame / sampleRate});
  }

  random(){ this.rnd ^= this.rnd << 13; this.rnd ^= this.rnd >>> 17; this.rnd ^= this.rnd << 5; return (this.rnd >>> 0) / 4294967296; }

  /* decide the next step: which scene, which hits (chance), queue them, tell the page */
  stepLen(){ return sampleRate * 15 / Math.max(20, Math.min(300, this.song.bpm)); }

  announce(){
    const s = this.song, stepLen = this.stepLen();
    let sc = s.scenes[this.sceneKey];
    if (this.pendingScene && this.mode === 'scene' && this.counter % 16 === 0 && s.scenes[this.pendingScene]){
      this.sceneKey = this.pendingScene; this.pendingScene = null; this.counter = 0; this.runStep = 0; sc = s.scenes[this.sceneKey];
    }
    if (!sc){ this.sceneKey = Object.keys(s.scenes)[0]; sc = s.scenes[this.sceneKey]; this.counter = 0; this.runStep = 0; }
    if (this.counter >= sc.len){
      this.counter = 0;
      if (this.mode === 'song'){
        const b = s.song[this.block];
        if (!(b && b.loop) && ++this.rep >= Math.max(1, b ? b.repeat : 1)){
          this.block = (this.block + 1) % s.song.length; this.rep = 0; this.runStep = 0;
          if (this.block === 0){   // the song's end: it starts again from bar 0; a song take being recorded ends here
            this.songStep = 0;
            if (this.rec && this.rec.kind === 'song') this.rec.cap.finish(Math.round(this.nextFrame) + this.rec.lat);
          }
        }
        this.sceneKey = s.song[this.block].scene; sc = s.scenes[this.sceneKey] || sc;
      }
    }
    // swing: every second 16th comes late (swing 0…1 = up to half a step)
    const swing = Math.max(0, Math.min(1, s.swing || 0)), late = this.global % 2 ? swing * 0.5 * stepLen : 0;
    const frame = this.nextFrame + late, gateLen = stepLen * 0.5;
    const solo = s.tracks.some(t => t.solo), events = [];
    s.tracks.forEach((tr, ti) => {
      const lane = sc.steps[ti]; if (!lane) return;
      const L = tr.len > 0 ? Math.min(tr.len, sc.len) : sc.len, idx = this.counter % L, st = lane[idx];
      if (!st || (solo ? !tr.solo : tr.mute)) return;
      if (st.chance < 100 && this.random() * 100 >= st.chance) return;
      this.trigger(ti, frame, st.note, st.vel, gateLen, st.cv);
      events.push({ti, idx, note: st.note, vel: st.vel, len: gateLen / sampleRate});
    });
    // audio tracks: where this step falls in each take's loop, on the step's own (unswung) frame
    if (s.hasAudio) this.queue.push({frame: this.nextFrame, sync: true, scene: this.sceneKey, runStep: this.runStep, stepLen, mode: this.mode, songStep: this.songStep}), this.queue.sort((a, b) => a.frame - b.frame);
    const clocks = []; for (let k = 0; k < PPQ_PER_STEP; k++) clocks.push((this.nextFrame + k * stepLen / PPQ_PER_STEP) / sampleRate);
    this.port.postMessage({t: 'step', time: frame / sampleRate, len: stepLen / sampleRate, scene: this.sceneKey, block: this.block,
      rep: this.rep, counter: this.counter, songStep: this.mode === 'song' ? this.songStep : null, events, clocks});
    this.counter++; this.global++; this.runStep++; this.songStep++; this.nextFrame += stepLen;
  }

  // queue a note on (and off) at an exact sample. MIDI and CV tracks make no sound here. A drum's note is its sound's
  // (BOING: which drum); a pump voice starts early by its latency, so it is heard on the beat.
  trigger(ti, frame, note, vel, len, cv){
    const tr = this.song.tracks[ti];
    if (tr.type === 'cv'){   // pitch + gate, on the sample
      this.queue.push({frame, ti, on: true, note, cv: cv ?? 0}, {frame: frame + len, ti, on: false, note});
      this.queue.sort((a, b) => a.frame - b.frame); return;
    }
    if (tr.type !== 'drum' && tr.type !== 'synth') return;
    const v = this.voices.get(tr.id), lat = v && v.pump ? v.pump.lat || 0 : 0;
    if (tr.type === 'drum' && tr.drumNote != null) note = tr.drumNote;
    const at = Math.max(currentFrame, frame - lat);
    this.queue.push({frame: at, ti, on: true, note, vel});
    if (tr.type === 'synth' || (v && v.pump)) this.queue.push({frame: at + (tr.type === 'drum' ? Math.min(len, sampleRate * 0.03) : len), ti, on: false, note});
    this.queue.sort((a, b) => a.frame - b.frame);
  }

  /* export: the song's end, on its exact sample. Like stop(), but the effects keep running (their tails ring out) */
  bounceEnd(off){
    this.playing = false;
    for (const v of this.tapes.values()) v.release();
    this.queue = this.queue.filter(q => !q.on && !q.sync && !q.end);
    for (const [, v] of this.voices){ if (v.synth) v.synth.off(); if (v.pump) v.pump.allOff(); if (v.engine === 'cv') v.gate = false; }
    this.bounce.end = currentFrame + off - this.bounce.start;
  }
  // where a track's sound goes when it has no effects: the mix, or (stem export) its own buffers
  stemBuf(id){ return this.bounce && this.bounce.stems ? this.bounce.bufs.get(id) || null : null; }

  fire(q, off){
    if (q.end) return this.bounceEnd(off);
    if (q.sync) return this.syncTapes(q, off);
    const tr = this.song.tracks[q.ti], v = tr && this.voices.get(tr.id); if (!v) return;
    const vel = Math.max(0, Math.min(127, q.vel || 100)) / 127;
    if (v.engine === 'cv'){ if (q.on){ v.val = q.cv; v.gate = true; v.note = q.note; } else if (v.note === q.note) v.gate = false; }
    else if (v.drum){ if (q.on){ v.rr ^= 1; v.drum[v.rr].trig(vel); } }
    else if (v.synth){
      if (q.on){ v.rate = Math.pow(2, (q.note - 36) / 12); v.gain = 0.35 + 0.65 * vel; v.synth.on(false, q.vel >= 112); v.note = q.note; }
      else if (v.note === q.note) v.synth.off();
    }
    else if (v.pump){ if (q.on) v.pump.on(off, q.note, q.vel || 100); else v.pump.off(off, q.note); }
    else if (v.bufs && q.on){
      const b = v.bufs.get(q.note); if (!b) return;   // not recorded yet (it will be in a moment)
      if (v.plays.length >= 6) v.plays.shift();
      v.plays.push({b, i: 0, g: 0.25 + 0.75 * vel});
    }
  }

  /* ---- audio tracks (tape.js) ---- */
  syncTapes(q, off){
    const s = this.song, sc = s.scenes[q.scene]; if (!sc) return;
    const late = Math.max(0, currentFrame + off - q.frame);
    s.tracks.forEach((tr, ti) => {
      const v = this.tapes.get(tr.id); if (!v) return;
      if (tr.span === 'song'){   // song-length take: song mode only (silent in scene mode)
        if (q.mode !== 'song') return v.release();
        const k = tr.take;
        return v.sync(k, k ? this.clips.get(k.id) : null, q.songStep, q.stepLen, late, this.tapeLevel(tr, s.tracks.some(t => t.solo)));
      }
      const c = sc.clips && sc.clips[ti];
      v.sync(c, c ? this.clips.get(c.id) : null, q.runStep, q.stepLen, late, this.tapeLevel(tr, s.tracks.some(t => t.solo)));
    });
  }
  tapeLevel(tr, solo){
    if ((solo ? !tr.solo : tr.mute) || (this.rec && this.rec.trackId === tr.id)) return 0;   // the track being recorded is quiet
    return (tr.vol ?? 0.8) * 0.9;
  }

  /* Record a loop take (engine.js record()). The take covers the loop's length from a bar line, in the music's time:
     stopped (or playing something else) → the scene starts after one bar of count-in, and the take starts on its first
     sample; already playing this scene → count-in over the next bar, the take starts on the bar line after it and is
     turned round so its first sample is the loop's start. The input is captured `lat` frames later than the music
     (output + input latency: what she sang along to was heard that much earlier). keep: the next take follows on at once. */
  recordStart(m){
    if (m.kind === 'song') return this.recordSongStart(m);
    const tr = this.song && this.song.tracks.find(t => t.id === m.trackId);
    if (tr && tr.span === 'song'){ this.port.postMessage({t: 'rec', state: 'cancelled', why: 'a song-length track'}); return; }
    if (!this.song || !this.song.scenes[m.scene]){ this.port.postMessage({t: 'rec', state: 'cancelled', why: 'no such scene'}); return; }
    if (this.rec) this.recordEnd('cancelled');
    const bars = [1, 2, 4, 8].includes(m.bars) ? m.bars : 1, S = bars * 16;
    let r0, recFrame;
    if (this.playing && this.mode === 'scene' && this.sceneKey === m.scene && !this.pendingScene){
      const st = this.stepLen(), k = (16 - this.runStep % 16) % 16, bl = this.nextFrame + k * st;
      for (let j = 0; j < 4; j++) this.clicks.add(bl + j * 4 * st, j ? 'click' : 'accent');
      recFrame = bl + 16 * st; r0 = this.runStep + k + 16;
    } else {
      if (this.playing) this.stop();
      this.start({mode: 'scene', scene: m.scene, countIn: true});
      recFrame = this.nextFrame; r0 = 0;
    }
    const st = this.stepLen(), len = Math.round(S * st), start = Math.round(recFrame) + Math.round(m.lat || 0);
    this.rec = {trackId: m.trackId, scene: m.scene, bars, S, len, rot: Math.round((r0 % S) * len / S), keep: !!m.keep,
      bpm: this.song.bpm, cap: new Capture(start, len), musicStart: recFrame, n: 0, metro: !!m.metronome, beat: 4 * st, nextBeat: recFrame, said: false};
    this.port.postMessage({t: 'rec', state: 'count-in', countTime: (recFrame - 16 * st) / sampleRate, startTime: recFrame / sampleRate,
      endTime: (recFrame + len) / sampleRate, trackId: m.trackId, scene: m.scene, bars});
  }
  recordEnd(state){
    if (!this.rec) return;
    this.rec = null; this.clicks.list = this.clicks.list.filter(c => c.kind === 'burst');
    this.port.postMessage({t: 'rec', state});
  }
  /* Record a song-length take (engine.js recordSong()): the song starts from block `block` after one bar of count-in
     (whatever was playing stops), and the input is captured from that block's first sample (+ lat, as loop takes)
     until Stop / recstop (kept) or the song's end (the block after the last). startBar = that block's first song bar. */
  recordSongStart(m){
    const s = this.song;
    if (!s || !s.song.length){ this.port.postMessage({t: 'rec', state: 'cancelled', why: 'no song blocks'}); return; }
    if (this.rec) this.recordEnd('cancelled');
    if (this.playing) this.stop();
    const block = Math.max(0, Math.min(s.song.length - 1, m.block | 0));
    this.start({mode: 'song', block, countIn: true});
    const st = this.stepLen(), recFrame = this.nextFrame, lat = Math.round(m.lat || 0), first = s.song[block].start || 0;
    const loops = s.song.slice(block).some(b => b.loop);
    this.rec = {kind: 'song', trackId: m.trackId, block, startBar: Math.round(first / 16), bpm: s.bpm, lat,
      cap: new SongCapture(Math.round(recFrame) + lat, sampleRate), musicStart: recFrame, n: 0, metro: !!m.metronome,
      beat: 4 * st, nextBeat: recFrame, said: false};
    this.port.postMessage({t: 'rec', state: 'count-in', kind: 'song', countTime: (recFrame - 16 * st) / sampleRate, startTime: recFrame / sampleRate,
      endTime: loops ? null : (recFrame + (s.songSteps - first) * st) / sampleRate, trackId: m.trackId, block, startBar: this.rec.startBar});
  }
  recordStop(m){
    const r = this.rec;
    if (r && r.kind === 'song' && !m.discard) r.cap.finish(currentFrame + r.lat);
    else this.recordEnd('cancelled');
  }
  recordFeed(input, f0, n){
    const r = this.rec;
    if (!r.said && f0 + n > r.musicStart){ r.said = true; this.port.postMessage({t: 'rec', state: 'recording', n: r.n}); }
    if (r.metro) while (r.nextBeat < f0 + n){ if (r.nextBeat >= f0) this.clicks.add(r.nextBeat, 'click'); r.nextBeat += r.beat; }
    if (r.kind === 'song'){
      if (!r.cap.feed(input, f0, n)) return;
      const c = r.cap, chunks = c.chunks.slice(0, Math.ceil(c.len / c.size));
      this.port.postMessage({t: 'take', kind: 'song', trackId: r.trackId, chunks, len: c.len, sr: sampleRate, bpm: r.bpm, startBar: r.startBar, n: 0},
        chunks.map(x => x.buffer));
      return this.recordEnd('done');
    }
    if (!r.cap.feed(input, f0, n)) return;
    // full: in loop order (sample j of the capture is loop position rot + j), sent off; then the next take or the end
    const d = r.cap.buf, out = r.rot ? new Float32Array(r.len) : d;
    if (r.rot) for (let j = 0; j < r.len; j++) out[(r.rot + j) % r.len] = d[j];
    this.port.postMessage({t: 'take', trackId: r.trackId, scene: r.scene, data: out, sr: sampleRate, bars: r.bars, bpm: r.bpm, n: r.n}, [out.buffer]);
    // (the next take starts inside this block: it gets this block's remaining frames too)
    if (r.keep){ r.n++; r.musicStart += r.len; r.said = false; r.cap = new Capture(r.cap.start + r.len, r.len); r.cap.feed(input, f0, n); }
    else this.recordEnd('done');
  }

  // latency test: `count` bursts, `gap` frames apart, starting 0.1 s from now; the input is kept from the first burst
  pingStart(m){
    const count = Math.max(1, Math.min(32, m.count | 0 || 8)), gap = Math.max(1024, m.gap | 0 || Math.round(sampleRate / 4));
    const start = currentFrame + Math.round(0.1 * sampleRate), at = [];
    for (let k = 0; k < count; k++){ this.clicks.add(start + k * gap, 'burst'); at.push(k * gap); }
    this.ping = {cap: new Capture(start, count * gap), at};
  }

  process(inputs, outputs){
    const bo = this.bounce;
    if (bo && bo.done){ for (const o of outputs) for (const ch of o) ch.fill(0); return true; }   // export finished: silence
    const sm = bo && bo.stems;   // stem export: each track into its own channels, the mix into a scratch pair
    if (sm){ for (const ch of outputs[0]) ch.fill(0); bo.clear(); }
    const out = outputs[0], L = sm ? bo.mL : out[0], R = sm ? bo.mR : out[1] || out[0], n = out[0].length, f0 = currentFrame;
    L.fill(0); if (R !== L) R.fill(0);
    // the input (recording): channel 0 of input 0, when something is connected
    const inp = inputs && inputs[0] && inputs[0][0] && inputs[0][0].length ? inputs[0][0] : null;
    if (this.inputOn) this.meter(inp, n);
    if (this.rec) this.recordFeed(inp, f0, n);
    if (this.ping && this.ping.cap.feed(inp, f0, n)){ const d = this.ping.cap.buf; this.port.postMessage({t: 'pong', data: d, at: this.ping.at}, [d.buffer]); this.ping = null; }
    const CV = outputs[1] || []; for (const ch of CV) ch.fill(0);
    if (this.playing && this.song) while (this.nextFrame < f0 + n + LOOKAHEAD * sampleRate){
      if (bo && bo.left-- <= 0){   // export: every step has been played; the end is queued on the sample after the last
        if (!bo.ending){ bo.ending = true; this.queue.push({frame: this.nextFrame, end: true}); this.queue.sort((a, b) => a.frame - b.frame); }
        break;
      }
      this.announce();
    }
    if (!this.song) return true;
    for (const c of this.fx.chains.values()){ c.L.fill(0); c.R.fill(0); }   // tracks with effects play into their own buffers
    // render in pieces between queued events, so every hit lands on its own sample
    let a = 0;
    while (a < n){
      while (this.queue.length && this.queue[0].frame < f0 + a + 1) this.fire(this.queue.shift(), a);
      const nx = this.queue.length ? Math.ceil(this.queue[0].frame - f0) : n, b = Math.max(a + 1, Math.min(n, nx));
      this.renderVoices(L, R, a, b);
      if (CV.length) this.renderCV(CV, a, b);
      a = b;
    }
    this.clicks.render(L, R, f0, n);
    for (const [ch, val] of this.cvHold) if (CV[ch]) CV[ch].fill(val);   // Tune CV / Test outputs win
    // pump voices run the whole block at once (their notes were sent with their offset in it)
    this.song.tracks.forEach(tr => { const v = this.voices.get(tr.id); if (!v || !v.pump) return; const c = this.fx.buffers(tr.id);
      const sb = !c && this.stemBuf(tr.id);
      if (c) v.pump.render(c.L, c.R, n, 0.9); else v.pump.render(sb ? sb.L : L, sb ? sb.R : R, n, (tr.vol ?? 0.8) * 0.9); });
    // the track effects (fxhost.js), then volume / mute / solo after them
    if (this.fx.chains.size){
      const solo = this.song.tracks.some(t => t.solo), Rx = R !== L ? R : this.tmpR;
      for (const tr of this.song.tracks) if (this.fx.has(tr.id)){ const sb = this.stemBuf(tr.id);
        this.fx.run(tr.id, sb ? sb.L : L, sb ? sb.R : Rx, n, f0, (solo ? !tr.solo : tr.mute) ? 0 : (tr.vol ?? 0.8)); }
    }
    if (sm){   // stems: as they are (no master clip: the page sums them and clips that, as below)
      for (const b of bo.bufs.values()){ out[2 * b.k].set(b.L); out[2 * b.k + 1].set(b.R); }
      bo.take(null, null, f0, n); return true;
    }
    for (let i = 0; i < n; i++){ L[i] = Math.tanh(L[i]); if (R !== L) R[i] = Math.tanh(R[i]); }   // gentle master clip
    if (bo) bo.take(L, R, f0, n);
    return true;
  }

  // CV tracks: the pitch output holds the last note's value; the gate is high while the note is on
  renderCV(CV, a, b){
    for (const tr of this.song.tracks){
      if (tr.type !== 'cv') continue;
      const v = this.voices.get(tr.id); if (!v) continue;
      const P = CV[tr.cvPitch], G = CV[tr.cvGate];
      if (P) P.fill(v.val, a, b);
      if (G && v.gate) for (let i = a; i < b; i++) if (G[i] < tr.gateV) G[i] = tr.gateV;
    }
  }

  meter(inp, n){
    const l = this.lvl;
    if (inp) for (let i = 0; i < n; i++){ const x = inp[i], a = x < 0 ? -x : x; if (a > l.pk) l.pk = a; l.sq += x * x; }
    l.n += n;
    if (++l.blocks >= 6){ this.port.postMessage({t: 'level', peak: l.pk, rms: Math.sqrt(l.sq / l.n)}); l.pk = l.sq = l.n = l.blocks = 0; }
  }

  renderVoices(L0, R0, a, b){
    const L = L0, R = R0;
    const s = this.song, mono = this.mono, tL = this.tmpL, tR = this.tmpR;
    if (this.tapes.size){
      const solo = s.tracks.some(t => t.solo);
      for (const tr of s.tracks){ const v = this.tapes.get(tr.id); if (!v || !v.busy) continue; const c = this.fx.buffers(tr.id);
        const sb = !c && this.stemBuf(tr.id);
        if (c) v.render(c.L, c.R, a, b, this.rec && this.rec.trackId === tr.id ? 0 : 0.9);   // (mute / solo / volume: after its effects)
        else v.render(sb ? sb.L : L, sb ? sb.R : R, a, b, this.tapeLevel(tr, solo)); }
    }
    s.tracks.forEach(tr => {
      const v = this.voices.get(tr.id); if (!v) return;
      const c = this.fx.buffers(tr.id), sb = !c && this.stemBuf(tr.id), L = c ? c.L : sb ? sb.L : L0, R = c ? c.R : sb ? sb.R : R0, g = c ? 0.9 : (tr.vol ?? 0.8) * 0.9;   // with effects: volume after them
      if (v.drum){
        if (!v.drum[0].on && !v.drum[1].on) return;
        mono.fill(0, a, b); v.drum[0].render(mono, a, b, g); v.drum[1].render(mono, a, b, g);
        for (let i = a; i < b; i++){ L[i] += mono[i]; if (R !== L) R[i] += mono[i]; }
      } else if (v.plays){
        for (let j = v.plays.length - 1; j >= 0; j--){
          const p = v.plays[j], k = g * p.g * 0.4, e = Math.min(b, a + p.b.length - p.i);
          for (let i = a; i < e; i++){ const x = p.b[p.i++] * k; L[i] += x; if (R !== L) R[i] += x; }
          if (p.i >= p.b.length) v.plays.splice(j, 1);
        }
      } else if (v.synth){
        if (v.synth.stage === 0 && v.synth.env === 0) return;
        v.synth.render(tL, tR, a, b, v.rate);
        const k = g * v.gain * 0.95;
        for (let i = a; i < b; i++){ L[i] += tL[i] * k; if (R !== L) R[i] += tR[i] * k; }
      }
    });
  }
}

registerProcessor('spores-engine', SporesEngine);
