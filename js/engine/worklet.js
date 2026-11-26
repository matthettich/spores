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
 * Messages out:        {t:'start', time}            first step's time, for MIDI Start
 *                      {t:'step', time, frame, len, scene, block, rep, counter, events, clocks}
 *                      {t:'stop', time}
 */
import {BlipVoice, AcidCore, DRUMS, SYNTHS} from './voices.js';

const LOOKAHEAD = 0.12;      // seconds: how far ahead a step is decided (MIDI needs this lead)
const START_DELAY = 0.06;    // seconds between pressing Play and the first step
const PPQ_PER_STEP = 6;      // MIDI clock: 24 per quarter note = 6 per 16th

class SporesEngine extends AudioWorkletProcessor {
  constructor(opts){
    super();
    this.song = null; this.voices = new Map(); this.queue = []; this.playing = false;
    this.tmpL = new Float32Array(128); this.tmpR = new Float32Array(128); this.mono = new Float32Array(128);
    this.rnd = 0x9e3779b9;
    this.port.onmessage = e => this.msg(e.data);
    // processorOptions {song, play}: start straight away (used by offline renders and tests, where port messages
    // only arrive after rendering)
    const o = opts && opts.processorOptions;
    if (o && o.song){ this.msg({t: 'song', song: o.song}); if (o.play) this.msg(Object.assign({t: 'play'}, o.play)); }
  }

  msg(m){
    if (m.t === 'song'){ this.song = m.song; this.syncVoices(); }
    else if (m.t === 'play') this.start(m);
    else if (m.t === 'stop') this.stop();
    else if (m.t === 'scene') this.pendingScene = m.scene;
    else if (m.t === 'hit'){ const tr = this.song && this.song.tracks[m.ti]; if (tr) this.trigger(m.ti, currentFrame, m.note, m.vel, (m.len || 0.25) * sampleRate); }
  }

  /* one set of voices per track, kept across song updates (so a sound changing mid-note doesn't cut it) */
  syncVoices(){
    const keep = new Map();
    for (const tr of this.song.tracks){
      let v = this.voices.get(tr.id);
      if (!v || v.type !== tr.type){
        v = {type: tr.type, gain: 1};
        if (tr.type === 'drum') v.drum = [new BlipVoice(sampleRate), new BlipVoice(sampleRate)], v.rr = 0;
        else if (tr.type === 'synth') v.synth = new AcidCore(sampleRate), v.rate = 1;
      }
      if (v.sound !== tr.sound){
        v.sound = tr.sound;
        if (v.drum){ const p = DRUMS[tr.sound] || DRUMS.Kick; for (const d of v.drum) d.set(p); }
        if (v.synth){ v.synth.p = null; v.synth.set(SYNTHS[tr.sound] || SYNTHS['Acid bass']); }
      }
      keep.set(tr.id, v);
    }
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
    for (const [, v] of this.voices) if (v.synth) v.synth.off();
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
      this.trigger(ti, frame, st.note, st.vel, gateLen);
      events.push({ti, idx, note: st.note, vel: st.vel, len: gateLen / sampleRate});
    });
    const clocks = []; for (let k = 0; k < PPQ_PER_STEP; k++) clocks.push((this.nextFrame + k * stepLen / PPQ_PER_STEP) / sampleRate);
    this.port.postMessage({t: 'step', time: frame / sampleRate, len: stepLen / sampleRate, scene: this.sceneKey, block: this.block,
      rep: this.rep, counter: this.counter, events, clocks});
    this.counter++; this.global++; this.nextFrame += stepLen;
  }

  // queue a note on (and off, for synths) at an exact sample. MIDI and CV tracks make no sound here.
  trigger(ti, frame, note, vel, len){
    const tr = this.song.tracks[ti]; if (tr.type !== 'drum' && tr.type !== 'synth') return;
    this.queue.push({frame, ti, on: true, note, vel});
    if (tr.type === 'synth') this.queue.push({frame: frame + len, ti, on: false, note});
    this.queue.sort((a, b) => a.frame - b.frame);
  }

  fire(q){
    const tr = this.song.tracks[q.ti], v = tr && this.voices.get(tr.id); if (!v) return;
    const vel = Math.max(0, Math.min(127, q.vel || 100)) / 127;
    if (v.drum){ if (q.on){ v.rr ^= 1; v.drum[v.rr].trig(vel); } }
    else if (v.synth){
      if (q.on){ v.rate = Math.pow(2, (q.note - 36) / 12); v.gain = 0.35 + 0.65 * vel; v.synth.on(false, q.vel >= 112); v.note = q.note; }
      else if (v.note === q.note) v.synth.off();
    }
  }

  process(_in, outputs){
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, f0 = currentFrame;
    L.fill(0); if (R !== L) R.fill(0);
    if (this.playing && this.song) while (this.nextFrame < f0 + n + LOOKAHEAD * sampleRate) this.announce();
    if (!this.song) return true;
    // render in pieces between queued events, so every hit lands on its own sample
    let a = 0;
    while (a < n){
      while (this.queue.length && this.queue[0].frame < f0 + a + 1) this.fire(this.queue.shift());
      const nx = this.queue.length ? Math.ceil(this.queue[0].frame - f0) : n, b = Math.max(a + 1, Math.min(n, nx));
      this.renderVoices(L, R, a, b);
      a = b;
    }
    for (let i = 0; i < n; i++){ L[i] = Math.tanh(L[i]); if (R !== L) R[i] = Math.tanh(R[i]); }   // gentle master clip
    return true;
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
      } else if (v.synth){
        if (v.synth.stage === 0 && v.synth.env === 0) return;
        v.synth.render(tL, tR, a, b, v.rate);
        const k = g * v.gain * 0.6;
        for (let i = a; i < b; i++){ L[i] += tL[i] * k; if (R !== L) R[i] += tR[i] * k; }
      }
    });
  }
}

registerProcessor('spores-engine', SporesEngine);
