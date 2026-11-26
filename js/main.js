/* js/main.js: start-up. Wires store ↔ ui ↔ engine (and MIDI). */
import {createStore} from './store.js';
import {createEngine} from './engine/engine.js';
import * as midi from './midi.js';
import {mountSteps} from './ui/steps.js';

const store = createStore();
// The AudioContext starts suspended; the first Play (a click) resumes it.
const engine = await createEngine();
engine.setSong(store.get());
store.subscribe(s => engine.setSong(s));

// Closing or reloading the tab writes the (delayed) autosave straight away, so the last tap is not lost.
window.addEventListener('pagehide', () => store.saveNow());

const steps = mountSteps(document.getElementById('app'), {store, engine, midi});
engine.on('step', m => steps.playhead(m));
engine.on('stop', () => steps.stopped());

// MIDI is optional: without it (or if the browser says no), Spores still plays its own sounds.
midi.init().then(ok => { if (ok) midi.attach(engine, store.get); });

window.spores = {store, engine, midi};   // for the console and tests
