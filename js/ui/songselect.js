/* js/ui/songselect.js: choosing several blocks on the Song screen, and Copy / Paste / Duplicate for them.
 *
 * Click a block to pick it (song.js does that). Shift-click another block to pick everything between the two.
 * Right-click a block (or the Menu key / Shift+F10 on it) for: Copy, Paste, Duplicate.
 *   Copy      keeps the picked blocks in memory. Then "Paste" (or just clicking in the song while the blue bar shows)
 *             waits for a click: near a block's left or right edge a marker shows where it goes in between blocks;
 *             in the middle of a block it replaces that block (or the whole pick, if the block is part of it).
 *   Duplicate puts a copy of the pick right after it.
 * Escape (or Cancel in the bar) drops a waiting paste. Each paste / duplicate is one store.edit = one Undo step.
 * The song holds at most MAX_BLOCKS blocks; a menu item that would go over says so.
 *
 *   songSelect({store, blocksEl, hintEl, list, getSel, setSel, redraw}) → {draw(), range()}
 *     list() → [{b, i}] the drawn blocks (i = place in song.song); getSel / setSel = song.js's single pick (a position)
 */
import {el} from './dom.js';
import {toast} from './dialog.js';
import {contextMenu, onMenu} from './clipboard.js';

export const MAX_BLOCKS = 128;
const clone = x => JSON.parse(JSON.stringify(x));

