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
 *                      {t:'wasm', module}           pump-synth.wasm, compiled on the page (COIL, ORBIT, FOLD, BOING)
 *                      {t:'buf', id, note, data}    a recorded note of a Modal / Scanned track (render-worker.js)
 *                      {t:'cvtest', ch, value}      hold a CV output at a value (Tune CV, Test outputs); value null = let go
 * Outputs: 0 = the stereo mix, 1 = CV_CHANNELS of CV (cv.js), sample values, straight to the interface.
 * Messages out:        {t:'start', time}            first step's time, for MIDI Start
 *                      {t:'step', time, frame, len, scene, block, rep, counter, events, clocks}
 *                      {t:'stop', time}
 */
import {BlipVoice, AcidCore} from './voices.js';
import {pumpInit, PumpVoice} from './pump.js';

const LOOKAHEAD = 0.12;      // seconds: how far ahead a step is decided (MIDI needs this lead)
const START_DELAY = 0.06;    // seconds between pressing Play and the first step
const PPQ_PER_STEP = 6;      // MIDI clock: 24 per quarter note = 6 per 16th

class SporesEngine extends AudioWorkletProcessor {
  constructor(opts){
    super();
    this.song = null; this.voices = new Map(); this.queue = []; this.playing = false; this.cvHold = new Map();
    this.tmpL = new Float32Array(128); this.tmpR = new Float32Array(128); this.mono = new Float32Array(128);
    this.rnd = 0x9e3779b9;
    this.port.onmessage = e => this.msg(e.data);
    // processorOptions {song, play, wasm, bufs}: start straight away (used by offline renders and tests, where port messages
    // only arrive after rendering)
    const o = opts && opts.processorOptions;
    if (o && o.wasm) pumpInit(o.wasm);
    if (o && o.song){ this.msg({t: 'song', song: o.song}); for (const b of o.bufs || []) this.msg(Object.assign({t: 'buf'}, b)); if (o.play) this.msg(Object.assign({t: 'play'}, o.play)); }
  }

  msg(m){
    if (m.t === 'song'){ this.song = m.song; this.syncVoices(); }
    else if (m.t === 'play') this.start(m);
    else if (m.t === 'stop') this.stop();
    else if (m.t === 'scene') this.pendingScene = m.scene;
    else if (m.t === 'wasm'){ if (pumpInit(m.module) && this.song) this.syncVoices(); this.port.postMessage({t: 'wasm', ok: !!m.module && pumpInit(m.module)}); }
    else if (m.t === 'buf'){ const v = this.voices.get(m.id); if (v && v.bufs) v.bufs.set(m.note, m.data); }
    else if (m.t === 'cvtest'){ if (m.value == null) this.cvHold.delete(m.ch); else this.cvHold.set(m.ch, m.value); }
    else if (m.t === 'hit'){ const tr = this.song && this.song.tracks[m.ti]; if (tr) this.trigger(m.ti, currentFrame, m.note, m.vel, (m.len || 0.25) * sampleRate); }
  }

