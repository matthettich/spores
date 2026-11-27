# Spores code review — 27 Nov 2026

Read-only reference for an agent (or person) picking this up. Reviewed at commit `851d5ef` on `main`; **no code was
changed**. Line numbers were accurate at that commit. Where this file and `AGENTS.md` / `docs/SPEC.md` disagree, those
win — this is a review, not a second set of rules.

## Scope and method

Review of the whole app at `851d5ef` (87 commits): `js/` (~6.9k lines, page + AudioWorklet + engine), `desktop/` (Electron
wrapper, updater, file channels), `css/`, `index.html`, `tools/`, `tests/`, `.github/workflows/desktop.yml`, and the docs
(`docs/SPEC.md`, `AGENTS.md`, `docs/NOTES.md`).

Run here:

- `node --test tests/path-allow.test.js tests/updater.test.js` → **11 pass, 0 fail**.
- Throwaway Node probes against the pure modules: `store.migrate` / `newSong` / `demoSong`, `compile()`,
  `zipWrite`/`zipRead`, `wavBytes`/`wavRead` (16- and 24-bit stereo, 32-bit float mono), `songMap`,
  `scale.degToMidi`/`noteColor`, and `BlipVoice`.
- Timings for the per-edit work: JSON size and `store.edit` cost on a maxed song, `compile()` cost on maxed and default
  songs.

Not run: the headless browser suites (`tests/*-check.mjs` need Chrome + `puppeteer-core`, neither was installed), any
real audio I/O, an Electron build, or any clicking through the UI. Those checks are the repo's own and the commit /
`docs/NOTES.md` history says they passed; this review could not confirm that.

**Bottom line: no blocker, no security hole and no data-loss bug found.** The architecture holds up well. What follows is
ordered by how much it matters.

## Medium

### 1. Song files are trusted too far: one bad drum setting silences the whole mix

`js/store.js:187` validates that `track.params` is an object but not its values, and `BlipVoice.set`
(`js/engine/voices.js:19`) applies them with no check — unlike `AcidCore.set` (`:73`), which folds every non-finite
value back to its default.

Reproduced: `resolve('Kick', {pitch: 'loud'})` → `BlipVoice.render` emits `NaN` → `worklet.js` adds it into the mix →
`Math.tanh(NaN)` is `NaN`, so the whole output block is dead — every track, not just that one. (With an effect on the
track, `fxhost` scrubs bad samples and the damage is smaller.)

Reachable via a hand-edited or truncated `.json`/`.spores` file (Open confirms first, but a stray JSON is otherwise a
supported input). Fix: clamp/coerce `params` in `fixTrack` against `settingsFor(sound)`, and make `BlipVoice.set` skip
non-finite values as `AcidCore` does. `PumpVoice.fill` already guards with `isFinite`, and `fxClean` clamps effect
settings, so this is the one gap.

### 2. `song` blocks are not validated or clamped on load

`js/store.js:169` only checks `Array.isArray(s.song)`. Blocks pointing at a missing scene and unbounded `repeat` values
survive: verified that `{scene: 'Z', repeat: 1e9}` is kept.

Consequences: the Song screen clamps the display to ×64 (`repeatOf` in `js/ui/song.js`) while the engine plays the raw
number (`Math.max(1, b.repeat)` in `worklet.js`), so a block shown as ×64 can loop a billion times. Export then computes
`songSteps × stepLength` (`js/engine/render.js`) — ~10¹⁴ frames for that value, which the `OfflineAudioContext`
constructor rejects, and merely large values mean a multi-gigabyte allocation. Otherwise this is contained (`songMap`,
`compile` and the UI all skip blocks whose scene is gone). Fix: in `migrate`, drop blocks with unknown scenes and clamp
`repeat` to 1–64 and `loop` to a boolean.

### 3. A long song-length take is posted to the page in one message

`js/engine/worklet.js:333-341`: `SongCapture` keeps 8-second chunks on the audio thread and, at the end, posts the lot in
a single `postMessage` with every chunk transferred. The cap is 30 minutes (`songtake.js` `MAX_S = 30*60`) → ~345 MB of
`Float32Array` plus one enormous structured clone, allocated and copied from the realtime thread. Nothing in the UI
mentions a length limit. For the songs this app is for (a few minutes) it is fine, but it is the one place that scales
badly. Streaming each chunk to the page as it fills would fix it, since the data is transferred anyway.

### 4. No `worker.onerror` on either render worker