export function songSelect({store, blocksEl, hintEl, list, getSel, setSel, redraw}){
  let r = null;          // the picked run of positions in the drawn list: {a: anchor, lo, hi}
  let clip = null;       // copied blocks [{scene, repeat, loop}]
  let pending = false;   // a paste is waiting for a click
  const n = () => list().length;
  const picked = () => r && r.lo <= r.hi && r.hi < n() ? r : null;
  const noun = k => k + ' block' + (k === 1 ? '' : 's');
  const pick = (a, b) => { r = {a, lo: Math.min(a, b), hi: Math.max(a, b)}; setSel(a); };

  const posOf = card => [...blocksEl.children].indexOf(card);

  // Shift-click extends from the anchor; a plain click only tells us where the new anchor is (song.js does the rest)
  blocksEl.addEventListener('click', e => {
    const card = e.target.closest('.sblk'); if (!card || !blocksEl.contains(card)) return;
    const p = posOf(card);
    if (pending){ e.preventDefault(); e.stopPropagation(); place(p, zone(card, e)); return; }
    if (e.target.closest('button, select, input')) return;
    if (e.shiftKey){
      e.preventDefault(); e.stopPropagation();
      const a = r ? r.a : (getSel() != null ? getSel() : p);
      pick(a, p); redraw();
    } else r = {a: p, lo: p, hi: p};
  }, true);
  // a click on the empty part of the strip pastes at the end
  blocksEl.addEventListener('click', e => { if (pending && !e.target.closest('.sblk')) place(n() - 1, 'after'); });

  const zone = (card, e) => {
    const b = card.getBoundingClientRect(), f = (e.clientX - b.left) / b.width;
    return f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'over';
  };
  const clearMarks = () => { for (const c of blocksEl.children) c.classList.remove('ins-before', 'ins-after', 'rep'); };
  blocksEl.addEventListener('pointermove', e => {
    if (!pending) return;
    clearMarks();
    const card = e.target.closest('.sblk'); if (!card) return;
    const z = zone(card, e), p = posOf(card);
    if (z === 'before') card.classList.add('ins-before');
    else if (z === 'after') card.classList.add('ins-after');
    else { const rg = picked(); const [lo, hi] = rg && p >= rg.lo && p <= rg.hi ? [rg.lo, rg.hi] : [p, p]; for (let k = lo; k <= hi; k++) blocksEl.children[k].classList.add('rep'); }
  });
  blocksEl.addEventListener('pointerleave', clearMarks);

  /* ---- the actions ---- */
  const rangeSongIdx = (lo, hi) => { const l = list(); return [l[lo].i, l[hi].i]; };
  function copy(){
    const rg = picked(); if (!rg) return;
    const s = store.get(); const [a, b] = rangeSongIdx(rg.lo, rg.hi);
    clip = clone(s.song.slice(a, b + 1)); setPending(false);
    toast(`Copied ${noun(clip.length)}. Right-click a block and choose Paste, then click where it goes.`);
  }
  function duplicate(){
    const rg = picked(); if (!rg) return;
    const [a, b] = rangeSongIdx(rg.lo, rg.hi), k = b - a + 1;
    if (store.get().song.length + k > MAX_BLOCKS) return;
    store.edit('Duplicate blocks', s => { s.song.splice(b + 1, 0, ...clone(s.song.slice(a, b + 1))); });
    pick(rg.hi + 1, rg.hi + k); redraw(); toast(`Duplicated ${noun(k)}.`);
  }
  function place(p, z){
    if (!clip || !list()[p]) return;
    const rg = picked(), l = list(), s = store.get();
    let lo, hi, at, drop = 0;
    if (z === 'over'){ [lo, hi] = rg && p >= rg.lo && p <= rg.hi ? [rg.lo, rg.hi] : [p, p]; const [a, b] = rangeSongIdx(lo, hi); at = a; drop = b - a + 1; }
    else at = z === 'before' ? l[p].i : l[p].i + 1;
    if (s.song.length - drop + clip.length > MAX_BLOCKS){ toast(`The song can have ${MAX_BLOCKS} blocks at most; that would make ${s.song.length - drop + clip.length}.`); return; }
    const items = clone(clip), first = z === 'over' ? lo : (z === 'before' ? p : p + 1);
    store.edit(z === 'over' ? 'Paste over blocks' : 'Paste blocks', st => { st.song.splice(at, drop, ...items); });
    setPending(false); pick(first, first + items.length - 1); redraw();
    toast(z === 'over' ? `Replaced ${noun(drop)} with ${noun(items.length)}.` : `Pasted ${noun(items.length)}.`);
  }
  function setPending(v){
    pending = v && !!clip; blocksEl.classList.toggle('pasting', pending); clearMarks(); hint();
  }
  function hint(){
    hintEl.innerHTML = ''; hintEl.hidden = !pending; if (!pending) return;
    hintEl.append(el('span', {}, `Pasting ${noun(clip.length)}: click between two blocks to insert, or the middle of a block to replace it.`),
      el('button', {class: 'tb quiet', onclick: () => setPending(false)}, 'Cancel'));
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pending && !blocksEl.closest('[hidden]')){ e.preventDefault(); setPending(false); } });

  /* ---- the menu ---- */
  onMenu(blocksEl, '.sblk', (card, x, y) => {
    const p = posOf(card); if (p < 0) return;
    let rg = picked(); if (!rg || p < rg.lo || p > rg.hi){ pick(p, p); redraw(); rg = picked(); }
    const k = rg.hi - rg.lo + 1, len = store.get().song.length;
    const full = need => len + need > MAX_BLOCKS ? `The song can have ${MAX_BLOCKS} blocks at most; that would make ${len + need}.` : '';
    contextMenu(x, y, [
      {label: k > 1 ? `Copy ${k} blocks` : 'Copy block', fn: copy},
      {label: clip ? `Paste ${noun(clip.length)}…` : 'Paste…', off: !clip ? 'Copy some blocks first' : '',
        title: 'Then click between blocks to insert, or on a block to replace it', fn: () => { setPending(true); toast('Click where it goes. Escape cancels.'); }},
      {label: k > 1 ? `Duplicate ${k} blocks` : 'Duplicate block', off: full(k), title: 'Put a copy right after', fn: duplicate},
    ]);
  });

  return {
    range: picked,
    draw(){   // after the blocks are drawn: marks, focus, and a single pick that song.js has dropped
      const rg = picked(), sel = getSel();
      if (rg && rg.lo === rg.hi && sel !== rg.a) r = null;
      else if (!rg) r = null;
      const g = picked();
      [...blocksEl.children].forEach((c, i) => {
        if (!c.classList.contains('sblk')) return;
        c.tabIndex = 0; c.classList.toggle('multi', !!g && g.lo !== g.hi && i >= g.lo && i <= g.hi);
        c.setAttribute('aria-selected', g && i >= g.lo && i <= g.hi ? 'true' : 'false');
      });
      hint();
    },
  };
}
