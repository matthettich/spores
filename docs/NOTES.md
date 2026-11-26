# Working notes

Agents: add a dated entry when you stop. Newest at the top.

## 2026-11-26 — phase 5 done: scenes A–H, the Song screen, Undo merging per step
- Undo merging first (`js/store.js`): `store.edit(label, fn, key)` takes an optional key naming what changed, and two
  edits merge into one Undo only when the label AND the key match. Dragging Velocity on one step is still one Undo;
  moving to another step, or to Chance, starts a new entry. Step edits use `scene:track:step`, sound settings
  `track:setting`, volume `track:volume`.
- Two screens (`js/main.js`): Steps and Song are both mounted, one visible at a time (`#app` now holds two `.screen`
  divs, each with its own header / work area / bottom row). The Steps header's "Song ›" now opens the Song screen and
  "‹ Steps" comes back. The hidden screen keeps its DOM; the Song screen redraws when shown.
- Song screen (`js/ui/song.js`, new): blocks with a scene picker A–H, the scene name, a mini grid of the scene's first
  bar, ×repeats with − +, a Loop flag and × to remove (which asks first, then says so); "+ Add block"; the scene
  library with an editable name, "N bars · N steps on · in the song N×", "Add to song" (appends at the end) and "Copy"
  (a deep copy into the next empty scene, off with a reason once A–H are all used); a position bar with one segment per
  block and a marker that follows the playing block, repeat and step, plus a line like "Playing block 2 of 2 · repeat 1
  of 2 · B". Play runs the whole song (`engine.play('song')`) and then starts again. Everything goes through store.edit,
  so Undo / Redo / autosave work on this screen too.
- Drag to reorder: drag a block onto another one to put it there (HTML5 drag; there is no pointer/touch version yet).
- Scenes A–H: the Steps header's letters and "+" still make and switch scenes; the Song library names, adds and copies
  them. Scenes[k].name is what the blocks, the library and the Steps scene buttons show. The demo song now has two
  scenes — A "Scene A" ×4 then B "Chorus" ×2 (a lead line and a different bass) — so the Song screen opens with
  something to arrange.
- Tested in headless Chrome (1440×900): velocity 60 on one step then 50 on another back to back — Undo restores only the
  second, a second Undo the first; same for chance; a drag on one step is still one Undo; velocity then chance on the same
  step undo separately. Song › hides the steps and shows the screen; 2 blocks / 2 library cards; + Add block and
  Add to song append; × 4 → 5 with − + and Undo; Loop sets the flag, the pressed state and the dark style and reaches
  the worklet as `B/2/true`; the block picker changes a scene and Undo restores it; playing moves the marker through
  block 1 ("repeat 1 of 4") into block 2 ("repeat 1 of 2 · B") and Stop resets it; removing a block asks "Remove
  “Scene A” from the song?" with Keep it / Remove it and Escape keeps it; Copy fills C as "Copy of Scene A" with the
  same steps in a separate object (editing one does not change the other) and says so in a toast; renaming C to Bridge
  sticks; drag C onto the first block reorders to C, A, B with the names following, Undo and Redo work; with eight
  scenes every Copy is disabled and titled "All eight scenes are in use"; block order, names and the loop flag survive
  a reload; ‹ Steps still shows the grid, its scene B and the melody lane; no console errors.
- Not tested: touch / pointer dragging (only synthetic drag events), real speakers, a touch screen, a normal Chrome
  window; `tests/*.mjs` not re-run (`js/engine/` untouched).
- Half done / later: no "play from this block" (Play always starts at the first block); a block cannot be duplicated in
  place (use Add to song) and there is no reordering with touch yet — that needs a pointer version before the phone
  work in phase 8; copying only goes into an empty scene — no copying over an existing scene, no deleting a scene, no
  changing a scene's letter; the mini grid shows only a scene's first bar; a block's picker lists only scenes that
  exist, so a block cannot point at an empty letter; one song at a time (the Song screen link is phase 7).
- Odd: the Steps screen still redraws on every song edit even while hidden (the Song screen skips its redraw when
  hidden), so block changes made here show up there with the right scene names the moment you go back. The position
  bar's marker is worked out from each block's scene length × repeats, so a long block moves it slowly but a scene
  edit during playback (bars, repeats) shifts the marker without stopping the audio.

## 2026-11-26 — phase 4 done: melody lane and step editing
- Melody lane (`js/ui/steps.js`): under the grid for the selected Synth / MIDI / CV track, one bar per step with the
  height = pitch, in the note colours and with the note name under each bar. It sticks to the bottom of the grid area,
  scrolls sideways with the steps, outlines the selected note and is marked by the playhead. Tap a bar to select that
  step (it does not toggle it). The lane's ▲ ▼ move the selected note one scale step (via `nudgeNote` in
  `js/ui/stepedit.js`), so notes stay in key. Drum tracks have no pitch, so the lane hides for them.
