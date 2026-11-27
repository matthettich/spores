/* js/ui/flare.js: "cool flare" — a slim animated strip at the foot of the Song screen while the song plays: a little dancing
 * mushroom (Spores' mascot) bobbing to the tempo, a row of 16 step lights, and a scope of the master level scrolling by.
 * Colours are CSS variables only (css/flare.css), so it follows every skin.
 *
 * Cheap on purpose: nothing is drawn while stopped; one requestAnimationFrame loop runs only while playing AND the strip is
 * on screen (it ends itself when the Song screen is hidden or the tab is in the background, and the next 'master' event
 * from the engine starts it again); the scope is one small canvas. prefers-reduced-motion: no bobbing, no scope scrolling,
 * only the step lights change. File › Animations switches the whole strip off (per computer, localStorage 'spores.flare', like the skin).
 *
 *   const f = mountFlare({engine, store}) → {node}      flareOn() / setFlare(bool)
 */
import {el} from './dom.js';

const KEY = 'spores.flare', N = 16, HIST = 96;
export const flareOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } };
export function setFlare(on){
  const root = document.documentElement;
  if (on) delete root.dataset.flare; else root.dataset.flare = 'off';
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch (e) {}
}
setFlare(flareOn());   // applies the saved choice at start-up

// the mushroom: shapes only; fills come from css/flare.css classes
const MUSH = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect class="fm-ground" x="6" y="60" width="52" height="2"/>
  <path class="fm-stem" d="M25 34 L23 60 L41 60 L39 34 Z"/>
  <rect class="fm-band" x="24" y="48" width="16" height="4"/>
  <path class="fm-cap" d="M7 36 C7 16 19 6 32 6 C45 6 57 16 57 36 Z"/>
  <rect class="fm-gills" x="9" y="35" width="46" height="4"/>
  <rect class="fm-spot" x="17" y="17" width="7" height="7"/><rect class="fm-spot lit" x="38" y="13" width="7" height="7"/><rect class="fm-spot" x="45" y="25" width="6" height="6"/>
  <rect class="fm-eye" x="27" y="44" width="3" height="4"/><rect class="fm-eye" x="35" y="44" width="3" height="4"/>
</svg>`;

export function mountFlare({engine, store}){
  const mush = el('span', {class: 'fmush', html: MUSH});
  const leds = Array.from({length: N}, (_, i) => el('span', {class: 'fled' + (i % 4 ? '' : ' q')}));
  const canvas = el('canvas', {class: 'fscope', width: 192, height: 32});
  const node = el('div', {class: 'flare', 'aria-hidden': 'true'}, mush, el('span', {class: 'fleds'}, leds), canvas);
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};

  const hist = new Float32Array(HIST); let head = 0, peakL = 0, peakR = 0, raf = 0, playing = false, lit = -1, col = {};
  const level = p => p > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(p) + 54) / 60)) : 0;   // -54 dB … +6 dB, as the master meter

  function colours(){ const cs = getComputedStyle(node); col = {a: cs.getPropertyValue('--audio').trim() || '#22958d', hot: cs.getPropertyValue('--meter-hot').trim() || '#d8402f', g: cs.getPropertyValue('--glass').trim() || '#050607'}; }
  function beat(){ node.style.setProperty('--beat', (60 / Math.max(20, Math.min(300, store.get().bpm || 120))).toFixed(3) + 's'); }
  function clear(){ ctx.fillStyle = col.g || '#050607'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

  function draw(){
    const w = canvas.width, h = canvas.height, mid = h / 2, bw = w / HIST;
    clear();
    for (let i = 0; i < HIST; i++){
      const v = hist[(head + i) % HIST]; if (v <= 0.01) continue;
      const a = Math.max(1, v * (mid - 1));
      ctx.fillStyle = v > 0.9 ? col.hot : col.a;
      ctx.fillRect(i * bw, mid - a, Math.max(1, bw - 1), a * 2);
    }
  }
  function frame(){
    raf = 0;
    if (!playing && !hist.some(v => v > 0.01)){ clear(); return; }   // all quiet: stop
    if (!node.offsetParent || document.hidden) return;               // not on screen: stop; the next 'master' event restarts
    const v = level(Math.max(peakL, peakR)); peakL = peakR = 0;
    hist[head] = Math.max(v, hist[(head + HIST - 1) % HIST] * 0.85 * (playing ? 1 : 0.5)); head = (head + 1) % HIST;
    draw();
    raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf && !still.matches && node.offsetParent && !document.hidden){ colours(); raf = requestAnimationFrame(frame); } };

  engine.on('start', () => { playing = true; beat(); node.classList.add('on'); colours(); wake(); });
  engine.on('stop', () => {
    playing = false; node.classList.remove('on');
    if (lit >= 0) leds[lit].classList.remove('on'); lit = -1;
    peakL = peakR = 0;
    if (still.matches){ hist.fill(0); clear(); } else wake();   // the scope falls away by itself, then the loop ends
  });
  engine.on('master', m => { if (!playing) return; peakL = Math.max(peakL, m.L); peakR = Math.max(peakR, m.R); wake(); });
  engine.on('step', m => {
    if (!playing || !node.offsetParent) return;
    const i = (m.counter | 0) % N;
    if (lit >= 0) leds[lit].classList.remove('on');
    leds[i].classList.add('on'); lit = i;
    if (i % 4 === 0){ node.classList.remove('thump'); void node.offsetWidth; node.classList.add('thump'); }   // a quick pulse on each beat
  });
  store.subscribe(() => { if (playing) beat(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  colours(); clear();
  return {node};
}
