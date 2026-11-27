/* js/ui/tempopresets.js: the "Style" list next to the tempo field on the Steps and Song headers.
 * Picking a style sets the song's tempo as ONE undo step (the same 'Tempo' edit the BPM field makes).
 * Tempos are the usual ones for each style; Trap is listed at 140 (it is often felt at half-time, 70). */
import {el} from './dom.js';

export const TEMPO_PRESETS = [
  ['Hip-hop', [['Boom bap', 90], ['Lo-fi', 80], ['Trap', 140, ' (half-time feel 70)'], ['Drill', 142]]],
  ['House & techno', [['Deep house', 122], ['House', 124], ['Tech house', 126], ['Techno', 130], ['Hard techno', 145]]],
  ['Breaks & bass', [['Breakbeat', 130], ['UK garage', 132], ['Dubstep', 140], ['Drum & bass', 174], ['Jungle', 165], ['Footwork', 160]]],
  ['Downtempo & other', [['Ambient', 70], ['Downtempo', 95], ['Trip-hop', 90], ['IDM', 110], ['Synthwave', 100], ['Electro', 128], ['Trance', 138], ['Hardcore', 170]]],
];

/* a <select> that shows "Style ▾" and, once a style is picked, sets the tempo and goes back to the label */
export function tempoPresetSelect(store){
  const sel = el('select', {class: 'tempopre', 'aria-label': 'Tempo presets', title: 'Set the tempo to a common style'},
    el('option', {value: '', selected: true}, 'Style'),
    TEMPO_PRESETS.map(([group, items]) => el('optgroup', {label: group},
      items.map(([name, bpm, note]) => el('option', {value: String(bpm)}, `${name} · ${bpm}${note || ''}`)))));
  sel.addEventListener('change', () => {
    const bpm = +sel.value;
    sel.value = '';
    if (bpm >= 20 && bpm <= 300) store.edit('Tempo', s => { s.bpm = bpm; });
  });
  return sel;
}
