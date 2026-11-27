# Working notes

Agents: add a dated entry when you stop. Newest at the top.

## 2026-11-27 — queued request 4: chords, up to 4 notes per step (Claude, branch `q-chords`, not pushed)
- **Data (v5):** `step.chord` = other notes as scale steps above `deg` (js/chord.js `cleanChord` / `stepDegs` / `stepMidi` / `chordName`);
  `deg` stays the lowest note, so drag / arrows / ▲ ▼ move the whole chord with no extra code. v4 → v5 migration changes nothing;
  `migrate` cleans every step's `chord` (whole numbers 1..21, unique, sorted, ≤ 3; else removed). Copy / paste and undo clone steps, so chords ride along.
- **Engine (🔴):** compile adds `st.notes` (MIDI, lowest first) and `track.poly`; the worklet's `chord()` triggers every note on the step's
  sample. Acid (mono): a track with chords gets 3 more AcidCores (`v.more`, made in syncVoices, idle ones skipped in render), voice index
  `vi` in the queue, each note at 1/√n. Pump synths (Coil / Orbit / Fold): all notes to the wasm voice (its own poly, no extra gain).
  Rendered (Modal / Scanned): every note's buffer; ringing cap 6 → 12 and the oldest now fades out over 128 samples instead of a hard cut
  (also for one-note tracks). CV: root only. MIDI: every note-on together, matching offs. `engine.hit(ti, deg, vel, chord)`; render.js
  (Export) records every chord note (it recorded only `st.note` before).
- **UI:** panel "Chord" picker (js/ui/chordui.js): None / Triad / 7th / Sus2 / Sus4 / Add 9 / Power / Octave from the scale (Chromatic:
  Major / Minor / 7th / Maj7 / Min7 / Sus / Power / Octave; pentatonics: Triad / Power / Octave), plus the chord's name + notes; "Your own
  notes" when hand-made. Shift-click in the melody lane adds / removes the note at that height (max 4; the last note stays). Grid cell:
  chord name + a stripe of its notes' colours (css/chords.css). Melody lane moved to js/ui/melody.js (steps.js 613 → 536). One Undo each.
