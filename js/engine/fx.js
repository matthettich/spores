/* js/engine/fx.js: the track effects' table (names, groups, settings, what they send to tfx.wasm). 🔴 Claude only.
 *
 * The effects are ...Thunder Plus' track effects, run from tfx.wasm (a copy of thunder-plus/waves/dsp/tfx.wasm, see
 * tools/copy-fx.sh; never edit it by hand). Every setting below is copied from Thunder Plus' TFX table (index.html,
 * `const TFX = {`): its key, default, range and the text shown for a value; labels are in plain English here. Values are
 * Thunder's own: whole numbers, mostly 0–255 (128 = exactly the middle), some in their own units (Time in steps, Note as
 * a MIDI note, Pitch in semitones). `map` is Thunder's, turning them into the 12 numbers the wasm effect reads.
 *
 *   FX_LIST                 [{type, name, group, about}] in menu order; FX_GROUPS the group names in order
 *   fxInfo(type)            → {type, name, group, about, id, params:[{key, label, def, min, max, names?, main}], main:[keys]}
 *   fxDefaults(type)        → {key: default} (a new effect's `p`)
 *   fxText(type, key, v)    → the value as shown ("−3.0 dB", "4 steps · 500 ms", "Granular")
 *   fxMap(type, p, sr, bpm, restart) → 12 numbers for the wasm (worklet.js / fxhost.js)
 * Used by the worklet too, so nothing here touches the page.
 */

export const MAX_FX = 4;   // per track
/* in the whole song (the Add menu's limit; a file with more still plays them all, up to 64). Measured (tests/fx-check.mjs,
   2.1 GHz Xeon, one 128-frame block = 2667 µs at 48 kHz): 64 effects of every kind 1.8 ms, but 64 of the heaviest
   (Space, Speaker cab, Tape, Galaxy) 4.4 ms, over real time; 32 of the heaviest 2.0 ms. So 32 by default. */
export const MAX_SONG_FX = 32;
export const FX_GROUPS = ['Space', 'Echo', 'Drive & colour', 'Filter & tone', 'Movement', 'Pitch', 'Dynamics', 'Experimental'];

// Thunder's helpers (index.html), unchanged
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const u8 = v => v === 128 ? 0.5 : clamp(v, 0, 255) / 255;
const sdb = d => (d > 0.05 ? '+' : d < -0.05 ? '−' : '±') + Math.abs(d).toFixed(1) + ' dB';
const pc = v => Math.round(u8(v) * 100) + '%';
const khz = k => k.toFixed(1) + ' kHz';
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
const dlySec = (steps, bpm) => steps * 15 / bpm;
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = v => NOTE[((v % 12) + 12) % 12] + (Math.floor(v / 12) - 1);
const hz = v => (v < 10 ? v.toFixed(2) : Math.round(v)) + ' Hz';
const wet = v => pc(v) + ' wet';
const signedPc = v => { const x = -1 + 2 * u8(v); return (x > 0 ? '+' : '') + Math.round(x * 100) + '%'; };
const dbPm12 = v => { const x = -12 + 24 * u8(v); return (x > 0 ? '+' : '') + x.toFixed(1) + ' dB'; };
const SPACE_SIZE_MAX = 0.99;   // Space reverb: Size exactly 1 never decays (Thunder's note)
// rvMix (Thunder's REVERB MIX): every reverb's Mix is an equal-power dry fade and a sin² tail. → [dry gain, wet gain]
export function rvMix(m){ const a = clamp(m, 0, 1) * Math.PI / 2, s = Math.sin(a); return [Math.cos(a), s * s]; }

// P(key, label, default, text, min = 0, max = 255) and E(key, label, default, names) as Thunder's P_ / EN
const P = (key, label, def, fmt, min = 0, max = 255) => ({key, label, def, fmt, min, max});
const E = (key, label, def, names) => ({key, label, def, min: 0, max: names.length - 1, names});

