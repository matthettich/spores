# Working notes

Agents: add a dated entry when you stop. Newest at the top.

## 2026-11-26 — experimental engines (Claude)
- Owner asked for more experimental melodic engines (she's an artist and will want to experiment). Added, all in
  `js/engine/` (🔴): **Coil** (tuned springs), **Orbit** (chaos oscillators), **Fold** (west coast) and **Boing**
  (spring drums: 8 drums × 14 kits) played live from the pump plugins' own code (`pump-synth.wasm`); **Modal**
  (struck / bowed objects) and **Scanned** (masses on springs) recorded per note in a Worker. 153 sounds in all.
- For the panel (phase 2 / 4, ✅): `settingsFor(track.sound)` gives `main` (5 big ones, Simple) and `all` (More).
  A change is `track.params[s] = value` through `store.edit`; picking a new sound clears `track.params`. Group the
  sound picker by `SOUNDS[name].engine` / `ENGINES[engine].label`. `ch` on a setting = name per whole value (a menu).
- Generated files: `rendered.js`, `pump-meta.js`, `pump-synth.wasm` come from Thunder Plus via
  `node tools/gen-sounds.mjs /path/to/thunder-plus`. Don't edit them by hand.
- Tested (`tests/sounds-check.mjs`): every engine plays through the worklet with no NaNs, on the step (Coil's spring
  speaks ~7 ms after it, the sound itself), loudness within ±3 dB of the Blip kit; the wasm reaches the worklet in
  real time; a Modal note not yet recorded plays ~120 ms after the tap; phase 1 checks still pass.
- Known: Modal / Scanned notes have a fixed length (their Note length setting, default 0.5 s), and a setting change
  is heard once its notes are re-recorded (~60 ms a note). Not tested on real speakers.

## 2026-11-26 — phase 1 done: skeleton + engine (Claude)
- Built: every file in the spec's list; `js/scale.js`; `js/engine/` (AudioWorklet step clock, Blip drum voice and
  Acid synth copied from ...Thunder Plus, a 13-sound kit and 5 synth presets); `js/midi.js` (notes, clock,
  Start / Stop, Seeds link). `js/ui/steps.js` is only a **test grid** (Play / Stop, tempo, tap steps, tap a track
  name to hear it); phase 2 replaces it with the real Steps screen. `panel.js` / `song.js` are stubs with notes.
- How the engine works (for phases 2–6, no need to touch `js/engine/`): call `engine.setSong(song)` after any edit
  (main.js already does this on every `store.edit`), `engine.play('scene', 'A')` / `engine.play('song', null, block)`,
  `engine.stop()`, `engine.scene('B')` (switches at the next bar), `engine.hit(trackIndex, deg)` to hear a sound.
  `engine.on('step', m => …)` fires when a step is heard: `m.scene, m.counter` (step in the scene), `m.block, m.rep`
  (song position), `m.events`. Song blocks with `loop: true` repeat forever (the Song screen's loop button).
- Song format additions (optional fields, still v1): `track.oct`, `track.len`, `track.midi.clock`. In SPEC.
- Tested (headless Chrome, `tests/engine-check.mjs` + a page check): kicks land on the exact sample at 120 and 170
  BPM; a C2 bass note measures 65.2 Hz (C2 = 65.4); song A ×2 → B ×1 plays AABAA; with a fake MIDI port at 120 BPM:
  Start, 6 clocks per step 20.83–20.86 ms apart, Seeds-link kick notes on ch 16, a MIDI track's E♭4 on ch 2, Stop
  and note-offs; steps reach MIDI ~70–160 ms early with timestamps. Not tested: real speakers / a real IAC port.
- Open question for Matt: what should **LOCK** next to Key do? The engine ignores it for now (notes are always in
  the scale, as `deg` is scale steps). Guess: lock = keep notes in key; off = let the Note picker choose any semitone.
- Next: phase 2 (✅ low-cost model): the Steps screen from the mockups, replacing the test grid.

## 2026-11-26 — project set up (Claude)
- Repo, spec, agent rules and the Seeds style guide copy are in place. Nothing built yet.
- Next: phase 1 (🔴 Claude): clock and engine.
