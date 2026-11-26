/* js/ui/panel.js: the right-hand track / step panel.
 *
 * Selected track: sound picker with Prev / Next (grouped by engine), its sound settings as sliders (Simple = the
 * few main ones, More = all), MIDI port / channel / clock for a MIDI track, volume. CV tracks: outputs, Tune CV,
 * Test outputs (js/ui/cv.js). Selected step: Note / Velocity / Chance. See docs/SPEC.md "Screens".
 *
 * Sound settings come from settingsFor(track.sound) → {main, all}; `ch` = names per whole value (a menu),
 * `log: true` = a logarithmic slider. A change is store.edit('Sound setting', s => { t.params[key] = value }), so it
 * is undoable; the engine hears it on the next setSong. Picking a sound clears track.params and plays it.
 * The panel is rebuilt only when the selection, the sound or the mode changes; otherwise values update in place, so
 * dragging a slider is not interrupted.
 */
import {ENGINES, SOUNDS, settingsFor} from '../engine/sounds.js';
import {degToMidi, midiName} from '../scale.js';
import {nudgeNote, setChance, setVelocity, stepAt} from './stepedit.js';
import {SOUND_LISTS} from '../store.js';
import {ask, openDialog} from './dialog.js';
import * as midi from '../midi.js';
import {el} from './dom.js';
import {cvSection} from './cv.js';

const TYPE = {drum: 'Drum', synth: 'Synth', midi: 'MIDI', cv: 'CV'};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// slider position 0…1 ↔ value, for settings that span several decades (min must be above 0 for a log scale to work)
const toPos = (r, v) => r.log && r.min > 0 ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min);
const fromPos = (r, p) => r.log && r.min > 0 ? r.min * Math.pow(r.max / r.min, p) : r.min + p * (r.max - r.min);

function fmt(r, v){
  if (r.ch) return r.ch[Math.round(v)] ?? String(v);
  const n = r.int ? Math.round(v) : Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  return r.unit ? `${n} ${r.unit}` : String(n);
}