`js/engine/engine.js:104-107` and `js/engine/render.js:51`. If a worker dies, live Modal/Scanned notes silently stop
being recorded, and in Export `renderedNotes()` awaits promises that only ever resolve from `w.onmessage`;
`renderAudio` awaits that before it checks `cancelled()`, so Export would sit at 0 % with Close disabled until the page
is reloaded. Cheap fix: `worker.onerror` → reject, and a timeout around each note.

### 5. Every edit costs two full-song JSON snapshots, and every edit re-sends the compiled song

`js/store.js:230` stringifies the song before and after each `store.edit`, and `js/main.js:36` → `engine.setSong`
(`engine.js:191`) recompiles and posts the whole compiled song on every notification — including each `input` event of a
slider (`panel.js` `apply`), which fires at pointer rate.

Measured on the review machine: a maxed 16-track × 8-scene × 4-bar song is **981 KB** of JSON and costs **3.74 ms per
`store.edit`** (mainly the two stringifies); `compile()` adds 0.37 ms. A drag at ~60 events/s is therefore ~0.25 s of
work per second of dragging, and 80 undo entries at that size retain ~78 MB. The default 8-track song is negligible
(`compile` 0.054 ms), so this is a ceiling problem, not a daily one. If it is worth touching: take the history snapshot
at most once per merge window instead of per event (the merge already collapses the undo entry, but both stringifies
still run).

### 6. Two browser tabs have no coordination

The autosave (`spores.song` in localStorage), the take store (`spores-audio` IndexedDB) and `gcClips` at start-up are
all app-wide, not tab-wide. `js/main.js:42-44` deletes every stored take the *autosaved* song doesn't reference. Two
tabs editing the same song therefore mean last-writer-wins on the autosave, and a take recorded in tab A can be collected
by tab B if A's song write (250 ms debounce) had not landed. The desktop app is protected by
`requestSingleInstanceLock`; the browser has nothing. Low frequency, but silent when it happens.

## Low / polish

- **`oct` default disagrees with itself.** `store.js:43` starts new synth/MIDI/CV tracks at `oct: 2`; `fixTrack` uses
  `3` for a missing `oct`; `docs/SPEC.md` documents `oct: 3`. Every song saved since the skeleton has `oct`, so this only
  affects hand-made files — but the three should say the same thing.
- **New scenes skip `clips: {}`** (`js/ui/steps.js:197`) while the spec's scene shape and `migrate` always include it.
  Every reader uses `sc.clips || {}`, so nothing breaks; it is format drift.
- **The spec's data block is behind the code**: `presets`, `track.color`, `track.loop`, and the song-take `span`/`take`
  fields are all stored but absent from `docs/SPEC.md`. Docs only.
- **CI runs only the updater test.** `.github/workflows/desktop.yml:52` runs `node --test tests/updater.test.js`;
  `desktop/package.json`'s `test` script also includes `tests/path-allow.test.js`, which is the security-relevant one. One
  extra path in the same line.
- **No CSP in `index.html`.** Nothing remote is loaded and the desktop wrapper blocks external navigation, sandboxes the
  renderer and keeps `contextIsolation`, so this is defence in depth only — but a `Content-Security-Policy` meta is cheap
  for a page that loads wasm and opens user files.
- **Dialog focus.** `js/ui/dialog.js` has no focus trap and does not restore focus on close, so Tab can reach the page
  behind the scrim and keyboard users lose their place. The important parts are right: `role="dialog"` + `aria-label`,
  Escape and click-outside close, `ask()` focuses the safe answer.
- **Browser-side import is unbounded.** Desktop reads are capped at 512 MB (`files.js`), but `savefile.js` `parse` →
  `wavRead` sizes buffers from the file itself, so a crafted `.spores` can ask for a lot of memory.
- **`zipRead` failure reasons are swallowed** (`savefile.js` `parse` returns `null` for any exception), so a `.spores`
  re-zipped by another tool with compression shows "That file isn't a Spores song." rather than the actual reason.
  Compressed/zip64 entries are refused by design.

## Checked and fine

- `zipWrite`/`zipRead` round-trip and CRC validation; 24-bit stereo and 32-bit float mono WAV round-trips (mixed to mono
  on read, as documented); `wavRead` pads odd chunk lengths correctly.
- Compiled scene `clips` are arrays indexed by track position but sourced from `scene.clips[trackId]`, and `worklet.js`
  reads them by the same index — consistent, no id/index mix-up.
