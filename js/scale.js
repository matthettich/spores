/* js/scale.js: keys, scales, note names and note colours.
 *
 * A step stores `deg`: scale steps above the track's root (0 = root, 7 = root an octave up in a 7-note scale).
 * degToMidi() turns that into a MIDI note, so melodies stay in key when the key or scale changes.
 * Pure module (no DOM): the page, the store and the engine can all import it.
 */

export const KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
// Plain names for the key picker; the spec's song format stores these ('C', 'D', 'E♭'…). Sharps typed as '#' also work.
const KEY_ALIASES = {'C#': 1, 'Db': 1, 'D♭': 1, 'D#': 3, 'Eb': 3, 'D♯': 3, 'F#': 6, 'Gb': 6, 'G♭': 6, 'G#': 8, 'Ab': 8, 'G♯': 8, 'A#': 10, 'Bb': 10, 'A♯': 10};

export const SCALES = {
  major:      {name: 'Major',            iv: [0, 2, 4, 5, 7, 9, 11]},
  minor:      {name: 'Minor',            iv: [0, 2, 3, 5, 7, 8, 10]},
  dorian:     {name: 'Dorian',           iv: [0, 2, 3, 5, 7, 9, 10]},
  phrygian:   {name: 'Phrygian',         iv: [0, 1, 3, 5, 7, 8, 10]},
  lydian:     {name: 'Lydian',           iv: [0, 2, 4, 6, 7, 9, 11]},
  mixolydian: {name: 'Mixolydian',       iv: [0, 2, 4, 5, 7, 9, 10]},
  harmonic:   {name: 'Harmonic minor',   iv: [0, 2, 3, 5, 7, 8, 11]},
  penta:      {name: 'Major pentatonic', iv: [0, 2, 4, 7, 9]},
  pentaMinor: {name: 'Minor pentatonic', iv: [0, 3, 5, 7, 10]},
  chromatic:  {name: 'Chromatic',        iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]},
};

/* Note colours, by scale degree (HSL hue). The root is always pink, so untouched steps are pink and every note
   that was changed stands out. Values from the mockup (C minor: C D E♭ F G A♭ B♭). */
export const DEGREE_HUES = [330, 22, 44, 135, 178, 215, 265];
// Other scales (pentatonic, chromatic): a hue per semitone above the root, fitted round the 7 hues above, so a
// note keeps roughly the same colour whichever scale it is in.
const SEMI_HUES = [330, 0, 22, 44, 95, 135, 158, 178, 215, 240, 265, 298];

export function keyIndex(key){
  if (typeof key === 'number') return ((key % 12) + 12) % 12;
  const i = KEYS.indexOf(key); if (i >= 0) return i;
  return KEY_ALIASES[key] ?? (['C', 'D', 'E', 'F', 'G', 'A', 'B'].includes(key) ? [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(key)] : 0);
}

export function scaleOf(name){ return SCALES[name] || SCALES.minor; }

/* `oct` is the track's root octave in MIDI terms (C-1 = octave -1, so C3 = 48 with oct 3).
   Negative degrees go below the root. */
export function degToMidi(deg, key, scale, oct = 3){
  const iv = scaleOf(scale).iv, n = iv.length, d = Math.round(deg) || 0;
  const o = Math.floor(d / n), i = d - o * n;
  return Math.max(0, Math.min(127, 12 * (oct + 1) + keyIndex(key) + iv[i] + 12 * o));
}

// The note's name without octave ('E♭'), as printed on a step.
export function degName(deg, key, scale){ return KEYS[degToMidi(deg, key, scale, 4) % 12]; }

export function midiName(note){ return KEYS[note % 12] + (Math.floor(note / 12) - 1); }

/* Colour for a step: {top, bottom, text}. Each step is drawn as a top-to-bottom gradient; higher octaves are
   brighter; text is black or white, whichever reads better. */
export function noteColor(deg, scale){
  const iv = scaleOf(scale).iv, n = iv.length, d = Math.round(deg) || 0;
  const o = Math.floor(d / n), i = d - o * n;
  const hue = n === 7 ? DEGREE_HUES[i] : SEMI_HUES[iv[i]];
  const L = Math.max(22, Math.min(82, 52 + o * 12));   // octave 0 = 52 %, each octave up +12
  const top = hsl(hue, 78, Math.min(90, L + 8)), bottom = hsl(hue, 70, Math.max(16, L - 8));
  return {hue, top, bottom, text: luminance(hue, 74, L) > 0.42 ? '#000' : '#fff'};
}

function hsl(h, s, l){ return `hsl(${h} ${s}% ${l}%)`; }

// Relative luminance of an HSL colour (WCAG), used to pick black or white text.
function luminance(h, s, l){
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const lin = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}
