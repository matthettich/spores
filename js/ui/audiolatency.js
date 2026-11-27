/* js/ui/audiolatency.js: the "Test latency…" dialog (More › Latency on an audio track). The engine plays 8 short beeps
 * and listens for them (engine.measureLatency, not applied); she then chooses to use the number or keep what she had.
 * Latency is per computer (kept by the engine in localStorage), not part of the song, so this is not an Undo step. */
import {el} from './dom.js';
import {openDialog} from './dialog.js';

export function openLatencyTest(engine, onDone){
  const status = el('p', {class: 'note'}), act = el('div', {class: 'dacts'});
  let dlg, busy = false;
  const btn = (label, fn, primary) => el('button', {class: 'tb' + (primary ? ' on' : ''), onclick: fn}, label);
  const show = (text, buttons) => { status.textContent = text; act.replaceChildren(...buttons); if (buttons[0]) buttons[0].focus(); };
  const close = () => dlg.close();

  const intro = () => show(
    'Spores plays 8 short beeps and listens for them to come back, to learn how long your computer takes to play a sound '
    + 'and hear it again. Hold your headphones against the microphone, or turn the speakers up so the microphone can hear '
    + 'them. Nothing goes into your song.',
    [btn('Start the test', run, true), btn('Not now', close)]);

  async function run(){
    if (busy) return; busy = true;
    if (engine.playing) engine.stop();
    if (!engine.input.open){
      const r = await engine.openInput({});
      if (!r.ok){ busy = false; return show(r.error || 'Couldn’t open an audio input.', [btn('Close', close, true)]); }
    }
    show('Listening… (about three seconds)', []);
    const r = await engine.measureLatency({apply: false});
    busy = false;
    if (!r.ok) return show(r.error || 'The test didn’t work.', [btn('Try again', run, true), btn('Keep what I had', close)]);
    const steady = r.jitterMs < 3 ? 'The beeps came back steadily.' : `The beeps wandered by ${r.jitterMs.toFixed(1)} ms, so try again somewhere quieter.`;
    show(`The sound took ${r.totalMs.toFixed(1)} ms to come back. ${steady} Using it makes new takes line up with the beat.`,
      [btn('Use this', () => { engine.setLatencyOffset(r.offsetMs); close(); }, true), btn('Try again', run), btn('Keep what I had', close)]);
  }

  dlg = openDialog({title: 'Test latency', content: [status, act], actions: [], onClose: onDone});
  intro();
}
