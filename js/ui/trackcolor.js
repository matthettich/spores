/* js/ui/trackcolor.js: a track's colour. Click the colour bar beside a track (or Colour in the panel) to pick one.
   "Automatic" goes back to the colour of its type. The colour shows on the bar and on a drum track's steps (melody
   steps keep their note colours). Stored as track.color (a key from TRACK_COLOURS; missing = automatic). */
import {el} from './dom.js';
import {openDialog} from './dialog.js';
import {TRACK_COLOURS} from '../store.js';

const NAMES = {pink: 'Pink', orange: 'Orange', mustard: 'Mustard', green: 'Green', teal: 'Teal', blue: 'Blue', purple: 'Purple', grey: 'Grey'};
const TYPE_VAR = {drum: 'var(--gate)', synth: 'var(--audio)', midi: 'var(--video)', cv: 'var(--mod)'};

// the CSS colour a track shows: its chosen colour, or its type's
export const trackColour = t => t.color ? `var(--tc-${t.color})` : (TYPE_VAR[t.type] || 'var(--gate)');

export function openColourPicker(store, trackId){
  const t = store.get().tracks.find(x => x.id === trackId);
  if (!t) return;
  let dlg;
  const pick = key => {
    store.edit('Track colour', s => {
      const tr = s.tracks.find(x => x.id === trackId);
      if (!tr) return;
      if (key) tr.color = key; else delete tr.color;
    });
    dlg.close();
  };
  const sw = (key, label, colour) => el('button', {class: 'tcsw' + ((t.color || '') === key ? ' on' : ''), title: label,
    'aria-label': label, 'aria-pressed': (t.color || '') === key ? 'true' : 'false', onclick: () => pick(key)},
    el('span', {class: 'tcdot', style: {background: colour}}));
  const grid = el('div', {class: 'tcgrid'},
    sw('', 'Automatic (by track type)', TYPE_VAR[t.type] || 'var(--gate)'),
    ...TRACK_COLOURS.map(k => sw(k, NAMES[k], `var(--tc-${k})`)));
  dlg = openDialog({title: `Colour for ${t.name}`, body: 'Automatic uses the colour of its type.', content: [grid],
    actions: [{label: 'Cancel'}]});
  const on = grid.querySelector('.on');
  if (on) on.focus();
}
