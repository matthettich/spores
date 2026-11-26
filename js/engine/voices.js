/* js/engine/voices.js: the sound sources. 🔴 engine code: Claude only (see AGENTS.md).
 *
 * BlipVoice (drums) and AcidCore (synth) are copied unchanged from ...Thunder Plus (index.html, 'Blip voice' and
 * 'AcidCore'), the owner's own code, so a sound made there sounds the same here. Kits and presets are below them.
 * Pure module: imported by the AudioWorklet (worklet.js) and by the page (for the sound names).
 */

/* ---------- Blip voice (original code) ----------
   A minimal electronic drum voice in the spirit of the classic generative "blip" grooveboxes: a parabolic tone with
   a kick (a fast pitch drop), FM, ring mod, a little noise and click, an exponential decay, drive, a bipolar filter
   (left of centre low-pass, right high-pass) and a grain stutter (the hit repeated, each quieter). Self-contained:
   it is copied as text into the pads' engine and into the chains/waves worklets. Mono. */
export class BlipVoice {
  constructor(sr){ this.sr = sr; this.p = BlipVoice.defaults(); this.reset(); }
  static defaults(){
    return {pitch:180, kick:0.4, kickT:35, fm:0, fmR:1.5, ring:0, ringF:300, noise:0, click:0.2, atk:0.5, decay:220, drive:0, filt:0, res:0.2, grain:0, grainT:60, vel:1};
  }
  reset(){ this.on = false; this.t = 0; this.ph = 0; this.mph = 0; this.rph = 0; this.lp = 0; this.bp = 0; this.rnd = 7777; this.g = 0; this.rep = 0; this.rg = 1; }
  set(o){ this.p = Object.assign(BlipVoice.defaults(), o || {}); }
  trig(vel){ this.on = true; this.t = 0; this.ph = 0; this.mph = 0; this.rep = 0; this.rg = vel == null ? 1 : vel; this.v0 = this.rg; }
  // Adds (does not write) samples [a, b) of the voice into out, times gain g.
  render(out, a, b, g){
    if (!this.on) return;
    const p = this.p, sr = this.sr, inv = 1 / sr, kd = Math.exp(-inv * 1000 / Math.max(1, p.kickT)), ad = Math.exp(-inv * 1000 * 6.9 / Math.max(1, p.decay));
    const atk = Math.max(1, p.atk / 1000 * sr), fmI = p.fm * 8, dr = p.drive * 8, dn = dr ? 1 / Math.tanh(dr) : 1;
    const filt = Math.max(-1, Math.min(1, p.filt)), fc = filt < 0 ? 20000 * Math.pow(0.004, -filt) : 20 * Math.pow(400, filt);
    const q = 2 - 1.95 * Math.max(0, Math.min(1, p.res)), gT = Math.max(5, p.grainT) / 1000 * sr, rc = Math.sqrt(q / 2);   // rc: resonance doesn't jump the level
    // FIX (sweep, 4 Nov): the filter blew up (a crackle at ~8× full scale) with Filter near HP 8 kHz or a nearly open LP and
    // little Resonance: this state-variable filter is only stable for f² + 2fq < 4, so f stops just under that
    const f = Math.min(2 * Math.sin(Math.PI * Math.min(0.45, fc / sr)), 0.98 * (Math.sqrt(q * q + 4) - q));
    for (let i = a; i < b; i++){
      const t = this.t;
      // grain: the hit starts again every Grain time, each repeat quieter
      if (p.grain >= 1 && this.rep < (p.grain | 0) && t >= gT * (this.rep + 1)){ this.rep++; this.rg = this.v0 * Math.pow(0.72, this.rep); this.ke = 1; this.env = 0; this.ph = 0; }
      if (t === 0){ this.ke = 1; this.env = 0; }
      const tl = t - this.rep * gT;
      // envelope: linear attack, then exponential decay
      this.env = tl < atk ? tl / atk : this.env * ad;
      this.ke *= kd;
      const kk = p.kick * 5 * this.ke, hz = kk > 1e-4 ? p.pitch * Math.exp(kk * 0.6931471805599453) : p.pitch;
      // FM: a sine at fmR × pitch modulates the phase
      this.ph += hz * inv; if (this.ph >= 1) this.ph -= Math.floor(this.ph);
      let pm = this.ph;
      if (fmI > 0){ this.mph += hz * p.fmR * inv; if (this.mph >= 1) this.mph -= Math.floor(this.mph); pm += fmI * Math.sin(2 * Math.PI * this.mph) * this.env * 0.159; }
      const x0 = pm - Math.floor(pm), u = x0 < 0.5 ? 2 * x0 : 2 * x0 - 1;
      let y = (x0 < 0.5 ? 4 : -4) * u * (1 - u);   // parabolic arcs: a sine with a little more edge
      // ring mod: depth from tremolo to metal
      if (p.ring > 0){ this.rph += p.ringF * inv; if (this.rph >= 1) this.rph -= Math.floor(this.rph); y *= 1 - p.ring + p.ring * Math.sin(2 * Math.PI * this.rph); }
      // noise and click
      this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0; const nz = this.rnd / 2147483648 - 1;
      y = y * (1 - p.noise * 0.7) + nz * p.noise;
      if (tl < sr * 0.0015) y += p.click * (1 - tl / (sr * 0.0015)) * (nz * 0.5 + 0.8);
      y *= this.env * this.rg;
      if (dr) y = Math.tanh(y * dr) * dn;
      // bipolar state-variable filter
      if (filt !== 0){ const hp = y - this.lp - q * this.bp; this.bp += f * hp; this.lp += f * this.bp; if (!(Math.abs(this.lp) < 1e3)){ this.lp = this.bp = 0; } y = (filt < 0 ? this.lp : hp) * rc; }
      out[i] += y * g * 0.8;
      this.t++;
      if (this.env < 1e-5 && tl > atk && (p.grain < 1 || this.rep >= (p.grain | 0))){ this.on = false; break; }
    }
  }
}


