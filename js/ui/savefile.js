/* js/ui/savefile.js: Save, Save as…, Save a copy…, Open… and Open Recent (File menu + Ctrl/Cmd+S, Shift+S, O).
 *
 * A .spores file is a zip (js/zip.js) holding song.json and audio/<id>.wav for every loop take the song refers to
 * (32-bit float mono, js/wav.js; the samples come from js/audiostore.js, and Open puts them back there before the song
 * replaces the one on screen). Files without audio (older ones, or songs with no takes) open as before. Open also takes the old plain .json songs. Where it is written:
 *   desktop app: native dialogs and file writes through window.sporesNative.file (desktop/main.js; it only writes
 *                files the person picked or opened); Chrome / Edge: File System Access, the handle kept in
 *                IndexedDB (js/ui/filestate.js); anything else: a download (Save then behaves like Save a copy…).
 * Chrome's save and download fallback are adapted from ...Thunder Plus (pickOut / writeOut).
 * The current file and the unsaved dot live in filestate.js. Opening still asks first and goes through store.load,
 * so Undo brings the old song back.
 */
import {isSong, newSong, clipIds} from '../store.js';
import {zipWrite, zipRead, isZip} from '../zip.js';
import {wavBytes, wavRead} from '../wav.js';
import {getClip, putClip, peekClip} from '../audiostore.js';
import {createFileState, stripExt} from './filestate.js';
import {ask, toast} from './dialog.js';
import {el} from './dom.js';

const NOT_SONG = 'That file isn’t a Spores song.';
const TYPES_SAVE = [{description: 'Spores song', accept: {'application/zip': ['.spores']}}];
const TYPES_OPEN = [{description: 'Spores song', accept: {'application/zip': ['.spores'], 'application/json': ['.json']}}];
const enc = new TextEncoder(), dec = new TextDecoder();
const today = () => new Date().toISOString().slice(0, 10);
const errText = e => (e && e.message) || String(e || 'unknown problem');

