# ...Spores: spec

Mockups: https://claude.ai/artifact/JqEYuQwWHL9eqVeWJ2tpdF (1 · step grid with note colours and melody lane,
2 · song arranger; 3 shows the older "node inside Seeds" idea, now done over MIDI instead, see Linking to Seeds).

## Who it's for

Emmanuelle is learning electronic music and already uses ...Seeds for microscope videos. She gets overwhelmed by
complex software. Every screen must pass this test: **could a first-time user make a beat in under a minute without
reading anything?** If a feature fails it, it goes behind the **More** toggle.

## What it is

A standalone web app (desktop Chrome first; an Electron build later, like Seeds): a step sequencer with 8 tracks by
default (up to 16), scenes A–H, and a simple song arranger. Track types: **Drum, Synth, MIDI, CV**.

## Files

```
index.html          one page, loads css/app.css and js/main.js
css/app.css         tokens on :root (copied from the Seeds style guide, Minimal skin first), then components
js/main.js          start-up, wires store ↔ ui ↔ engine
js/store.js         song data, save / load (localStorage + file), undo / redo, format migration
js/scale.js         keys, scales, note names, note colours (see Note colours)
js/ui/steps.js      Steps screen
js/ui/song.js       Song screen
js/ui/panel.js      right-hand track / step panel
js/zip.js           tiny stored-zip writer / reader (crc32 from Thunder Plus)
js/wav.js           WAV writer (32-bit float for takes, 16 / 24-bit PCM) and reader
js/songmap.js       song bars ↔ blocks (song-length takes: where they play, and the Song screen's lane)
js/audiostore.js    recorded takes' samples by clip id (IndexedDB + memory); takes.js puts a take into the song
js/ui/export.js     File › Export…: Song / Scene × N / Stems, file name, progress + Cancel, Show in Finder (desktop)
js/ui/savefile.js   Save, Save as…, Save a copy…, Open…, Open Recent (desktop); Ctrl/Cmd+S / Shift+S / O
js/ui/filestate.js  the current file, unsaved-changes dot, remembered Chrome file handle; filetag.js shows it in the header
desktop/files.js    the desktop app's file channels, export's out-pick / out-write / out-show (+ path-allow.js: only files the person picked)
js/midi.js          Web MIDI ports, note out, clock out
js/engine/          🔴 Claude only: clock worklet, voices, CV out
  engine.js           page side: AudioContext, compile(song) for the worklet, playhead + MIDI timing
  worklet.js          AudioWorklet: sample-exact step clock, chance, song order, mixing
  voices.js           Blip drum voice + Acid synth (from ...Thunder Plus), the kit and synth presets
  sounds.js           every sound (153), its engine, and the settings it offers (settingsFor)
  pump.js             COIL / ORBIT / FOLD / BOING played live from pump-synth.wasm (GENERATED: pump-meta.js)
  render-worker.js    records Modal / Scanned notes off the audio thread (GENERATED: rendered.js)
  cv.js               CV: note → voltage, the pitch detector, Tune CV and the DC check
  tape.js             audio tracks in the worklet: loop-take playback, clicks, input capture
  songtape.js         song-length audio takes in the worklet: playback by song bar, open-ended capture
  recorder.js         the input, level meter, Hear myself, latency test and record() (page side)
  fx.js               the track effects' table: names, groups, settings, value text, what goes to the wasm
  fxhost.js           the track effects in the worklet: up to 4 per track, two tfx.wasm instances (32 effects each)
  render.js           Export's offline render (page side): song / scene / stems at 48 kHz in an OfflineAudioContext
  bounce.js           Export inside the worklet: plays N steps, ends, lets the tails ring out, sends the audio (or stems) in chunks
  tfx.wasm            GENERATED: ...Thunder Plus' track-effects module, copied by tools/copy-fx.sh
js/fxedit.js        add / remove / move / switch / set an effect, each one Undo step (for the Effects panel)
js/ui/cv.js         a CV track's panel section, Tune CV… and Test outputs…
tools/gen-sounds.mjs  re-copies the generated engine files from a Thunder Plus checkout
tools/copy-fx.sh      re-copies tfx.wasm from a Thunder Plus checkout
THIRD_PARTY_NOTICES.md  the effects' MIT notices (they travel with the desktop app)
tests/*.mjs           headless engine and sound checks (dev only, see each file)
```

## Saving

