# Spores desktop app (Electron)

A wrapper around the web app: `copy-app.js` copies `index.html`, `css/` and `js/` into `desktop/app/`, and `main.js`
serves them from `app://spores/` (ES modules, the AudioWorklet and the wasm need a real, secure origin; `file://` won't do).
The app itself stays plain files with no build step: npm packages live only here.

- Try it on a computer: `cd desktop && npm install && npm start`
- Mac build: GitHub Actions › Desktop app › Run workflow (see `.github/workflows/desktop.yml`). Unsigned, so the first
  open is right-click › Open.
- What the wrapper adds: MIDI, audio input (Tune CV) and output-device choice allowed without prompts; no timer
  throttling when the window is hidden (MIDI timing); File › Save / Save as… / Open… / Open Recent with native dialogs (`files.js`; it only writes `.spores` / `.json` files you picked, `path-allow.js`) File › Export… with the native Save dialog and Show in Finder (only `.wav` / `.zip` paths picked in that dialog are written); and a Save / Don’t save / Cancel box when closing with unsaved changes; a Save box for File › Save a copy…; one copy at a time; update
  checks against this repo's Releases (`updater.js`, from ...Seeds; `tests/updater.test.js`).
- The song lives in the app's own storage, separate from Chrome's: move a song from the browser with File › Save a
  copy… (or Save) there and File › Open… here.
