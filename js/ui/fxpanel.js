/* js/ui/fxpanel.js: the "Effects" section of the track panel (called from panel.js) for drum, synth and audio tracks.
 *
 * "+ Add effect ▾" opens a list grouped by FX_GROUPS (disabled, with the reason, at 4 on the track or 32 in the song).
 * Each effect is a small card: name, On / Off, ‹ › (earlier / later), Reset, × (asks first; Undo brings it back with its
 * settings) and its settings: Simple shows the effect's main ones, More shows all of them. Every change is one
 * store.edit through js/fxedit.js; dragging a slider merges into one Undo step (store.js MERGE_LABELS).
 *   const f = fxSection(root, {store, t, mode})  → {update(song, track), dispose()}
 * The cards are rebuilt only when the list of effects (ids, order, on / off) changes; otherwise values update in place,
 * so a drag is not interrupted. Look: css/fx.css.
 */
import {el} from './dom.js';
import {ask} from './dialog.js';
import {FX_LIST, FX_GROUPS, MAX_FX, MAX_SONG_FX, fxInfo, fxText} from '../engine/fx.js';
import {fxPresets, fxPresetName} from '../engine/fxpresets.js';
import {addFx, removeFx, moveFx, setFxOn, setFxParam, resetFx, applyFxPreset, canAddFx, fxCount} from '../fxedit.js';

