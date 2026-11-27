/* js/ui/songwave.js: geometry and drawing for the Song screen's song-length lane (used by songlane.js).
 * The lane sits under the scene blocks and lines up with them: each block's card is a stretch of the lane, divided
 * evenly into that block's bars × repeats (js/songmap.js), so a repeated block shows the take again where it repeats.
 *
 *   geometry(map, cards) → [{left, width}] one per map block (cards = the .sblk elements; offsetLeft is relative to the lane's container)
 *   xOfBar(map, geom, bar) → x in px for a (fractional) song bar, clamped to the first / last block
 *   drawTake(canvas, {w, h, map, geom, take, pk, colour}) draws the trimmed take at its startBar (peaks: js/ui/peaks.js)
 */
import {PEAK_BINS} from './peaks.js';

export function geometry(map, cards){
  return map.blocks.map((b, i) => { const c = cards[i]; return c ? {left: c.offsetLeft, width: c.offsetWidth} : {left: 0, width: 0}; });
}

export function xOfBar(map, geom, bar){
  const bl = map.blocks;
  if (!bl.length) return 0;
  if (bar <= 0) return geom[0].left;
  for (let i = 0; i < bl.length; i++){
    if (bar < bl[i].endBar || i === bl.length - 1){
      const k = Math.min(1, Math.max(0, (bar - bl[i].startBar) / (bl[i].endBar - bl[i].startBar)));
      return geom[i].left + k * geom[i].width;
    }
  }
  return 0;
}

export function drawTake(canvas, {w, h, map, geom, take, pk, colour}){
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!take || !pk || !map.blocks.length) return;
  g.scale(dpr, dpr);
  g.fillStyle = colour;
  const secPerBar = 240 / (take.bpm || 120), len = pk.length / (pk.sr || take.sr || 48000);
  const t0 = Math.max(0, take.trimStart || 0), t1 = Math.max(t0, len - (take.trimEnd || 0));
  const mid = h / 2, amp = mid - 5, gain = take.gain == null ? 1 : take.gain;
  map.blocks.forEach((b, i) => {
    const {left, width} = geom[i], nb = b.endBar - b.startBar;
    if (width <= 0) return;
    for (let x = 0; x < width; x += 2){
      const barA = b.startBar + x / width * nb, barB = b.startBar + Math.min(width, x + 2) / width * nb;
      const ta = (barA - take.startBar) * secPerBar, tb = (barB - take.startBar) * secPerBar;
      if (tb <= t0 || ta >= t1) continue;
      const a = Math.max(0, Math.floor(Math.max(ta, t0) / len * PEAK_BINS)), z = Math.min(PEAK_BINS - 1, Math.floor(Math.min(tb, t1) / len * PEAK_BINS));
      let hi = 0, lo = 0;
      for (let k = a; k <= z; k++){ if (pk.max[k] > hi) hi = pk.max[k]; if (pk.min[k] < lo) lo = pk.min[k]; }
      hi = Math.min(1, hi * gain); lo = Math.max(-1, lo * gain);
      const top = mid - hi * amp, bot = mid - lo * amp;
      g.fillRect(left + x, top, 2, Math.max(1.5, bot - top));
    }
  });
}
