/* js/ui/audiolane.js: the Steps grid's lane for an audio track. Instead of 16 step cells it shows this scene's take as a
 * waveform spanning the take's loop length (repeated faintly when the scene is longer than the take), or says there is
 * no take. The lane still holds one (inert) cell per step, so it lines up with the other lanes and the playhead (a
 * highlight on the current cell, see steps.js playhead) crosses it as it does the others. Tapping the lane selects the track.
 * Dragging the waveform sideways slides the take earlier or later (its Start offset): a take recorded with extra audio
 * either side (clip.pad) moves within that, with nothing wrapping round; one Undo step when let go.
 *
 *   const L = audioLane({t, ti, bars, onSelect, onOffset}) → {lane, cells, paint(song, sceneKey, rec)}
 *   onOffset(seconds): the drag's new offset, when let go
 * paint() is cheap to call on every change: it draws again only when the take, its settings, the size or the recording
 * state changed.
 */
import {STEPS_PER_BAR} from '../engine/engine.js';
import {el} from './dom.js';
import {trackColour} from './trackcolor.js';
import {peaksFor, missing, PEAK_BINS} from './peaks.js';

export function audioLane({t, ti, bars, onSelect, onOffset}){
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
  let sig = '', last = null, drag = null, moved = false;
  lane.addEventListener('click', () => { if (!moved) onSelect(ti); moved = false; });
  // drag: px → seconds by the take's loop length on screen (the first repeat); within ±pad (±250 ms for older takes)
  canvas.addEventListener('pointerdown', e => {
    const c = last && cur(last[0], last[1]); if (!c || !onOffset) return;
    const loopPx = Math.max(1, edge(Math.min(len, c.bars * STEPS_PER_BAR)) - edge(0));
    drag = {x: e.clientX, o0: c.offset || 0, lim: c.pad > 0 ? c.pad : 0.25, sPerPx: c.bars * 4 * 60 / (c.bpm || 120) / loopPx, o: c.offset || 0};
    canvas.setPointerCapture(e.pointerId); moved = false;
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x; if (Math.abs(dx) > 3) moved = true;
    if (!moved) return;
    drag.o = Math.max(-drag.lim, Math.min(drag.lim, drag.o0 - dx * drag.sPerPx));   // drag right = the sound later = start earlier in the take
    sig = ''; paint(...last);
  });
  const end = () => { if (!drag) return; const d = drag; drag = null; sig = ''; if (moved && Math.abs(d.o - d.o0) > 1e-4) onOffset(Math.round(d.o * 1000) / 1000); else paint(...last); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  const cur = (song, sceneKey) => { const sc = song.scenes[sceneKey]; return sc && sc.clips && sc.clips[t.id]; };
  const edge = i => i >= len ? cells[len - 1].offsetLeft + cells[len - 1].offsetWidth : cells[i].offsetLeft;
  new ResizeObserver(() => { if (last) paint(...last); }).observe(lane);   // shown again after the Song screen, or resized

  function paint(song, sceneKey, rec){
    last = [song, sceneKey, rec];
    const c0 = cur(song, sceneKey), clip = c0 && drag ? Object.assign({}, c0, {offset: drag.o}) : c0;
    const recHere = rec && rec.st.phase !== 'idle' && rec.st.trackId === t.id && rec.st.scene === sceneKey;
    const pk = clip ? peaksFor(clip.id, () => paint(...last)) : null;
    const w = lane.clientWidth, h = lane.clientHeight;
    const text = drag && moved ? `${clip.offset > 0 ? 'Earlier' : clip.offset < 0 ? 'Later' : 'As recorded'}${clip.offset ? ` by ${Math.abs(Math.round(clip.offset * 1000))} ms` : ''}`
      : recHere ? (rec.st.phase === 'count' ? 'Counting in…' : 'Recording…')
      : !clip ? 'No take in this scene · press Record'
      : pk ? '' : (missing(clip.id) ? 'This take’s sound isn’t on this computer' : 'Loading…');
    msg.textContent = text; msg.hidden = !text;
    lane.classList.toggle('empty', !clip || recHere);
    lane.classList.toggle('dragging', !!(drag && moved));
    canvas.title = clip && pk && onOffset ? 'Drag sideways to move the take earlier or later' : '';
    const key = [clip ? [clip.id, clip.bars, clip.gain, clip.offset, clip.pad, clip.reverse].join(',') : '', !!pk, recHere, bars, w, h, devicePixelRatio, t.color || ''].join('|');
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
    const left = edge;
    const shift = clip.offset * (pk.sr || 1) / Math.max(1, pk.length) * PEAK_BINS;   // offset in seconds → bins
    // a padded take: the loop is the window [pad + offset, … + loop length) of the samples, in bins; no wrapping
    const P = clip.pad > 0 ? Math.min(clip.pad * (pk.sr || 1), (pk.length - 2) / 3) : 0;
    const w0 = P ? (P + Math.max(-P, Math.min(P, clip.offset * (pk.sr || 1)))) / pk.length * PEAK_BINS : 0, wn = P ? (pk.length - 2 * P) / pk.length * PEAK_BINS : 0;
    for (let r = 0; r * L < len; r++){
      const a = left(r * L), z = left(Math.min(len, (r + 1) * L)) - (r * L + L < len ? 12 : 0);
      const frac = Math.min(1, (len - r * L) / L);
      g.globalAlpha = r ? 0.3 : 1;
      for (let x = a; x < z; x += 2){
        const p = (x - a) / ((z - a) / frac) / 1;
        let bin;
        if (P){ bin = Math.floor(w0 + (clip.reverse ? 1 - p : p) * wn); bin = Math.max(0, Math.min(PEAK_BINS - 1, bin)); }
        else {
          bin = Math.floor(p * PEAK_BINS + shift);
          bin = ((bin % PEAK_BINS) + PEAK_BINS) % PEAK_BINS;
          if (clip.reverse) bin = PEAK_BINS - 1 - bin;
        }
        const hi = Math.min(1, pk.max[bin] * clip.gain), lo = Math.max(-1, pk.min[bin] * clip.gain);
        const top = mid - hi * amp, bot = mid - lo * amp;
        g.fillRect(x, top, 2, Math.max(1.5, bot - top));
      }
    }
    g.globalAlpha = 1;
  }
  return {lane, cells, paint};
}