/* type: {name, group, about, id (the wasm's effect number), main (Simple mode's knobs), params, map,
   wet (index in map()'s list of a reverb's own mix: run fully wet, blended with rvMix), hard (map() indices that jump
   to a new value instead of gliding: modes, patterns, counts)} */
const T = {
  reverb: {name: 'Galaxy reverb', group: 'Space', about: 'A huge, shimmering hall (Airwindows Galactic)', id: 8, wet: 4, main: ['mix', 'big', 'bright'], params: [
    P('replace', 'Replace', 128, pc), P('bright', 'Brightness', 128, pc), P('detune', 'Detune', 128, pc), P('big', 'Size', 255, pc),
    P('mix', 'Mix', 48, v => Math.round(u8(v) * 100) + '% wet')],
    map: f => [u8(f.replace), u8(f.bright), u8(f.detune), u8(f.big), u8(f.mix)]},
  space: {name: 'Space reverb', group: 'Space', about: 'A smooth, deep reverb (Cloud Seed by Ghost Note Audio)', id: 20, wet: 7, main: ['mix', 'size', 'decay'], params: [
    P('size', 'Size', 128, pc), P('decay', 'Decay', 140, pc), P('diff', 'Diffusion', 178, pc), P('mod', 'Modulation', 102, pc),
    P('tone', 'Tone', 153, pc), P('lowcut', 'Low cut', 51, pc), P('pre', 'Pre-delay', 26, pc), P('mix', 'Mix', 89, pc)],
    map: f => [Math.min(u8(f.size), SPACE_SIZE_MAX), u8(f.decay), u8(f.diff), u8(f.mod), u8(f.tone), u8(f.lowcut), u8(f.pre), u8(f.mix)]},
  room: {name: 'Room', group: 'Space', about: 'A small, natural room (Airwindows Verbity2)', id: 24, wet: 3, main: ['wet', 'size'], params: [
    P('size', 'Size', 128, pc), P('sustain', 'Sustain', 128, pc), P('mulch', 'Mulch', 128, pc), P('wet', 'Mix', 89, pc)],
    map: f => [u8(f.size), u8(f.sustain), u8(f.mulch), u8(f.wet)]},

  delay: {name: 'Tape echo', group: 'Echo', about: 'Echoes in time with the song (Airwindows TapeDelay2)', id: 9, main: ['steps', 'regen', 'mix'], params: [
    P('steps', 'Time', 3, (v, bpm = 120) => { const s = dlySec(v, bpm); return `${v} step${v > 1 ? 's' : ''} · ` + (s > 1.83 ? 'max 1.8 s' : s < 0.07 ? 'min 70 ms' : Math.round(s * 1000) + ' ms'); }, 1, 32),
    P('regen', 'Repeats', 96, pc), P('freq', 'Tone', 128, pc), P('reso', 'Resonance', 0, pc), P('flutter', 'Flutter', 0, pc),
    P('mix', 'Mix', 64, v => `wet ${Math.round(Math.min(1, u8(v) * 2) * 100)}% · dry ${Math.round(Math.min(1, 2 - u8(v) * 2) * 100)}%`)],
    // TapeDelay2's tape runs through 88200 samples at "speed" 1–26 per sample, so speed sets the time.
    map: (f, sr, bpm) => { const sp = clamp(88200 / (dlySec(f.steps, bpm) * sr), 1, 26); return [Math.pow((sp - 1) / 25, 0.25), u8(f.regen), u8(f.freq), u8(f.reso), u8(f.flutter), u8(f.mix)]; }},

  density: {name: 'Saturation', group: 'Drive & colour', about: 'Thickens and warms (Airwindows Density)', id: 2, main: ['drive', 'out', 'mix'], params: [
    P('drive', 'Drive', 102, pc), P('hipass', 'High-pass', 0, pc), P('out', 'Output', 204, pc), P('mix', 'Mix', 255, wet)],
    map: f => [0.2 + u8(f.drive) * 0.8, u8(f.hipass), u8(f.out), u8(f.mix)]},
  tape: {name: 'Tape', group: 'Drive & colour', about: 'The sound of tape (Airwindows ToTape6)', id: 3, main: ['input', 'soften', 'flutter'], params: [
    P('input', 'Input', 128, pc), P('soften', 'Soften', 128, pc), P('bump', 'Head bump', 128, pc), P('flutter', 'Flutter', 128, pc),
    P('out', 'Output', 128, pc), P('mix', 'Mix', 255, wet)],
    map: f => [u8(f.input), u8(f.soften), u8(f.bump), u8(f.flutter), u8(f.out), u8(f.mix)]},
  odrive: {name: 'Overdrive', group: 'Drive & colour', about: 'Crunchy pedal drive (DaisySP Overdrive)', id: 14, main: ['drive', 'tone', 'out'], params: [
    P('drive', 'Drive', 128, pc), P('tone', 'Tone', 153, pc), P('out', 'Output', 51, pc), P('mix', 'Mix', 255, pc)],
    map: f => [u8(f.drive), u8(f.tone), u8(f.out), u8(f.mix)]},
  drive: {name: 'Clean drive', group: 'Drive & colour', about: 'Gentle, clean saturation (Airwindows PurestDrive)', id: 22, main: ['drive'], params: [
    P('drive', 'Drive', 128, pc)],
    map: f => [u8(f.drive)]},
  tube: {name: 'Tube', group: 'Drive & colour', about: 'Valve warmth (Airwindows Tube2)', id: 33, main: ['input', 'tube'], params: [
    P('input', 'Input', 128, pc), P('tube', 'Tube', 128, pc)],
    map: f => [u8(f.input), u8(f.tube)]},
  folder: {name: 'Wavefolder', group: 'Drive & colour', about: 'Folds the wave over for buzzy overtones (DaisySP Wavefolder)', id: 15, main: ['gain', 'offset', 'mix'], params: [
    P('gain', 'Fold', 118, v => (Math.pow(20, u8(v))).toFixed(1) + '×'), P('offset', 'Offset', 128, v => (-1 + 2 * u8(v)).toFixed(2)),
    P('out', 'Output', 153, pc), P('mix', 'Mix', 255, pc)],
    map: f => [Math.pow(20, u8(f.gain)), -1 + 2 * u8(f.offset), u8(f.out), u8(f.mix)]},
  crush: {name: 'Bitcrusher', group: 'Drive & colour', about: 'Fewer bits, lower rate (DaisySP Decimator)', id: 5, main: ['down', 'bits', 'mix'], hard: [1, 2], params: [
    P('down', 'Downsample', 102, pc), P('bits', 'Bits', 8, v => v + ' bit', 1, 16), E('smooth', 'Crush', 0, ['Hard', 'Smooth']), P('mix', 'Mix', 255, wet)],
    map: f => [u8(f.down), f.bits, f.smooth, u8(f.mix)]},
  lofi: {name: 'Lo-fi', group: 'Drive & colour', about: 'Grainy, old-sampler sound (Airwindows DeRez2)', id: 21, main: ['rate', 'rez', 'mix'], params: [
    P('rate', 'Rate', 153, pc), P('rez', 'Bits', 153, pc), P('hard', 'Hardness', 128, pc), P('mix', 'Mix', 255, pc)],
    map: f => [u8(f.rate), u8(f.rez), u8(f.hard), u8(f.mix)]},
  vinyl: {name: 'Vinyl', group: 'Drive & colour', about: 'A record’s tone and wear (Airwindows ToVinyl4)', id: 30, main: ['wear', 'hlim'], params: [
    P('mlow', 'Mid low cut', 51, pc), P('slow', 'Side low cut', 87, pc), P('hlim', 'High limit', 82, pc), P('wear', 'Groove wear', 76, pc)],
    map: f => [u8(f.mlow), u8(f.slow), u8(f.hlim), u8(f.wear)]},
  dub: {name: 'Dub tape', group: 'Drive & colour', about: 'Thick, dubby tape colour (Airwindows Dubly)', id: 31, main: ['amt', 'mix'], params: [
    P('amt', 'Amount', 128, pc), P('mix', 'Mix', 255, pc)],
    map: f => [u8(f.amt), u8(f.mix)]},
  cab: {name: 'Speaker cab', group: 'Drive & colour', about: 'As if played through a speaker (Airwindows Cabs)', id: 32, main: ['model', 'int', 'room'], hard: [0], params: [
    E('model', 'Cab', 0, ['Stack', 'Vintage', 'Boutique', 'Large closed', 'Small closed', 'Bass']), P('int', 'Intensity', 168, pc), P('room', 'Room', 84, pc),
    P('size', 'Size', 168, pc), P('axis', 'Off axis', 84, pc), P('out', 'Output', 204, pc)],
    map: f => [(f.model + 0.5) / 6, u8(f.int), u8(f.room), u8(f.size), u8(f.axis), u8(f.out)]},

  eq: {name: 'EQ', group: 'Filter & tone', about: 'Bass, mid and treble (Airwindows EQ)', id: 6, main: ['bass', 'mid', 'treble'], params: [
    P('treble', 'Treble', 128, v => sdb(u8(v) * 24 - 12)), P('mid', 'Mid', 128, v => sdb(u8(v) * 24 - 12)), P('bass', 'Bass', 128, v => sdb(u8(v) * 24 - 12)),
    P('lowpass', 'Low-pass', 255, v => khz(u8(v) * u8(v) * 15 + 1)), P('tfreq', 'Treble freq', 102, v => khz(u8(v) * u8(v) * 15 + 1)),
    P('bfreq', 'Bass freq', 102, v => Math.round(u8(v) * u8(v) * 1570 + 30) + ' Hz'), P('hipass', 'High-pass', 0, v => v ? Math.round(u8(v) * u8(v) * 1570 + 30) + ' Hz' : 'off'),
    P('out', 'Output', 128, v => sdb(u8(v) * 36 - 18))],
    map: f => [u8(f.treble), u8(f.mid), u8(f.bass), u8(f.lowpass), u8(f.tfreq), u8(f.bfreq), u8(f.hipass), u8(f.out)]},
  ladder: {name: 'Ladder filter', group: 'Filter & tone', about: 'A classic synth filter (DaisySP LadderFilter)', id: 18, main: ['cut', 'res', 'mode'], hard: [3], params: [
    P('cut', 'Cutoff', 150, v => hz(30 * Math.pow(533.3333333333334, u8(v)))), P('res', 'Resonance', 85, v => (1.8 * u8(v)).toFixed(2)),
    P('drive', 'Drive', 64, v => (4 * u8(v)).toFixed(2)), E('mode', 'Type', 0, ['Low-pass 24', 'Low-pass 12', 'Band-pass 24', 'Band-pass 12', 'High-pass 24', 'High-pass 12']),
    P('mix', 'Mix', 255, pc)],
    map: f => [30 * Math.pow(533.3333333333334, u8(f.cut)), 1.8 * u8(f.res), 4 * u8(f.drive), f.mode, u8(f.mix)]},
  autowah: {name: 'Auto-wah', group: 'Filter & tone', about: 'A wah that follows how loud you play (DaisySP Autowah)', id: 16, main: ['wah', 'mix'], params: [
    P('wah', 'Wah', 153, pc), P('level', 'Level', 204, pc), P('mix', 'Mix', 255, pc)],
    map: f => [u8(f.wah), u8(f.level), u8(f.mix)]},
  air: {name: 'Air', group: 'Filter & tone', about: 'More or less sparkle and weight (Airwindows Air3)', id: 23, main: ['air', 'gnd'], params: [
    P('air', 'Air', 128, signedPc), P('gnd', 'Ground', 128, signedPc)],
    map: f => [u8(f.air), u8(f.gnd)]},
  comb: {name: 'Comb resonator', group: 'Filter & tone', about: 'Rings at a note (Thunder original)', id: 25, main: ['note', 'fb', 'mix'], params: [
    P('note', 'Note', 48, noteName, 24, 96), P('fb', 'Feedback', 237, v => { const x = -0.99 + 1.98 * u8(v); return (x < 0 ? 'hollow ' : '') + Math.round(Math.abs(x) * 100) + '%'; }),
    P('damp', 'Damping', 77, v => Math.round(0.99 * u8(v) * 100) + '%'), P('spread', 'Spread', 41, v => Math.round(50 * u8(v)) + ' cents'), P('mix', 'Mix', 153, pc)],
    map: f => [440 * Math.pow(2, (f.note - 69) / 12), -0.99 + 1.98 * u8(f.fb), 0.99 * u8(f.damp), 50 * u8(f.spread), u8(f.mix)]},

  chorus: {name: 'Chorus', group: 'Movement', about: 'Wide and shimmery (DaisySP Chorus)', id: 4, main: ['depth', 'rate', 'mix'], params: [
    P('depth', 'Depth', 128, pc), P('rate', 'Rate', 105, v => (0.05 * Math.pow(160, u8(v))).toFixed(2) + ' Hz'),
    P('delay', 'Delay', 62, v => (1 + u8(v) * 29).toFixed(1) + ' ms'), P('fb', 'Feedback', 54, v => Math.round(u8(v) * 95) + '%'), P('mix', 'Mix', 128, wet)],
    map: f => [u8(f.depth), 0.05 * Math.pow(160, u8(f.rate)), 1 + u8(f.delay) * 29, u8(f.fb) * 0.95, u8(f.mix)]},
  flanger: {name: 'Flanger', group: 'Movement', about: 'A jet-plane swoosh (DaisySP Flanger)', id: 11, main: ['depth', 'rate', 'fb'], params: [
    P('depth', 'Depth', 128, pc), P('rate', 'Rate', 99, v => hz(0.05 * Math.pow(100, u8(v)))), P('delay', 'Delay', 128, v => (0.1 + u8(v) * 6.9).toFixed(1) + ' ms'),
    P('fb', 'Feedback', 134, v => Math.round(0.95 * u8(v) * 100) + '%'), P('mix', 'Mix', 128, pc)],
    map: f => [u8(f.depth), 0.05 * Math.pow(100, u8(f.rate)), u8(f.delay), 0.95 * u8(f.fb), u8(f.mix)]},
  phaser: {name: 'Phaser', group: 'Movement', about: 'A swirling, sweeping sound (DaisySP Phaser)', id: 12, main: ['depth', 'rate', 'fb'], hard: [4], params: [
    P('depth', 'Depth', 178, pc), P('rate', 'Rate', 99, v => hz(0.05 * Math.pow(100, u8(v)))), P('freq', 'Centre', 124, v => hz(100 * Math.pow(40, u8(v)))),
    P('fb', 'Feedback', 113, v => Math.round(0.9 * u8(v) * 100) + '%'), P('poles', 'Poles', 4, v => String(v), 1, 8), P('mix', 'Mix', 153, pc)],
    map: f => [u8(f.depth), 0.05 * Math.pow(100, u8(f.rate)), 100 * Math.pow(40, u8(f.freq)), 0.9 * u8(f.fb), f.poles, u8(f.mix)]},
  tremolo: {name: 'Tremolo', group: 'Movement', about: 'The volume wobbles (DaisySP Tremolo)', id: 13, main: ['rate', 'depth'], hard: [2], params: [
    P('rate', 'Rate', 159, v => hz(0.5 * Math.pow(40, u8(v)))), P('depth', 'Depth', 178, pc), E('shape', 'Shape', 0, ['Sine', 'Triangle', 'Saw', 'Ramp', 'Square'])],
    map: f => [0.5 * Math.pow(40, u8(f.rate)), u8(f.depth), f.shape]},
  tgate: {name: 'Trance gate', group: 'Movement', about: 'Chops the sound in time with the song (Thunder original)', id: 27, main: ['pat', 'div', 'depth'], hard: [0, 4, 5, 6, 7], params: [
    E('div', 'Step', 2, ['1/32', '1/16 triplet', '1/16', '1/8 triplet', '1/8', '1/4']),
    E('pat', 'Pattern', 4, ['All steps', 'Every other', 'Offbeats', '3-3-2', 'Trance 1', 'Trance 2', 'Stutter', 'Sparse', 'Clave']),
    P('len', 'Length', 148, v => Math.round((0.05 + 0.95 * u8(v)) * 100) + '%'), P('depth', 'Depth', 255, pc),
    P('smooth', 'Smoothing', 112, v => Math.round(0.5 * Math.pow(60, u8(v))) + ' ms')],
    // restart / wait (6, 7): the gate's pattern starts again `wait` seconds after `restart` changes (fxhost.js: on Play)
    map: (f, sr, bpm, restart = 0, wait = 0) => [bpm / 60 / [0.125, 0.16666667, 0.25, 0.33333333, 0.5, 1][f.div], 0.05 + 0.95 * u8(f.len), u8(f.depth),
      0.5 * Math.pow(60, u8(f.smooth)), [65535, 21845, 43690, 18761, 22235, 54749, 4879, 4353, 5193][f.pat], 16, restart, wait]},

  pshift: {name: 'Pitch shifter', group: 'Pitch', about: 'Moves the pitch up or down (DaisySP PitchShifter)', id: 17, main: ['semis', 'mix'], params: [
    P('semis', 'Pitch', 7, v => (v > 0 ? '+' : '') + v + ' st', -24, 24), P('win', 'Window', 156, v => Math.round(10 * Math.pow(30, u8(v))) + ' ms'),
    P('spray', 'Spray', 0, pc), P('mix', 'Mix', 255, pc)],
    map: f => [f.semis, 10 * Math.pow(30, u8(f.win)), u8(f.spray), u8(f.mix)]},
  fshift: {name: 'Frequency shifter', group: 'Pitch', about: 'Shifts every frequency by the same amount: metallic, strange (Thunder original)', id: 29, main: ['shift', 'fb', 'mix'], params: [
    P('shift', 'Shift', 147, v => { const x = -1 + 2 * u8(v); return (x > 0 ? '+' : '') + Math.round(Math.sign(x) * x * x * 2000) + ' Hz'; }),
    P('fb', 'Feedback', 0, v => Math.round(0.9 * u8(v) * 100) + '%'), P('mix', 'Mix', 255, pc)],
    map: f => { const x = -1 + 2 * u8(f.shift); return [Math.sign(x) * x * x * 2000, 0.9 * u8(f.fb), u8(f.mix)]; }},

  comp: {name: 'Compressor', group: 'Dynamics', about: 'Evens out loud and quiet (Airwindows Pressure4)', id: 7, main: ['press', 'speed', 'out'], params: [
    P('press', 'Pressure', 102, v => v ? pc(v) : 'off'), P('speed', 'Speed', 51, pc), P('mew', 'Mewiness', 255, v => (u8(v) * 2 - 1).toFixed(2)),
    P('out', 'Output', 255, pc), P('mix', 'Mix', 255, wet)],
    map: f => [u8(f.press), u8(f.speed), u8(f.mew), u8(f.out), u8(f.mix)]},
  ott: {name: 'Multiband squash', group: 'Dynamics', about: 'Loud, bright and in your face, like OTT (Thunder original)', id: 28, main: ['depth', 'time'], params: [
    P('depth', 'Depth', 128, pc), P('time', 'Time', 102, pc), P('lo', 'Low', 128, dbPm12), P('mid', 'Mid', 128, dbPm12), P('hi', 'High', 128, dbPm12), P('out', 'Output', 128, dbPm12)],
    map: f => [u8(f.depth), u8(f.time), -12 + 24 * u8(f.lo), -12 + 24 * u8(f.mid), -12 + 24 * u8(f.hi), -12 + 24 * u8(f.out)]},
  transient: {name: 'Transient shaper', group: 'Dynamics', about: 'More or less punch and ring (Thunder original)', id: 26, main: ['att', 'sus'], params: [
    P('att', 'Attack', 191, signedPc), P('sus', 'Sustain', 128, signedPc), P('out', 'Output', 128, v => Math.round(2 * u8(v) * 100) + '%'), P('mix', 'Mix', 255, pc)],
    map: f => [-1 + 2 * u8(f.att), -1 + 2 * u8(f.sus), 2 * u8(f.out), u8(f.mix)]},

  rings: {name: 'Resonator', group: 'Experimental', about: 'Strings and bells that ring with the sound (Mutable Instruments Rings)', id: 0, main: ['note', 'structure', 'mix'], hard: [0, 1], params: [
    E('model', 'Model', 0, ['Modal', 'Sympathetic', 'String', 'FM voice', 'Quantized', 'String + reverb']), E('poly', 'Voices', 0, ['1', '2', '4']),
    P('note', 'Note', 48, noteName, 24, 84), P('structure', 'Structure', 102, pc), P('bright', 'Brightness', 128, pc), P('damp', 'Damping', 153, pc),
    P('pos', 'Position', 77, pc), P('input', 'Input', 128, v => (u8(v) * 2).toFixed(2) + '×'), P('mix', 'Mix', 204, wet)],
    map: f => [f.model, [1, 2, 4][f.poly] || 1, f.note, u8(f.structure), u8(f.bright), u8(f.damp), u8(f.pos), u8(f.input) * 2, u8(f.mix)]},
  clouds: {name: 'Grain cloud', group: 'Experimental', about: 'Breaks the sound into grains: smears, stretches, freezes (Mutable Instruments Clouds)', id: 1,
    main: ['density', 'size', 'blend'], hard: [0, 1, 2], params: [
    E('mode', 'Mode', 0, ['Granular', 'Stretch', 'Loop delay', 'Spectral']), E('lofi', 'Quality', 0, ['Hi-fi', 'Lo-fi']), E('freeze', 'Freeze', 0, ['Off', 'On']),
    P('pos', 'Position', 26, pc), P('size', 'Size', 128, pc), P('pitch', 'Pitch', 0, v => sgn(v) + ' st', -24, 24), P('density', 'Density', 153, pc),
    P('texture', 'Texture', 128, pc), P('blend', 'Mix', 128, wet), P('fb', 'Feedback', 51, pc), P('verb', 'Reverb', 128, pc), P('spread', 'Spread', 128, pc)],
    map: f => [f.mode, f.lofi, f.freeze, u8(f.pos), u8(f.size), f.pitch, u8(f.density), u8(f.texture), u8(f.blend), u8(f.fb), u8(f.verb), u8(f.spread)]},
  beads: {name: 'Grain texture', group: 'Experimental', about: 'Dusty, smeared grains and echoes (Mutable Instruments Beads)', id: 10, main: ['time', 'density', 'blend'], hard: [0, 2], params: [
    E('media', 'Media', 3, ['Digital', 'Vintage', 'Tape', 'Dusty']), E('freeze', 'Freeze', 0, ['Off', 'On']),
    P('time', 'Time', 51, pc), P('size', 'Size', 128, pc), P('pitch', 'Pitch', 128, pc), P('shape', 'Shape', 128, pc),
    P('density', 'Density', 217, pc), P('fb', 'Feedback', 51, pc), P('blend', 'Mix', 255, wet), P('verb', 'Reverb', 64, pc)],
    map: f => [f.media | 0, 0, f.freeze >= 0.5 ? 1 : 0, u8(f.time), Math.min(u8(f.size), 0.995), u8(f.pitch), u8(f.shape), u8(f.density), u8(f.fb), u8(f.blend), u8(f.verb), 0]},
  xmod: {name: 'Cross-mod', group: 'Experimental', about: 'Ring-mod, folds and vocoder against a built-in tone (Mutable Instruments Warps)', id: 19, main: ['alg', 'timbre', 'note'], hard: [4], params: [
    P('alg', 'Algorithm', 76, v => ['Crossfade', 'Fold', 'Analog ring', 'Digital ring', 'XOR', 'Compare', 'Morph', 'Vocoder', 'Vocoder'][Math.min(8, Math.round(u8(v) * 8))]),
    P('timbre', 'Timbre', 128, pc),
    // Thunder's Carrier also offers "Input R" (another track as the carrier): a Spores track is one sound, so only the built-in tones
    E('carrier', 'Tone', 2, ['Sine', 'Triangle', 'Saw']), P('note', 'Note', 48, noteName, 24, 96),
    P('clvl', 'Tone level', 204, pc), P('mlvl', 'Input level', 204, pc), P('mix', 'Mix', 255, pc)],
    map: f => [u8(f.alg), u8(f.timbre), u8(f.clvl), u8(f.mlvl), f.carrier + 1, f.note, u8(f.mix)]},
};

