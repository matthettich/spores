/* js/ui/preview.js: "Preview on click" — adding a step or changing a note plays that sound once (engine.hit, the same
 * 'hit' message the Sound picker uses). On by default; the choice is per computer (localStorage 'spores.preview'), like the
 * skin, not in the song. Only drum and synth tracks sound here: MIDI / CV tracks have no sound of their own.
 */
import {stepAt} from './stepedit.js';

const KEY = 'spores.preview';

export function previewOn(){
  try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; }
}
export function setPreview(on){
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, '0'); } catch (e) {}
}

// play the step at `where` ({scene, trackId, index}) now, if the setting is on and the step is a sounding drum / synth note
export function previewStep(engine, store, where){
  if (!previewOn() || !where) return;
  const song = store.get(), ti = song.tracks.findIndex(t => t.id === where.trackId), t = song.tracks[ti];
  const st = stepAt(song, where);
  if (!t || !st || !st.on || (t.type !== 'drum' && t.type !== 'synth')) return;
  Promise.resolve(engine.hit(ti, st.deg || 0, st.vel ?? 100, t.type === 'drum' ? null : st.chord || null)).catch(() => {});   // a chord: all of it
}
