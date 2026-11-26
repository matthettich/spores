/* js/main.js: start-up. Wires store ↔ screens ↔ engine (and MIDI). */
import {createStore} from './store.js';
import {createEngine} from './engine/engine.js';
import * as midi from './midi.js';
import {mountSteps} from './ui/steps.js';
import {mountSong} from './ui/song.js';
import {applyCvSettings} from './ui/cv.js';

const store = createStore();
// The AudioContext starts suspended; the first Play (a click) resumes it.
const engine = await createEngine();
await applyCvSettings(engine);   // CV output device + volts at full scale, kept on this computer
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

engine.on('step', m => { steps.playhead(m); song.playhead(m); });
engine.on('stop', () => { steps.stopped(); song.stopped(); });

// MIDI is optional: without it (or if the browser says no), Spores still plays its own sounds.
midi.init().then(ok => { if (ok) midi.attach(engine, store.get); });

window.spores = {store, engine, midi, show};   // for the console and tests
