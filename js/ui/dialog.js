/* js/ui/dialog.js: one dialog at a time, and a toast for quiet confirmations.
 *
 * Nothing is deleted without asking (AGENTS.md): the buttons say what they do, never "OK" / "Cancel", and the safe
 * answer has the focus. Escape (or a click outside) means no.
 *
 *   await ask({title, body, yes, no})                    → true / false
 *   openDialog({title, body, content, actions, focus})   → a form: its fields edit themselves, its buttons just close
 */
import {el} from './dom.js';

/* The shell every dialog uses: a scrim, a titled box, the content handed in, and the action buttons. Every button
   closes the dialog, then does its thing; Escape or a click outside closes it too (onClose says what that means). */
export function openDialog({title = '', body = '', content = [], actions = [], focus, onClose} = {}){
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    if (onClose) onClose();
  };
  const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); close(); } };
  const buttons = actions.map(a => el('button', {class: 'tb' + (a.primary ? ' on' : ''), onclick: () => { if (a.onClick) a.onClick(); close(); }}, a.label));
  const scrim = el('div', {class: 'scrim'},
    el('div', {class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title},
      el('h2', {class: 'dtitle'}, title),
      body ? el('p', {class: 'note'}, body) : null,
      content,
      el('div', {class: 'dacts'}, buttons)));
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  const first = focus || buttons[0];
  if (first) first.focus();
  return {root: scrim, close};
}

export function ask({title = '', body = '', yes = 'Yes', no = 'Keep it'} = {}){
  return new Promise(resolve => {
    let answer = false;
    openDialog({title, body,
      actions: [{label: no}, {label: yes, primary: true, onClick: () => { answer = true; }}],
      onClose: () => resolve(answer)});
  });
}

export function toast(text){
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = el('div', {class: 'toast', role: 'status'}, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}