// menu order: by group, then as listed above
export const FX_TYPES = FX_GROUPS.flatMap(g => Object.keys(T).filter(k => T[k].group === g));
export const FX_LIST = FX_TYPES.map(type => ({type, name: T[type].name, group: T[type].group, about: T[type].about}));
export const isFxType = type => typeof type === 'string' && Object.prototype.hasOwnProperty.call(T, type);

export function fxInfo(type){
  const d = T[type]; if (!d) return null;
  return {type, name: d.name, group: d.group, about: d.about, id: d.id, main: d.main.slice(),
    params: d.params.map(p => ({key: p.key, label: p.label, def: p.def, min: p.min, max: p.max, names: p.names ? p.names.slice() : undefined, main: d.main.includes(p.key)}))};
}
export function fxDefaults(type){ const d = T[type], o = {}; if (d) for (const p of d.params) o[p.key] = p.def; return o; }
// a value as shown; bpm only matters for the echo's Time
export function fxText(type, key, v, bpm = 120){
  const d = T[type], p = d && d.params.find(q => q.key === key); if (!p) return '';
  if (p.names) return p.names[clamp(Math.round(v), 0, p.names.length - 1)] || '';
  return p.fmt(v, bpm);
}
// whole numbers within the setting's range; anything missing or odd → its default
export function fxClean(type, p){
  const d = T[type], o = {}; if (!d) return o;
  for (const q of d.params){ const v = p && p[q.key]; o[q.key] = typeof v === 'number' && isFinite(v) ? clamp(Math.round(v), q.min, q.max) : q.def; }
  return o;
}
// → {id, P: Float32Array(12), wet, hard} for the wasm (P[wet] still holds the reverb's mix: the host runs it at 1)
export function fxMap(type, p, sr, bpm, restart = 0, wait = 0){
  const d = T[type]; if (!d) return null;
  const v = d.map(fxClean(type, p), sr, Math.max(20, Math.min(300, bpm || 120)), restart, wait), P = new Float32Array(12);
  for (let i = 0; i < v.length && i < 12; i++) P[i] = +v[i] || 0;
  return {id: d.id, P, wet: d.wet ?? -1, hard: d.hard || []};
}
