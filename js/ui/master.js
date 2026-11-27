/* js/ui/master.js: the master section in the Song screen's header: a stereo level meter (left and right peaks of the
 * whole mix, before its gentle clip; red when it goes over 0 dB) and a fader for the master volume (song.master, saved
 * with the song, one Undo step per drag; double-click puts it back to 0 dB). Exports follow it too (worklet.js).
 *
 *   const m = masterSection({store, engine}) → {node, update(song)}
 */
import {el} from './dom.js';

const MIN_DB = -60, MAX_DB = 6;
const toDb = g => g > 0 ? Math.max(MIN_DB, 20 * Math.log10(g)) : MIN_DB;
const fromDb = d => d <= MIN_DB ? 0 : Math.pow(10, d / 20);
// meter scale: -60 dB … +6 dB across the bar, the 0 dB mark at its place
const pos = p => p > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(p) - MIN_DB) / (MAX_DB - MIN_DB))) : 0;

export function masterSection({store, engine}){
  const bar = () => { const f = el('span', {class: 'mmcover'}); return {f, b: el('span', {class: 'mmbar'}, el('span', {class: 'mmfill'}), f)}; };   // the colours stay put; a cover slides back
  const Lb = bar(), Rb = bar();
  const meter = el('span', {class: 'mmeter', title: 'Master level (left / right). Red: over 0 dB, turn the master down.', 'aria-hidden': 'true'},
    Lb.b, Rb.b, el('span', {class: 'mmzero', style: {left: (pos(1) * 100) + '%'}}));
  const fader = el('input', {type: 'range', class: 'slider mfader', min: MIN_DB, max: MAX_DB, step: 0.5, 'aria-label': 'Master volume', title: 'Master volume (double-click: 0 dB)'});
  const val = el('span', {class: 'pval num mval'});
  const show = d => { val.textContent = d <= MIN_DB ? 'off' : `${d > 0 ? '+' : ''}${d.toFixed(1)} dB`; };
  fader.addEventListener('input', () => { const d = +fader.value; show(d); store.edit('Master volume', s => { s.master = fromDb(d); }, 'master'); });
  fader.addEventListener('dblclick', () => { fader.value = 0; show(0); store.edit('Master volume', s => { s.master = 1; }, 'master-reset'); });
  const node = el('div', {class: 'hgroup master'}, el('span', {class: 'cap'}, 'Master'), meter, fader, val);

  // the bars: rise at once, fall smoothly; a short red hold after going over 0 dB
  const shown = [0, 0], hot = [0, 0]; let peak = [0, 0], raf = 0;
  engine.on('master', m => { peak = [Math.max(peak[0], m.L), Math.max(peak[1], m.R)]; if (!raf) raf = requestAnimationFrame(paint); });
  function paint(){
    raf = 0; let moving = false;
    [Lb, Rb].forEach((x, i) => {
      const now = pos(peak[i]); let v = Math.max(now, shown[i] * 0.88); if (v < 0.005) v = 0;
      shown[i] = v; if (v) moving = true;
      if (peak[i] > 1) hot[i] = 40; else if (hot[i]) hot[i]--;
      x.f.style.transform = `scaleX(${(1 - v).toFixed(3)})`; x.b.classList.toggle('hot', hot[i] > 0);
      if (hot[i]) moving = true;
    });
    peak = [0, 0];
    if (moving) raf = requestAnimationFrame(paint);
  }
  return {node, update(s){ const d = toDb(s.master ?? 1); if (document.activeElement !== fader) fader.value = d; show(d); }};
}