export function mountPanel(root, {store, engine, state}){
  let sig = '', updaters = [];

  function refresh(){
    const s = store.get();
    if (!s.tracks.length){ root.innerHTML = ''; return; }
    const ti = Math.max(0, Math.min(state.track, s.tracks.length - 1));
    state.track = ti;
    const t = s.tracks[ti];
    const next = [ti, t.id, t.type, t.sound || '', s.mode, state.step, state.scene].join('|');
    if (next !== sig){ sig = next; build(s, t, ti); return; }
    for (const f of updaters) f(s, t);
  }

  function build(s, t, ti){
    root.innerHTML = ''; updaters = [];
    root.append(el('div', {class: 'phead'},
      el('div', {class: 'ptitle'}, t.name || TYPE[t.type] || 'Track'),
      el('div', {class: 'muted small'}, t.sound ? `${TYPE[t.type]} · ${t.sound}` : (TYPE[t.type] || ''))));

    if (t.type === 'drum' || t.type === 'synth'){
      soundPicker(t, ti);
      settings(s, t, ti);
      if (s.mode === 'more') presets(s, t, ti);
    } else if (t.type === 'midi'){
      midiTrack(t, ti);
    } else if (t.type === 'cv'){
      updaters.push(cvSection(root, {store, engine, t, ti, mode: s.mode}));
    }
    if (t.type !== 'cv') volume(t, ti);   // a CV track has no level: its voltages are its notes
    if (s.mode === 'more' && (t.type === 'drum' || t.type === 'synth')) length(t, ti);
    if (s.mode === 'more' && t.type === 'drum') seedsNote(t, ti);
    step(s, t, ti);
  }

  /* ---- sound presets (More): a sound plus its settings, kept in the song and put on any track of the same kind ---- */
  function presets(s, t, ti){
    const list = (s.presets || []).filter(p => (SOUND_LISTS[t.type] || []).includes(p.sound));
    root.append(el('div', {class: 'psec'}, 'Sound presets'));

    const sel = el('select', {'aria-label': 'Sound presets'});
    sel.append(el('option', {value: ''}, list.length ? 'Apply a preset…' : 'No presets yet'));
    for (const p of list) sel.append(el('option', {value: String(s.presets.indexOf(p))}, `${p.name} · ${p.sound}`));
    const removeBtn = el('button', {class: 'tb', disabled: true, onclick: () => removePreset(+sel.value, sel, removeBtn)}, 'Remove');

    sel.addEventListener('change', () => {
      removeBtn.disabled = sel.value === '';
      const p = (store.get().presets || [])[+sel.value];
      if (!p) return;
      store.edit('Preset', song => {   // the sound and its settings, as they were saved
        const tr = song.tracks[ti];
        tr.sound = p.sound;
        tr.params = Object.assign({}, p.params);
      });
    });

    // a save or a remove changes the list without rebuilding the panel
    updaters.push((song, tr) => {
      const keep = sel.value;
      const live = (song.presets || []).filter(p => (SOUND_LISTS[tr.type] || []).includes(p.sound));
      while (sel.options.length > 1) sel.remove(1);
      for (const p of live) sel.append(el('option', {value: String(song.presets.indexOf(p))}, `${p.name} · ${p.sound}`));
      sel.options[0].textContent = live.length ? 'Apply a preset…' : 'No presets yet';
      sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
      removeBtn.disabled = sel.value === '';
    });

    root.append(
      el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Presets'), sel),
      el('div', {class: 'sndrow'},
        el('button', {class: 'tb', onclick: () => savePreset(t, ti)}, 'Save this sound'),
        removeBtn));
  }

  function savePreset(t, ti){
    const inp = el('input', {type: 'text', maxlength: '40', value: `${t.sound} preset`, 'aria-label': 'Preset name'});
    openDialog({
      title: 'Save this sound',
      body: 'The sound and every setting on it are kept in the song, ready to put on another track of the same kind.',
      content: [el('label', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Name'), inp)],
      actions: [{label: 'Don’t save'}, {label: 'Save preset', primary: true, onClick: () => {
        const name = (inp.value.trim() || `${t.sound} preset`).slice(0, 40);
        store.edit('Save preset', song => {
          const tr = song.tracks[ti];
          song.presets = song.presets || [];
          song.presets.push({name, sound: tr.sound, params: Object.assign({}, tr.params || {})});
        });
      }}],
      focus: inp,
    });
  }

  async function removePreset(i, sel, removeBtn){
    const p = (store.get().presets || [])[i];
    if (!p) return;
    const ok = await ask({title: `Remove the preset “${p.name}”?`, body: 'The sound and its settings stay on this track.',
      yes: 'Remove it', no: 'Keep it'});
    if (!ok) return;
    store.edit('Remove preset', song => { song.presets.splice(i, 1); });
    // the list shifted under the select: show the “apply a preset” line again rather than another preset
    sel.value = '';
    removeBtn.disabled = true;
  }

  /* ---- MIDI track: which port, which channel, and its own clock ---- */
  function midiTrack(t, ti){
    root.append(el('div', {class: 'psec'}, 'MIDI output'));
    const outs = midi.outputs();
    const sel = el('select', {'aria-label': 'MIDI port'});
    sel.append(el('option', {value: ''}, outs.length ? 'No port yet' : 'No MIDI ports found'));
    for (const o of outs) sel.append(el('option', {value: o.id}, o.name));
    // a saved port that is not plugged in right now stays in the list, so it comes back when it is
    if (t.midi.port && !outs.some(o => o.id === t.midi.port || o.name === t.midi.port))
      sel.append(el('option', {value: t.midi.port}, t.midi.port));
    sel.value = t.midi.port || '';
    sel.addEventListener('change', () => store.edit('MIDI port', s => { s.tracks[ti].midi.port = sel.value; }));
    root.append(el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Port'), sel));

    const ch = el('select', {'aria-label': 'MIDI channel'});
    for (let i = 1; i <= 16; i++) ch.append(el('option', {value: String(i)}, 'Channel ' + i));
    ch.value = String(t.midi.ch || 1);
    ch.addEventListener('change', () => store.edit('MIDI channel', s => { s.tracks[ti].midi.ch = +ch.value; }));
    root.append(el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Channel'), ch));

    const clock = el('input', {type: 'checkbox'});
    clock.checked = !!t.midi.clock;
    clock.addEventListener('change', () => store.edit('MIDI clock', s => { s.tracks[ti].midi.clock = clock.checked; }));
    root.append(el('label', {class: 'checkrow'}, clock, el('span', {}, 'Send clock and Start / Stop to this port')));
    updaters.push((song, tr) => {   // Undo / Redo / a reload of the song keep the controls honest
      if (document.activeElement !== sel) sel.value = tr.midi.port || '';
      if (document.activeElement !== ch) ch.value = String(tr.midi.ch || 1);
      if (document.activeElement !== clock) clock.checked = !!tr.midi.clock;
    });
    root.append(el('p', {class: 'note'}, 'A MIDI track makes no sound of its own: the steps go out of the port you pick.'));
    if (!midi.ready()) root.append(el('p', {class: 'note'}, 'MIDI is not available in this browser (Chrome has it).'));
  }

  /* ---- sound ---- */
  function pick(name, ti){
    if (!name) return;
    // a track still named after its sound ("Kick") takes the new sound's name, so the list never says
    // "Kick · Snare"; a name she chose herself ("Bass") stays
    store.edit('Sound', s => { const t = s.tracks[ti]; if (!t.name || t.name === t.sound) t.name = name; t.sound = name; t.params = {}; });
    Promise.resolve(engine.hit(ti, 0)).catch(() => {});
  }

  function soundPicker(t, ti){
    const list = SOUND_LISTS[t.type] || [];
    if (!list.length) return;
    const sel = el('select', {'aria-label': 'Sound'});
    const groups = new Map();
    for (const n of list){
      const e = (SOUNDS[n] && SOUNDS[n].engine) || 'other';
      if (!groups.has(e)) groups.set(e, []);
      groups.get(e).push(n);
    }
    for (const [e, names] of groups){
      const g = el('optgroup', {label: (ENGINES[e] && ENGINES[e].label) || e});
      for (const n of names) g.append(el('option', {value: n}, n));
      sel.append(g);
    }
    sel.value = t.sound;
    sel.addEventListener('change', () => pick(sel.value, ti));
    const step = d => {
      const i = list.indexOf(t.sound);
      const n = list[(i + d + list.length) % list.length];
      if (n && n !== t.sound) pick(n, ti);
    };
    root.append(el('div', {class: 'psec'}, 'Sound'), el('div', {class: 'sndrow'},
      el('button', {class: 'tb', title: 'Previous sound', 'aria-label': 'Previous sound', onclick: () => step(-1)}, '‹'),
      sel,
      el('button', {class: 'tb', title: 'Next sound', 'aria-label': 'Next sound', onclick: () => step(1)}, '›')));
  }

  /* ---- sound settings ---- */
  function settings(s, t, ti){
    const kinds = settingsFor(t.sound);
    const rows = s.mode === 'more' ? kinds.all : kinds.main;
    if (!rows || !rows.length) return;
    root.append(el('div', {class: 'psec'}, s.mode === 'more' ? 'All sound settings' : 'Sound settings'));
    for (const r of rows) root.append(settingRow(r, t, ti));
  }

  function apply(r, v, ti){
    store.edit('Sound setting', s => {
      const t = s.tracks[ti];
      t.params = t.params || {};
      t.params[r.s] = v;
    }, `${ti}:${r.s}`);
  }

  function settingRow(r, t, ti){
    const cur = t.params[r.s] ?? r.def ?? r.min;

    if (r.ch){   // a menu: one name per whole value
      const sel = el('select', {'aria-label': r.l});
      r.ch.forEach((name, i) => sel.append(el('option', {value: String(i)}, name)));
      sel.value = String(Math.round(cur));
      sel.addEventListener('change', () => apply(r, +sel.value, ti));
      updaters.push((s, tr) => {
        const v = Math.round(tr.params[r.s] ?? r.def ?? r.min);
        if (document.activeElement !== sel) sel.value = String(v);
      });
      return el('div', {class: 'prow wide'}, el('span', {class: 'plabel', title: r.l}, r.l), sel);
    }

    const log = !!r.log && r.min > 0;
    const inp = el('input', {type: 'range', class: 'slider', 'aria-label': r.l});
    if (log){ inp.min = 0; inp.max = 1; inp.step = 0.001; inp.value = toPos(r, cur); }
    else { inp.min = r.min; inp.max = r.max; inp.step = r.int ? 1 : Math.max(0.001, (r.max - r.min) / 200); inp.value = cur; }
    const val = el('span', {class: 'pval num'}, fmt(r, cur));
    inp.addEventListener('input', () => {
      const raw = log ? fromPos(r, +inp.value) : +inp.value;
      const v = Math.round(raw * 1000) / 1000;
      val.textContent = fmt(r, v);
      apply(r, v, ti);
    });
    updaters.push((s, tr) => {
      const v = tr.params[r.s] ?? r.def ?? r.min;
      val.textContent = fmt(r, v);
      if (document.activeElement !== inp) inp.value = log ? toPos(r, v) : v;
    });
    return el('div', {class: 'prow'}, el('span', {class: 'plabel', title: r.l}, r.l), inp, val);
  }

  /* ---- track: volume (and, in More, its length) ---- */
  function volume(t, ti){
    const inp = el('input', {type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': 'Volume'});
    const val = el('span', {class: 'pval num'});
    inp.addEventListener('input', () => {
      const v = +inp.value;
      val.textContent = Math.round(v * 100) + '%';
      store.edit('Volume', s => { s.tracks[ti].vol = v; }, `${ti}:volume`);
    });
    updaters.push((s, tr) => {
      const v = tr.vol ?? 0.8;
      val.textContent = Math.round(v * 100) + '%';
      if (document.activeElement !== inp) inp.value = v;
    });
    root.append(el('div', {class: 'psec'}, 'Track'),
      el('div', {class: 'prow'}, el('span', {class: 'plabel'}, 'Volume'), inp, val));
  }

  // More only: how many steps this track plays before it starts again (0 = the scene's length)
  function length(t, ti){
    const sel = el('select', {'aria-label': 'Track length'});
    for (const n of [0, 4, 8, 12, 16, 24, 32, 48, 64])
      sel.append(el('option', {value: String(n)}, n ? `${n} steps` : 'Same as the scene'));
    sel.value = String(t.len || 0);
    sel.addEventListener('change', () => store.edit('Track length', s => { s.tracks[ti].len = +sel.value; }));
    updaters.push((song, tr) => { if (document.activeElement !== sel) sel.value = String(tr.len || 0); });
    root.append(el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Length'), sel));
  }

  // More: the note this drum sends to Seeds on every hit (js/midi.js, docs/SPEC.md "Linking to Seeds")
  function seedsNote(t, ti){
    const inp = el('input', {type: 'number', class: 'num', min: 0, max: 127, step: 1, 'aria-label': 'Seeds note'});
    inp.value = String(t.seedsNote ?? 36);
    inp.addEventListener('change', () => {
      const v = clamp(Math.round(+inp.value) || 0, 0, 127);
      inp.value = String(v);
      store.edit('Seeds note', s => { s.tracks[ti].seedsNote = v; });
    });
    updaters.push((song, tr) => {
      const v = tr.seedsNote ?? 36;
      if (document.activeElement !== inp) inp.value = String(v);
    });
    root.append(el('div', {class: 'prow wide'},
      el('span', {class: 'plabel', title: 'The note sent to Seeds on every hit'}, 'Seeds note'), inp));
  }

  /* ---- selected step: Note / Velocity / Chance, all through store.edit (so Undo works) ---- */
  function step(s, t, ti){
    root.append(el('div', {class: 'psec'}, 'Selected step'));
    const where = () => ({scene: state.scene, trackId: t.id, index: state.step});

    const stepNum = el('span', {class: 'pval num'}, '—');
    const pickHint = () => t.type === 'drum' ? 'Tap and hold a step (or right-click it) to change how loud it is.'
      : 'Tap and hold a step (or right-click it) to change its note.';
    const hint = el('p', {class: 'note'}, pickHint());

    // Note: ▲ ▼ move it a scale step, so it stays in key. Drums have no pitch, so this row hides.
    const noteVal = el('span', {class: 'pval num'}, '—');
    const noteUp = el('button', {class: 'tb', title: 'Up one scale step', 'aria-label': 'Note up',
      onclick: () => nudgeNote(store, where(), 1)}, '▲');
    const noteDown = el('button', {class: 'tb', title: 'Down one scale step', 'aria-label': 'Note down',
      onclick: () => nudgeNote(store, where(), -1)}, '▼');
    const noteRow = el('div', {class: 'prow'}, el('span', {class: 'plabel'}, 'Note'),
      el('span', {class: 'nudge'}, noteUp, noteDown), noteVal);
    noteRow.hidden = t.type === 'drum';

    const vel = el('input', {type: 'range', min: 1, max: 127, step: 1, 'aria-label': 'Velocity'});
    const velVal = el('span', {class: 'pval num'}, '—');
    const velRow = el('div', {class: 'prow'}, el('span', {class: 'plabel'}, 'Velocity'), vel, velVal);
    vel.addEventListener('input', () => {
      velVal.textContent = vel.value;
      setVelocity(store, where(), +vel.value);
    });

    // Chance is a More thing (the engine only uses it in More mode)
    let chance = null, chanceVal = null, chanceRow = null;
    if (s.mode === 'more'){
      chance = el('input', {type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Chance'});
      chanceVal = el('span', {class: 'pval num'}, '—');
      chanceRow = el('div', {class: 'prow'}, el('span', {class: 'plabel'}, 'Chance'), chance, chanceVal);
      chance.addEventListener('input', () => {
        chanceVal.textContent = chance.value + '%';
        setChance(store, where(), +chance.value);
      });
    }

    root.append(el('div', {class: 'sline'}, el('span', {class: 'plabel'}, 'Step'), stepNum), hint, noteRow, velRow);
    if (chanceRow) root.append(chanceRow);

    const paint = (song, tr) => {
      const st = state.step == null ? null : stepAt(song, where());
      const on = !!(st && st.on);
      stepNum.textContent = state.step == null ? '—' : String(state.step + 1);
      hint.hidden = state.step != null && on;
      hint.textContent = state.step == null ? pickHint() : 'This step is off. Tap it to turn it on.';
      noteRow.hidden = tr.type === 'drum' || !on;
      velRow.hidden = !on;
      if (chanceRow) chanceRow.hidden = !on;
      if (!on) return;
      if (tr.type !== 'drum') noteVal.textContent = midiName(degToMidi(st.deg || 0, song.key, song.scale, tr.oct ?? 3));
      const v = st.vel ?? 100;
      velVal.textContent = String(v);
      if (document.activeElement !== vel) vel.value = v;
      if (chance){
        const c = st.chance ?? 100;
        chanceVal.textContent = c + '%';
        if (document.activeElement !== chance) chance.value = c;
      }
    };
    paint(s, t);
    updaters.push(paint);
  }

  // a MIDI port plugged in or out while a MIDI track is open: list it (no leak: one subscription per panel)
  midi.onChange(() => {
    const t = store.get().tracks[state.track];
    if (t && t.type === 'midi'){ sig = ''; refresh(); }
  });

  refresh();
  return {refresh};
}
