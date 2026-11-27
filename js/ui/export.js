/* js/ui/export.js: File › Export… — the song, a scene or stems as WAV files (48 kHz, 24-bit stereo).
 *
 * What: Song (the arrangement once, with the effects' tails), Scene (one scene × N), or Stems (one WAV per track that
 * makes a sound + the mix, in a .zip). The render is js/engine/render.js (offline, faster than real time, the same
 * sound as playing). Where it goes, asked first (inside the click, so the browser allows the picker):
 *   desktop app: the system Save dialog (window.sporesNative.out, desktop/files.js: .wav / .zip only), then
 *                "Show in Finder" (Explorer on Windows);
 *   Chrome / Edge: showSaveFilePicker; anything else: a download.
 * Nothing in the song changes, so there is nothing to undo.
 *
 *   openExport({store, files, scene})   scene = the scene on the Steps screen (the Scene choice starts there)
 */
import {renderAudio, SR} from '../engine/render.js';
import {wavBytes} from '../wav.js';
import {zipWrite} from '../zip.js';
import {stripExt} from './filestate.js';
import {openDialog, toast} from './dialog.js';
import {el} from './dom.js';

const MAC = /Mac/.test(navigator.platform || '');
const clean = n => String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
const sizeText = b => b > 1e6 ? (b / 1e6).toFixed(b > 1e8 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const errText = e => (e && e.message) || String(e || 'unknown problem');
let last = {what: 'song', repeats: 4};   // this page only

/* the render → the file's bytes. stems: "<name>/01 Kick.wav" … + "<name>/<name> mix.wav" in a zip */
export function exportFiles(r, base, what){
  if (what !== 'stems') return wavBytes(r.mix, r.sr, 24);
  const files = r.stems.map((s, k) => ({name: `${base}/${String(k + 1).padStart(2, '0')} ${clean(s.name) || 'Track'}.wav`, bytes: wavBytes(s.data, r.sr, 24)}));
  files.push({name: `${base}/${base} mix.wav`, bytes: wavBytes(r.mix, r.sr, 24)});
  return zipWrite(files);
}

// where the file goes: asked before the render. → {native: path} | {handle} | {download: name} | null (cancelled)
async function pickTarget(name, ext, near){
  const native = window.sporesNative && window.sporesNative.out;
  if (native){ const p = await native.pick(name, near || ''); return p ? {native: p, name: p.split(/[\\/]/).pop()} : null; }
  if (typeof window.showSaveFilePicker === 'function'){
    try {
      const h = await window.showSaveFilePicker({suggestedName: name, startIn: 'music',
        types: [ext === 'zip' ? {description: 'Zip of WAV files', accept: {'application/zip': ['.zip']}} : {description: 'WAV audio', accept: {'audio/wav': ['.wav']}}]});
      return {handle: h, name: h.name};
    } catch (e){
      if (e && e.name === 'AbortError') return null;
      if (e && e.name !== 'SecurityError' && e.name !== 'NotAllowedError') throw e;   // a picker that won't open here: download
    }
  }
  return {download: name, name};
}
async function writeTarget(t, bytes, ext){
  if (t.native){ const r = await window.sporesNative.out.write(t.native, bytes); if (!r || r.error) throw new Error(r ? r.error : 'not written'); return; }
  if (t.handle){ const w = await t.handle.createWritable(); try { await w.write(bytes); await w.close(); } catch (e){ try { await w.abort(); } catch (e2){} throw e; } return; }
  const url = URL.createObjectURL(new Blob([bytes], {type: ext === 'zip' ? 'application/zip' : 'audio/wav'}));
  const a = el('a', {href: url, download: t.download}); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function openExport({store, files, scene} = {}){
  const song = store.get(), keys = Object.keys(song.scenes || {});
  const st = files && files.state, base0 = clean(stripExt(st && st.name)) || 'Song';
  let what = last.what, sceneKey = keys.includes(scene) ? scene : keys[0], repeats = last.repeats, busy = false, cancel = false;
  if (!song.song || !song.song.length) what = what === 'stems' || what === 'song' ? 'scene' : what;

  const whatBtns = [['song', 'Song'], ['scene', 'Scene'], ['stems', 'Stems']].map(([k, label]) =>
    el('button', {class: 'tb', 'aria-pressed': 'false', onclick: () => { what = k; nameIn.value = defName(); paint(); }}, label));
  const sceneSel = el('select', {'aria-label': 'Scene'}, keys.map(k => el('option', {value: k}, `${k}${song.scenes[k].name ? ' · ' + song.scenes[k].name : ''}`)));
  sceneSel.value = sceneKey;
  sceneSel.addEventListener('change', () => { sceneKey = sceneSel.value; nameIn.value = defName(); });
  const repText = el('span', {class: 'pval'});
  const rep = d => { repeats = Math.max(1, Math.min(64, repeats + d)); paint(); };
  const sceneRow = el('div', {class: 'xprow'},
    el('span', {class: 'plabel'}, 'Scene'), sceneSel,
    el('div', {class: 'nudge'}, el('button', {class: 'tb', 'aria-label': 'Fewer times', onclick: () => rep(-1)}, '−'), repText,
      el('button', {class: 'tb', 'aria-label': 'More times', onclick: () => rep(1)}, '+')));
  const defName = () => what === 'scene' ? `${base0} - scene ${sceneKey}` : what === 'stems' ? `${base0} stems` : base0;
  const nameIn = el('input', {type: 'text', class: 'xpname', 'aria-label': 'File name', value: defName(), spellcheck: 'false'});
  const extText = el('span', {class: 'plabel'});
  const about = el('p', {class: 'note'});
  const bar = el('div', {class: 'xpbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100'}, el('div'));
  const status = el('p', {class: 'note', 'aria-live': 'polite'});
  const prog = el('div', {class: 'xpprog', hidden: true}, bar, status);
  const goBtn = el('button', {class: 'tb on', onclick: () => go()}, 'Export');
  const closeBtn = el('button', {class: 'tb', onclick: () => dlg.close()}, 'Close');
  const cancelBtn = el('button', {class: 'tb', hidden: true, onclick: () => { cancel = true; cancelBtn.disabled = true; status.textContent = 'Stopping…'; }}, 'Cancel');
  const showBtn = el('button', {class: 'tb', hidden: true}, MAC ? 'Show in Finder' : 'Show in folder');

  const ABOUT = {
    song: 'The whole song once, from the first block, with the effects ringing out at the end. A block set to loop for ever plays its repeats once.',
    scene: 'One scene, played the number of times you pick, with the effects ringing out at the end.',
    stems: 'One file for each track that makes a sound, plus the mix, in a .zip. MIDI, CV and muted tracks are left out; Solo is ignored.',
  };
  function paint(){
    whatBtns.forEach((b, i) => { const on = ['song', 'scene', 'stems'][i] === what; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      b.disabled = busy || (i !== 1 && !(song.song && song.song.length)); });
    sceneRow.hidden = what !== 'scene';
    repText.textContent = `× ${repeats}`;
    extText.textContent = what === 'stems' ? '.zip' : '.wav';
    about.textContent = ABOUT[what] + ' 48 kHz, 24-bit WAV.';
    [sceneSel, nameIn, ...sceneRow.querySelectorAll('button')].forEach(x => { x.disabled = busy; });
    goBtn.hidden = busy; cancelBtn.hidden = !busy; cancelBtn.disabled = cancel; closeBtn.disabled = busy;
  }
  const setProgress = x => { const p = Math.round(x * 100); bar.firstChild.style.width = p + '%'; bar.setAttribute('aria-valuenow', String(p)); status.textContent = `Exporting… ${p} %`; };

  async function go(){
    if (busy) return;
    last = {what, repeats};
    const ext = what === 'stems' ? 'zip' : 'wav', base = clean(nameIn.value) || defName(), name = `${base}.${ext}`;
    let target;
    try { target = await pickTarget(name, ext, st && st.path); }
    catch (e){ console.error(e); toast(`Couldn’t export: ${errText(e)}`); return; }
    if (!target) return;
    busy = true; cancel = false; showBtn.hidden = true; prog.hidden = false; setProgress(0); paint();
    try {
      const fileBase = clean(stripExt(target.name).replace(/\.(wav|zip)$/i, '')) || base;
      const r = await renderAudio(store.get(), {what, scene: sceneKey, repeats, onProgress: setProgress, cancelled: () => cancel});
      if (!r){ status.textContent = 'Stopped. Nothing was saved.'; return; }
      status.textContent = 'Writing the file…';
      await new Promise(res => setTimeout(res, 0));
      const bytes = exportFiles(r, fileBase, what);
      await writeTarget(target, bytes, ext);
      const secs = r.length / SR, len = secs >= 60 ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` : `${secs.toFixed(1)} s`;
      status.textContent = `Saved “${target.name}” (${len}, ${sizeText(bytes.length)})` + (target.download ? ' to your downloads.' : '.')
        + (r.missing.length ? ` ${r.missing.length} recorded take${r.missing.length > 1 ? 's were' : ' was'} missing and stayed silent.` : '')
        + (what === 'stems' ? ` ${r.stems.length} track${r.stems.length === 1 ? '' : 's'} + the mix.` : '');
      bar.firstChild.style.width = '100%';
      if (target.native){ showBtn.hidden = false; showBtn.onclick = () => window.sporesNative.out.show(target.native); }
      window.__lastExport = {name: target.name, bytes: bytes.length, length: r.length, end: r.end, stems: r.stems.length};   // (tests)
    } catch (e){
      console.error(e); status.textContent = `Couldn’t export: ${errText(e)}`;
    } finally { busy = false; paint(); }
  }

  const dlg = openDialog({title: 'Export', content: [
    el('div', {class: 'seg', role: 'group', 'aria-label': 'What to export'}, whatBtns),
    sceneRow, about,
    el('label', {class: 'xprow'}, el('span', {class: 'plabel'}, 'File name'), nameIn, extText),
    prog,
    el('div', {class: 'dacts'}, showBtn, closeBtn, cancelBtn, goBtn),
  ], focus: goBtn, onClose: () => { if (busy) cancel = true; }});
  dlg.root.classList.add('xpdlg');
  paint();
  return dlg;
}
