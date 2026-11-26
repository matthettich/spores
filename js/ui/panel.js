/* js/ui/panel.js: the right-hand track / step panel (phase 2 and 4).
 * Selected track: sound picker with Prev / Next (drum, synth), port / channel / clock (MIDI), pitch / gate outputs and
 * Tune CV… (CV), volume. Selected step: Note / Velocity / Chance. See docs/SPEC.md "Screens".
 * Sound names: SOUND_LISTS in store.js (SOUNDS in js/engine/sounds.js has each one's engine, for grouping).
 * Sound settings (the "experiment" knobs): settingsFor(track.sound) → {main, all}; Simple shows `main`, More shows `all`.
 * A setting change is store.edit('Sound setting', s => { track.params[r.s] = value; }); the engine follows. Choosing a
 * new sound clears track.params. Hear a sound: engine.hit(trackIndex, deg). */
export function mountPanel(root, ctx){ return {select(){}}; }
