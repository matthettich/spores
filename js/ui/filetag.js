/* js/ui/filetag.js: the quiet "Song name •" beside the app name in the header (both screens). The dot means there
 * are changes not saved to the file yet; with no file yet it only shows once the song has changed. Long names are
 * cut short so the header stays on one row. */
import {el} from './dom.js';
import {stripExt} from './filestate.js';

export function fileTag(files){
  const name = el('span', {class: 'fname-t'}), dot = el('span', {class: 'fdot', 'aria-hidden': 'true'}, '•');
  const root = el('span', {class: 'fname'}, name, dot);
  const paint = st => {
    const shown = st.name ? stripExt(st.name) : st.dirty ? 'Untitled' : '';
    name.textContent = shown;
    dot.hidden = !st.dirty;
    root.hidden = !shown;
    root.title = shown ? (st.dirty ? `${shown}: changes not saved yet (Save: Ctrl/Cmd+S)` : `${shown}: saved`) : '';
  };
  files.state.onChange(paint);
  paint(files.state);
  return root;
}