- `degToMidi` clamps to 0–127 and wraps negative degrees correctly; melody colours keep the root pink.
- The swing/lookahead/queue design in `worklet.js` reads correct: chance rolled once per step ahead of time, note-offs
  filtered on stop, per-track length modulo, pending scene switch on the bar line.
- `fxhost.js` is unusually careful: NaN scrubbing, trap bypass, re-viewing wasm memory after growth, sleep on silence,
  tail fade after Stop, crossfaded on/off and reorder.
- Desktop security is sound: `app://` handler with `path.startsWith(APP_DIR + sep)`, IPC `senderFrame` origin check,
  persisted allow-list with extension checks, temp-file + rename saves, separate allow-list for exports, SHA-256 verified
  update downloads with stall timeouts and prerelease handling.
- GitHub Actions: path filters are not evaluated for tag pushes, so a `v*` tag release runs despite the `paths` filter —
  the workflow does what its comments say.
- `AGENTS.md` rules: colours come from `:root` tokens (the only hexes in `js/` are the computed black/white step text),
  targets are `--touch` 44 px, deletes ask first, and no source file exceeds ~600 lines (`steps.js` 582).

## Suggested order

1. Clamp `track.params` on load (finding 1) — it is a silence-the-song bug with a one-line repro.
2. Validate `song` blocks in `migrate` (finding 2) — protects the Song screen and Export from bad files.
3. Add `worker.onerror` + a timeout in `renderedNotes` (finding 4) — turns a hang into a message.
4. Add `tests/path-allow.test.js` to CI (low, one line).
5. Defer 3, 5 and 6 unless long recordings or very full songs become real use.

---

## Handoff brief for the next agent

**Paste-able prompt:** *"In the Spores repo (plain ES modules, no build step), fix findings 1 and 2 from
`docs/CODE-REVIEW.md`. Read `AGENTS.md` first and follow it: work on `dev`, never add npm packages to the app, colours
only from `:root` tokens, every song change through `store.edit`, deletes ask first, and anything marked 🔴 (all of
`js/engine/`, timing, audio) is Claude-only — stop and hand back instead of editing it. Do one finding per commit, say
what you tested and how, and add a dated `docs/NOTES.md` entry."*

### State

Reviewed at commit `851d5ef` on `main`; the working tree was left clean (this file is the only addition). `main` is the
owner's copy and `dev` is where work happens. The song format is at `v: 3`; do not bump it without a migration in
`store.migrate` **and** an update to `docs/SPEC.md` — old files must keep opening.

### Which findings can be done without touching 🔴 engine code

| Finding | Where | Owner |
| --- | --- | --- |
| 1. Unvalidated `track.params` | `js/store.js` `fixTrack` (the `BlipVoice` guard itself is `js/engine/voices.js` = 🔴) | safe to do the store half |
| 2. Unvalidated `song` blocks | `js/store.js` `migrate` | safe |
| 3. Song-take transfer | `js/engine/worklet.js`, `songtape.js` | 🔴 Claude only |
| 4. Missing `worker.onerror` | `js/engine/engine.js`, `js/engine/render.js` | 🔴 Claude only |
| 5. Per-edit snapshots | `js/store.js` `edit()` | safe, but it changes undo granularity — test it |
| 6. Two-tab coordination | `js/main.js`, `js/audiostore.js` | safe, but it is a design change — ask the owner first |
| Low items | see the list above | safe |

### Reproductions (scratch files at the repo root, deleted after use)

Finding 1:

```js
import {resolve} from './js/engine/sounds.js';
import {BlipVoice} from './js/engine/voices.js';
const r = resolve('Kick', {pitch: 'loud'});
const v = new BlipVoice(48000); v.set(r.vals); v.trig(1);
const out = new Float32Array(8); v.render(out, 0, 8, 1);
console.log(out);   // NaN, NaN, NaN, …  (AcidCore sanitises these; BlipVoice does not)
```

Finding 2:

```js
import {migrate} from './js/store.js';
import {songMap} from './js/songmap.js';
const s = migrate({v: 3, tracks: [{id: 't1', type: 'drum', sound: 'Kick'}],
  scenes: {A: {name: 'A', bars: 1, steps: {}}},
  song: [{scene: 'Z', repeat: 1e9}, {scene: 'A', repeat: 'x'}]});
console.log(s.song, songMap(s));   // block kept with repeat 1000000000; the Song screen shows ×64
```