export function createSaveFile({store}){
  const native = window.sporesNative && window.sporesNative.file || null;
  const st = createFileState(store);
  let busy = false;

  // the song as file bytes, with the hash of exactly what was written (the song may change while a dialog is open)
  // (takes already in memory are written straight away, so Save a copy can still download inside the click)
  function buildWith(clips, json, hash){
    const files = [{name: 'song.json', bytes: enc.encode(json)}];
    for (const [id, c] of clips){
      if (c) files.push({name: `audio/${id}.wav`, bytes: wavBytes(c.data, c.sr)});
      else console.warn('Save: no samples for take', id);   // (a file opened without its audio): the song still saves
    }
    return {bytes: zipWrite(files), hash};
  }
  function buildNow(){
    const json = store.serialize(), ids = [...clipIds(JSON.parse(json))], clips = ids.map(id => [id, peekClip(id)]);
    return clips.every(([, c]) => c) ? buildWith(clips, json, st.nowHash()) : null;
  }
  async function build(){
    const json = store.serialize(), hash = st.nowHash(), ids = [...clipIds(JSON.parse(json))];
    const clips = []; for (const id of ids) clips.push([id, await getClip(id)]);
    return buildWith(clips, json, hash);
  }
  // → {data: song, audio: [{id, bytes}]} or null
  function parse(bytes){
    try {
      let text, audio = [];
      if (isZip(bytes)){
        const all = zipRead(bytes), f = all.find(x => x.name === 'song.json');
        if (!f) return null;
        text = dec.decode(f.bytes);
        for (const x of all){ const m = /^audio\/([\w-]{1,64})\.wav$/.exec(x.name); if (m) audio.push({id: m[1], bytes: x.bytes}); }
      } else text = dec.decode(bytes);
      const d = JSON.parse(text);
      return isSong(d) ? {data: d, audio} : null;
    } catch (e){ return null; }
  }
  // the file's takes into this browser's audio store, before the song that plays them is loaded
  async function keepAudio(audio){
    let bad = 0;
    for (const a of audio){
      try { const w = wavRead(a.bytes); await putClip(a.id, w).catch(() => {}); }
      catch (e){ bad++; console.warn('Open: unreadable take', a.id, e); }
    }
    if (bad) toast(`${bad} recorded take${bad > 1 ? 's' : ''} in that file couldn’t be read, so ${bad > 1 ? 'they' : 'it'} will be silent.`);
  }
  const baseName = () => stripExt(st.name) || 'Song';
  const fileName = () => baseName() + '.spores';

  function download(name, bytes){
    const url = URL.createObjectURL(new Blob([bytes], {type: 'application/zip'}));
    const a = el('a', {href: url, download: name});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function writeHandle(h){
    const {bytes, hash} = await build();
    const w = await h.createWritable();
    try { await w.write(bytes); await w.close(); } catch (e){ try { await w.abort(); } catch (e2){} throw e; }
    st.setFile({name: h.name, handle: h}, hash);
    toast(`Saved “${h.name}”.`);
    return true;
  }
  async function writeNative(path, asNew, near){
    const {bytes, hash} = await build();
    const r = asNew ? await native.saveAs(fileName(), bytes, near || '') : await native.save(path, bytes);
    if (!r) return false;                                         // the dialog was cancelled
    if (r.error){ toast(`Couldn’t save: ${r.error}`); return false; }
    st.setFile({name: r.name, path: r.path}, hash);
    toast(`Saved “${r.name}”.`);
    return true;
  }

  /* Returns true if the song was written (the desktop app's close prompt waits on it). */
  async function saveAs(){
    if (busy) return false;
    busy = true;
    try {
      if (native) return await writeNative('', true, st.path);
      if (typeof window.showSaveFilePicker === 'function'){
        let h;
        try { h = await window.showSaveFilePicker({suggestedName: fileName(), types: TYPES_SAVE, startIn: 'documents'}); }
        catch (e){
          if (e && e.name === 'AbortError') return false;
          if (e && e.name !== 'SecurityError' && e.name !== 'NotAllowedError') throw e;   // a picker that won't open here: download
          h = null;
        }
        if (h) return await writeHandle(h);
      }
      const {bytes, hash} = await build(), name = fileName();
      download(name, bytes);
      st.setFile({name}, hash);
      toast(`Saved “${name}” to your downloads.`);
      return true;
    } catch (e){
      console.error(e);
      toast(`Couldn’t save: ${errText(e)}`);
      return false;
    } finally { busy = false; }
  }

  async function save(){
    if (busy) return false;
    try {
      if (native){
        if (!st.path) return await saveAs();
        busy = true;
        try { return await writeNative(st.path, false); } finally { busy = false; }
      }
      const h = await st.getHandle();
      if (!h) return await saveAs();                              // first time (or no file access): ask where
      // after a reload the browser wants the OK again for the same file; this runs inside the click / key press
      let ok = (await h.queryPermission({mode: 'readwrite'})) === 'granted';
      if (!ok) ok = (await h.requestPermission({mode: 'readwrite'})) === 'granted';
      if (!ok) return await saveAs();
      busy = true;
      try { return await writeHandle(h); } finally { busy = false; }
    } catch (e){
      busy = false;
      console.error(e);
      toast(`Couldn’t save “${st.name}”: ${errText(e)} Try Save as…`);
      return false;
    }
  }

  // a copy goes to the downloads (the desktop app shows its own Save box for it); the song's file and dot stay as they are
  async function saveCopy(){
    const name = st.name ? `${baseName()} copy.spores` : `spores-${today()}.spores`;
    try { const now = buildNow(); download(name, (now || await build()).bytes); }
    catch (e){ console.error(e); toast(`Couldn’t save a copy: ${errText(e)}`); return; }
    toast(`Saved a copy, “${name}”, to your downloads.`);
  }

  function pickByInput(){
    return new Promise(resolve => {
      const input = el('input', {type: 'file', accept: '.spores,.json,application/zip,application/json', style: {display: 'none'}});
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        input.remove();
        resolve(f ? {name: f.name, bytes: new Uint8Array(await f.arrayBuffer())} : null);
      });
      input.addEventListener('cancel', () => { input.remove(); resolve(null); });
      document.body.append(input);
      input.click();
    });
  }

  // got: {name, bytes, path?, handle?} from any of the three places. Asks before replacing the song on screen.
  async function openLoaded(got){
    if (!got) return false;
    if (got.error){ toast(`Couldn’t open that file: ${got.error}`); return false; }
    const parsed = parse(got.bytes);
    if (!parsed){ toast(NOT_SONG); return false; }
    const data = parsed.data;
    const ok = await ask({title: 'Open this song?',
      body: `“${got.name}” replaces the song on screen. Undo brings the old one back.`, yes: 'Open it', no: 'Keep this song'});
    if (!ok) return false;
    await keepAudio(parsed.audio);
    if (!store.load(data)){ toast(NOT_SONG); return false; }
    // an old .json song is saved on as a new .spores file (Save asks where), so the old file is never overwritten
    if (/\.json$/i.test(got.name)) st.setFile({name: stripExt(got.name) + '.spores'});
    else st.setFile({name: got.name, path: got.path || '', handle: got.handle || null});
    toast(`Opened “${got.name}”.`);
    return true;
  }

  async function open(){
    if (busy) return false;
    try {
      if (native) return await openLoaded(await native.open(st.path));
      if (typeof window.showOpenFilePicker === 'function'){
        let h;
        try { [h] = await window.showOpenFilePicker({types: TYPES_OPEN, startIn: 'documents'}); }
        catch (e){ if (e && e.name === 'AbortError') return false; throw e; }
        const f = await h.getFile();
        return await openLoaded({name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), handle: h});
      }
      return await openLoaded(await pickByInput());
    } catch (e){ console.error(e); toast(`Couldn’t open that file: ${errText(e)}`); return false; }
  }

  // desktop: one of the recent files (File › Open Recent)
  async function openPath(path){
    if (!native) return false;
    try { return await openLoaded(await native.read(path)); }
    catch (e){ console.error(e); toast(`Couldn’t open that file: ${errText(e)}`); return false; }
  }

  // New song: asks, then forgets the current file (the new song counts as nothing to save)
  async function startNew(){
    const yes = await ask({title: 'Start a new song?', body: 'The song on screen is replaced. Undo brings it back.',
      yes: 'Start fresh', no: 'Keep this song'});
    if (!yes) return;
    store.replace(newSong(), 'new song');
    st.setFile({});
    toast('New song. Undo brings the old one back.');
  }

  // the desktop app closes the window only after asking; it hears about unsaved changes here
  if (native && native.dirty){ st.onChange(s => native.dirty(s.dirty, s.name)); native.dirty(st.dirty, st.name); }
  // Chrome / Edge: warn before the tab closes with unsaved changes (the desktop app asks in its own way)
  if (!native) window.addEventListener('beforeunload', e => { if (st.dirty){ e.preventDefault(); e.returnValue = ''; } });

  return {state: st, save, saveAs, saveCopy, open, openPath, startNew,
    hasRecent: !!(native && native.recent), recent: () => native && native.recent ? native.recent() : Promise.resolve([])};
}

/* Ctrl/Cmd+S saves, +Shift saves as, +O opens: anywhere except while typing in a text field (the keys are still kept
   from the browser's own Save page / Open file). Not while a dialog is open. */
export function bindFileKeys(files){
  const NOT_TYPING = new Set(['range', 'checkbox', 'button', 'radio']);
  window.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 's' && k !== 'o') return;
    e.preventDefault();
    if (e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && !NOT_TYPING.has(t.type)))) return;
    if (document.querySelector('.scrim')) return;
    if (k === 'o') files.open();
    else if (e.shiftKey) files.saveAs();
    else files.save();
  });
}
