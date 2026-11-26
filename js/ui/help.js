/* js/ui/help.js: the "?" help — how Spores works, in plain words, one short page.
 *
 * It is behind a button on purpose: docs/SPEC.md says a first-time user should be able to make a beat without reading
 * anything, so nothing here is in the way, and every line repeats something the screen already hints at.
 */
import {el} from './dom.js';
import {openDialog} from './dialog.js';

export function openHelp(){
  openDialog({
    title: 'How Spores works',
    content: [
      el('div', {class: 'psec'}, 'A beat'),
      el('p', {class: 'note'}, 'Tap a step to turn it on. Press ▶ Play. Tap a track on the left to change its sound; M mutes.'),
      el('div', {class: 'psec'}, 'A melody'),
      el('p', {class: 'note'}, 'Tap and hold a step (or right-click it) to choose it, then ▲ ▼ move its note up or down the '
        + 'key. Velocity is how hard it plays; in More, Chance is how often it plays at all.'),
      el('div', {class: 'psec'}, 'Scenes and songs'),
      el('p', {class: 'note'}, 'The letters at the top are scenes — A is where you start. Song puts scenes in a row with '
        + 'repeats, and plays them in order.'),
      el('div', {class: 'psec'}, 'Seeds'),
      el('p', {class: 'note'}, 'File › Seeds link… sends every drum hit and the clock to Seeds over a MIDI port.'),
      el('p', {class: 'note'}, 'Space plays and stops. Undo (Ctrl+Z) takes back any change. The song saves itself in this browser; File › Save a '
        + 'copy… keeps a file.'),
    ],
    actions: [{label: 'Got it', primary: true}],
  });
}
