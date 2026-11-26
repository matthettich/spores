/* js/main.js: start-up. Wires store ↔ screens ↔ engine (and MIDI). */
import {createStore} from './store.js';
import {createEngine} from './engine/engine.js';
import * as midi from './midi.js';
import {mountSteps} from './ui/steps.js';
import {mountSong} from './ui/song.js';
import {applyCvSettings} from './ui/cv.js';
import {toast} from './ui/dialog.js';

const store = createStore(undefined, {
  onSaveError: () => toast('This browser won’t keep the song (private window or full). Use File › Save a copy… to keep it.'),
});
// The AudioContext starts suspended; the first Play (a click) resumes it.
let engine;
try {
  engine = await createEngine();
} catch (e) {
  // without the engine there is nothing to play: say so in plain words instead of a blank page
  console.error(e);
  const app = document.getElementById('app');
  app.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'note startfail';
  p.textContent = 'Spores couldn’t start its sound engine in this browser. Try the latest Google Chrome, then reload the page. Your song is safe: it is still saved in this browser.';
  app.append(p);
  throw e;
}
try { await applyCvSettings(engine); }   // CV output device + volts at full scale, kept on this computer
catch (e) { console.error(e); }          // a missing CV device must not stop the app opening
engine.setSong(store.get());
store.subscribe(s => engine.setSong(s));

// Closing or reloading the tab writes the (delayed) autosave straight away, so the last tap is not lost.
window.addEventListener('pagehide', () => store.saveNow());

/* Two screens, one visible at a time: the Steps screen and the Song screen (phase 5). Both stay mounted, so the
   hidden one keeps its place; the Song screen redraws when it is shown again. */
const app = document.getElementById('app');
const stepsEl = document.createElement('div');
stepsEl.className = 'screen';
const songEl = document.createElement('div');
songEl.className = 'screen';
songEl.hidden = true;
app.append(stepsEl, songEl);

const steps = mountSteps(stepsEl, {store, engine, midi, openSong: () => show('song')});
const song = mountSong(songEl, {store, engine, openSteps: () => show('steps')});

function show(name){
  stepsEl.hidden = name !== 'steps';
  songEl.hidden = name !== 'song';
  if (name === 'song') song.refresh();
}
show('steps');

/* Spacebar plays and stops, like every music app: the scene on the Steps screen, the whole song on the Song screen.
   Not while typing in a text field, and not while a dialog or menu is open (there it presses the focused button).
   It never also "clicks" whatever button has focus, so a tapped step isn't toggled again. */
window.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  const typing = t && (t.tagName === 'TEXTAREA' || t.isContentEditable
    || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)));
  if (typing || document.querySelector('.scrim') || document.querySelector('.menu:not([hidden])')) return;
  e.preventDefault();
  (songEl.hidden ? steps : song).togglePlay();
});
// a focused button would still "click" on the key's release in some browsers: swallow that too
window.addEventListener('keyup', e => { if (e.code === 'Space' && !document.querySelector('.scrim') && e.target.tagName === 'BUTTON') e.preventDefault(); });

engine.on('step', m => { steps.playhead(m); song.playhead(m); });
engine.on('stop', () => { steps.stopped(); song.stopped(); });

// MIDI is optional: without it (or if the browser says no), Spores still plays its own sounds.
midi.init().then(ok => { if (ok) midi.attach(engine, store.get); });

window.spores = {store, engine, midi, show};   // for the console and tests