The song saves itself in the browser (localStorage) a moment after every change: crash recovery, not a file. **File › Save**
(Ctrl/Cmd+S) writes a **`.spores` file** (a zip with `song.json` inside; recorded audio will join it as `audio/<id>.wav`):
the first time it asks where, after that it writes the same file silently; **Save as…** (Shift+Ctrl/Cmd+S) picks a new
one; **Save a copy…** downloads a copy and leaves the song's file alone. **Open…** (Ctrl/Cmd+O) takes `.spores` and the old
`.json` songs (a `.json` is saved on as a new `.spores`, never overwritten) and asks first; Undo brings the old song back.
The song's name and a dot while there are unsaved changes show in the page title and beside the app name. The dot is "the
song differs from what was last saved", so undoing back to the saved state clears it. Chrome keeps the file handle (IndexedDB),
the desktop app keeps the path and offers Open Recent and a Save / Don't save / Cancel box when closing with unsaved changes.

## Export

**File › Export…** (also the desktop app's File menu): **Song** = the arrangement once from the first block (a Loop-forever block
plays its repeats once, the blocks after it follow), **Scene** = one scene × N (1–64; song-length takes are silent, as when a
scene plays), **Stems** = a `.zip` with one WAV per drum / synth / audio track that makes a sound, plus the mix (MIDI, CV and
muted tracks left out; Solo is ignored so the stems add up to the mix; a stem is the track after its effects and volume,
before the master clip). Always 48 kHz, 24-bit stereo WAV. Rendered offline with the same worklet (identical to playing,
faster than real time), with the effects' tails: the file ends where the sound falls below −90 dB, at most 10 s after the end.
It asks where to save first (desktop: the system dialog, then Show in Finder; Chrome: the file picker; else a download).

## Data (one song)

```js
song = {
  v: 5,                              // 5: chords (step.chord); 4: mute / solo per scene; 3: track effects (track.fx); 2: audio tracks; older files migrate
  bpm: 120, swing: 0,                // swing hidden behind More
  key: 'C', scale: 'minor', lock: true,
  tracks: [                          // 8 by default, + Add track up to 16
    { id: 't1', name: 'Kick', type: 'drum',     // 'drum' | 'synth' | 'midi' | 'cv' | 'audio' (≤ 4, teal)
      sound: '909 Kick',             // drum / synth only
      midi: { port: '', ch: 1 },     // midi only
      cv: { pitch: 3, gate: 4, cal: null },     // cv only: output channels, calibration table
      seedsNote: 36,                 // note sent to Seeds on every hit (see Linking to Seeds)
      params: {},                    // drum / synth: the sound's settings she has changed (settingsFor in sounds.js)
      oct: 3,                        // synth / midi / cv: root octave (2 = C2 = MIDI 36)
      len: 0,                        // More: per-track length in steps (0 = the scene's)
      vol: 0.8, mute: false, solo: false,    // midi also has midi.clock: send clock + Start / Stop to its port
      fx: [ { id: 'f…', type: 'reverb', on: true, p: { mix: 48, big: 255 /* … every setting, fx.js ranges */ } } ] },
                                     // drum / synth / audio: up to 4 effects, in order, after the sound and before volume;
                                     // MIDI / CV: always []. 32 in the whole song (fx.js MAX_SONG_FX)
    { id: 't10', type: 'audio', span: 'song',  // a song-length audio track (counts toward the 4): no scene clips,
      take: { id: 'c…', sr: 48000, bpm: 120, startBar: 4,   // one take from song bar 4 (songmap.js), or null;
              gain: 1, fadeIn: 0.004, fadeOut: 0.004, trimStart: 0, trimEnd: 0 } }   // seconds; plays in song mode only
  ],
  scenes: {                          // A–H
    A: { name: 'Intro groove', bars: 1,
         steps: { t1: [ { on: true, deg: 0, vel: 100, chance: 100 } /* × 16 × bars */ ],
                  t7: [ { on: true, deg: 0, chord: [2, 4], vel: 100, chance: 100 } ] },   // a chord step (v5)
         clips: { t9: { id: 'c…', bars: 2, bpm: 120, sr: 48000, gain: 1, offset: 0,   // one loop take per audio track;
                        fadeIn: 0.004, fadeOut: 0.004, reverse: false } } }            // samples: audiostore / audio/<id>.wav
  },
  song: [ { scene: 'A', repeat: 4 }, { scene: 'B', repeat: 2 } ],
  link: { seedsPort: '', seedsCh: 16, clock: true },
  mode: 'simple'                     // 'simple' | 'more'
}
```

