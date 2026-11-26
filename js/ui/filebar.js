/* js/ui/filebar.js: the File menu — New song, Open a song file…, Save a copy…, Seeds link…
 *
 * Save a copy downloads the song as JSON (store.serialize). Open reads a JSON file and checks it is a Spores song
 * before asking; both New and Open ask first, and both go through store.replace, so Undo brings the old song back
 * (nothing is lost). The song also saves itself in the browser (js/store.js), so there is no plain "Save".
 * Seeds link… opens the link settings (js/ui/link.js).
 */
import {isSong, newSong} from '../store.js';
import {openSeedsLink} from './link.js';
import {el} from './dom.js';
import {ask, toast} from './dialog.js';

export function mountFileMenu(host, {store}){
  const input = el('input', {type: 'file', accept: '.json,application/json', 'aria-label': 'Open a song file',
    style: {display: 'none'}});
  const menu = el('div', {class: 'menu', role: 'menu', hidden: true});
  const btn = el('button', {class: 'tb', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: e => { e.stopPropagation(); menu.hidden ? open() : close(); }}, 'File ▾');

  const item = (label, fn) => el('button', {role: 'menuitem', onclick: () => { close(); fn(); }}, label);
  menu.append(item('New song', startNew), item('Open a song file…', () => input.click()), item('Save a copy…', saveCopy),
    item('Seeds link…', () => openSeedsLink(store)));
  host.append(btn, menu, input);

  function open(){
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
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

  async function startNew(){
    const ok = await ask({title: 'Start a new song?', body: 'The song on screen is replaced. Undo brings it back.',
      yes: 'Start fresh', no: 'Keep this song'});
    if (!ok) return;
    store.replace(newSong(), 'new song');
    toast('New song. Undo brings the old one back.');
  }

  function saveCopy(){
    const blob = new Blob([store.serialize()], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = el('a', {href: url, download: `spores-${new Date().toISOString().slice(0, 10)}.json`});
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('Saved a copy to your downloads.');
  }

  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { toast('That file isn’t a Spores song.'); return; }
    if (!isSong(data)){ toast('That file isn’t a Spores song.'); return; }
    const ok = await ask({title: 'Open this song?',
      body: `“${f.name}” replaces the song on screen. Undo brings the old one back.`, yes: 'Open it', no: 'Keep this song'});
    if (!ok) return;
    if (!store.load(data)){ toast('That file isn’t a Spores song.'); return; }
    toast('Song opened.');
  });
}
