/* js/ui/filebar.js: the File menu — Save, Save as…, Save a copy…, Open…, Open Recent (desktop app), New song,
 * Export… (js/ui/export.js), Seeds link…, Skin…, Preview on click (a tick; stays open). The saving itself is in js/ui/savefile.js; each row shows its keyboard shortcut, muted.
 * Opening and New song ask first and go through store.replace / store.load, so Undo brings the old song back.
 */
import {openSeedsLink} from './link.js';
import {openSkinDialog} from './skin.js';
import {previewOn, setPreview} from './preview.js';
import {el} from './dom.js';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
// 'S' / 'Shift+S' / 'O' → ⌘S / ⇧⌘S on a Mac, Ctrl+S / Ctrl+Shift+S elsewhere
const keyText = k => MAC ? (k.startsWith('Shift+') ? '⇧' : '') + '⌘' + k.slice(-1) : 'Ctrl+' + k;

export function mountFileMenu(host, {store, files, scene}){
  const menu = el('div', {class: 'menu', role: 'menu', hidden: true});
  const btn = el('button', {class: 'tb', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: e => { e.stopPropagation(); menu.hidden ? open() : close(); }}, 'File ▾');

  const item = (label, fn, key) => el('button', {role: 'menuitem', onclick: () => { close(); fn(); }},
    el('span', {}, label), key ? el('span', {class: 'kbd'}, keyText(key)) : null);
  const recentBox = el('div', {class: 'menusub', hidden: true});
  const recentBtn = el('button', {role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    onclick: () => { recentBox.hidden = !recentBox.hidden; recentBtn.setAttribute('aria-expanded', String(!recentBox.hidden)); }},
    el('span', {}, 'Open Recent'), el('span', {class: 'kbd'}, '▸'));
  menu.append(item('Save', () => files.save(), 'S'), item('Save as…', () => files.saveAs(), 'Shift+S'),
    item('Save a copy…', () => files.saveCopy()), item('Open…', () => files.open(), 'O'));
  if (files.hasRecent) menu.append(recentBtn, recentBox);
  if (files.exportAudio) menu.append(item('Export…', () => files.exportAudio(scene ? scene() : undefined)));
  const prev = el('button', {role: 'menuitemcheckbox', onclick: () => { setPreview(!previewOn()); paintPrev(); }},
    el('span', {}, 'Preview on click'), el('span', {class: 'kbd'}));
  const paintPrev = () => { prev.setAttribute('aria-checked', String(previewOn())); prev.lastChild.textContent = previewOn() ? '✓' : ''; };
  paintPrev();
  menu.append(item('New song', () => files.startNew()), item('Seeds link…', () => openSeedsLink(store)), item('Skin…', openSkinDialog), prev);
  host.append(btn, menu);

  async function fillRecent(){
    recentBox.replaceChildren();
    let list = [];
    try { list = await files.recent(); } catch (e){}
    recentBtn.disabled = !list.length;
    recentBtn.firstChild.textContent = list.length ? 'Open Recent' : 'Open Recent (none yet)';
    for (const r of list) recentBox.append(el('button', {role: 'menuitem', title: r.path, onclick: () => { close(); files.openPath(r.path); }}, r.name));
  }
  function open(){
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (files.hasRecent){ recentBox.hidden = true; recentBtn.setAttribute('aria-expanded', 'false'); fillRecent(); }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  }
  function close(){
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
  }
  function outside(e){ if (!host.contains(e.target)) close(); }
  function esc(e){ if (e.key === 'Escape') close(); }
}
