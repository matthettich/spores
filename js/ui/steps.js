/* js/ui/steps.js: Steps screen.
 *
 * PHASE 1: a plain test grid (Play / Stop, tempo, one scene, tap a step on / off, tap a track name to hear it), so
 * the engine can be tried. Phase 2 replaces this with the full screen from the mockups (docs/SPEC.md "Screens").
 * Keep the exported shape: mountSteps(root, {store, engine, midi}) → {playhead(m), stopped()}.
 */
import {noteColor, degName} from '../scale.js';
import {STEPS_PER_BAR} from '../engine/engine.js';

export function mountSteps(root, {store, engine}){
  let scene = 'A', cells = [];
  root.innerHTML = `
    <div class="bar">
      <span class="app-name">...Spores</span>
      <button class="tb play" id="play">▶ Play</button>
      <label class="field">Tempo <input id="bpm" class="num" type="number" min="20" max="300" step="1"></label>
      <span class="hint">Tap a step to turn it on or off. Tap a track name to hear it.</span>
    </div>
    <div class="steps" id="grid"></div>
    <div class="status" id="status">Press Play to start.</div>`;
  const $ = id => root.querySelector('#' + id), grid = $('grid'), playBtn = $('play'), bpm = $('bpm'), status = $('status');

  function draw(){
    const s = store.get(), sc = s.scenes[scene], len = (sc.bars || 1) * STEPS_PER_BAR;
    bpm.value = s.bpm; grid.innerHTML = ''; cells = [];
    s.tracks.forEach((t, ti) => {
      const row = document.createElement('div'); row.className = 'row';
      const name = document.createElement('button'); name.className = 'trk';
      name.innerHTML = `<span class="sw"></span><span><div>${esc(t.name)}</div><div class="sub">${t.type} · ${esc(t.sound || '')}</div></span>`;
      name.onclick = () => engine.hit(ti, 0);
      const box = document.createElement('div'); box.className = 'cells';
      const lane = (sc.steps[t.id] || []), rc = [];
      for (let i = 0; i < Math.min(len, 16); i++){
        const b = document.createElement('button'), st = lane[i];
        b.className = 'cell' + (st && st.on ? ' on' : '');
        if (st && st.on && t.type !== 'drum'){
          const c = noteColor(st.deg || 0, s.scale);
          b.style.setProperty('--top', c.top); b.style.setProperty('--bottom', c.bottom); b.style.setProperty('--txt', c.text);
          b.textContent = degName(st.deg || 0, s.key, s.scale);
        }
        b.onclick = () => store.edit('Step on / off', s => {
          const l = s.scenes[scene].steps[t.id] = s.scenes[scene].steps[t.id] || [];
          const cur = l[i]; l[i] = cur && cur.on ? Object.assign(cur, {on: false}) : Object.assign({deg: 0, vel: 100, chance: 100}, cur || {}, {on: true});
        });
        box.append(b); rc.push(b);
      }
      cells.push(rc); row.append(name, box); grid.append(row);
    });
  }

  playBtn.onclick = () => { if (engine.playing) engine.stop(); else engine.play('scene', scene); };
  bpm.onchange = () => store.edit('Tempo', s => { s.bpm = Math.max(20, Math.min(300, +bpm.value || 120)); });
  engine.on('start', () => { playBtn.classList.add('on'); playBtn.textContent = '■ Stop'; });
  store.subscribe(draw);
  draw();

  let lit = [];
  return {
    playhead(m){
      lit.forEach(b => b.classList.remove('now')); lit = [];
      const s = store.get();
      s.tracks.forEach((t, ti) => { const L = t.len > 0 && s.mode === 'more' ? t.len : 16, b = cells[ti] && cells[ti][m.counter % L]; if (b){ b.classList.add('now'); lit.push(b); } });
      status.textContent = `Playing scene ${m.scene} · step ${m.counter + 1}`;
    },
    stopped(){ lit.forEach(b => b.classList.remove('now')); lit = []; playBtn.classList.remove('on'); playBtn.textContent = '▶ Play'; status.textContent = 'Stopped.'; },
  };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