  /* one voice per track, kept across song updates (so a setting changing mid-note doesn't cut it). The kind of voice
     follows the track's engine: blip (2 voices, round robin), acid (mono), pump (a wasm handle, poly), rendered
     (recorded notes, up to 6 ringing at once). */
  syncVoices(){
    const keep = new Map();
    for (const tr of this.song.tracks){
      if (tr.type === 'cv'){ keep.set(tr.id, this.voices.get(tr.id) || {engine: 'cv', val: 0, gate: false, note: -1}); continue; }
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
    this.voices = keep;
  }

  start(m){
    if (!this.song) return;
    const s = this.song;
    this.mode = m.mode === 'song' && s.song.length ? 'song' : 'scene';
    this.block = Math.max(0, Math.min(s.song.length - 1, m.block | 0)); this.rep = 0;
    this.sceneKey = this.mode === 'song' ? s.song[this.block].scene : (s.scenes[m.scene] ? m.scene : Object.keys(s.scenes)[0]);
    this.pendingScene = null; this.counter = 0; this.global = 0;
    this.nextFrame = currentFrame + START_DELAY * sampleRate;
    this.playing = true;
    this.port.postMessage({t: 'start', time: this.nextFrame / sampleRate});
  }

  stop(){
    if (!this.playing) return;
    this.playing = false;
    this.queue = this.queue.filter(q => !q.on);   // drop notes not yet started; let note-offs through
    for (const [, v] of this.voices){ if (v.synth) v.synth.off(); if (v.pump) v.pump.allOff(); if (v.engine === 'cv') v.gate = false; }
    this.port.postMessage({t: 'stop', time: currentFrame / sampleRate});
  }

  random(){ this.rnd ^= this.rnd << 13; this.rnd ^= this.rnd >>> 17; this.rnd ^= this.rnd << 5; return (this.rnd >>> 0) / 4294967296; }

  /* decide the next step: which scene, which hits (chance), queue them, tell the page */
  announce(){
    const s = this.song, stepLen = sampleRate * 15 / Math.max(20, Math.min(300, s.bpm));
    let sc = s.scenes[this.sceneKey];
    if (this.pendingScene && this.mode === 'scene' && this.counter % 16 === 0 && s.scenes[this.pendingScene]){
      this.sceneKey = this.pendingScene; this.pendingScene = null; this.counter = 0; sc = s.scenes[this.sceneKey];
    }
    if (!sc){ this.sceneKey = Object.keys(s.scenes)[0]; sc = s.scenes[this.sceneKey]; this.counter = 0; }
    if (this.counter >= sc.len){
      this.counter = 0;
      if (this.mode === 'song'){
        const b = s.song[this.block];
        if (!(b && b.loop) && ++this.rep >= Math.max(1, b ? b.repeat : 1)){ this.block = (this.block + 1) % s.song.length; this.rep = 0; }
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
    const clocks = []; for (let k = 0; k < PPQ_PER_STEP; k++) clocks.push((this.nextFrame + k * stepLen / PPQ_PER_STEP) / sampleRate);
    this.port.postMessage({t: 'step', time: frame / sampleRate, len: stepLen / sampleRate, scene: this.sceneKey, block: this.block,
      rep: this.rep, counter: this.counter, events, clocks});
    this.counter++; this.global++; this.nextFrame += stepLen;
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

  fire(q, off){
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

  process(_in, outputs){
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, f0 = currentFrame;
    L.fill(0); if (R !== L) R.fill(0);
    const CV = outputs[1] || []; for (const ch of CV) ch.fill(0);
    if (this.playing && this.song) while (this.nextFrame < f0 + n + LOOKAHEAD * sampleRate) this.announce();
    if (!this.song) return true;
    // render in pieces between queued events, so every hit lands on its own sample
    let a = 0;
    while (a < n){
      while (this.queue.length && this.queue[0].frame < f0 + a + 1) this.fire(this.queue.shift(), a);
      const nx = this.queue.length ? Math.ceil(this.queue[0].frame - f0) : n, b = Math.max(a + 1, Math.min(n, nx));
      this.renderVoices(L, R, a, b);
      if (CV.length) this.renderCV(CV, a, b);
      a = b;
    }
    for (const [ch, val] of this.cvHold) if (CV[ch]) CV[ch].fill(val);   // Tune CV / Test outputs win
    // pump voices run the whole block at once (their notes were sent with their offset in it)
    this.song.tracks.forEach(tr => { const v = this.voices.get(tr.id); if (v && v.pump) v.pump.render(L, R, n, (tr.vol ?? 0.8) * 0.9); });
    for (let i = 0; i < n; i++){ L[i] = Math.tanh(L[i]); if (R !== L) R[i] = Math.tanh(R[i]); }   // gentle master clip
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

  renderVoices(L, R, a, b){
    const s = this.song, mono = this.mono, tL = this.tmpL, tR = this.tmpR;
    s.tracks.forEach(tr => {
      const v = this.voices.get(tr.id); if (!v) return;
      const g = (tr.vol ?? 0.8) * 0.9;
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
