/* js/ui/melody.js: the melody lane under the grid, for the selected Synth / MIDI / CV track (drums have no pitch).
 * One bar per step, height = pitch (the step's lowest note); a chord's other notes are dots above it at their own
 * heights, in their note colours. Tap a bar to select that step; ▲ ▼ move the selected note (a chord moves whole).
 * Shift-click a step at a height adds that note to it (a chord, up to 4 notes) or takes it away again: one Undo each.
 * (Moved out of steps.js with the chords, 2026-11-27.)
 */
import {el} from './dom.js';
import {STEPS_PER_BAR} from '../engine/engine.js';
import {noteColor, degName, degToMidi, midiName} from '../scale.js';
import {stepDegs, isChord, chordName} from '../chord.js';
import {nudgeNote, toggleChordNote} from './stepedit.js';
import {previewStep} from './preview.js';

const BASE = 15, MIN_H = 8, RANGE = 52;   // px: the bars' floor (css .mbar bottom), shortest bar, height range (css/app.css .mcell)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function melodyLane({store, engine, state, selectStep}){
  const note = el('span', {class: 'mnote num'}, '—');
  const up = el('button', {class: 'tb', title: 'Up one scale step', 'aria-label': 'Note up', onclick: () => move(1)}, '▲');
  const down = el('button', {class: 'tb', title: 'Down one scale step', 'aria-label': 'Note down', onclick: () => move(-1)}, '▼');
  const lane = el('div', {class: 'mlane'});
  const root = el('div', {class: 'melody', hidden: true},
    el('div', {class: 'mlabel'},
      el('span', {class: 'mlabel-t'}, 'Melody'), up, down, note,
      el('span', {class: 'hint'}, 'Tap a note to select it; ▲ ▼ move it up or down the scale. Shift-click to add or remove a chord note.')),
    lane);
  let sig = '', cells = [], scaleY = {lo: 0, span: 7};

  const whereOf = i => { const t = store.get().tracks[state.track]; return t ? {scene: state.scene, trackId: t.id, index: i} : null; };
  function move(by){
    const t = store.get().tracks[state.track];
    if (!t || t.type === 'drum' || t.type === 'audio' || state.step == null) return;
    const where = whereOf(state.step);
    nudgeNote(store, where, by);
    previewStep(engine, store, where);
  }
  // the scale degree at a height in a cell (the inverse of a bar's height)
  const degAt = (b, clientY) => {
    const r = b.getBoundingClientRect(), y = r.bottom - clientY - BASE - MIN_H;
    return Math.round(scaleY.lo + (y / RANGE) * scaleY.span);
  };
  const height = d => MIN_H + Math.round(((d - scaleY.lo) / scaleY.span) * RANGE);

  function draw(s = store.get()){
    const sc = s.scenes[state.scene], t = s.tracks[state.track];
    const melodic = !!(sc && t && t.type !== 'drum' && t.type !== 'audio');
    root.hidden = !melodic;
    if (!melodic){ if (sig){ sig = ''; cells = []; lane.innerHTML = ''; } return; }   // built again when a melodic track comes back

    const len = clamp(sc.bars | 0 || 1, 1, 4) * STEPS_PER_BAR;
    const nextSig = [state.scene, state.track, t.id, len].join('|');
    if (nextSig !== sig){
      sig = nextSig; lane.innerHTML = ''; cells = [];
      for (let i = 0; i < len; i++){
        const b = el('button', {type: 'button',
          class: 'mcell' + (i % 16 === 0 && i > 0 ? ' barstart' : i % 4 === 0 && i > 0 ? ' beatstart' : '')});
        b.addEventListener('click', e => {
          const st = (store.get().scenes[state.scene].steps[store.get().tracks[state.track].id] || [])[i];
          if (e.shiftKey && st && st.on){   // add / remove the note at this height
            const where = whereOf(i);
            toggleChordNote(store, where, degAt(b, e.clientY));
            if (state.step !== i) selectStep(state.track, i);
            previewStep(engine, store, where);
            return;
          }
          selectStep(state.track, i);
        });
        const bar = el('span', {class: 'mbar'}), name = el('span', {class: 'mname'}), dots = el('span', {class: 'mdots'});
        b.append(bar, dots, name);
        lane.append(b);
        cells.push({b, bar, name, dots});
      }
    }

    const steps = (sc.steps && sc.steps[t.id]) || [];
    const all = [];
    for (let i = 0; i < len; i++){ const st = steps[i]; if (st && st.on) all.push(...stepDegs(st)); }
    const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    scaleY = {lo, span: Math.max(7, hi - lo)};
    cells.forEach(({b, bar, name, dots}, i) => {
      const st = steps[i], on = !!(st && st.on), d = on ? (st.deg || 0) : 0;
      b.classList.toggle('sel', state.step === i);
      b.style.setProperty('--h', height(d) + 'px');
      bar.hidden = !on;
      dots.innerHTML = '';
      if (on){
        const c = noteColor(d, s.scale);
        bar.style.setProperty('--top', c.top);
        bar.style.setProperty('--bottom', c.bottom);
        const ds = stepDegs(st);
        for (const x of ds.slice(1)){
          const k = noteColor(x, s.scale);
          dots.append(el('span', {class: 'mdot', style: {'--h': height(x) + 'px', '--top': k.top, '--bottom': k.bottom}}));
        }
        name.textContent = isChord(st) ? (chordName(st, s.key, s.scale) || degName(d, s.key, s.scale) + '+') : degName(d, s.key, s.scale);
        b.setAttribute('aria-label', `Step ${i + 1}, ` + ds.map(x => degName(x, s.key, s.scale)).join(' '));
      } else {
        name.textContent = '';
        b.setAttribute('aria-label', `Step ${i + 1}, empty`);
      }
    });

    const sel = state.step != null ? steps[state.step] : null;
    const movable = !!(sel && sel.on);
    note.textContent = movable ? stepDegs(sel).map(x => midiName(degToMidi(x, s.key, s.scale, t.oct ?? 3))).join(' ') : '—';
    up.disabled = down.disabled = !movable;
  }

  return {el: root, draw, get cells(){ return cells; }};
}
