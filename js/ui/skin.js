/* js/ui/skin.js: skins — a skin is only a different set of :root values (docs/seeds-style-guide.md).
 *
 * The choice is per computer, not in the song (localStorage 'spores.skin'), like the CV device: a song looks the same
 * wherever it is opened. index.html reads the same key before the first paint, so there is no flash of the old skin.
 */
import {el} from './dom.js';
import {openDialog} from './dialog.js';

const KEY = 'spores.skin';

export const SKINS = [
  {id: '', name: 'Minimal', note: 'White, square corners, black lines.', dots: ['minimal-1', 'minimal-2', 'minimal-3']},
  {id: 'tr909', name: '909', note: 'Light grey and charcoal, orange for steps. Easy on the eyes.', dots: ['909-1', '909-2', '909-3', '909-4']},
  {id: 'tr808', name: '808', note: 'Warm charcoal, cream text, orange steps, yellow selection.', dots: ['808-1', '808-2', '808-3', '808-4']},
  {id: 'idmpg', name: 'IDM pink & green', note: 'Warm paper, black ink, hot pink and green.', dots: ['idmpg-1', 'idmpg-2', 'idmpg-3', 'idmpg-4']},
];

// skins that were retired → the nearest one now (index.html does the same before the first paint)
const RENAMED = {black: 'tr808', pastel: 'tr909'};
export function currentSkin(){
  let s = ''; try { s = localStorage.getItem(KEY) || ''; } catch (e) {}
  s = RENAMED[s] || s;
  return SKINS.some(k => k.id === s) ? s : '';
}

export function applySkin(id = ''){
  const root = document.documentElement;
  if (id) root.dataset.skin = id; else delete root.dataset.skin;
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) {}
}

export function openSkinDialog(){
  const list = el('div', {class: 'skins'});
  const draw = () => {
    list.innerHTML = '';
    for (const sk of SKINS){
      const on = currentSkin() === sk.id;
      list.append(el('button', {class: 'skin' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onclick: () => { applySkin(sk.id); draw(); }},
        el('span', {class: 'skindots'}, sk.dots.map(c => el('span', {class: 'skindot', style: {background: `var(--sw-${c})`}}))),
        el('span', {class: 'skintext'},
          el('span', {class: 'skinname'}, sk.name),
          el('span', {class: 'note'}, sk.note))));
    }
  };
  draw();
  openDialog({
    title: 'Skin',
    body: 'A skin changes colours and corners only: every song is the same in every skin. It is kept on this computer.',
    content: [list],
    actions: [{label: 'Done', primary: true}],
  });
}