- Step editing (`js/ui/panel.js`): the Selected step section is now editable — Note ▲ ▼ with the note name, a Velocity
  slider (1–127) and, in More only, a Chance slider (0–100 %). Drums hide the Note row. All through
  `store.edit('Step note' / 'Step velocity' / 'Step chance')`, via `js/ui/stepedit.js`, so Undo, Redo and autosave
  work; Velocity and Chance drags merge into one Undo (added to `MERGE_LABELS` in `js/store.js`).
- Grid feedback: a white corner on a step whose velocity or chance was changed, a dashed bottom in More for steps
  with chance below 100 %, and the values in the cell's tooltip.
- Tested in headless Chrome (1440×900): the Bass lane shows 16 cells, 7 bars (8–60 px tall) named C, C, A♭…; a drum
  track hides it; tapping a bar selects without toggling; lane ▲ turns C2 into D2 and Undo puts it back; arrows disable
  on an off step; key D renames lane and grid; playing marks one melody cell. Panel: Simple shows Note C2, ▲ ▼,
  velocity 100, no Chance; ▲ gives D2 and Undo C2; velocity 60 marks the cell and shows "Velocity 60 · chance 100%",
  Undo restores it; a four-event drag is one Undo; More shows Chance and 50 % reaches the worklet's compiled song;
  a drum step hides Note but keeps Velocity / Chance; velocity 70 / chance 40 play, survive a reload with their marks;
  Simple hides Chance again and keeps the value. No console errors.
- Not tested: real speakers, a touch screen, a normal Chrome window; `tests/*.mjs` not re-run (`js/engine/` untouched).
- Fixed while testing: after selecting a drum track the lane kept its old cells, so coming back to the same melodic
  track never rebuilt it (names went stale, selections did not show). Changing to a drum track now clears the lane.
- Half done / later: note editing is one scale step at a time — no note picker / piano; no drag-painting of steps; one
  selected step at a time; the lane shows only the selected track; chance is only visible on the grid in More (the
  engine ignores it in Simple); in More the step controls sit below every sound setting, so they need scrolling.
- Odd: the lane's ▲ ▼ work on the selected step, which is also selected by tapping a bar or holding a grid step —
  three ways in, one behaviour. The melody lane sticks to the bottom of the grid, so it stays visible while the track
  list scrolls; with fewer tracks than the window it sits right under the last row instead.

## 2026-11-26 — phase 3 done: save, load, undo / redo
- Undo / redo (`js/store.js`): every `store.edit` keeps the song as it was before it, up to 80 steps, and Redo keeps
  what was undone. A dragged slider is one step (Sound setting / Volume / Swing edits within 600 ms merge), so Undo
  after a drag goes back to the value before the drag. Header Undo and Redo buttons disable when there is nothing to
  do; Ctrl/Cmd+Z, Shift+Z and Ctrl+Y work anywhere except while typing. `replace()` (New song, Open) goes on the same
  history, so loading a file can be undone too.
- Saving in the browser: the song autosaves to `localStorage` (`spores.song`) 250 ms after each change, and at once
  on `pagehide` (`js/main.js`), so a reload, even straight after a tap, keeps it. On start the store opens the saved
  song; the demo groove only appears on the very first run. A save that is not a Spores song is ignored (demo instead)
  and odd tracks / scenes are filled in by `migrate()`, so a half-old or corrupt save cannot crash a screen.
- Files: a new File menu (`js/ui/filebar.js`) with **New song**, **Open a song file…** and **Save a copy…**. Save
  downloads the song as JSON (`store.serialize()`). Open reads a `.json`, checks `isSong()` before asking, and asks
  with named buttons before replacing anything; New asks too. Dialogs and toasts are in `js/ui/dialog.js` and follow
  the style guide (named buttons, safe answer focused, Escape = no, colours only from `:root`).
- Tested in headless Chrome (puppeteer, 1440×900, `python3 -m http.server`): two Undo / Redo button states at start;
  a step toggles, undoes and redoes (grid and song agree); Ctrl+Z / Shift+Ctrl+Z add and remove a track; a six-event
  slider drag is one Undo and one Redo; draining the history disables Undo. First run has no save; tapping a step,
  key D and + Add track are all in `spores.song` after 250 ms; reload keeps 9 tracks, key D, the steps and the grid;
  a tap straight before a reload survives it; a broken localStorage value loads the demo with no errors and the next
  edit writes a good save. File menu lists three items, Escape closes it; "Keep this song" changes nothing; Save
  produces `spores-2026-11-26.json` with 9 tracks, key D and the lit steps; "Start fresh" gives an empty 8-track song
  and Undo restores the 9-track one; opening the saved file asks, restores key D and its 20 lit steps, and Undo / Redo
  step over the load; a `{"hello":1}` file is refused with a toast and the song is untouched. Finally: a new 4-track
  beat (4 / 2 / 2 / 4 steps) plays, survives a reload, plays again, and an edit can be undone. No console errors in
  any of these runs.