export class AcidCore {
  constructor(sr){
    this.sr = sr; this.BLK = 16; this.ph = 0; this.subPh = 0; this.lf = 0; this.go = true; this.gate = false; this.leg = false;
    this.env = 0; this.stage = 0; this.fe = 0; this.accE = 0; this.accC = 0; this.accOn = 0; this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0;
    this.dc = 0; this.dcx = 0; this.rnd = 9137; this.p = null; this.set({});
  }
  static defaults(){ return {oct:1, wave:0, pw:0.5, sub:0, noise:0, cut:380, res:0.72, envAmt:0.6, dec:300, accent:0.6, slide:65,
    ampDec:900, sus:0.8, rel:12, key:0.25, sat:0.25, tune:0, drive:0, level:0}; }
  set(o){ const p = Object.assign(AcidCore.defaults(), this.p || {}, o || {}); for (const k in p) if (typeof p[k] !== 'number' || !isFinite(p[k])) p[k] = AcidCore.defaults()[k] || 0; this.p = p; }
  on(leg, acc){
    const fresh = !this.gate && this.env < 0.003; this.go = fresh;
    this.leg = !!leg && !fresh; this.gate = true; this.accOn = acc ? 1 : 0;
    if (!this.leg){ this.fe = 1; this.stage = 1; if (acc) this.accE = 1; }
  }
  off(){ this.gate = false; this.stage = 4; }
  busy(){ return false; }
  pblep(t, dt){ if (t < dt){ t /= dt; return t + t - t * t - 1; } if (t > 1 - dt){ t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
  ft(x){ if (x > 3) return 1; if (x < -3) return -1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
  render(L, R, a, b, rate){ for (let i = a; i < b; i += this.BLK) this.block(L, R, i, Math.min(b, i + this.BLK), rate); }
  block(L, R, a, b, rate){
    const p = this.p, sr = this.sr, n = b - a, dt = n / sr;
    if (this.stage === 0 && this.env === 0){ for (let i = a; i < b; i++){ L[i] = 0; R[i] = 0; } return; }
    const target = Math.log2(65.406 * Math.max(1e-3, rate)) + p.oct + p.tune / 12;
    if (this.go || this.lf === 0){ this.lf = target; this.go = false; }
    else if (this.leg && p.slide > 0.5) this.lf += (target - this.lf) * (1 - Math.exp(-dt * 1000 / p.slide));
    else this.lf = target;
    const f = Math.pow(2, this.lf), inc = Math.min(0.45, f / sr);
    // amp: a quick attack, then down toward Sustain over Amp decay while held; Release after
    const e0 = this.env; let e1 = e0;
    if (this.stage === 1){ e1 = e0 + dt * 1000 / 2; if (e1 >= 1){ e1 = 1; this.stage = 2; } }
    else if (this.stage === 2) e1 = p.sus + (e0 - p.sus) * Math.exp(-dt * 1000 * 4.6 / Math.max(1, p.ampDec));
    else if (this.stage === 4){ e1 = e0 * Math.exp(-dt * 1000 * 4.6 / Math.max(1, p.rel)); if (e1 < 1e-5){ e1 = 0; this.stage = 0; } }
    this.env = e1;
    // filter envelope (accented notes decay faster), and the accent "sweep": repeated accents charge up and climb
    const fd = this.accOn ? Math.min(p.dec, 200) : p.dec;
    this.fe *= Math.exp(-dt * 1000 * 4.6 / Math.max(10, fd));
    this.accE *= Math.exp(-dt * 1000 * 4.6 / 200);
    this.accC += (this.accE - this.accC) * (1 - Math.exp(-dt / 0.05));
    const acc = p.accent * this.accOn;
    const fc = Math.min(sr * 0.42, Math.max(25, p.cut * Math.pow(2, p.envAmt * 5 * this.fe + acc * 3.2 * this.accC + p.key * (this.lf - 7.03))));
    const g = 1 - Math.exp(-2 * Math.PI * fc / sr), k = p.res * 4.1, comp = 1 + p.res * 1.1;
    const pw = 0.5 - Math.max(0, Math.min(0.45, (p.pw - 0.5) * 0.9 + 0)), wv = p.wave, sub = p.sub, nz = p.noise;
    const sat = 1 + p.sat * 4, lv = Math.pow(10, (p.level || 0) / 20) * 1.1 * (1 + acc * 0.6), dr = p.drive > 0.001 ? 1 + p.drive * p.drive * 10 : 0, dn = dr ? 1 / Math.tanh(dr) : 1;
    const de = (e1 - e0) / n; let env = e0;
    for (let i = a; i < b; i++){
      env += de;
      let t = this.ph; this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      let saw = 2 * t - 1 - this.pblep(t, inc);
      let sq = (t < pw ? 1 : -1) + this.pblep(t, inc); { let t2 = t - pw; if (t2 < 0) t2 += 1; sq -= this.pblep(t2, inc); }
      let x = saw * (1 - wv) + sq * wv;
      if (sub > 0){ this.subPh += inc * 0.5; if (this.subPh >= 1) this.subPh -= 1; x += (this.subPh < 0.5 ? 1 : -1) * sub * 0.7; }
      if (nz > 0){ this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0; x += (this.rnd / 2147483648 - 1) * nz * 0.6; }
      // the ladder: four one-pole stages with soft saturation, resonance fed back from the last
      const u = this.ft((x - k * this.s3) * 0.8);
      this.s0 += g * (u - this.s0); this.s1 += g * (this.s0 - this.s1); this.s2 += g * (this.s1 - this.s2); this.s3 += g * (this.ft(this.s2 * sat) / sat - this.s3);
      let y = this.s3 * comp * env;
      const o = y - this.dcx + 0.997 * this.dc; this.dcx = y; this.dc = o; y = o * lv;
      if (dr) y = Math.tanh(y * dr) * dn;
      L[i] = y; R[i] = y;
    }
  }
}

/* ---------- Spores' first kit and synths ----------
   A drum sound is a set of BlipVoice values; a synth sound is a set of AcidCore values. The pitch of a drum is its
   own (drum steps don't carry a note); a synth plays the step's note. AcidCore's `oct` is kept at 0 here: the
   engine passes the note's own frequency, so the track's octave lives on the track (see store.js). */
export const DRUMS = {
  'Kick':        {pitch: 58, kick: 0.8, kickT: 28, click: 0.5, decay: 240, drive: 0.2},
  'Boom kick':   {pitch: 48, kick: 0.75, kickT: 55, click: 0.3, decay: 950, drive: 0.35},
  'Snare':       {pitch: 200, kick: 0.35, kickT: 12, noise: 0.72, click: 0.6, decay: 170, filt: 0.2, res: 0.3},
  'Clap':        {pitch: 1200, kick: 0, noise: 0.95, click: 0.2, decay: 130, filt: 0.3, res: 0.45, grain: 3, grainT: 11},
  'Closed hat':  {pitch: 5000, kick: 0, noise: 0.95, click: 0.4, decay: 45, filt: 0.62, res: 0.35},
  'Open hat':    {pitch: 6200, kick: 0, noise: 0.9, ring: 0.5, ringF: 7300, decay: 420, filt: 0.58, res: 0.3},
  'Tom':         {pitch: 110, kick: 0.5, kickT: 40, click: 0.3, decay: 320},
  'Rim':         {pitch: 620, kick: 0.25, kickT: 8, decay: 70, filt: -0.25, res: 0.6, click: 0.4},
  'Click':       {pitch: 1800, kick: 0.1, kickT: 5, click: 0.8, decay: 18, filt: 0.35},
  'Metal':       {pitch: 420, fm: 0.6, fmR: 3.73, ring: 0.8, ringF: 1730, kick: 0.1, decay: 320},
  'Zap':         {pitch: 300, kick: 1, kickT: 90, decay: 180, fm: 0.15, fmR: 0.5},
  'Glitch':      {pitch: 900, kick: 0.3, kickT: 10, decay: 70, grain: 6, grainT: 28, fm: 0.25, fmR: 2},
  'Bell':        {pitch: 880, kick: 0, fm: 0.35, fmR: 3.5, decay: 1400, atk: 1},
};

export const SYNTHS = {
  'Acid bass':   {oct: 0},
  'Squelch':     {oct: 0, cut: 250, res: 0.9, envAmt: 0.8, dec: 200, drive: 0.3},
  'Round bass':  {oct: 0, wave: 0, cut: 900, res: 0.2, envAmt: 0.2, sub: 0.5, sat: 0.1},
  'Square lead': {oct: 0, wave: 1, pw: 0.3, cut: 1800, res: 0.35, envAmt: 0.35, ampDec: 600, sus: 0.6, rel: 80},
  'Soft pluck':  {oct: 0, wave: 1, cut: 600, res: 0.3, envAmt: 0.7, dec: 180, ampDec: 300, sus: 0, rel: 150},
};

