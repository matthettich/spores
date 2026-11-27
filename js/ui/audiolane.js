/* js/ui/audiolane.js: the Steps grid's lane for an audio track. Instead of 16 step cells it shows this scene's take as a
 * waveform spanning the take's loop length (repeated faintly when the scene is longer than the take), or says there is
 * no take. The lane still holds one (inert) cell per step, so it lines up with the other lanes and the playhead (a
 * highlight on the current cell, see steps.js playhead) crosses it as it does the others. Tapping the lane selects the track.
 *
 *   const L = audioLane({t, ti, bars, onSelect}) → {lane, cells, paint(song, sceneKey, rec)}
 * paint() is cheap to call on every change: it draws again only when the take, its settings, the size or the recording
 * state changed.
 */
import {STEPS_PER_BAR} from '../engine/engine.js';
import {el} from './dom.js';
import {trackColour} from './trackcolor.js';
import {peaksFor, missing, PEAK_BINS} from './peaks.js';

export function audioLane({t, ti, bars, onSelect}){
  const len = bars * STEPS_PER_BAR;
  const lane = el('div', {class: 'lane audio', style: {'--rowc': trackColour(t)}});
  const cells = [];
  for (let i = 0; i < len; i++){
    const c = el('span', {class: 'cell acell' + (i % 8 < 4 ? ' dk' : '') + (i % 16 === 0 && i > 0 ? ' barstart' : i % 4 === 0 && i > 0 ? ' beatstart' : ''), 'aria-hidden': 'true'});
    lane.append(c); cells.push(c);
  }
  const canvas = el('canvas', {class: 'wave', 'aria-hidden': 'true'});
  const msg = el('div', {class: 'lanemsg'});
  lane.append(canvas, msg);
  lane.addEventListener('click', () => onSelect(ti));
  let sig = '', last = null;
  new ResizeObserver(() => { if (last) paint(...last); }).observe(lane);   // shown again after the Song screen, or resized

  function paint(song, sceneKey, rec){
    last = [song, sceneKey, rec];
    const sc = song.scenes[sceneKey], clip = sc && sc.clips && sc.clips[t.id];
    const recHere = rec && rec.st.phase !== 'idle' && rec.st.trackId === t.id && rec.st.scene === sceneKey;
    const pk = clip ? peaksFor(clip.id, () => paint(...last)) : null;
    const w = lane.clientWidth, h = lane.clientHeight;
    const text = recHere ? (rec.st.phase === 'count' ? 'Counting in…' : 'Recording…')
      : !clip ? 'No take in this scene · press Record'
      : pk ? '' : (missing(clip.id) ? 'This take’s sound isn’t on this computer' : 'Loading…');
    msg.textContent = text; msg.hidden = !text;
    lane.classList.toggle('empty', !clip || recHere);
    const key = [clip ? [clip.id, clip.bars, clip.gain, clip.offset, clip.reverse].join(',') : '', !!pk, recHere, bars, w, h, devicePixelRatio, t.color || ''].join('|');
    if (key === sig || !w) return;
    sig = key;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!clip || !pk || recHere) return;
    g.scale(dpr, dpr);
    g.fillStyle = getComputedStyle(lane).color;
    const L = clip.bars * STEPS_PER_BAR, mid = h / 2, amp = mid - 6;
    const left = i => i >= len ? cells[len - 1].offsetLeft + cells[len - 1].offsetWidth : cells[i].offsetLeft;
    const shift = clip.offset * (pk.sr || 1) / Math.max(1, pk.length) * PEAK_BINS;   // offset in seconds → bins
    for (let r = 0; r * L < len; r++){
      const a = left(r * L), z = left(Math.min(len, (r + 1) * L)) - (r * L + L < len ? 12 : 0);
      const frac = Math.min(1, (len - r * L) / L);
      g.globalAlpha = r ? 0.3 : 1;
      for (let x = a; x < z; x += 2){
        const p = (x - a) / ((z - a) / frac) / 1;
        let bin = Math.floor(p * PEAK_BINS + shift);
        bin = ((bin % PEAK_BINS) + PEAK_BINS) % PEAK_BINS;
        if (clip.reverse) bin = PEAK_BINS - 1 - bin;
        const hi = Math.min(1, pk.max[bin] * clip.gain), lo = Math.max(-1, pk.min[bin] * clip.gain);
        const top = mid - hi * amp, bot = mid - lo * amp;
        g.fillRect(x, top, 2, Math.max(1.5, bot - top));
      }
    }
    g.globalAlpha = 1;
  }
  return {lane, cells, paint};
}
