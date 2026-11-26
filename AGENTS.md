# Instructions for coding agents (Freebuff, Kilo Code, Claude)

Read `docs/SPEC.md` first. It says what Spores is, the data format, the screens and the build order.

## Rules

1. Work on the `dev` branch. `main` is the copy she uses: only merge `dev` into `main` when the owner says so.
2. Plain web app, **no build step**: `index.html`, CSS in `css/`, ES modules in `js/`. No frameworks, no npm packages in
   the app itself. Keep files small (under ~600 lines); add a new file rather than growing one.
3. Look and feel follow `docs/seeds-style-guide.md` (Spores is ...Seeds' sister app): colours from CSS variables on
   `:root`, never hard-coded hexes in components; pink = triggers/gates, teal = audio, purple = modulation; plain-English
   labels; touch targets ≥ 44 px.
4. Every edit to a song can be undone. Nothing is deleted without asking. Old song files must keep opening (bump
   `v` and migrate in `js/store.js` if the format changes).
5. One small, testable step per commit. Say in the commit message what you tested and how.
6. **Stop and hand back to Claude** for anything marked 🔴 in the spec, any timing or audio glitch, and any change
   inside `js/engine/`. Write what you saw and what you tried in `docs/NOTES.md`, then stop.
7. Keep `docs/NOTES.md` up to date: what you finished, what's half done, anything odd you noticed.