- **Tested:** tests/chord-check.mjs (new, 42 checks, PORT env): Acid / Modal chord == the notes alone at 1/√3 sample-exact (before the
  tanh clip), Coil E♭ / G present, onsets on the notes' sample, finite, CV root, migration, MIDI 3 ons / offs, Export, picker, Shift-click,
  drag / arrows, preview, .spores round trip. Suite passes: engine, sounds, export, save, clipboard, note-preview, fx, scene-mute, cv,
  cv-render, cv-ui, song-select, master, loop-song, audio, audio-song (4 tests' "v === 4" bumped to 5).
- **Odd / not done:** a pump chord is louder than one note (no 1/√n there: the wasm mixes its voices). Acid chords are 4 separate
  303s (each its own filter), not a paraphonic shared filter. Not heard by a person yet.

## 2026-11-27 — Song screen: pick several blocks, Copy / Paste / Duplicate (Claude, branch `q-songsel`, not pushed)
- `js/ui/songselect.js` (new; hooks in song.js: the import, a paste bar, one `multi.draw()` line) + `css/songselect.css`. Shift-click picks a
  run from the anchor; right-click / Menu key / Shift+F10 on a block: Copy, Paste…, Duplicate (menu helpers `contextMenu` / `onMenu` now
  exported from clipboard.js). Paste waits for a click: edge of a block = insert there (marker), middle = replace that block, or the whole
  pick if inside it. Escape / Cancel drops it. 128-block limit explained on disabled items. One Undo each.
- Tested: `tests/song-select-check.mjs` (PORT env), clipboard-check, loop-song-check pass. save-check's two 1280x760 header-height FAILs
  also fail on `dev` without this change (not caused by it).
## 2026-11-27 — "cool flare": an animated strip on the Song screen (Claude, branch `q-flare`, not pushed)
- **Done (queued request 6):** `js/ui/flare.js` + `css/flare.css`: a 52 px strip under the Song screen: a dancing mushroom (the app icon's, bobbing at the
  tempo, `--beat` from the BPM), 16 step lights (pink; beat lights taller and hot pink) following the engine 'step' counter, and a small scope canvas of the master
  peaks ('master' event) scrolling by. Only CSS variables, so it follows every skin. Only on the Song screen (Steps' grid rows have no room without touching steps.js).
- **Cheap:** one requestAnimationFrame loop only while playing and on screen; it ends itself when the screen or tab is hidden or all is quiet, and the next
  'master' event restarts it. prefers-reduced-motion: no bobbing or scope scrolling, only the lights change. engine/ untouched.
- **Skippable:** File › Animations: on / off (localStorage `spores.flare`, 'off' when off; per computer like the skin).
- **Hooks:** one line each in main.js (mount), filebar.js (menu item), index.html (CSS link). **Tested:** `tests/flare-check.mjs` (new; all ok, 4 skins, screenshots
  /tmp/flare-<skin>.png), header-fit-check (all ok). The scope is a level history, not a true waveform (the engine only sends peaks).
## 2026-11-27 — queued requests 1-3: preview on click, drag a note, arrow keys (Claude, branch `q-notes`, not pushed)
- **1 Preview on click:** `js/ui/preview.js` (`previewOn` / `setPreview`, localStorage `spores.preview`, on unless '0'; `previewStep`
  calls `engine.hit(ti, deg, vel)`, the same 'hit' path as the Sound picker; drum and synth tracks only). Plays when a step is
  switched on (not off), after a drag move, arrow key or the lane / panel note ▲ ▼. File menu row "Preview on click" with a tick
  (stays open, `menuitemcheckbox`). `js/engine/` untouched.
- **2 Drag:** `js/ui/notedrag.js` `attachNoteDrag`: press on an ON melodic step and move 8 px, then 14 px = one scale step (up =
  higher); pointer captured so it can leave the cell; the cell's tap-toggle is skipped after a drag and the step is selected.
  ONE Undo: `setNoteDeg` uses a per-drag merge key and a new `hold` flag on `store.edit(label, fn, key, hold)` (merges with the
  last edit of the same label + key however long the pause; old merging unchanged). `touch-action: pan-x` on melodic cells.
- **3 Keys:** `mountNoteKeys`: ↑ / ↓ on the selected note step, Shift = octave (the scale's note count). Ignored in
  input / select / textarea, menus and dialogs, on the Song screen and for drum steps. Each key press is its own Undo (as ▲ ▼).
- **"Chromatic" decision:** notes are stored as scale degrees (`deg`), so one move = the next note of the song's scale (a semitone
  only in the Chromatic scale; a tone or so in Minor etc.; it stays in key). No format change, `v` not bumped. A true semitone move
  in a non-chromatic scale would need a new per-step field (e.g. `semi`) and engine changes (compile, degToMidi) = 🔴; not done.
- **Tested:** `tests/note-preview-check.mjs` (new, 19 checks) all pass; save-check (menu rows now 9) passes except 2 header-fit
  checks that fail the same on the untouched branch (fname w=0 at 1280x760); engine-check, tempo-skin, scene-mute, clipboard,
  master checks pass. header-fit-check did not finish in 2 min (not rerun). Not tested: a real touch screen, the sound itself.
  steps.js is 613 lines (was 597): next change there should move code out.

## 2026-11-27 — IDM pink & green skin and tempo presets (Claude, branch `skin-tempo`, not pushed)
- **Skin `idmpg`** (css/app.css, js/ui/skin.js, 4 swatches `--sw-idmpg-*`): from ...Thunder Plus' IDM pink & green: paper `--mxbg`
  #e9e8e3 = bench, `--mxpanel` #f2f1ec = panel, `--mxpanel2` #dddcd5 = panel-2, ink `--mx` #141414, muted `--mx2` #505050, `--mxdim`
  #bdbcb6 = track, pink `--mxsoft` #ff2d8a = gate / selection, green `--mxbus` #1f9e5a = audio, play orange #ff4d00 = video / solo,
  JetBrains Mono (falls back to the system mono), square corners, uppercase letter-spaced brand. Spores' own: step greys, gate-dark, record red.
- **Tempo presets** (`js/ui/tempopresets.js`, one line each in steps.js / song.js): a "Style" list beside BPM, 23 usual tempos in
  4 groups; picking one is the same 'Tempo' edit as the BPM field (one Undo). `tests/tempo-skin-check.mjs` covers both and the skin.

## 2026-11-27 — effect presets on every effect card (Claude, branch `fx-presets`, not pushed)
- **Done:** a preset list (aria-label "<Effect> preset") in each Effects card, under the buttons: Default first, then the
  effect's presets; it shows "Custom" when the values match none. Picking one is ONE undo step ('Effect preset',
  `applyFxPreset` in `js/fxedit.js`). The table is the new `js/engine/fxpresets.js` (`FX_PRESETS`, `fxPresets`, `fxPresetName`).
- **Where they came from:** every preset is ...Thunder Plus' own (FX_FACTORY + FX_FACTORY_MORE in its index.html), 4-6 per
  effect, all 34 effects, none written new, none skipped. Thunder's choosing a preset resets unnamed settings to default;
  so does this. Only change: Cross-mod's Tone is Thunder's Carrier minus 1 (Spores has no "Input R").
- **Tested:** `tests/fx-preset-check.mjs` (new, 27 checks), `tests/fx-ui-check.mjs` (57) and `tests/fx-check.mjs` (35), all pass.
  The list is 44 px tall and inside the card at 1280x760 and 1440x830. Not tested: a real phone, the sound of each preset.

## 2026-11-27 — review findings 1 and 2: song files can no longer silence the mix or loop a billion times (Claude, on `dev`)
- **Done (two commits, `js/store.js` only):** (1) `fixTrack` rebuilds `track.params` for drum / synth tracks from
  `settingsFor(sound).all`: finite numbers only, clamped to each setting's min..max (rounded for `int` ones). Non-numbers,
  NaN / Infinity and unknown keys are dropped, so a bad value can't reach `BlipVoice`. (2) `migrate` keeps only song
  blocks whose scene exists, clamps `repeat` to 1..64 (bad / missing = 1), makes `loop` a boolean and keeps at most 128
  blocks. If every block is dropped the song is left empty (not replaced by scene A). `v` stays 3; no undo / merge change.
- **Tested:** the review's two repros as scratch files (deleted). Before: `BlipVoice` samples NaN; `repeat 1000000000`
  kept and `songMap` gave 1000000001 bars. After: `{pitch:'loud', decay:1e9}` becomes `{decay: 4000}` and the samples
  are finite; the song ends as `[A x1, A x64 loop]` with the missing-scene block gone (65 bars). Default params of every
  drum / synth sound, `newSong` and `demoSong` params round-trip unchanged. `cd desktop && npm test` 11 pass.
  `tests/save-check.mjs` in headless Chrome: all ok except "menu rows and shortcuts", which fails the same way on `851d5ef` (the test predates the File menu's Export… row).
- **Odd / left:** a block saved before now gains `loop: false` on the next save (same meaning, only a new key). The
  unknown-key drop means a file from a newer version loses settings this one doesn't know. Export length with a bad
  repeat was not run through the Export UI, only reasoned from `songMap`.
- **Follow-up (Claude, same day):** `BlipVoice.set` now does what `AcidCore.set` does: any default key that isn't a
  finite number falls back to its default (other keys pass through), so `{pitch:'loud', decay:NaN}` renders finite
  samples (was NaN). `tests/save-check.mjs` now expects 8 File menu rows with Export… 5th; it runs all 46 checks green.
  `worklet.js` still plays `Math.max(1, b.repeat)` raw, left as is since load clamps to 64.

## 2026-11-26 — every sound checked live; three slow pads fixed (Claude)
- **Checked:** all 153 sounds played live (real-time AudioContext, peak at the output, new `tests/live-sounds-check.mjs`).
  Since FX1's fix (wasm bytes, not a compiled Module, posted to the worklet) Coil / Orbit / Fold / Boing all sound live;
  in v0.2.0 and earlier they were silent live in Chrome 153.
- **Fixed:** Fold · Folded drone (−60 dB), Fold · Drifting complex (−42 dB) and Orbit · Thomas pad (−28 dB) never got
  loud: their 0.6–1.5 s fade-in (Fold `rise`, Orbit `attack`) is longer than a step's note (half a step). `js/engine/sounds.js`
  caps those at 60 ms in Spores' copy of the presets; tails unchanged, More can slow it again. Now 0.39–0.62 peak.
- **Tested:** live sweep 153/153 above 0.13 peak, no errors; sounds-check unchanged. Not tested: real speakers / a Mac.
- **Later (owner):** a held / tied note (longer gate) would let real pads and drones keep their slow fade-in.

## 2026-11-26 — export C: File › Export… done, engine + UI + desktop (Claude, on `dev`, pushed)
- **Done:** File › Export… (Steps screen File menu + the desktop app's native File menu): **Song** (the arrangement once),
  **Scene** (the Steps screen's scene, or another, × 1–64, default 4, remembered for the page), **Stems** (a `.zip`: folder
  "<name>/" with "01 Kick.wav" … + "<name> mix.wav"). Always 48 kHz, 24-bit stereo WAV (`wavBytes` now takes `[L, R]`;
  the mono 32-bit float path for takes is unchanged, Save stays byte-identical). File name defaults to the song's file
  name ("Song" if none; "<name> - scene A", "<name> stems"). It asks where first (inside the click), then renders with a
  progress bar + Cancel, then "Saved “x.wav” (0:42, 12 MB)" and, on desktop, Show in Finder ("Show in folder" elsewhere).
  Desktop: `spores:out-pick / out-write / out-show` in `desktop/files.js` (after Thunder's out-* ; Save dialog starts where
  the last export went, else the song's folder, else Music; only `.wav` / `.zip`; only paths picked in that dialog this
  session, in a separate in-memory allow-list so exports never push songs out of Open Recent; written via a temp file +
  rename). `path-allow.js` `check(p, 'out')` + `isOutFile`. Chrome: `showSaveFilePicker`, else a download.
- **Engine (🔴):** `js/engine/render.js` (page) + `js/engine/bounce.js` (worklet). The live worklet, voices, effects, takes,
  pump wasm and Modal / Scanned notes (re-recorded at 48 kHz in render-worker.js) in an OfflineAudioContext. With
  `processorOptions.bounce` the worklet plays exactly N steps, then on the sample after the last step it ends like Stop
  (no new notes, takes fade 5 ms, synth notes released) **but the effects keep "playing"**, so the 3-s after-Stop tail
  fade never cuts a reverb. The rendered samples go to the page in 32k-frame chunks over the port (the context itself is
  1 channel, so memory = the result only), which also drives the progress bar. Tail: kept while louder than −90 dB at the
  file; stops after 2 s below it, or 10 s after the end (then the last 0.25 s is faded); trimmed to the last sample above
  −90 dB. After that the worklet writes silence, so the rest of the render is nearly free. Cancel: the page checks once per
  second of audio (ctx.suspend), posts `{t:'halt'}` (a worklet only hears messages while an offline render is suspended).
  Master = tanh in the worklet × 0.9 (the page's master gain) as live; the first step lands on sample 0 (the render's
  0.06 s lead-in is trimmed). **Stems** = one pass for up to 4 tracks (8 channels; ≤ 4 passes for 16 tracks): every track
  plays (so chance rolls are the same in every pass) but each listed track goes into its own channel pair after its
  effects / volume / mute and before the master clip; the mix = 0.9 × tanh(Σ stems / 0.9), i.e. exactly what the worklet
  does (sum then tanh). Live play is untouched: without `bounce` the worklet runs the same code path as before
  (stemBuf() returns null, one extra null check per track per block).
- **Rules (decisions, owner may change):** Song: a Loop-forever block plays its **repeats once** (as the Song screen draws it)
  and the blocks after it follow; Mute and **Solo are respected** (as playing). Scene: song-length takes are silent (as when
  a scene plays). Stems: MIDI / CV skipped, **muted tracks skipped, Solo ignored** (every other track counts, so stems add
  up to the mix), tracks that stay completely silent are left out, the mix in the zip is that same set. Stems are not
  clipped (a stem over 0 dBFS clips in the 24-bit file); the mix is. No dither (24-bit). Scene default × 4.
- **Tested:** new `tests/export-check.mjs` (27 checks, all pass) on a song with 7 drum / synth tracks (one Coil = pump wasm,
  one Modal = rendered notes, one muted), MIDI + CV tracks, a reverb + an echo, a loop take (440 Hz) and a song-length take
  (660 Hz from bar 1), blocks A ×2 + B (Loop forever): song export through the dialog (mocked picker), end at 384000 =
  4 bars exactly, tail 2.7 s ending near −90 dB, matches a plain offline render of the worklet within −90 dB (−144 dB),
  Solo respected (−144 dB); scene ×3 at 170 BPM, kick on step 5: first non-zero sample = ceil(4 steps)+1 (the hit starts on
  ceil(4 steps), whose first value is 0), end within 1 sample of 3 × 16 steps; stems: 9 files + mix with the right names
  (MIDI, CV, muted left out, Solo ignored), 0.9·tanh(Σ/0.9) = mix (−128 dB), plain sum ≈ mix within −60 dB at these
  levels (−63 dB, sum peak 0.12), mix = plain render with Solo off (−143 dB), 440 / 660 Hz in the takes' stems (song take
  silent before bar 1), Coil and Modal stems have sound, Snare's reverb rings in its stem after the end; every WAV 2 ch /
  48 kHz / 24-bit by python `wave`, `unzip -t`; Cancel stops in ~0.6 s and writes nothing, export after Cancel works; no
  console errors. New `tests/desktop-export-check.js` (Electron 33, xvfb, dialogs + shell stubbed, 12 checks pass): menu
  Export…, .wav filter, starts in Music then where the last one went, ".wav" added, WAV written + parses, Show in folder
  gets the path, stems zip, cancelled dialog renders nothing, unpicked / .spores / .sh refused. `path-allow.test.js` +1
  test. Dialog: no control under 44 px, screenshots in Minimal and Black looked right. Still pass: engine-check (170 BPM
  gaps exact, MIDI clock 20.83–20.86 ms), sounds-check, audio-check (30), audio-song-check (29), fx-check (35), save-check
  (46), cv-render-check, cv-check, zip-check, audio-ui-check (62), audio-song-ui-check (55), desktop-save-check, updater,
  path-allow; cv-ui-check unchanged (its fake-input Tune step fails in this sandbox, as before).
- **Speed:** a 12.5 s song ≈ 0.25–0.7 s here (this 2.1 GHz Xeon); stems ≈ (tracks / 4) × that.
- **Not tested:** a real Mac (Finder reveal, the real Save dialog), Windows, a real Chrome picker UI (mocked), very long songs
  (memory: the result is held as floats then as WAV bytes; a 5-minute 16-track stems export ≈ 1.5 GB of WAVs in one zip:
  heavy — a desktop "folder of WAVs" would avoid the big zip if that is ever needed), touch.
- **Odd:** each export pass's OfflineAudioContext keeps its wasm instances (tfx ×2, pump ×1) until the page goes (see the
  FX1 note: ~60 contexts). Export only loads tfx / pump when the song uses effects / pump sounds, and a Song export is one
  pass, Stems ≤ 4, so this needs a lot of exports in one session; reloading the page clears it. If it happens, effects
  pass the sound through in that export (no crash).
- **Next:** (5) desktop build + release (FX2, the Effects panel, landed alongside; export-check, fx-ui-check and the rest re-run after the rebase: all pass). Later if wanted: MP3, loudness-normalised
  export, stems as a folder on desktop, Scene stems.

## 2026-11-26 — effects FX2: the Effects panel is done (Claude, on `dev`)
- **Done:** `js/ui/fxpanel.js` (+ `css/fx.css`), mounted by panel.js as an "Effects" section after Track (drum, synth, loop
  audio and song-length audio; none for MIDI / CV). "+ Add effect ▾" lists the 34 effects under the 8 groups; at 4 on the
  track or 32 in the song the button is disabled and the line under it says why ("n of 32 in the song" always shows).
  Each effect is a card: name, On / Off, ‹ ›, Reset, × (asks "Remove Echo?" Keep it / Remove it; Undo restores it with its
  settings), then its settings: Simple = the main ones, More = all; values via fxText (Time uses the song's BPM). Sliders
  merge into one Undo per drag (store 'Effect setting' label); the cards are rebuilt only when the list / order / on-off
  / mode changes, so a drag is never interrupted. The track row says "fx 2" (in the "Drum · Kick" line on wide windows,
  a small line of its own on laptops where that line is hidden).
- **Song-length audio tracks:** their Effects are in the Steps panel (where their Volume already is), not on the Song-screen
  card. Say if you want them on the card too.
- **Tested:** tests/fx-ui-check.mjs (all ok at 1280x760 and 1440x830: add Echo → song + worklet, setting + Undo, a real mouse
  drag = one Undo, on / off, reorder, Reset, remove asks / Keep it / Undo restores, 5th effect refused, 32-in-song message,
  audio loop + song-length, Simple 3 vs More 6, Save → Open, no MIDI/CV section, header one row, no panel control < 44 px,
  no console errors; SHOTS=dir writes the panel in all three skins, looked at). fx-check, audio-ui-check,
  audio-song-ui-check, save-check, engine-check still pass.
- **Not done:** step 5 (desktop build + release). Plan step 3 is finished.

## 2026-11-26 — effects FX1: engine + data for up to 4 effects per track done (Claude, on `dev`, pushed)
- **Done:** `js/engine/tfx.wasm` (unchanged copy of thunder-plus/waves/dsp/tfx.wasm, Thunder 706d70c, md5 99337ee2…;
  refresh: `sh tools/copy-fx.sh /path/to/thunder-plus`, then check fx.js still matches Thunder's TFX table). `js/engine/fx.js`:
  all 34 effects in tfx.wasm with plain names, 8 groups, every setting's key / default / range / value text / wasm map copied
  from Thunder's `const TFX = {` (values are Thunder's whole numbers, mostly 0–255, 128 = middle; Time in steps, Note as
  MIDI, Pitch in semitones), 1–3 main knobs each. `js/engine/fxhost.js` runs them in the worklet; `js/fxedit.js` edits them.
  Song **v 3**: `track.fx = [{id, type, on, p}]` (v2 → fx = []; fixTrack cleans every version: known types, ≤ 4, values
  clamped to range, unknown keys dropped, ids unique; MIDI / CV tracks always []). Save / Open unchanged (it's in song.json).
- **Not included:** Thunder's JS-only effects (Resonator chords, Pitch delay, Pitch reverb, Flex, Step gate, Grains, Scramble,
  Glitch, Retrigger, Degrade, Vintage sampler): they are not in tfx.wasm (plain JS in Thunder's index.html, most tied to its
  tracker clock / FLX GAT RTG commands). Of the wasm ones none was dropped; Cross-mod lost its "Input R" carrier (needs a
  second track as the carrier) and keeps Sine / Triangle / Saw.
- **Signal path:** voice / take → effect 1…4 → volume, mute, solo (all after the effects, so a muted track's tail is silent
  too) → mix → master tanh. Drum, synth (Acid, pump, Modal / Scanned), loop and song takes. MIDI / CV: none. A track with no
  effects plays exactly as before (same code path).
- **Behaviour:** on / off = 5 ms crossfade of input and output; switched on again it starts afresh (no stale echo jumps in).
  Add = fades in; remove = fades out, then freed. Reorder = the track's effects output dips to silence over 2.7 ms and back
  (no click; not a crossfade). Settings glide (~30 ms one-pole per block) except choices / counts (fx.js `hard`). Reverbs
  run fully wet with Thunder's rvMix blend. Crash (wasm trap) → that effect is bypassed for good; NaN / runaway → that block
  passes dry, effect restarted; bad input samples zeroed, anti-denormal; views remade when wasm memory grows. Silent in and
  out for 4 s → it sleeps (Vinyl never). Trance gate restarts on Play, on step 1. Two wasm instances (32 effects each).
- **Tails (decision, owner may change):** while playing, effects run on (a reverb rings through a scene change or empty
  steps). On Stop they ring on; once a track has had silence going IN for 3 s, whatever still sounds (an endless echo, a
  frozen grain cloud) fades out over 0.25 s and its effects are started afresh, so nothing old returns on the next Play.
  A tapped step cancels that at once.
- **Limit (decision):** 4 per track, **32 in the song** (`MAX_SONG_FX`; a file with more still plays up to 64). Cost per
  128-frame block (offline render, this 2.1 GHz Xeon; budget 2667 µs): 16 drum tracks no effects 83 µs · 64 effects of every
  kind 1756 µs · 64 of the heaviest (Space, Speaker cab, Tape, Galaxy) 4140 µs = over real time · 32 heaviest 2104 µs ·
  32 of every kind 908 µs. A Mac M-series core is roughly twice this, so 64 typical would fit there but 64 heavy would not.
- **Fixed on the way:** a compiled `WebAssembly.Module` posted into the realtime AudioWorklet arrives as a `messageerror` in
  Chrome 153, so **COIL / ORBIT / FOLD / BOING were silent in real time** (offline renders were fine, tests only checked that
  the post happened). engine.js now sends the wasm bytes and the worklet compiles them (pump and tfx); `wasmReady` /
  `fxReady` now resolve to the worklet's own answer.
- **API for the panel (Sonnet agent):** all in `js/engine/fx.js` and `js/fxedit.js`, no engine calls needed (main.js sends
  every edit to the engine).
  - Menus: `FX_GROUPS` (8 names in order), `FX_LIST` → `[{type, name, group, about}]` in menu order (group by `group`).
  - `fxInfo(type)` → `{type, name, group, about, main: [keys], params: [{key, label, def, min, max, names?, main}]}`.
    A param with `names` is a choice (a select / segmented control, value = index); otherwise a whole-number slider
    min…max, step 1. Simple shows `main` (in that order), More shows all `params` (in their order).
  - `fxText(type, key, value, bpm)` → the value as shown ("−3.0 dB", "4 steps · 500 ms", "Hi-fi"); pass the song's bpm
    (only the echo's Time uses it). `fxDefaults(type)`; `MAX_FX` (4), `MAX_SONG_FX` (32).
  - `canHaveFx(track)` (drum / synth / audio), `canAddFx(track, song)`, `fxCount(song)` ("12 of 32 in the song").
  - Edits (each one Undo step): `addFx(store, trackId, type, at?)` → new id or null ('Add effect'); `removeFx(store, trackId,
    fxId)` (ask first: "Remove Galaxy reverb?"); `moveFx(store, trackId, fxId, -1 | +1)`; `setFxOn(store, trackId, fxId, on)`;
    `setFxParam(store, trackId, fxId, key, value)` ('Effect setting': consecutive moves of the same knob within 600 ms
    merge into one Undo, so writing on `input` is fine); `resetFx(store, trackId, fxId)`.
  - The effect's data: `track.fx[i] = {id, type, on, p}`; read it from `store.get()` fresh after Undo.
- **Tested:** new `tests/fx-check.mjs` (35 checks, all pass; `ONLY=each|clicks|timing|tails` runs one offline section):
  every effect renders a snare with signal and no NaN / Inf; no click (largest sample jump within 1.25× + 0.004 of the
  effect on or off alone) toggling eq, density, Galaxy, Space, echo, chorus, ladder, pitch shifter, compressor, tube,
  overdrive, bitcrusher on a held sine take, adding / removing the first effect, reordering; 170 BPM kick onsets with
  64 effects identical to without (to the sample); Space tail after a hit, rings on after Stop; an endless echo (Repeats
  255) faded to silence after Stop and silent on Play again; pitch shifter +12 on an audio take (440 Hz out); on the page:
  both wasm files reach the realtime worklet, it makes the effects, Add / setting clamp / one-drag Undo / move / off /
  Undo / Redo, 4 per track, 32 per song (Undo back), old v2 song → v3 with fx = [], odd lists cleaned. Still pass:
  engine-check (170 BPM gaps exact, MIDI clock 20.83–20.86 ms), sounds-check, audio-check (its v1 → v2 check now expects
  v3), audio-song-check (same), audio-ui-check, audio-song-ui-check, save-check, cv-render-check, zip-check, cv-ui-check.
- **Not tested:** real speakers / a real Mac (CPU there), Electron (bytes path should be the same), every effect's every
  setting extreme (crash-bypass covers a trap), touch.
- **Odd:** each OfflineAudioContext keeps its two wasm instances until the page goes; after ~60 offline renders in one page
  new instances fail (effects then pass the sound through). The test opens a fresh page per section. The app has one context.
- **Next:** (3) the Effects panel (Sonnet agent, from the API above), then (5) desktop build + release.

## 2026-11-26 — audio tracks B4: the UI for the song-length audio track done (Claude agent, on `dev`, pushed)
- **Done:** Add track ▾ › "Song-length audio track (record over the whole song)" (names "Song voice 1…", shares the 4-audio limit;
  both audio items grey out with "4 of 4 used"). **Steps screen:** the track keeps its row ("Audio · whole song · no take yet") but
  its lane is one dashed line "Song-length take · on the Song screen" (tap: selects it and opens the Song screen); its panel
  is a note + button + Volume / Colour. **Song screen** (`js/ui/songlane.js`, `songwave.js`, `songmore.js`): under the blocks one
  strip per song track, aligned to the block cards (each card = its bars × repeats, via `songMap`), waveform drawn at `startBar`
  (repeats included), trims honoured, "No take yet · press Record", a playhead line from `songStep`. Blocks and strips scroll
  sideways together. Tap a block (not its buttons) to select it; the card under the strips has ● Record from start, ● Record
  from block N (off until a block is tapped), count-in "1 2 3 4", "Recording… bar N" (song bar), ■ Stop (keeps the take), Volume,
  M, S, More: start bar − / + (whole bars, "Bar n"), trim start / end, fades, gain, Remove this take (asks), then the shared input
  picker / level meter / Hear myself / latency. Undo / Redo = the Song header's. The shared input bits were moved out of
  `audiopanel.js` into `js/ui/audioinput.js` (`inputControls`, `latencyControls`), so both screens use the same code and settings.
  The mic closes after a take unless More is open. Song tracks no longer get a bar in the blocks' mini grid. Help: one line.
  **Fix:** the level meter's cover was `--glass` (near black) so it looked like a black bar before the mic was on; now `--track`
  (border `--edge`).
- **Tested:** new `tests/audio-song-ui-check.mjs` (fake mic), all pass: add; limit shared (1 song + 3 loop = 4, both items
  disabled with the reason); Steps: no loop lane, the one-line lane, row text, panel, tap goes to Song; empty lane text; record from
  start (count-in shown, "Recording… bar 1", Stop keeps it, waveform starts at block 1's left and runs past block 2); Undo / Redo;
  record from block 2 (startBar 1, waveform starts at block 2's left, nothing over block 1); start bar + / − undoable (stops at
  bar 1); fade / trim sliders write, one Undo step; meter cover is not black with the mic off; Save → Open in a fresh profile
  draws the take; header one row, no page scroll, no control under 44 px on Steps and Song (More open) at 1280x760 and 1440x830 in
  Minimal, Black, Pastel; no console errors. Song-screen screenshots in all three skins looked right. Still pass: audio-ui-check,
  audio-song-check, audio-check, engine-check, save-check.
- **Not tested:** a real mic / interface; a long real take; touch; recording a song with a Loop-forever block; two song tracks at
  once (code handles it, one card each; only one can record at a time); a take longer than the song (drawn to the song's end only).
- **Decisions (owner may change):** the lane waveform is as wide as the block cards (fixed 188 px each), so a long song is
  scrolled sideways, not squeezed; the record buttons are on a card under the strips, not inside the strip; "selected block"
  is chosen by tapping a block card; start bar is shown 1-based ("Bar 1" = startBar 0); no fade curves drawn.
- **Next:** export (C), effects, a take-end handle you can drag on the strip.

## 2026-11-26 — audio tracks B3: engine + data for song-length audio done (Claude agent, on `dev`, pushed)
- **Done:** a second kind of audio track that spans the song: `type: 'audio'` + `span: 'song'` + `track.take`
  (`newSongTrack()`, `isSongTrack(t)`, `newSongTake({id, sr, bpm, startBar})` in store.js; it counts toward
  `MAX_AUDIO_TRACKS`; no `v` bump: optional fields, old files open as before; migrate cleans a bad take to null, drops
  stray `span` / `take` from other tracks and never keeps scene clips on a song track). `track.take = {id, sr, bpm,
  startBar, gain, fadeIn, fadeOut, trimStart, trimEnd}`; samples in IndexedDB and in `.spores` as `audio/<id>.wav`
  exactly like loop takes (`clipIds` includes them, so Save / Open / the worklet need nothing new). Engine:
  `js/engine/songtape.js` (SongTape voice, SongCapture), worklet keeps a song step counter, `js/songmap.js` (pure).
- **Playback rules:** song mode only (**silent in scene mode**). A song bar counts from 0 at the first block, through
  every block and every repeat. The take's first sample plays on the first sample of `startBar`, re-synced on every step
  (no drift, any tempo; another tempo = varispeed, it keeps its bar count). Silent before its start and after its
  (trimmed) end. At the song's end the song starts again from bar 0 and so does the take (crossfade 5 ms); the part of a
  take past the song's end is never heard. **Loop-forever block:** the song bar keeps counting up inside it, so the
  take plays on through to its own end once, then is silent (blocks after a Loop-forever block are only reached by
  Play from block). **Trim:** `trimStart` / `trimEnd` hide seconds at either end; the take stays anchored (trimming
  never moves the audio; moving = `startBar`); fades apply at the trimmed edges. Mute / solo / volume as other tracks;
  silent while it is being recorded.
- **API for the UI agent** (Song screen lane; all on `engine` = `window.spores.engine` unless said):
  - `const take = await engine.recordSong({track: trackId, fromBlock = 0, metronome, onTake})` → `{id, kind: 'song',
    trackId, data, sr, bpm, startBar, n}` or null. Whatever plays stops; one bar of count-in; the song plays from block
    `fromBlock` (index into the blocks as songMap lists them); records from that block's first sample (same latency
    correction / input / Hear myself as loop takes) until **Stop** or `engine.stopRecording()` (both keep the take) or
    the song's end; the music plays on afterwards. `engine.stopRecording({discard: true})` drops it. Then
    `keepSongTake(store, take)` (js/takes.js, also `window.spores.keepSongTake`) = one Undo step 'Record song take';
    `clearSongTake(store, trackId)` removes it. `engine.record()` on a song track is refused ('cancelled').
  - `engine.on('rec', m)`: `count-in` has `kind: 'song'`, `startTime`, `endTime` (the song's end, context seconds;
    null if a Loop-forever block comes after `fromBlock`), `block`, `startBar`; then `recording`, `done` / `cancelled`.
    **`engine.recording` is now false before 'done' / 'cancelled' reach listeners** (loop takes too; the B2 note).
  - Play from a block: `engine.play('song', null, blockIndex)` (already existed; the song take starts at the right
    offset, sample-accurate). Step events (`on('step')` / `on('sched')`) now carry `songStep` (song mode; ÷ 16 = song
    bar) for a lane playhead.
  - Drawing the lane: `songMap(song)` → `{blocks: [{index, scene, bars, repeat, loop, startBar, endBar}], totalBars,
    loopAt}`, `barToBlock(song, bar)` → `{index, rep, barInScene}`, `blockToBar(song, index)`, `takeBars({sr, bpm, n})`
    (js/songmap.js). The take's samples: `peekClip(id)` / `getClip(id)` (audiostore), peaks as for loop takes.
  - Debug: `await spores.debugRecordSong({fromBlock})` in the console (adds a song track if none, records, keeps).
- **Tested:** new `tests/audio-song-check.mjs`, all 29 pass. Offline (song A 1 bar · B 2 bars ×2 · A): start bar 3 (the
  repeat of B): silent before, first sample on the bar line (120: sample 290880 with its exact value; 170: first frame
  = ceil of the fractional bar line), later bars within 0.01 sample; start bar 1 across A → B: bars land within 0.02
  sample, stops at the song's end, starts again with the song (120 and 170); Play from block 2 / 3: the take's right
  sample within 0.02 sample (120, 170); varispeed 120 → 170 within 0.03 sample; trim anchored + gain; silent in scene
  mode; Loop-forever block plays the take through once. Real time against a 25 ms loop-back: from the start = exactly 3
  bars, kicks 0.023 ms off; from block 2: startBar 1, exactly 2 bars, 0.023 ms; Stop part-way keeps it (aligned);
  discard drops it; `engine.recording` false at 'done'. Undo / Redo swap track.take in the song and the worklet, Play
  from block 2 after Undo plays the older take. Save → Open in a fresh profile: WAV in the file, take back in IndexedDB
  and the worklet. Migrate rules; 4-track cap. Still pass: audio-check (30), audio-ui-check, engine-check (170 BPM gaps
  exact, MIDI clock 20.83–20.86 ms: no timing change), sounds-check, cv-render-check, save-check, zip-check.
- **Not tested:** a real mic / interface; very long takes (capture is chunked, 8 s chunks, joined on the page; stops by
  itself at 30 minutes); the Steps screen with a song track (it shows as an empty loop lane until the UI agent hides it
  there); a take recorded at another sample rate (same maths as loop takes).
- **Decisions (owner may change):** silent in scene mode; Loop-forever = plays through once; recording always starts
  from Stop with a count-in (no punch-in while the song is already playing); after the song's end the music keeps
  looping (as loop takes keep playing) but the take has ended; Stop keeps a song take (a loop take's unfinished bar is
  dropped); `startBar` is a whole bar ≥ 0; trim keeps the audio anchored; no reverse / offset on song takes (not in the plan).
- **Odd:** none new. **Next:** the Song screen lane (UI agent: hide song tracks from the Steps grid or show them as a
  plain row, Add track › "Song-length voice", the lane, Record from a block, move / trim / fades in More); export (C).

## 2026-11-26 — audio tracks B2: the UI for loop takes done (Claude agent, on `dev`, pushed)
- **Done:** "+ Add track ▾ › Audio track (record your voice)" (disabled with the reason at 4 audio tracks / 16 tracks; names
  "Voice 1…"); row "Audio · 2 bars" / "Audio · no take yet" (kept visible on laptop widths, name on one line), teal.
  Steps lane (`js/ui/audiolane.js`): inert cells (so it lines up and the playhead highlights the current step) under a
  canvas waveform of this scene's take (`js/ui/peaks.js`: 1024 min/max bins, gain / reverse / offset applied when drawn),
  repeated at 30 % when the scene is longer than the take; "No take in this scene · press Record", "Counting in…",
  "Recording…". No melody lane for audio. Panel (`js/ui/audiopanel.js`): Record / ■ Stop, count-in "1 2 3 4", "Recording…
  bar n of m", loop 1/2/4/8 (`track.loop`, default 2, validated in store.js; it is the length of the NEXT take; a note shows
  when the scene's take differs), input device + channel (only > 2), level meter (dB scale, quick rise / slow fall),
  Hear myself (off) + headphones line, Keep going (this page only), Volume / Colour. More: gain (dB), start offset,
  fades (ms), reverse, Remove this take (asks), latency value, Adjust (ms), "Test latency…" (`audiolatency.js`: explains,
  runs measureLatency without applying, "Use this" / "Try again" / "Keep what I had"). Sliders write on release (one Undo
  step per drag; store.js MERGE_LABELS untouched). `js/ui/recstatus.js` turns engine 'rec' events into phase + bar / beat.
  Song screen: a teal bar in each block's mini grid (audio rows always listed; the mini grid is capped at 8 rows). Help:
  a "Recording your voice" paragraph. Copy scene copies takes; Delete track drops its takes (Undo brings them back).
  The microphone closes when a non-audio track is selected (no recording dot in the tab); it opens on "Turn on the
  microphone", on Record, or by itself when Chrome already allows it.
- **Tested:** new `tests/audio-ui-check.mjs` (headless Chrome, fake mic), all pass: add; 5th refused with reason; empty lane
  text; panel contents and defaults; loop length + Undo; meter moves; 1-bar take (count-in 1-2-3-4, "Recording… bar 1 of 1",
  waveform drawn, row text, Undo removes, Redo restores); playhead on the lane; More controls write and Undo; latency
  adjust (kept in localStorage); Test dialog text; Keep going (two takes, Stop, Undo); Song mini bar; Save → Open in a
  fresh profile keeps the take visible; permission denied → plain message; header one row and no page scroll at 1280x760 and
  1440x830 in all three skins, Simple and More; no control under 44 px (checkboxes counted by their row); no console
  errors. Screenshots of the Steps screen with an audio track in Minimal, Black and Pastel looked right. Still pass:
  audio-check (30), engine-check, save-check, cv-ui-check.
- **Not tested:** a real microphone or interface (channel picker with > 2 channels, the real latency test through air),
  a real Mac, touch, the permission prompt itself (Chrome's UI is auto-accepted here), Safari / Firefox. The fake mic
  is a beep, so waveforms are spikes; real voice shapes not seen.
- **Decisions (owner may change):** loop length is a setting of the track for the next take (default 2 bars), not the
  take's; Keep going and the mic choice are not Undo steps (not song data); latency "Use this" is per computer; a take
  longer than its scene shows only the part inside the scene.
- **Odd:** the engine emits 'rec' done before `engine.recording` goes false, so the UI relies on its own phase. The
  Chrome fake mic alternates silence and full scale, so the meter jumps between empty and full in tests.
- **Not done (next):** song-length audio layer on the Song screen, effects, export (C), a waveform on the Song mini grid
  (it is a bar), per-take colour, drag a take between scenes.

## 2026-11-26 — audio tracks B1: engine + data for loop takes done (Claude agent, on `dev`, pushed)
- **Done:** song `v` 2 (v1 migrates: every scene gets `clips: {}`). Track type `audio` (`MAX_AUDIO_TRACKS` 4,
  `canAddAudio(song)`, `newTrack('audio')` = "Voice", teal by default). `scene.clips[trackId] = newClip({id, bars, bpm, sr})`
  → `{id, bars 1|2|4|8, bpm, sr, gain 1, offset 0 s, fadeIn 0.004 s, fadeOut 0.004 s, reverse false}`. Samples live in
  `js/audiostore.js` (IndexedDB `spores-audio` + memory) and in `.spores` files as `audio/<id>.wav` (32-bit float mono,
  `js/wav.js`); Save writes only the takes the song refers to, Open puts them back before the song loads.
  Engine: `js/engine/tape.js` + worklet changes (playback, count-in, capture, latency bursts), `js/engine/recorder.js`
  (page side). Takes reach the worklet by transfer; the worklet holds exactly the takes the current song refers to.
- **Playback rules:** a take loops from the scene's first sample (song mode: from the block's first sample; a block's
  repeats run on through the take, so a 4-bar take in a 1-bar scene ×4 plays all 4 bars), re-synced on every step so
  it can't drift; another tempo = varispeed (pitch moves). Mute / solo / volume as other tracks. A scene with no take
  for a track is silent on it. The track being recorded is silent while recording (incl. its old take).
- **API for the UI agent** (all on `engine`, i.e. `window.spores.engine`; put a take in the song with `keepTake`):
  - `await engine.audioInputs()` → `[{deviceId, label}]` (labels are empty until the first `openInput`, browser rule).
  - `await engine.openInput({deviceId, channel})` → `{ok, channels, channel, label, error}`; channel from 1; defaults
    = the last choice (kept on this computer, localStorage `spores.rec`). `engine.closeInput()`. `engine.input` →
    `{open, deviceId, channel, channels, label}`. `engine.on('input', m)` fires on open / close / `{lost: true}`.
  - `engine.on('level', ({peak, rms, db, clip}) => …)` ~60 times a second while an input is open (peak 0…1).
  - `engine.setMonitor(on)` / `engine.monitor` ("Hear myself", off by default, remembered).
  - `engine.latency` → `{reportedMs, offsetMs, totalMs}`; `engine.setLatencyOffset(ms)` (the More "latency" nudge).
    `await engine.measureLatency()` → `{ok, totalMs, reportedMs, offsetMs, jitterMs, found, error}`: 8 bursts 0.25 s
    apart; needs the input to hear the output (headphones held to the mic, speakers, or a cable). Sets the offset.
    Not while playing a song (it would hear the music too; the UI should Stop first).
  - `const take = await engine.record({scene, track: trackId, bars, keepGoing, metronome, onTake})` → the last
    finished take `{id, trackId, scene, data, sr, bars, bpm, n}` or null if stopped first. From Stop: plays the scene
    with one bar of count-in, records `bars` from the scene's start, then keeps playing. While playing that scene:
    count-in over the next bar, records from the bar line after. Playing something else (song mode, another scene):
    stops it and starts as from Stop. `keepGoing`: takes follow one another; `onTake(take)` for each; ends with
    `engine.stopRecording()` (the unfinished take is dropped) or Stop. `metronome`: clicks on the beats while recording.
  - `engine.on('rec', m)`: `{state: 'count-in', countTime, startTime, endTime}` (context seconds; turn into a countdown
    with `engine.toPerf`), `'recording'`, `'done'`, `'cancelled'`. `engine.recording` (bool).
  - `keepTake(store, take)` (js/takes.js) = samples into audiostore + one `store.edit('Record take')` → Undo brings the
    previous take back. Call it in `onTake` for keep going. `clearTake(store, scene, trackId)` removes one.
  - `engine.on('missing', {id})`: a take the song refers to has no samples here (a file opened without them).
  - Debug: `await spores.debugRecord({bars})` in the console (adds an audio track if none, default input, records,
    keeps). `await engine.peekWorklet()` → what the worklet holds (tests).
- **Tested:** new `tests/audio-check.mjs`, all 30 checks pass: offline, the first sample of a take lands on sample 2880
  (the scene start) with its exact value, loops exactly on bar lines at 120; at 170 the loop start is within 0.01
  sample of every bar line; a 120 BPM take in a 170 BPM song spans exactly one bar (within 0.02 sample); 2-bar take in
  a 1-bar scene; song blocks; mute; reverse; the 4 ms fade. Real time, against a loop-back in the audio graph (engine
  output → DelayNode → its input): the latency test finds the loop's delay to within 0.05 ms, recorded kicks land
  within 0.05 ms of their steps from Stop, from mid-scene (turned round) and with keep going; rec states. Undo / Redo
  swap the clip in the song and the worklet and Play uses it. Save → Open in a fresh browser profile restores the take
  (IndexedDB + worklet), re-saving gives byte-identical WAVs; old v1 `.json` opens as v2. A fake input device opens,
  gives level values, Hear myself toggles. Still pass: engine-check (170 BPM gaps exact, MIDI clock 20.83–20.86 ms),
  sounds-check, cv-render-check, cv-check, zip-check, save-check, desktop-save-check (Electron, xvfb), updater,
  path-allow. Existing screens with an audio track added: no errors (it shows as an empty lane: UI agent's job).
- **Not tested:** a real microphone / interface, real speakers, a real Mac; the latency test through air; a
  multi-channel interface's channel pick (the fake device has 2 channels; channel 1 tested); sample rates other than
  44.1 / 48 kHz playing each other's takes (the maths is the same: varispeed by length).
- **Decisions (owner may change):** a new take gets default gain / fades, not the old take's. Takes are never deleted
  while the app runs (Undo may need them); at start-up, takes the autosaved song doesn't use are deleted (so a take
  only in another open tab's song could go: Spores is one-tab). Takes stay in memory for the session (~0.7 MB per bar
  at 48 kHz; long keep-going sessions grow). Recording uses the tempo at its start (a tempo change mid-take isn't
  followed). The count-in is one bar of clicks at the song tempo, MIDI Start / clock begin after it.
- **Odd:** a loop in the Web Audio graph adds one 128-frame block to the DelayNode's time (the test allows for it).
  Headless Chrome reports 30 ms output latency at 44.1 kHz. `measureLatency` result goes into the offset, so
  `latency.totalMs` = the measured round trip (as Thunder Plus: reported + offset).
- **Not done (next):** B2 the UI (panel: Record, input picker + channel, level meter, loop length, Volume; More:
  offset, gain, fades, reverse, latency + test; the Steps lane for an audio track showing the take); song-length
  audio (`track.take`); export (C); Electron's `io-helper` native input (Spores uses the browser's input only).

## 2026-11-26 — Save (plan step A) done (Claude agent, on `dev`, not pushed)
- **Done:** `.spores` files (a stored zip of `song.json`; `js/zip.js`, crc32 + headers adapted from Thunder Plus; the API is a
  list of `{name, bytes}` so `audio/<id>.wav` can join later: `build()` in `js/ui/savefile.js`). File menu: Save (Ctrl/Cmd+S;
  the first time asks where, then silent), Save as… (+Shift), Save a copy… (a download, now `.spores`), Open… (Ctrl/Cmd+O;
  `.spores` and old `.json`, asks first, Undo brings the old song back), Open Recent ▸ (desktop), New song (also forgets the
  file), Seeds link…, Skin…; shortcuts shown muted; keys work anywhere except in a text field and stop the browser's own
  Save / Open. Where it writes: desktop = native dialogs + `desktop/files.js` (IPC `spores:file-open/read/save/saveas/recent`,
  allow-list `desktop/path-allow.js` ported from Thunder Plus, atomic write); Chrome = File System Access with the handle in
  IndexedDB; otherwise a download. Dirty = song JSON hash differs from the saved one (`js/ui/filestate.js`), so Undo back to
  the saved state is clean; `{name, path, hash}` in localStorage `spores.file` survives a reload. Shown as "Name • — ...Spores"
  in the title and a quiet name + dot beside the app name on both screens (`filetag.js`; the File menu itself is still on the
  Steps screen only). Desktop closing / quitting with unsaved changes asks Save / Don't save / Cancel (Cancel default);
  Chrome warns on close only when dirty. The song's autosave is unchanged. SPEC "Saving" section, help line, desktop README.
- **Tested:** `tests/zip-check.mjs` (round trip, python zipfile + `unzip -t`); `tests/save-check.mjs` in headless Chrome
  (mock picker, real OPFS handle across a reload, no-picker download, Open .spores / .json / three bad files, dot / Undo,
  shortcuts, header one row at 1280x760 and 1440x830 on both screens, no console errors); `tests/desktop-save-check.js`
  Electron 33 under xvfb with dialogs stubbed (save / open / recent / allow-list refusals / close and quit prompts);
  `tests/path-allow.test.js` + updater tests; engine-check passes; cv-ui-check unchanged from before (its fake-input Tune
  step already fails in this sandbox).
- **Not tested:** a real Mac (Cmd keys, dock Open Recent / `addRecentDocument`, Cmd+Q), the real native dialog UI, Windows
  paths, real Chrome picker UI (mocked; the OPFS handle is real), touch, Safari / Firefox fallbacks by hand.
- **Odd / decisions:** a song opened from an old `.json` becomes "Name.spores" with no file behind it (Save asks where), so the
  old file is never overwritten. After Undo of an Open the file name stays but the dot shows (the song no longer matches the
  file). The desktop app's recent list is the allow-list (last 64 kept, newest 8 shown, missing files hidden). Not done
  (later): double-click a `.spores` to open it, Chrome "Open Recent", a File menu on the Song screen.

## 2026-11-26 — PLAN: Save, audio tracks, export (owner's request; A, B and C done: see the entries above)
Order: **A Save** (audio can't live in localStorage, so it comes first) → **B audio tracks** → **C export** (needs an
offline render that already knows audio tracks and the effects from the plan below). 🔴 = engine work (Claude).

**A. Save (File › Save, Cmd/Ctrl+S). ✅ DONE 2026-11-26 (see the entry above).** Today: autosave to localStorage + Save a copy… (a download) + Open.
- Save asks where the first time, then writes the same file silently; Save as… for a new file; Save a copy… stays.
  The title shows the song's file name and a dot while there are unsaved changes; closing the desktop app with unsaved
  changes asks first. Autosave stays, as crash recovery, not as the save.
- Desktop: native Save / Open dialogs and file writes through preload IPC (fs in main.js), Open Recent, later
  double-click a song file to open it. Chrome: File System Access (showSaveFilePicker / showOpenFilePicker, handle kept
  in IndexedDB); download fallback.
- Format: `.spores` = a zip (stored, no compression, own ~100-line writer/reader, no npm) of `song.json` +
  `audio/<clip-id>.wav`. Open still takes the old `.json` files. Song `v` → 2 (or 3 if effects land first), migrated.

**B. Audio tracks (record her voice, a few layers).**
- New track type `audio`, up to 4 to start (one constant to raise later), within the 16 tracks. Colour: teal (audio).
- A take is a loop of 1, 2, 4 or 8 bars that plays in time with the sequencer from the scene's start, looping for as
  long as the scene runs. One take per audio track per scene (owner, see answers below); the samples live in IndexedDB (browser
  and app autosave) and in the `.spores` file (Save). Undo keeps old takes until they leave the history.
- Recording: pick the input (Mac mic or interface) once; a level meter; arm ● on the track, Record: one bar of
  count-in click, records exactly the loop length, then stops (or "keep going" records the next take; Undo goes back).
  echoCancellation / noiseSuppression / autoGainControl off; mono in, played centre. Headphones advised; listening
  to herself while recording (monitoring) off by default.
- Timing 🔴: record in the worklet against the engine's clock (not MediaRecorder), and correct for input + output
  latency, measured once with a short "tap test" (like Tune CV). Clips go to the worklet by transfer over the port
  (no SharedArrayBuffer: GitHub Pages can't send COOP/COEP). 4 tracks × 8 bars at 120 BPM ≈ 12 MB: fine.
- Tempo change after recording: decide (owner): play at the new speed (pitch moves, simple) or keep pitch
  (time-stretch, harder; later). Proposed: varispeed first, with a note in the panel.
- Panel: Simple = big Record, input level, loop length, Volume. More = start offset, gain, fade in / out, reverse,
  latency. Effects (plan below) apply to audio tracks too: reverb / delay on a voice is the obvious first use.

**C. Export (File › Export…). ✅ DONE 2026-11-26 (see "export C" above).**
- Song as WAV (the arrangement once, plus the reverb / delay tail), Scene as WAV (the current scene × N), and Stems
  (one WAV per track + the mix, in a folder in the app or a zip in Chrome). 48 kHz, 24-bit. MIDI / CV tracks are
  skipped (they make no sound here). Progress bar and Cancel.
- 🔴 Offline render: the same worklet in an OfflineAudioContext (faster than real time, identical sound, no clicks
  from a busy computer); stems = one pass per track with the others muted (simple), or per-track outputs later.
- Later, if wanted: MP3 / AAC (needs an encoder; not in the no-npm app), loudness-normalised export (…pump?).

**Borrow from Thunder Plus first (read only; line numbers in `thunder-plus/index.html` as of 2026-11-26):**
- Recording: `rcdSet` / `RCD` / `rcdOpen1` / `rcdLat` (~16667–16770): input pick and channel, monitoring, "sync" mode
  recording a whole number of patterns, latency correction (output + input latency + a user offset), fit. Desktop
  audio-in helper: `electron/io-helper.js`, `thunder:io-mic`.
- Save: desktop IPC `thunder:file-read / file-save / file-open / file-saveas` and export writes `out-pick / out-write /
  out-show` in `electron/main.js` (~164–213, with `path-allow.js` limiting writes to files the user picked); Chrome
  `showSaveFilePicker` with download fallback (~15330, ~26518); IndexedDB helpers `idbOpen` (~15124) and `kvDb` (~26550).
- Files: `crc32` + `zipBlob` (~15287), so the `.spores` bundle needs no new zip code.
- Export: song renders and stems (Mixer, Master notes ~3213; stems skip the master chain) and its WAV writing.
Copy and adapt into small Spores files (AGENTS.md: under ~600 lines each, plain-English labels, Spores' look); keep
credits for anything third-party.

**Owner's answers (2026-11-26, corrected):** loop takes are **one per audio track per scene** (like steps):
`scene.clips[trackId] = {id, bars, bpm, sr, gain, offset, fadeIn, fadeOut}`; a scene with no take for a track is
silent on it. Tempo change after recording: varispeed, pitch may move. Input: the Mac's mic or an interface, so an
input picker (plus an input-channel choice on multi-input interfaces). Monitoring: a "Hear myself" toggle, off by
default (with a one-line note to wear headphones).
**Plus song-length audio (owner):** a second kind of audio track that spans the whole song, shown as a layer (lane)
on the Song screen under the scene blocks, not in the Steps grid. Recorded while the song plays (from the start, or
from a block), it runs across the scene changes and stops at the song's end; Loop-forever blocks don't apply to it.
Stored on the track (`track.take = {id, sr, bpm, startBar, gain, fadeIn, fadeOut}`), drawn as a waveform aligned to
the blocks, with move (start bar), trim and fades in More. Same input picker, latency correction, Hear myself, Undo,
`.spores` storage and export (stems include it). Build after loop takes, reusing their recording code.

## 2026-11-26 — PLAN: up to 4 effects per track from Thunder Plus (steps 1, 2, 4 done: see "effects FX1" above; 3, 5 not started)
- **Source (read only, don't change Thunder Plus):** `thunder-plus/waves/dsp/tfx.wasm` (674 KB): Thunder's native C++
  track-effects host compiled to WebAssembly. 34 effects (Mutable Instruments Rings / Clouds / Beads / Warps, Airwindows
  Density / ToTape6 / EQ / Galactic / Verbity2 / ToVinyl4 / Tube2 …, DaisySP chorus / flanger / phaser / overdrive /
  autowah / pitch / ladder …, CloudSeed, plus Thunder's own comp / reverb / delay / gate / OTT / comb / shift…), all MIT.
  API: `tfx_new(type, sr)` → handle, `tfx_params(h)` → 12 floats (0–1) in wasm memory, `tfx_l/r()` 128-sample buffers,
  `tfx_process(h, n)`, `tfx_free(h)`. Host code to copy: `waves/waves-worklet.js` ~line 340–380 (create / process /
  crash-bypass / memory-grew handling). Names, parameter labels, ranges and maps: the FX table in Thunder Plus
  `index.html` (~line 4457 onward, `rvMix` etc.). Sources and build: `beta/dsp/tfx/` (build.sh, WASI SDK).
- **Limit:** one module instance holds 32 effects; 16 tracks × 4 = 64, so run two instances (no rebuild needed).
- **Plan:** (1) engine: copy tfx.wasm + a `js/engine/fx.js` table (plain-English names, groups, 2–4 main knobs each);
  per track, a chain of up to 4 after the voice, in the worklet; render test (each effect: signal out, no NaN, no
  clicks, timing unchanged). (2) data: `track.fx = [{type, on, p:{…}}]` (≤4), bump `v` to 2 with a migration.
  (3) panel: an Effects section (Add effect ▾ grouped, on/off, knobs, ‹ › order, remove asks / Undo); Simple shows
  each effect's main knob, More shows all. (4) THIRD_PARTY_NOTICES.md credits (MIT). (5) desktop build + release.

## 2026-11-26 — visual polish pass: calmer, more professional (Claude)
- **Done:** empty steps are soft fills (`--step`, every other group of four `--step-beat`), no black outlines; track rows
  are hairline-separated and exactly one lane (`--lane`) tall; M / S are small boxes inside 44 px buttons (solo uses the new
  `--solo` token); header regrouped (name · Steps | Song · Play + BPM readout · Key · scenes ··· Undo / Redo · File ·
  Simple | More · ?) with one `.seg` segmented-switch style; panel title/sections/rows per the style guide; bottom bar
  quieter (Bars as a segmented switch, borderless note chips); Song screen shares the header, hints are one muted line
  per section, scene cards use hairline + soft fill, − × 4 + is a stepper, remove is a quiet ×. New tokens
  (`--step`, `--step-beat`, `--solo`, `--lane`) exist in :root and in the black and pastel skins.
- **Notes:** "Song ›" / "‹ Steps" became a Steps | Song switch (same behaviour). Below 1380 px the Key / Scene captions
  hide so the header keeps one row at 1280. Visible "block" words on the Song screen now say "scene".
- **Tested:** headless Chrome 1440x830, 1470x880, 1280x760: no page scroll, header one row, 1-bar grid not scrolling,
  no control under 44 px, track rows level with lanes (same offset on all 8), no console errors; engine-check and
  cv-ui-check pass.

## 2026-11-26 — laptop fit pass for the Mac window (Claude)
- **Done:** Steps and Song now fit 1440x830, 1470x880 and 1280x760 with the header on one row and all 16 steps of one bar
  showing (grid 812/812 at 1280, no sideways scroll). Track list and panel widths use clamp() on vw, header gaps and
  button padding shrink a little on narrower windows, the Scale list is narrower, gaps between step groups are a bit
  smaller (cells stay `--touch`, never under 44 px). Swing (More mode) moved from the header to the bottom bar so More
  no longer wraps the header. Dialogs (Help, Skin, Seeds link) fit at 1280x760 and 1024x640.
- **Tested:** headless Chrome, demo song, 1 bar, Bass selected, Simple and More, all three skins: no page scroll, no
  control under 44 px, nothing past the right edge, no console errors. At the Electron minimum (1024x640) the header
  wraps to two rows and the grid scrolls sideways; that is expected there.

## 2026-11-26 — desktop app (Mac) built by GitHub; track controls merged (Claude)
- **Desktop:** `desktop/` wraps the app in Electron (setup copied from ...Seeds; see `desktop/README.md`). Served from a
  secure `app://spores/` scheme because modules / AudioWorklet / Worker / wasm refuse `file://`. MIDI and audio
  permissions granted without prompts, no background timer throttling (MIDI timing), Save box for Save a copy…, one copy
  at a time, update checks against this repo's Releases (unsigned Mac: it offers the .dmg). Menu Undo / Redo call the
  page's undo.
- **Build:** `.github/workflows/desktop.yml` on macos-latest, unsigned arm64 + x64 .dmg and .zip as run downloads; runs on
  pushes to dev that touch `desktop/`, on a `v*` tag (publishes a Release), and from Run workflow once the file is on main.
  First green run: 45889382110.
- **Tested:** Electron 33 under xvfb here (secure context, engine + wasm + Play, MIDI permission granted, no errors);
  `tests/updater.test.js` 6/6. Not tested: opening the .dmg on a real Mac.
- **Odd:** the browser song doesn't carry into the app (separate storage): Save a copy… in Chrome, Open in the app.
  At 1280 px wide (a laptop) the header wraps to two rows and the 16th grid column scrolls off; worth a laptop layout pass.
- **Track controls (merged from `track-controls`, built by a Sonnet agent, checked by Claude):** Solo (S, dims the
  others), Rename (panel button or double-click the name), Delete track (asks, "Keep it" focused, Undo restores).

## 2026-11-26 — track controls: Solo, Rename, Delete (branch track-controls, Claude)
- **Built:** an S button beside M on every track row (44 px+, `aria-pressed`, store.edit 'Solo'); while any track is soloed
  the others' rows and step lanes dim (`.quiet`) so it is clear why they went silent. Rename button in the panel header
  and double-click on a row's name open a dialog (Enter saves, Escape cancels, trimmed, 24 letters, empty keeps the old
  name; 'Rename track'). Quiet "Delete track" button at the bottom of the panel: asks ("Delete Kick" / "Keep it", Keep
  it focused, says Undo brings it back), disabled on the last track; one 'Delete track' edit removes the track and its
  steps in every scene and moves the selection to the next track (or the one before if it was last). New file
  `js/ui/trackctl.js`; the panel's rebuild signature now includes the name and the track count.
- **Tested (headless Chrome):** solo store/classes/dim/compiled song/undo; rename + trim + undo + Escape + empty +
  double-click; delete asks, Keep it changes nothing, confirm removes track and steps, Undo restores the song exactly
  and the track is selectable, count `+ Add track (n of 16)` follows, last track's button disabled; no console errors;
  tests/engine-check.mjs still passes. Not tested: touch hardware, real playback of a solo.
- **Odd / left:** the name field's 24-letter limit counts spaces typed before the name, so leading spaces eat the room.
  Help text still only mentions M. Deleting a track leaves its Seeds/MIDI settings gone with it (Undo restores).

## 2026-11-26 — phase 9 review done (Claude); Electron build planned, not started
- **Checked:** `js/ui/`, `js/store.js`, `js/main.js`, `css/` against AGENTS.md and for beginner confusion. No file over
  600 lines, no npm in the app, no colours outside `:root` in CSS, every control ≥ 44 px (smoke test at 1440×900).
  All five `tests/*.mjs` pass (engine timing 170 BPM exact, bass 65.2 Hz, AABAA, MIDI clock 20.82–20.86 ms, CV, sounds).
- **Fixed (one commit each theme):** `edit()` rolls back a change that throws; one failing subscriber no longer blocks
  the engine; a toast when the browser won't keep the song; a plain message instead of a blank page if the engine
  can't start · Ctrl+Z works right after a slider drag; tempo field shows the real tempo after 999 / blank; fewer bars
  clears a hidden selected step; Simple no longer marks or mentions chance; **Lock hidden** (it does nothing yet) ·
  track name follows its sound when it was the sound's name; More › Length follows Undo; clearer step hint; one CV
  `devicechange` listener (was one per panel rebuild) and the device change reads the track fresh after Undo · skin
  preview dots use `:root` variables.
- **Left for Matt to decide:** what Lock should do (then unhide it); MIDI / CV in the add-track menu even in Simple
  (could go behind More); Simple / More is in the song and on the Undo stack (Undo can flip the mode; opening a file
  can change it); changing sound clears its settings (Undo restores them, but nothing says so); "block" vs "scene"
  wording on the Song screen, and + Add block always adds scene A; no track delete / rename / solo UI; song blocks
  reorder by mouse drag only (no touch); a >16-track file loses the extras silently; `fixTrack` defaults a missing
  `oct` to 3 but new synths get 2.
- **Not tested:** real speakers, touch hardware, a normal Chrome window.

## 2026-11-26 — phase 8 done: skins (and phase 7 merged cleanly)
- **Phase 7 merge:** pulled Claude's CV work (`b0d632f`) and re-checked phase 8's pieces against it: `+ Add track ▾ ›
  CV track` still makes "CV 1" with `CV · out 3 / 4` on its row and a "CV outputs" section in the panel; the help
  button, the preset section and the 48 px touch token all still open and measure as before; Undo removes the new CV
  track again; no console errors.
- **Skins:** a skin is only a different set of `:root` values (docs/seeds-style-guide.md "Skins"); the components
  already read nothing else. Two more sets in `css/app.css`: `:root[data-skin="black"]` (near-black bench and panels,
  white lines, brighter signals, cyan `--selc`) and `:root[data-skin="pastel"]` (grey-blue bench, soft `--edge`, 10 px
  corners, IBM Plex stack, pink `--selc`). Minimal stays the default and sets no attribute.
- **Where:** File › Skin… lists three skins with swatches, a name and a line; the current one is filled and picking one
  applies at once. It is kept per computer in localStorage `spores.skin`, not in the song, so a song looks the same
  wherever it is opened, and Undo never takes a skin back.
- **First paint:** `index.html` has a three-line inline script in `<head>` that copies `spores.skin` onto `<html
  data-skin>` before the app boots, so there is no flash of the old skin. `js/ui/skin.js` owns the rest (`applySkin`,
  `currentSkin`, `openSkinDialog`, the `SKINS` list).
- **Not made:** Pastel (follows the system), Minimal colors, Monotone, Minimal colors black and Neon. Neon needs a
  shadow/glow token and the "colors" skins need module-family tints, which Spores has no equivalent of (one panel
  colour, no module families). A new skin is a `:root[data-skin="…"]` block plus an entry in `SKINS`.
- **Tested in headless Chrome:** the dialog lists Minimal (filled), Minimal black and Pastel light; picking black sets
  `data-skin`, stores it, body rgb(14,14,16), `--selc` #00e5ff, radius 0, and moves the filled row; Pastel light gives
  bench rgb(214,219,228), 10 px button corners, the IBM Plex stack and pink `--selc`. Ink on panel is 17.2 / 15.5 /
  13.1 to 1 in the three skins (the filled row 13–15 to 1). The store JSON is identical before and after a skin change,
  Ctrl+Z leaves the skin alone, a reload keeps it, and with `js/main.js` blocked the head script alone still applies it
  (attribute set, body dark, no app markup). On a 390×844 touch viewport all three keep `--touch` 48 px, no control
  under 48 and no sideways scroll. Read the Steps screen in each skin, the Skin dialog on a black skin and the Song
  screen on a black skin as screenshots. No console errors.
- **Odd:** "Pastel light" only adds font and corner tokens, so on a machine without IBM Plex Sans Condensed or Arial
  Narrow it falls back to system-ui and looks like Minimal with softer edges.

## 2026-11-26 — phase 7 done: CV tracks (Claude)
- **Making one:** "+ Add track ▾ › CV track" makes "CV 1" on outputs 3 / 4 (the next CV track gets 5 / 6, and so on;
  1–2 carry the music). The track list says "CV · out 3 / 4" (and "· tuned"). No volume row: a CV track's level is its notes.
- **Engine (`js/engine/`):** the worklet has a second output, 32 channels of CV, connected straight to the output device
  with every channel open (`destination.channelCount = maxChannelCount`, discrete), no gain or clipping on the way. The
  stereo mix stays on channels 1–2. On each step a CV track sets its pitch output (held after the note) and raises its
  gate (5 V for half a step), on the exact sample. `compile(song, {fs})` turns notes into values with `cvValue()` in
  `js/engine/cv.js`: untuned = 1 V/oct with the track's root C at 0 V; tuned = the value that makes that oscillator
  play the note's exact pitch (A4 = 440 Hz). `engine.cvHold(ch, value)` holds an output (Tune / Test), `null` lets go.
- **Per computer, not in the song** (localStorage `spores.cv`): the output device (Chrome's `setSinkId`) and the volts
  at full scale (default 10, as on an Expert Sleepers ES-8 / ES-9; in More). Per track, in the song: pitch / gate
  outputs and the tuning `cv.cal = {points: [[value, log2 Hz]…], dc, perVolt, at}`.
- **Panel (`js/ui/cv.js`, new):** Device, Pitch, Gate, warnings (1–2 are the music; pitch = gate; past the device's
  outputs), tuned or not, **Tune CV…**, **Test outputs…**, Forget tuning (asks; undoable).
- **Tune CV…:** oscillator's audio into an interface input; Spores holds −1 … +5 V, measures each pitch (YIN, 3 reads
  each), fits a table. First it holds +2 V for 2.5 s: if the pitch slides back, the outputs are AC-coupled and it says so
  (that's the **DC check**). Plain-English errors for no signal, wrong input, cable in the wrong jack.
- **Test outputs…:** holds 0 / +1 / +5 V on pitch and opens / closes the gate, with the multimeter version of the DC
  check written out. Lets go when closed.
- **Tested:** `tests/cv-check.mjs` (Node, model oscillators): detector within ~1 cent on saw / sine / square 41 Hz–1.5 kHz;
  a VCO 3 % off 1 V/oct tunes to within 1.4 cents across 5 octaves (untuned it was 24–132 cents off); an AC-coupled
  one is caught (−1458 cents drift); no signal gives the no-pitch message. `tests/cv-render-check.mjs`: C minor
  root / E♭ / G / C' give 0, 0.025, 0.0583, 0.1 (= 0, 0.25, 0.583, 1 V at 10 V full scale); gate 0.5 (5 V) for half a step;
  nothing leaks into the music. `tests/cv-ui-check.mjs`: add, outputs, warning, Undo, +5 V held on the right channel and
  released, Tune dialog lists inputs and fails cleanly on a beep. Engine and MIDI checks still pass
  (`engine-check.mjs`: its Play click now calls the engine, the button's id changed in phase 2).
- **Not tested:** real CV. Needs a DC-coupled interface (the Cranborne 500R8's outputs are very likely AC-coupled: the
  DC check will say) and an oscillator. Owner: try Test outputs › +5 V with a multimeter first.
- **Later:** slew / glide, trigger (short gate) mode, gate length per step, more than 7 tuning points, CV clock out.

## 2026-11-26 — handover to Claude: phase 7 (CV tracks) is next
- **State:** phases 1–6 are done on `dev` (tips: `a94a00a`, phase 6 + its review), tree clean, everything pushed. Phase
  7 is untouched: there is no CV code in `js/engine/`, and `js/ui/panel.js` still shows its placeholder — "A CV track.
  The pitch and gate outputs arrive in phase 7." A CV track cannot even be created yet: `addTrack(type)` in
  `js/ui/steps.js` offers Drum / Synth / MIDI only.
- **Phase 7 from docs/SPEC.md:** CV tracks: pitch + gate on chosen output channels, Tune CV (1 V/oct), DC-coupled
  interface check. Marked 🔴, so it is Claude's (AGENTS.md rule 6) — and it is the one thing the last agent stopped for.
- **Already in place:** `track.cv = {pitch, gate, cal}` (newTrack / fixTrack in `js/store.js`), `track.oct` for the root,
  `deg` on steps. Grid, note colours, melody lane, Note / Velocity / Chance and Undo already treat `cv` like
  synth / MIDI (nothing type-checks for 'cv' except the panel's placeholder and the TYPE maps in panel.js / steps.js).
- **Missing (engine side):** `compile()` in `js/engine/engine.js` gives a CV track no engine, so its steps are silent;
  nothing writes `cal`; SPEC's "Tune CV…" dialog does not exist; the `pitch` / `gate` channel selects are not drawn.
  The panel's `cv` branch is the hook for all of that.
- **Verification limits here:** no audio device, no DC-coupled interface, no CV gear in this sandbox, and no MIDI
  hardware either — MIDI was checked against a fake Web MIDI port (bytes and timestamps, clock gaps 14.66–14.72 ms at
  170 BPM). `tests/*.mjs` have not been re-run since phase 3 because `js/engine/` has not changed; re-run them after
  touching the engine.
- **After CV:** phase 8 has been started — touch sizes, help text and sound presets are on `dev` (see the phase 8 entry
  below); skins are not started.

## 2026-11-26 — phase 8 started: touch sizes, help text, sound presets
- **Touch sizes:** I measured every visible button, select, input, `[role=button]` and check row at 1440×900, 390×844 and
  360×740 (Steps, More and the Song screen) before changing anything: nothing was under the 44 px minimum and the page
  never scrolled sideways. So the change is a step up for fingers, not a repair: `@media (pointer: coarse) { :root {
  --touch: 48px } }` — cells, melody bars, buttons, fields and selects all follow the token, and a mouse keeps 44.
  Left as is: at 390 px the header still wraps to seven or eight rows (more with Swing), so the grid gets little room on
  a phone. Desktop Chrome is the target; a phone layout is a separate job, not done here.
- **Help text:** `js/ui/help.js` — a "?" beside the app name on both screens opens "How Spores works": a beat, a melody,
  scenes and songs, Seeds, then one line about Undo (Ctrl+Z) and where the song lives. It is behind a button on purpose
  (SPEC: a first-time user should make a beat without reading anything) and uses the shared dialog shell.
- **Sound presets:** behind More, a drum or synth track gets a "Sound presets" section: apply a preset (sound + every
  setting), "Save this sound" (a small dialog asks for a name), Remove (asks first). They live in the song as
  `song.presets = [{name, sound, params}]`; `newSong()` starts with `[]` and `migrate()` fills it in for older songs, so
  files keep opening. Only sounds of the track's own kind are offered, and a removal clears the select, because the
  option values are indices into the list and would otherwise point at the next preset.
- **Files:** `css/app.css` (one media query), `js/ui/help.js` (new), `js/ui/steps.js` and `js/ui/song.js` (the "?"),
  `js/ui/panel.js` (presets + save dialog), `js/store.js` (newSong / migrate). `js/engine/` untouched.
- **Tested in headless Chrome:** at 1440×900 the token is 44 px and a cell 44×44; with a 390×844 touch viewport
  (`pointer: coarse` and `hover: none` confirmed) the token is 48 and a cell 48, with no control under 48 and no page
  overflow. The "?" follows the app name on the first header row and opens the dialog (four sections, five lines, "Got
  it" focused); Escape closes it; the Song screen's copy opens and closes the same page. Presets: on a drum track in
  More the section shows "No presets yet" with Remove disabled; Save this sound fills in "Kick preset", saves "Punchy
  kick", and the select lists "Punchy kick · Kick"; applying it after a Pitch change restores the saved value and Undo
  puts the change back; a new drum track takes the preset's sound and settings; a synth track sees no drum presets; the
  preset survives a reload; Remove asks, removal empties the select and disables Remove, and Undo restores the preset
  (with both presets listed again). No console errors.
- **Not tested / left:** skins (the rest of phase 8 — a skin is a different set of `:root` values, so the tokens are
  ready but no second skin exists), the phone header wrap, presets have no rename or reorder, a preset keeps the sound
  and its settings but not the track's octave or volume, no real touch device (emulated viewport only), `tests/*.mjs`
  not re-run (`js/engine/` untouched).
- **Odd:** a preset copies the settings at the moment it is saved, so later slider moves on a track never change it, and
  applying one overwrites the track's current settings without a second question (Undo brings them back).

## 2026-11-26 — phase 6 done: MIDI tracks and the Seeds link
- Adding tracks: "+ Add track" adds a drum in one tap (as in phases 2–5); the small ▾ beside it opens a menu with
  Synth track / MIDI track, because those could not be made at all before (`js/ui/steps.js`). A new synth takes the
  first unused synth sound, a MIDI track is "MIDI 1", "MIDI 2"… and takes no local sound.
- MIDI tracks (`js/ui/panel.js`): port (every Web MIDI output, or "No port yet"; a saved port that is unplugged now
  stays in the list so it comes back), channel 1–16, and "Send clock and Start / Stop to this port". The track list
  says what it is wired to — "MIDI · IAC Driver Bus 1 · ch 3" or "no port yet" — and the panel relists ports when one
  is plugged in or out. MIDI tracks are melodic like synths: note colours, melody lane, Note / Velocity / Chance.
- Seeds link (`js/ui/link.js`, new; File › Seeds link…): the virtual port Spores and Seeds share, the channel the drum
  hits go out on (16 by default), and "Send clock and Start / Stop", with a line on making the port (IAC Driver / loopMIDI)
  and a note when the browser has no MIDI. All three are `link.*` in the song, so they save and undo with it. The dialog
  is built on the shared shell (`openDialog` in `js/ui/dialog.js`), not a copy of it.
- More: a drum track gets "Seeds note" (0–127, its `seedsNote`, default the GM note: Kick 36, Snare 38, Hat 42…), the
  note that track sends to Seeds on every hit. Out-of-range numbers clamp. The MIDI port / channel / clock selects and
  this field now follow Undo and Redo instead of keeping a stale value.
- Fixed a phase 4 slip found here: in Simple the selected-step section printed a stray "null" under the hint, because
  `root.append(…, chanceRow || null)` writes the text "null" (dom.js's `el()` filters those, plain `append` does not).
- Files: `js/ui/link.js` (new), `js/ui/dialog.js` (`openDialog`, shared with `ask`), `js/ui/steps.js` (add-track
  button + menu, MIDI line in the track list), `js/ui/panel.js` (MIDI section, Seeds note, updaters), `js/ui/filebar.js`
  (menu item), `css/app.css` (.menu.up, .checkrow, .bottom .hgroup.seg). `js/midi.js` and `js/engine/` were read, not
  changed.
- Tested in headless Chrome with a fake `navigator.requestMIDIAccess` (two ports, every byte recorded): one tap on
  + Add track makes a drum and leaves the menu closed, ▾ lists Synth track / MIDI track and Escape closes it; a MIDI
  track makes "MIDI 1" selected with "no port yet · ch 1"; the port list is No port yet /
  IAC Driver Bus 1 / loopMIDI; port + channel 3 + clock write through and the list line follows; one MIDI step at 120 BPM
  sends note-on `0x92` note 36 velocity 100, note-off `0x82`, Start `0xFA`, 84 clock bytes `0xF8` and Stop `0xFC` to that
  port only; Undo removes the step. Seeds link dialog: File lists Seeds link…, the dialog shows Off / IAC Driver Bus 1 /
  loopMIDI, channel 16, clock ticked and its explanations; loopMIDI + channel 15 + clock off writes
  `{seedsPort, seedsCh: 15, clock: false}`, Done and Escape close it; playing then sends the drum hits as `0x9E` note 36,
  38, 42, 46… with no clock or Start; clock back on sends Start and 66 clocks in 1.2 s; Undo puts the clock back. Seeds
  note: only in More, 36 for Kick; 40 writes and the kick sends 40; Undo restores 36 in the song and the field; 500 clamps
  to 127; a synth has no row. Timing at 170 BPM with the link on: 180 clock bytes in 2.5 s, gaps 14.66–14.72 ms (24 per
  beat = 14.706 ms, so no drift in the timestamps handed to Web MIDI), Start present. A browser without MIDI: the panel
  says "MIDI is not available in this browser (Chrome has it)." with a single "No MIDI ports found" option, and the Seeds
  link dialog says the same. No console errors.
- Not tested: real MIDI hardware (IAC Driver, loopMIDI or a synth), Seeds itself, a normal Chrome window — the port, the
  bytes and the timestamps were checked against a fake Web MIDI output, not measured at a device. `tests/*.mjs` not
  re-run (`js/engine/` untouched).
- Half done / later: no MIDI input (MIDI learn, a keyboard); no "send a test note" button to check a port without
  playing; MIDI note length is whatever the engine already uses (not settable); no per-track MIDI transpose beyond the
  root octave; the Seeds link dialog is only on the Steps screen's File menu — the Song screen has no File menu; CV
  tracks are still the phase 7 placeholder; ports are only the ones Web MIDI lists (device changes are picked up, but
  there is no refresh button).
- Odd: the link settings live in the song file, so they travel with a song and can be undone like anything else. A MIDI
  track is silent on this computer by design (its steps only go out of the port). Drum hits always go out on the Seeds
  link channel, never on a drum track's own channel (drum tracks have no MIDI channel of their own).
- Review pass, same day, before phase 7: the Seeds link dialog had its own copy of the scrim / Escape / focus code, so
  `js/ui/dialog.js` now exports `openDialog({title, body, content, actions, focus, onClose})` and `ask()` is written on
  top of it — one place decides how a dialog closes. "+ Add track" went back to one tap for a drum, with the ▾ beside it
  for the other two kinds (the menu keeps only those two, so there is no second way to add a drum). Also cut: the MIDI
  checkbox's `for` / id juggling (the input sits inside its label), the Seeds note row's "to Seeds" column, and the Steps
  screen redrawing the track list when a MIDI port appears (it only changed a name). Re-tested after the change: one tap
  makes "Boom kick" at 9 of 16 with the menu closed; ▾ shows the two kinds and Escape closes it; the Seeds link dialog
  focuses the port, writes port and channel, and closes on Done, Escape and a scrim click; New song still asks (Keep this
  song focused; Escape keeps, Start fresh replaces and Undo restores the 10 tracks); the Seeds note still writes 41; at 16
  tracks both buttons disable; the pair is joined at gap 0 and its menu opens above it; no console errors.


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

## 2026-11-27: track meters, copy scene on Steps, song position fix (Claude)
- Track meters: a thin bar in the track's colour under each name (js/ui/trackmeters.js). The worklet measures what each
  track adds to the mix (snap/took around each voice, tape, pump voice and effects chain) and posts
  {t: 'tlevels', lv: {trackId: peak}} every 6 blocks while anything sounds, plus once when it goes quiet; engine.on('tlevels').
  Not measured during exports. MIDI / CV tracks stay empty (no sound here).
- Steps screen: ⧉ next to the scene + copies the scene being edited into the next free letter and opens it
  (store.js copySceneInto, shared with the Song screen's Copy).
- Song screen: the position line ignored the blocks already played, so it jumped back at every scene change; fixed.
- Tested: headless Chrome (meters move while playing, fall to 0 after Stop; ⧉ makes "Copy of Scene A" as C with the same
  steps; position line 3 → 99 % through the demo song then wraps); engine, fx, export, audio and save checks all pass.

## 2026-11-27: track meters, copy scene on Steps, song position fix, File menu on Song (Claude)
- Track meters: a thin bar in the track's colour under each name (js/ui/trackmeters.js). The worklet measures what each
  track adds to the mix (snap/took around each voice, tape, pump voice and effects chain) and posts
  {t: 'tlevels', lv: {trackId: peak}} every 6 blocks while anything sounds, plus once when it goes quiet; engine.on('tlevels').
  Not measured during exports. MIDI / CV tracks stay empty (no sound here).
- Steps screen: ⧉ next to the scene + copies the scene being edited into the next free letter and opens it
  (store.js copySceneInto, shared with the Song screen's Copy).
- Song screen: the position line ignored the blocks already played, so it jumped back at every scene change; fixed.
- Song screen: the File menu (filebar.js) is in its header too. ⌘S / ⇧⌘S / ⌘O already worked on both screens (savefile.js bindFileKeys).
- Tested: headless Chrome (meters move while playing, fall to 0 after Stop; ⧉ makes "Copy of Scene A" as C with the same
  steps; position line 3 → 99 % through the demo song then wraps; File menu lists all items on Song); engine, fx, export,
  audio and save checks all pass.
- App icon is a mushroom in Thunder Plus' IDM pink & green skin colours (#e9e8e3 paper, #141414 ink, #ff2d8a pink, #1f9e5a green;
  flat, offset ink shadows, step-square spots). Source: desktop/build/icon.svg;
  icon.png (1024×1024) is rendered from it (rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png) and is what electron-builder uses.
- Fix (desktop, laptop-height windows): "+ Add effect" seemed not to open. The panel (.panel) is a scrolling flex column, so
  it squashed the open list (.fxmenu) to a ~10 px sliver below the button. Now `.panel > *` and `.fxmenu` don't shrink, and
  the list scrolls into view when it opens. Tested in the Electron app (1440×873 window, real mouse clicks): the list opens
  436 px tall and in view, picking Galaxy reverb adds it (card + "fx 1"); tests/fx-ui-check all ok.
- Clap is now 808-style: new engine `clap` (voices.js Clap808, Spores' own; BlipVoice stays Thunder Plus' copy, unchanged).
  Band-passed white noise (Tone ~1.1 kHz, Width), N equal sharp bursts (Hands 4, Hands spread 10 ms, Snap 3 ms), then a
  separate tail from the last burst (Tail 240 ms, Tail level 0.45), light Drive. The old clap is kept as "Blip clap".
  An old song's Clap track keeps playing (as the new clap); any old Blip settings on it are dropped by fixTrack (not in the
  clap's rows). Tested: offline render (bursts at 0/10/20/30 ms then the tail, peak 0.60 like the Kick), the worklet in
  Chrome (claps on each beat at 120), panel shows Tone / Tail / Tail level / Hands / Hands spread; sounds, engine and export checks pass.
- Loop takes now keep half a bar of extra audio either side (clip.pad, seconds; samples = [pad | loop | pad] in loop
  order, worklet.js loopOrder). Start offset slides the loop window within ±pad with no wrap-around (tape.js); takes
  without pad (older ones) wrap as before. Drag the waveform in the Steps lane sideways to move it ("Later by 77 ms"
  while dragging, one Undo step); the panel's Start offset range follows the pad. Keep going: each next take is seeded
  with the overlapping frames. Tested: tests/audio-check (kicks within 1 ms in the window, pads hold the real neighbouring
  audio, keep going), a node test of TapeVoice (sample-exact window, ±10 ms = ±480 samples), a fake-mic record + drag +
  Undo in Chrome, audio-ui / audio-song / export checks.
- Copy / paste scenes and tracks: right-click (or Menu key / Shift+F10) on a scene letter or a track row (js/ui/clipboard.js).
  Scene: Copy · Paste over this scene (asks; keeps the target's name) · Paste as a new scene · Copy to a new scene.
  Track: Copy · Paste over this track (asks; sound, settings, effects with new ids, steps and takes in every scene; keeps
  its place and id) · Paste steps into this scene (asks; steps, or audio → audio its take, from the scene copied in) ·
  Paste as a new track ("<name> 2"). Limits (16 tracks, 4 audio, 32 effects) disable an item with the reason. Toasts
  no longer catch clicks (they sat over the scene buttons). Tested: tests/clipboard-check.mjs (15 ok), fx-ui, audio-ui checks.
- Mute and solo are per scene (song format v4): scene.mute / scene.solo = {trackId: true}; store.js isMuted / isSolo /
  anySolo / setQuiet. v3 → v4 copies a track's old mute / solo into every scene. The Steps screen's M / S edit the scene
  being edited; the Song screen's song-length lanes set all scenes. Engine: compile gives scenes[k].mute / solo arrays
  (a track-wide t.mute / t.solo still counts, for tests); notes are picked with the scene's flags when the step is
  decided, and the tracks' flags (tape / effect levels) change on the step's own sample (a queued {quiet} event).
  Stems leave out a track muted in every scene played. Copy / paste carries mutes (pasted tracks don't carry solos).
  Tested: tests/scene-mute-check.mjs (8 ok); engine, fx, export (solo now in every scene: an fx level changing mid-song is
  block-quantised, ~−88 dB between two renders), audio, audio-song, cv-render, clipboard checks.
- Song screen: master section (js/ui/master.js): stereo peak meter (−60…+6 dB, red hold over 0 dB) and a fader for
  song.master (gain 0…2, default 1; one Undo per drag; double-click = 0 dB). The worklet applies it before the master clip
  (eased over a block), so exports follow it; stems stay as they are. Peaks ride on the 'tlevels' message (mL / mR) →
  engine.on('master').
- Loop song (song.loopSong, default on; button beside Play on the Song screen): off = the worklet queues a stop on the
  song's last sample instead of wrapping (cancelled by Stop / Play). Tested: tests/master-check.mjs, tests/loop-song-check.mjs.
- Top bar on narrower laptops (MacBook Neo, a window not full screen): the scene group no longer shrinks under its own
  buttons (it stops at two letters + the + and copy buttons; the strip scrolls for more); the + / copy never shrink. On
  narrower windows the bar gives up words first: gaps tighten (≤1520), the Scene / Key labels and BPM go (≤1520 / ≤1400),
  the app and file name (≤1320), then the Simple / More and Play buttons get narrower (≤1240) and gaps again (≤1160).
  tests/header-fit-check.mjs: 1024–1680 wide, all skins, both screens, 7 scenes; FONT="DejaVu Sans" tries a font wider
  than the Mac's Futura.
- Skins: Minimal black and Pastel light retired; new 909 and 808 (after ...Thunder Plus' tr909 / tr808, tuned for reading:
  dark text ≥ 7:1 on 909; cream on charcoal with soft taupe lines on 808). A saved 'black' opens as 808, 'pastel' as 909
  (skin.js RENAMED and index.html's first-paint script).

## Queued requests (2026-11-27, from the owner; all done: 1-3, 5, 6 merged into dev; 4 on branch q-chords)
[DONE] 1. "Preview on click": clicking to add a note / drum step plays that sound; changing a note plays the new note. A File-menu
   setting "Preview on click", on by default (per computer, localStorage, like the skin). The worklet already has a 'hit'
   message (worklet.js msg t:'hit' {ti, note, vel, len}) used for auditioning: use it.
[DONE] 2. Click-hold-drag on a note step moves it up / down chromatically (drag up = higher), previewing as it goes; one Undo step.
[DONE] 3. A selected note step: ↑ / ↓ change it chromatically (Shift: octave?), previewing. (steps.js selectStep / stepedit.js nudgeNote.)
4. (DONE 2026-11-27, branch q-chords) A polyphonic synth track: up to 4-note chords per step. Data: a step gets notes [deg…] (≤4) instead of one deg; old
   songs unchanged (bump v + migrate if the format changes). Engine: AcidCore is mono; the pump synths (Coil / Orbit / Fold)
   are already poly (PumpVoice), rendered engines play several bufs; MIDI / CV tracks: MIDI can send chords, CV cannot.
   UI: how to enter chords simply (e.g. a chord picker in the step panel: root + type, or tap several notes). 🔴 Claude.
5. (DONE 2026-11-27, q-songsel) Song screen: Shift-click to select several blocks; right-click → Copy / Paste / Duplicate the selection; then click a
   place in the song to paste-insert (between blocks) or paste-replace (over blocks). One Undo step each.
6. (DONE 2026-11-27, branch q-flare) Some "cool flare": animations like Thunder Plus' FX-bar ones (its dancing dogs / scopes / LED animations; see
   thunder-plus index.html .dogs and the FX bar). Where in Spores is open: e.g. a small animated strip in the header or
   the Song screen while playing. Keep it light on CPU and skippable.
