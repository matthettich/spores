/* js/ui/dialog.js: one small question with named answers, and a toast for quiet confirmations.
 * Nothing is deleted without asking (AGENTS.md): the buttons say what they do, never "OK" / "Cancel", and the safe
 * answer has the focus. Escape (or a click outside) means no.
 */
import {el} from './dom.js';

export function ask({title = '', body = '', yes = 'Yes', no = 'Keep it'} = {}){
  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); finish(false); } };
    const scrim = el('div', {class: 'scrim'},
      el('div', {class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title},
        el('h2', {class: 'dtitle'}, title),
        body ? el('p', {class: 'note'}, body) : null,
        el('div', {class: 'dacts'},
          el('button', {class: 'tb', onclick: () => finish(false)}, no),
          el('button', {class: 'tb on', onclick: () => finish(true)}, yes))));
    scrim.addEventListener('pointerdown', e => { if (e.target === scrim) finish(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    const first = scrim.querySelector('button');
    if (first) first.focus();
  });
}

export function toast(text){
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = el('div', {class: 'toast', role: 'status'}, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}
