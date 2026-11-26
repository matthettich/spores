/* js/ui/link.js: the Seeds link settings (File › Seeds link…). See docs/SPEC.md "Linking to Seeds".
 *
 * Spores and Seeds talk over MIDI, so neither app can break the other. This dialog picks the virtual MIDI port they
 * share, the channel the drum hits go out on (16 by default) and whether Spores sends clock + Start / Stop. Every
 * change is a store.edit, so it is undoable and saved with the song; js/midi.js reads the same fields while playing.
 */
import {el} from './dom.js';
import {openDialog} from './dialog.js';
import * as midi from '../midi.js';

export function openSeedsLink(store){
  const link = store.get().link || {}, outs = midi.outputs();

  const port = el('select', {'aria-label': 'Seeds link port'});
  port.append(el('option', {value: ''}, 'Off'));
  for (const o of outs) port.append(el('option', {value: o.id}, o.name));
  // a port saved in the song but not plugged in now stays listed, so it comes back when it is
  if (link.seedsPort && !outs.some(o => o.id === link.seedsPort || o.name === link.seedsPort))
    port.append(el('option', {value: link.seedsPort}, link.seedsPort));
  port.value = link.seedsPort || '';
  port.addEventListener('change', () => store.edit('Seeds port', song => { song.link.seedsPort = port.value; }));

  const ch = el('select', {'aria-label': 'Seeds channel'});
  for (let i = 1; i <= 16; i++) ch.append(el('option', {value: String(i)}, 'Channel ' + i));
  ch.value = String(link.seedsCh || 16);
  ch.addEventListener('change', () => store.edit('Seeds channel', song => { song.link.seedsCh = +ch.value; }));

  const clock = el('input', {type: 'checkbox'});
  clock.checked = link.clock !== false;
  clock.addEventListener('change', () => store.edit('Seeds clock', song => { song.link.clock = clock.checked; }));

  openDialog({
    title: 'Seeds link',
    body: 'Make a virtual MIDI port on this computer — IAC Driver in Audio MIDI Setup on a Mac, loopMIDI on Windows — and pick it here.',
    content: [
      el('div', {class: 'psec'}, 'Seeds link'),
      el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Port'), port),
      el('div', {class: 'prow wide'}, el('span', {class: 'plabel'}, 'Channel'), ch),
      el('label', {class: 'checkrow'}, clock, el('span', {}, 'Send clock and Start / Stop')),
      el('p', {class: 'note'}, 'Every drum hit also sends its track’s Seeds note on this channel, so Seeds’ Clips and '
        + 'MIDI modules can flash, freeze or change patch with the beat.'),
      midi.ready() ? null : el('p', {class: 'note'}, 'MIDI is not available in this browser (Chrome has it).'),
    ],
    actions: [{label: 'Done', primary: true}],
    focus: port,
  });
}