`deg` = scale steps above the track's root note (key + `oct`) (0 = root, 7 = root an octave up). Storing scale steps, not MIDI
notes, keeps melodies in key when the key changes. `js/scale.js` turns `deg` into a MIDI note. Missing steps = off.
`chord` (optional, v5, `js/chord.js`) = the step's other notes as scale steps above `deg` (1–21, up to 3, so ≤ 4 notes): `deg` is
always the lowest note, so moving it moves the whole chord. Synth tracks play every note; MIDI tracks send every note-on / off
together; CV tracks play `deg` only (one pitch output); drum tracks ignore it.

## Note colours (for melodies)

- Each of the 7 scale notes has its own hue; the **root is always pink**, so untouched steps are pink and every
  note she has changed stands out.
- Higher octaves are brighter (lightness steps up per octave); each step is drawn as a top-to-bottom gradient.
- The note name (without octave) is printed on the step; text is black or white, whichever reads better.
- A white corner on a step means its velocity or chance was changed.
- Melody lane under the grid for Synth, MIDI and CV tracks: one bar per step, height = pitch, ▲ ▼ to move a note
  up / down the scale. Drum tracks keep the track colour.
- Hues in the mockup: C 330, D 22, E♭ 44, F 135, G 178, A♭ 215, B♭ 265 (HSL). Put them in `scale.js`, by scale degree.

## Screens (match the mockups)

**Steps.** Header: Play / Stop, Tempo, Key with LOCK, scene letters A–H (+), Song ›, Undo, Simple / More. Left: track
buttons (colour bar, name, type · output, M). Middle: 16 step buttons per bar, a gap every 4 steps, the playhead
outlined in the selection colour. Right panel: the selected track's settings (sound picker with Prev / Next for drum
and synth; port, channel, clock for MIDI; pitch / gate outputs and **Tune CV…** for CV), volume, and the selected
step's Note / Velocity / Chance. Bottom: + Add track (n of 16), Bars 1–4 (+), note colour key, melody lane.
- Tap a step: on / off. Hold (or right-click): select it and show its Note / Velocity / Chance.
- More shows: swing, per-step chance on the grid, per-track length, and every setting of the track's sound.
- Sound settings: Simple shows the sound's 5 main settings as big sliders (Coil: Tension, Drip, Decay, Tank, Tone);
  More shows them all. Moving one is heard straight away (Modal / Scanned a moment later, as they re-record).

**Song.** A row of blocks (scene letter, name, mini grid, × repeats, loop button), drag to reorder, + Add block, a song
position bar. Below: the scene library A–H; tap to add to the end, Copy scene → empty slot. No per-track arrangement.

## Linking to Seeds

Over MIDI, so neither app can break the other. On a Mac, turn on the **IAC Driver** in Audio MIDI Setup (built in);
on Windows, loopMIDI. In Spores' settings, pick that port as **Seeds link**:
- every drum hit also sends its track's `seedsNote` on `seedsCh` (default 16): Seeds' Clips and MIDI modules can turn
  those into flashes, freezes or patch changes;
- MIDI clock + Start / Stop, so Seeds' clock follows Spores' tempo.

## Build order

Each phase ends with something she could try. ✅ = fine for a low-cost model. 🔴 = Claude (top model).

| # | Phase | Who |
| --- | --- | --- |
| 1 | 🔴 Skeleton + engine: files above, AudioWorklet step clock, a first drum kit and one synth ported from ...Thunder Plus, MIDI note + clock out, `scale.js` | Claude |
| 2 | Steps screen: header, track list, grid with note colours, right panel, add track, bars; wired to the engine | ✅ |
| 3 | Store: save / load, undo / redo, reload keeps the song | ✅ |
| 4 | Melody lane and step editing (note, velocity, chance) | ✅ |
| 5 | Scenes A–H and the Song screen | ✅ |
| 6 | MIDI tracks and the Seeds link settings | ✅ (🔴 if timing drifts) |
| 7 | 🔴 CV tracks: pitch + gate on chosen output channels, Tune CV (1 V/oct), DC-coupled interface check | Claude |
| 8 | Polish: skins, touch sizes, help text, sound presets | ✅ |
| 9 | 🔴 Review, then Electron build | Claude |

## Test checklist (tick as you go)

- [ ] Make a 1-bar beat with 4 tracks in under a minute from a new song.
- [ ] Write a 16-step bass line with the melody lane; change the key and it stays in key.
- [ ] Undo / Redo every edit; reload the page and the song is still there.
- [ ] Song A ×4 → B ×2 plays in order and loops.
- [ ] With the Seeds link on, a kick flashes a Seeds patch in time at 120 and 170 BPM.