Finding 5's measurement (same shape as the probe used for the review):

```js
// 16 tracks, 8 scenes × 4 bars, every step on → 981 KB of JSON
// store.edit(...) × 200 → 3.74 ms each; compile() 0.37 ms; default song compile 0.054 ms
```

### Sketches

Finding 1, in `fixTrack` after the existing `t.params` line (import `settingsFor` from `js/engine/sounds.js`):

```js
if (t.type === 'drum' || t.type === 'synth'){
  const rows = settingsFor(t.sound).all, p = {};
  for (const r of rows){
    const v = t.params[r.s];
    if (typeof v === 'number' && isFinite(v)) p[r.s] = Math.min(r.max, Math.max(r.min, r.int ? Math.round(v) : v));
  }
  t.params = p;
}
```

This drops unknown keys as well as bad ones. That is deliberate (it is what makes the file unable to silence a track),
but it does mean a file written by a *newer* version loses settings this version does not know. If forward-compat
matters more, keep unknown keys and add the `isFinite` guard in `BlipVoice.set` instead — that part is 🔴, so it goes to
Claude.

Finding 2, replacing the `s.song` line in `migrate` (it already runs after `s.scenes` is built):

```js
s.song = Array.isArray(s.song) ? s.song
  .filter(b => b && typeof b === 'object' && s.scenes[b.scene])
  .slice(0, 128)
  .map(b => ({scene: b.scene, repeat: Math.max(1, Math.min(64, b.repeat | 0 || 1)), loop: !!b.loop}))
  : base.song;
```

Leave the result empty if every block was dropped — the Song screen already renders "The song is empty. Tap a scene
below to add it to the end." and Export gives a clear "The song has no blocks yet" error. Do not silently substitute
`base.song`; that would rewrite the owner's arrangement with scene A.

### Acceptance criteria

- **Finding 1:** the repro prints finite samples; a song with `"params": {"pitch": "loud", "decay": 1e9}` opens without
  silence, with `decay` clamped into the setting's range; a normal song's saved params are byte-identical after
  save/reopen; `tests/save-check.mjs` still passes (needs Chrome).
- **Finding 2:** a file with `repeat: 1e9`, a `repeat: "x"`, and a block on a missing scene opens with repeats ≤ 64 and
  the bad block gone; export of that song reports a normal length instead of failing; a valid song survives a save →
  reopen unchanged.
- **Finding 5 (if attempted):** one slider drag is still exactly one Undo step (that is the existing, deliberate
  behaviour), the drag no longer costs a full snapshot per pointer event, and Undo/Redo through `tests/save-check.mjs`
  and the dirty dot still behave.
- **Every change:** update `docs/NOTES.md` (AGENTS.md rule 7) with what was tested, how, and what was not; one small
  commit per finding.

### How to verify

- `cd desktop && npm install` once, then `npm test` → runs `tests/updater.test.js` and `tests/path-allow.test.js` under
  `node --test` (the only checks that run headless without a browser).
- Store/save/engine suites need Chrome plus `puppeteer-core` (`npm i --no-save puppeteer-core`), a static server in the
  repo root (`python3 -m http.server 8765`), then `node tests/save-check.mjs`, `tests/engine-check.mjs`,
  `tests/export-check.mjs`, etc. They are dev scripts, not a wired-up runner — the repo root has no `package.json`.
- A change inside `js/engine/` must not be declared done on a compile: the notes in `docs/NOTES.md` show what those
  checks assert (170 BPM gaps, MIDI clock spacing, export length exact to the sample).

### Do not

- Add a build step, a framework, or npm packages to the app (`desktop/` is the only place with packages).
- Rename files or reformat wholesale; source files stay under ~600 lines.
- Change the undo labels or merge rules (`MERGE_LABELS`, `MERGE_MS`, the `key` argument) without checking the
  drag-merges-into-one-Undo behaviour by hand.
- Touch `js/engine/*`, timing, or audio behaviour if you are not Claude — write what you saw in `docs/NOTES.md` and hand
  back, per AGENTS.md rule 6.

### What this review did and did not confirm

Confirmed by running: the 11 desktop unit tests, the pure-module probes above, and the timings. Not confirmed: the
browser suites' current status (Chrome/`puppeteer-core` were not available), anything about how the app sounds, and the
Electron build — `docs/NOTES.md` says those passed at the time of the last commits, but treat that as the previous
author's claim, not this review's.
