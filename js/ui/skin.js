/* js/ui/skin.js: skins — a skin is only a different set of :root values (docs/seeds-style-guide.md).
 *
 * The choice is per computer, not in the song (localStorage 'spores.skin'), like the CV device: a song looks the same
 * wherever it is opened. index.html reads the same key before the first paint, so there is no flash of the old skin.
 */
import {el} from './dom.js';
import {openDialog} from './dialog.js';

const KEY = 'spores.skin';

export const SKINS = [
  {id: '', name: 'Minimal', note: 'White, square corners, black lines.', dots: ['#ffffff', '#111111', '#ff3d8b']},
  {id: 'black', name: 'Minimal black', note: 'Black, white lines, cyan selection.', dots: ['#141416', '#f4f4f6', '#00e5ff']},
  {id: 'pastel', name: 'Pastel light', note: 'Soft greys and blue, rounded corners.', dots: ['#d6dbe4', '#f8f9fb', '#22958d']},
];

export function currentSkin(){
  try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
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
        el('span', {class: 'skindots'}, sk.dots.map(c => el('span', {class: 'skindot', style: {background: c}}))),
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