export function fxSection(root, {store, t, mode}){
  const id = t.id;
  const me = (s = store.get()) => s.tracks.find(x => x.id === id) || t;
  let sig = '', open = false, refocus = null, cards = [];
  const list = el('div', {class: 'fxlist'});
  const menu = el('div', {class: 'fxmenu', hidden: true, role: 'menu'});
  const addBtn = el('button', {class: 'tb fxadd', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => { open = !open; paintMenu(); if (open) menu.scrollIntoView({block: 'nearest'}); }}, '+ Add effect ▾');   // the list opens at the panel's foot: bring it into view
  const count = el('p', {class: 'note fxcount num', role: 'status'});
  root.append(el('div', {class: 'psec'}, 'Effects'),
    el('p', {class: 'note'}, 'Effects change this track’s sound, in order from top to bottom.'),
    list, el('div', {class: 'fxaddrow'}, addBtn), count, menu);

  for (const g of FX_GROUPS){
    menu.append(el('div', {class: 'fxgrp'}, g), ...FX_LIST.filter(x => x.group === g).map(x =>
      el('button', {class: 'tb fxitem', role: 'menuitem', title: x.about, 'data-type': x.type, onclick: () => {
        const n = addFx(store, id, x.type); open = false; paintMenu();
        if (n){ refocus = {id: n}; }
      }}, x.name)));
  }

  function paintMenu(){
    const s = store.get(), tr = me(s), ok = canAddFx(tr, s), n = fxCount(s), on = (tr.fx || []).length;
    if (!ok) open = false;
    addBtn.disabled = !ok;
    addBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.hidden = !open;
    const why = on >= MAX_FX ? `This track has ${MAX_FX} effects, the most it can have. Remove one to add another.`
      : n >= MAX_SONG_FX ? `The song has ${MAX_SONG_FX} effects, the most it can have. Remove one somewhere to add another.` : '';
    addBtn.title = why || 'Add an effect to this track';
    count.textContent = (why ? why + ' ' : '') + `${n} of ${MAX_SONG_FX} in the song`;
  }

  async function remove(f, name){
    const ok = await ask({title: `Remove ${name}?`, body: 'Undo brings it back with its settings.', yes: 'Remove it', no: 'Keep it'});
    if (ok) removeFx(store, id, f.id);
  }

  function card(f, i, n, song){
    const info = fxInfo(f.type), rows = mode === 'more' ? info.params : info.params.filter(p => p.main);
    const paint = [];
    const sw = el('button', {class: 'tb fxsw' + (f.on ? ' on' : ''), 'aria-pressed': f.on ? 'true' : 'false', 'aria-label': `${info.name} ${f.on ? 'on' : 'off'}`,
      title: f.on ? 'Switch this effect off (it stays here)' : 'Switch this effect on', onclick: () => setFxOn(store, id, f.id, !f.on)}, f.on ? 'On' : 'Off');
    const btn = (label, aria, title, fn, act, dis) => el('button', {class: 'tb', 'aria-label': aria, title, disabled: dis, 'data-act': act, onclick: fn}, label);
    const bar = el('div', {class: 'fxbtns'},
      btn('‹', `Move ${info.name} earlier`, 'Earlier in the chain', () => { refocus = {id: f.id, act: 'earlier'}; moveFx(store, id, f.id, -1); }, 'earlier', i === 0),
      btn('›', `Move ${info.name} later`, 'Later in the chain', () => { refocus = {id: f.id, act: 'later'}; moveFx(store, id, f.id, 1); }, 'later', i === n - 1),
      btn('Reset', `Reset ${info.name}`, 'Put every setting back how it started', () => resetFx(store, id, f.id), 'reset'),
      btn('×', `Remove ${info.name}`, 'Remove this effect (you will be asked first)', () => remove(f, info.name), 'remove'));
    // the preset list: shows the preset the card's values match exactly, else "Custom"
    const pre = el('select', {class: 'fxpre', 'aria-label': `${info.name} preset`, title: 'Start from a ready-made sound'});
    const presets = fxPresets(f.type);
    presets.forEach((x, k) => pre.append(el('option', {value: String(k)}, x.name)));
    pre.append(el('option', {value: 'custom', disabled: true}, 'Custom'));
    pre.addEventListener('change', () => { const x = presets[+pre.value]; if (x) applyFxPreset(store, id, f.id, x.p); });
    const showPre = x => { const nm = fxPresetName(f.type, x.p), k = presets.findIndex(q => q.name === nm); pre.value = k < 0 ? 'custom' : String(k); };
    showPre(f); paint.push(showPre);
    const body = el('div', {class: 'fxbody'});
    for (const p of rows){
      const cur = f.p[p.key] ?? p.def, val = el('span', {class: 'pval num'});
      const show = v => { val.textContent = fxText(f.type, p.key, v, store.get().bpm); };
      show(cur);
      if (p.names){
        const sel = el('select', {'aria-label': `${info.name} ${p.label}`});
        p.names.forEach((nm, k) => sel.append(el('option', {value: String(k)}, nm)));
        sel.value = String(cur);
        sel.addEventListener('change', () => setFxParam(store, id, f.id, p.key, +sel.value));
        paint.push(x => { if (document.activeElement !== sel) sel.value = String(x.p[p.key] ?? p.def); });
        body.append(el('div', {class: 'prow wide'}, el('span', {class: 'plabel', title: p.label}, p.label), sel));
      } else {
        const inp = el('input', {type: 'range', class: 'slider', min: p.min, max: p.max, step: 1, 'aria-label': `${info.name} ${p.label}`});
        inp.value = cur;
        inp.addEventListener('input', () => { show(+inp.value); setFxParam(store, id, f.id, p.key, +inp.value); });
        paint.push(x => { const v = x.p[p.key] ?? p.def; show(v); if (document.activeElement !== inp) inp.value = v; });
        body.append(el('div', {class: 'prow'}, el('span', {class: 'plabel', title: p.label}, p.label), inp, val));
      }
    }
    const node = el('div', {class: 'fxcard' + (f.on ? '' : ' off'), 'data-fx': f.id, 'data-type': f.type},
      el('div', {class: 'fxhead'}, el('span', {class: 'fxname', title: info.about}, info.name), sw), bar, el('div', {class: 'fxprerow'}, pre), body);
    cards.push({id: f.id, paint});
    return node;
  }

  function update(song){
    const tr = me(song), fx = tr.fx || [];
    const next = [mode, ...fx.map(f => f.id + f.type + (f.on ? 1 : 0))].join('|');
    if (next !== sig){
      sig = next; cards = [];
      list.replaceChildren(...fx.map((f, i) => card(f, i, fx.length, song)));
      if (!fx.length) list.append(el('p', {class: 'note fxnone'}, 'No effects on this track yet.'));
      if (refocus){
        const c = list.querySelector(`[data-fx="${refocus.id}"]`);
        const b = c && (refocus.act && c.querySelector(`[data-act="${refocus.act}"]:not(:disabled)`) || c.querySelector('.fxsw'));
        if (b) b.focus();
        if (c && !refocus.act) c.scrollIntoView({block: 'nearest'});
        refocus = null;
      }
    } else for (const c of cards){ const f = fx.find(x => x.id === c.id); if (f) c.paint.forEach(p => p(f)); }
    paintMenu();
  }
  update(store.get());
  return {update, dispose(){}};
}