- Not tested: real speakers, a touch screen, a normal Chrome window; `tests/*.mjs` not re-run (`js/engine/` unchanged).
- Half done / later: the undo history is not saved across a reload (it starts empty again — deliberate for now); there
  is no visible "saved" indicator, so autosave is silent; the format has no song name, so saved files are named by
  date (`spores-2026-11-26.json`); only JSON files, no bundled copy of the sounds; the Song screen is still phase 5
  and MIDI / CV tracks phase 6 / 7.
- Odd: if `localStorage` is off (private mode, full disk) the error is swallowed and the song lives in memory only —
  it works but will not survive a reload, and nothing tells her yet. Opening a file replaces the browser save on the
  next change, which is what we want, but it does mean there is no "unsaved" state to warn about.

## 2026-11-26 — phase 2 done: the Steps screen
- Built (✅, `js/engine/` untouched): `js/ui/steps.js` replaces the phase-1 test grid with the real screen. Header:
  Play / Stop, Tempo, Key + scale + Lock (`song.lock`, stored only, no other effect yet as the brief said), scene
  letters A–H with `+`, `Song ›` and `Undo` disabled, Simple / More (`song.mode`). Left: track buttons (type colour bar,
  name, "type · sound", M for mute) that select. Middle: 16 steps per bar, a gap every 4 and a wider one between bars,
  bars 1–4 (`scene.bars`), synth steps drawn with `noteColor()` / `degName()`, tap toggles, hold 400 ms or right-click
  selects, playhead outlined in `--selc`.
- `js/ui/panel.js`: sound picker grouped by `SOUNDS[name].engine` / `ENGINES[e].label` with Prev / Next (clears
  `track.params`, then plays `engine.hit(trackIndex, 0)`); the sound's settings as sliders — Simple = `settingsFor().main`,
  More = `.all`; `log` settings use a log scale, `ch` settings are menus (Boing's Kit and the kit's own menus); a change
  is `store.edit('Sound setting', s => t.params[key] = v)`. Volume for every track; in More a per-track length
  (0 = the scene's). MIDI / CV tracks just say what they are (phases 6, 7). Selected step: Note / Velocity / Chance,
  read-only until phase 4. Only one `store.edit` per change, so phase 3's undo will pick them all up.
- Bottom: `+ Add track (n of 16)` (adds a drum with the next unused kit sound), Bars 1–4, note colour key.
- `css/app.css` rewritten for the three-column frame; every colour is still a variable on `:root`, targets are 44 px.
- Tested in headless Chrome (puppeteer, 1440×900, page served by `python3 -m http.server`): page loads with no console
  errors before and after everything below; 8 tracks × 16 steps; tap toggles on and off; Play lights one cell per track
  and Stop clears it; Bars 2 → 32 cells; + Add track → 9 of 16; `+` adds scene B; key / scale / Lock / Simple–More update
  the song. Panel: six engine groups on a synth track; 5 main settings in Simple, 33 in More; picking "Coil · Default"
  clears `params`; moving Tension while playing sends the worklet a new song with tension 100; Prev changes the sound and
  clears params; volume 0.5; hold selects without toggling the step; right-click shows "Step 1 · Note C2 · Velocity 100 ·
  Chance 100%"; a Boing drum shows Kit (14 names) and the kit's menus; swing 0 → 50% reaches the worklet and is hidden in
  Simple; per-track length 8 reaches the worklet; a new song + four tracks (4 / 2 / 2 / 4 steps) plays.
- Not tested: real speakers (headless only), a touch screen, a normal Chrome window. `tests/` was not run because
  `js/engine/` did not change.
- Half done / later: step editing (Note / Velocity / Chance) is read-only (phase 4); Song › and Undo disabled (phases 5,
  3); MIDI port / channel and CV outputs (phases 6, 7); `+ Add track` always adds a drum — choosing a type, or copying a
  track, would be a friendly phase 8 addition; the app still opens on the phase-1 demo groove (phase 3's New / Open will
  take over).
- Odd: the `+` beside the scenes had to do something in phase 2, so it adds the next empty scene — the Song screen owns
  that properly in phase 5. A per-track length shorter than the scene leaves the extra steps visible but unplayed (the
  playhead just loops early). No timing or audio glitch seen, so nothing was handed back.

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
