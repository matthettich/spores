/* js/ui/song.js: the Song screen (phase 5): blocks of scenes with repeats and loop, the song position bar and
 * the scene library A–H. Nothing is arranged per track: a block is just a scene, a repeat count and a loop flag.
 *
 * Every change goes through store.edit, so Undo, Redo and the autosave work here too. The engine plays the song
 * (engine.play('song')) and tells us on every step which block, repeat and step it is on, which moves the bar.
 */
import {SCENES, isSongTrack} from '../store.js';
import {songLanes} from './songlane.js';
import {STEPS_PER_BAR} from '../engine/engine.js';
import {noteColor} from '../scale.js';
import {el} from './dom.js';
import {ask, toast} from './dialog.js';
import {openHelp} from './help.js';
import {fileTag} from './filetag.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bars = sc => clamp((sc && sc.bars) | 0 || 1, 1, 4);
const sceneLen = sc => bars(sc) * STEPS_PER_BAR;
const repeatOf = b => clamp((b && b.repeat) | 0 || 1, 1, 64);

export function mountSong(root, {store, engine, files, openSteps}){
  let playing = false;
  let pos = {block: 0, rep: 0, counter: 0, live: false};
  let selBlock = null;                        // the block tapped as the place to record a song-length take from
  let dragFrom = null;                        // the block being dragged, while it is dragged

  /* ---- header: back to the steps, Play, Tempo ---- */
  const playBtn = el('button', {class: 'tb play', 'aria-label': 'Play or stop the song', onclick: () => togglePlay()}, '▶ Play');
  const bpm = el('input', {type: 'number', min: 20, max: 300, step: 1, 'aria-label': 'Tempo'});
  bpm.addEventListener('change', () => {
    store.edit('Tempo', s => { s.bpm = clamp(Math.round(+bpm.value) || 120, 20, 300); });
    bpm.value = store.get().bpm;   // a typed 999 or a blank shows the tempo that is really playing
  });
  const undoBtn = el('button', {class: 'tb quiet', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => store.undo()},
    el('span', {class: 'ico'}, '↶'), el('span', {class: 'lbl'}, 'Undo'));
  const redoBtn = el('button', {class: 'tb quiet', title: 'Redo (Shift+Ctrl+Z)', 'aria-label': 'Redo', onclick: () => store.redo()},
    el('span', {class: 'ico'}, '↷'), el('span', {class: 'lbl'}, 'Redo'));

  // the same left side as the Steps screen (js/ui/steps.js): name, Steps | Song, then Play and the tempo
  const header = el('header', {class: 'hdr'},
    el('span', {class: 'app-name'}, '...Spores'), fileTag(files),
    el('div', {class: 'seg', role: 'group', 'aria-label': 'Screen'},
      el('button', {class: 'tb', 'aria-pressed': 'false', title: 'Back to the steps', onclick: () => openSteps()}, 'Steps'),
      el('button', {class: 'tb on', 'aria-pressed': 'true', title: 'Arrange the scenes into a song'}, 'Song')),
    el('div', {class: 'hgroup'}, playBtn, el('label', {class: 'tempo'}, bpm, el('span', {class: 'cap'}, 'BPM'))),
    el('span', {class: 'hspace'}),
    el('div', {class: 'hgroup'}, undoBtn, redoBtn),
    el('button', {class: 'tb help', title: 'How Spores works', 'aria-label': 'Help', onclick: () => openHelp()}, '?'));

  /* ---- body: the blocks, the position bar, the scene library ---- */
  const blocksEl = el('div', {class: 'sblocks'});
  const posbar = el('div', {class: 'posbar', 'aria-hidden': 'true'});
  const posline = el('p', {class: 'posline'}, 'Not playing.');
  const addBtn = el('button', {class: 'tb', onclick: addBlock}, '+ Add scene');
  const libEl = el('div', {class: 'libgrid'});

  // blocks, then (one per song-length audio track) a strip lined up under them; it all scrolls sideways together
  const stripsEl = el('div', {class: 'sstrips'}), cardsEl = el('div', {class: 'scards'});
  const sinner = el('div', {class: 'sinner'}, blocksEl, stripsEl);
  cardsEl.append(el('div', {class: 'sline-h'}, el('span', {class: 'psec'}, 'Song-length audio')),
    el('p', {class: 'hint'}, 'Record once over the whole song. Tap a scene block above to record from it.'));
  const lanes = songLanes({store, engine, blocksEl, stripsEl, cardsEl, getSel: () => selBlock});

  const body = el('div', {class: 'songbody'},
    el('section', {class: 'ssection'},
      el('div', {class: 'sline-h'},
        el('span', {class: 'psec'}, 'Song'),
        addBtn),
      el('p', {class: 'hint'}, 'Scenes play in order, then the song starts again. Drag to reorder; Loop repeats one scene forever.'),
      el('div', {class: 'sarea'}, sinner),
      posbar,
      posline,
      cardsEl),
    el('section', {class: 'ssection'},
      el('div', {class: 'sline-h'},
        el('span', {class: 'psec'}, 'Scenes')),
      el('p', {class: 'hint'}, 'Add a scene to the end of the song, copy it, or give it a name.'),
      libEl));

  root.append(header, body);

  /* ---- actions ---- */
  function togglePlay(){
    if (engine.playing){ engine.stop(); return; }
    if (!blocks().length){ toast('Add a scene to the song first.'); return; }
    engine.play('song');
  }

  function addBlock(){
    const s = store.get();
    const first = SCENES.find(k => s.scenes[k]);
    if (!first) return;
    store.edit('Add block', song => { song.song.push({scene: first, repeat: 1, loop: false}); });
  }

  function addSceneBlock(k){
    store.edit('Add block', song => { song.song.push({scene: k, repeat: 1, loop: false}); });
    toast(`Scene ${k} added to the end of the song.`);
  }

  function copyScene(k){
    const s = store.get(), free = SCENES.find(x => !s.scenes[x]);
    if (!free) return;
    store.edit('Copy scene', song => {
      const src = song.scenes[k];
      song.scenes[free] = {name: `Copy of ${src.name || 'Scene ' + k}`, bars: src.bars || 1,
        steps: JSON.parse(JSON.stringify(src.steps || {})), clips: JSON.parse(JSON.stringify(src.clips || {}))};   // a copy, not a second name for the same notes
    });
    toast(`Copied scene ${k} into scene ${free}.`);
  }

  function moveBlock(from, to){
    const n = store.get().song.length;
    if (from == null || from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    store.edit('Reorder song', song => { const [b] = song.song.splice(from, 1); song.song.splice(to, 0, b); });
  }

  function setRepeat(i, v){
    const n = clamp(v, 1, 64);
    store.edit('Repeats', song => { if (song.song[i]) song.song[i].repeat = n; });
  }

  async function removeBlock(i, name){
    const ok = await ask({title: `Remove “${name}” from the song?`, body: 'The scene itself stays in the library.',
      yes: 'Remove it', no: 'Keep it'});
    if (!ok) return;
    store.edit('Remove block', song => { song.song.splice(i, 1); });
    toast(`Removed “${name}” from the song.`);
  }

  /* ---- drawing ---- */
  const blocks = (s = store.get()) => s.song.map((b, i) => ({b, i})).filter(({b}) => b && s.scenes[b.scene]);

  function miniGrid(s, sc){
    const wrap = el('div', {class: 'mini', 'aria-hidden': 'true'});
    const len = Math.min(STEPS_PER_BAR, sceneLen(sc));   // the first bar is enough to recognise a scene
    // eight rows at most; audio tracks always get theirs (they come last), the others share what is left
    const audio = s.tracks.filter(t => t.type === 'audio' && !isSongTrack(t));   // (song-length tracks have their own lane)
    for (const t of [...s.tracks.filter(t => t.type !== 'audio').slice(0, 8 - audio.length), ...audio]){
      const row = el('div', {class: 'miniro'});
      if (t.type === 'audio'){   // a teal bar the length of a bar when this scene has a take; a faint one when it has none
        const has = !!(sc.clips && sc.clips[t.id]);
        row.append(el('span', {class: 'minibar' + (has ? ' on' : ''), style: {width: (len * 9 - 2) + 'px'}}));
        wrap.append(row); continue;
      }
      const lane = (sc.steps && sc.steps[t.id]) || [];
      for (let i = 0; i < len; i++){
        const st = lane[i], on = !!(st && st.on);
        const bg = on ? (t.type === 'drum' ? 'var(--gate)' : noteColor(st.deg || 0, s.scale).top) : '';
        row.append(el('span', {class: 'minid' + (on ? ' on' : ''), style: on ? {background: bg} : null}));
      }
      wrap.append(row);
    }
    return wrap;
  }

  function blockCard(s, b, i){
    const sc = s.scenes[b.scene], rep = repeatOf(b);
    const pick = el('select', {class: 'sblk-pick', 'aria-label': 'Scene of this block'});
    for (const k of SCENES) if (s.scenes[k]) pick.append(el('option', {value: k}, k));
    pick.value = b.scene;
    pick.addEventListener('change', () => store.edit('Block scene', song => { if (song.song[i]) song.song[i].scene = pick.value; }));

    const card = el('div', {class: 'sblk', draggable: 'true'},
      el('div', {class: 'sblk-head'},
        pick,
        el('span', {class: 'sblk-name'}, sc.name || `Scene ${b.scene}`)),
      miniGrid(s, sc),
      el('div', {class: 'sblk-row'},
        el('div', {class: 'seg stepper'},
          el('button', {class: 'tb', 'aria-label': 'One repeat fewer', onclick: () => setRepeat(i, rep - 1)}, '−'),
          el('span', {class: 'sblk-rep num', title: 'How many times this scene plays'}, `× ${rep}`),
          el('button', {class: 'tb', 'aria-label': 'One repeat more', onclick: () => setRepeat(i, rep + 1)}, '+'))),
      el('div', {class: 'sblk-row'},
        el('button', {class: 'tb' + (b.loop ? ' on' : ''), title: 'Play this scene over and over', 'aria-pressed': b.loop ? 'true' : 'false',
          onclick: () => store.edit('Loop block', song => { if (song.song[i]) song.song[i].loop = !song.song[i].loop; })}, 'Loop'),
        el('button', {class: 'tb quiet', title: 'Remove from the song', 'aria-label': 'Remove block',
          onclick: () => removeBlock(i, sc.name || `Scene ${b.scene}`)}, '×')));

    card.addEventListener('click', e => {   // tap a block (not one of its buttons) to choose it as the place to record from
      if (e.target.closest('button, select, input')) return;
      const pos = [...blocksEl.children].indexOf(card);
      selBlock = selBlock === pos ? null : pos; sync();
    });
    // drag a block onto another one to put it there
    card.addEventListener('dragstart', e => {
      dragFrom = i;
      if (e.dataTransfer){ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }
      card.classList.add('drag');
    });
    card.addEventListener('dragend', () => { dragFrom = null; card.classList.remove('drag'); });
    card.addEventListener('dragover', e => { if (dragFrom != null && dragFrom !== i){ e.preventDefault(); card.classList.add('over'); } });
    card.addEventListener('dragleave', () => card.classList.remove('over'));
    card.addEventListener('drop', e => { e.preventDefault(); card.classList.remove('over'); moveBlock(dragFrom, i); });
    return card;
  }

  function drawBlocks(s){
    blocksEl.innerHTML = '';
    const list = blocks(s);
    if (!list.length){
      blocksEl.append(el('p', {class: 'note'}, 'The song is empty. Tap a scene below to add it to the end.'));
      return;
    }
    list.forEach(({b, i}) => blocksEl.append(blockCard(s, b, i)));
    if (selBlock != null && selBlock >= list.length) selBlock = null;
    if (selBlock != null) blocksEl.children[selBlock].classList.add('sel');
  }

  function drawLibrary(s){
    libEl.innerHTML = '';
    const free = SCENES.find(x => !s.scenes[x]);
    SCENES.filter(k => s.scenes[k]).forEach(k => {
      const sc = s.scenes[k];
      const on = (sc.steps && Object.values(sc.steps).flat().filter(st => st && st.on).length) || 0;
      const used = blocks(s).filter(({b}) => b.scene === k).length;
      const name = el('input', {class: 'libname', type: 'text', maxlength: '40',
        value: sc.name || `Scene ${k}`, 'aria-label': `Name of scene ${k}`});
      name.addEventListener('change', () => {
        const v = name.value.trim() || `Scene ${k}`;
        if (v === sc.name) return;
        store.edit('Scene name', song => { if (song.scenes[k]) song.scenes[k].name = v; });
      });
      libEl.append(el('div', {class: 'libcard'},
        el('div', {class: 'libcard-t'}, el('span', {class: 'libletter'}, k), name),
        el('p', {class: 'note'}, `${bars(sc)} bar${bars(sc) > 1 ? 's' : ''} · ${on} step${on === 1 ? '' : 's'} on`
          + (used ? ` · in the song ${used}×` : ' · not in the song')),
        el('div', {class: 'librow'},
          el('button', {class: 'tb', onclick: () => addSceneBlock(k)}, 'Add to song'),
          el('button', {class: 'tb', disabled: !free,
            title: free ? 'Put a copy of this scene in the next empty scene' : 'All eight scenes are in use',
            onclick: () => copyScene(k)}, 'Copy'))));
    });
  }

  function drawPosition(s){
    posbar.innerHTML = '';
    const list = blocks(s);
    const lens = list.map(({b}) => sceneLen(s.scenes[b.scene]) * repeatOf(b));
    const total = lens.reduce((a, b) => a + b, 0);
    addBtn.disabled = !SCENES.some(k => s.scenes[k]);
    if (!total){
      posbar.append(el('span', {class: 'posseg', style: {width: '100%'}}));
      posline.textContent = 'The song is empty.';
      return;
    }
    const liveBlock = pos.live ? list[pos.block] : null;
    list.forEach((_, i) => posbar.append(el('span', {class: 'posseg' + (liveBlock && pos.block === i ? ' on' : ''),
      style: {width: (lens[i] / total * 100) + '%'}})));
    if (!liveBlock){
      posline.textContent = engine.playing ? 'Playing…' : 'Not playing.';
      return;
    }
    const here = sceneLen(s.scenes[liveBlock.b.scene]);
    const before = lens.slice(0, pos.block).reduce((a, b) => a + b, 0);
    const step = Math.max(0, pos.rep) * here + clamp(pos.counter, 0, here);
    posbar.append(el('span', {class: 'posnow', style: {left: clamp(step / total * 100, 0, 100) + '%'}}));
    const reps = repeatOf(liveBlock.b);
    posline.textContent = `Playing scene ${pos.block + 1} of ${list.length} · `
      + (reps > 1 ? `repeat ${pos.rep + 1} of ${reps}` : 'no repeats')
      + ` · ${liveBlock.b.scene}`;
  }

  function sync(s = store.get()){
    if (document.activeElement !== bpm) bpm.value = s.bpm;
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
    drawBlocks(s);
    drawLibrary(s);
    drawPosition(s);
    lanes.sync(s);
  }

  store.subscribe(s => { if (!root.hidden) sync(s); });   // the Steps screen has nothing to do with these edits

  engine.on('start', () => {
    playing = true;
    playBtn.classList.add('on'); playBtn.textContent = '■ Stop'; playBtn.setAttribute('aria-pressed', 'true');
    if (!root.hidden) drawPosition(store.get());
  });
  engine.on('stop', () => {
    playing = false;
    playBtn.classList.remove('on'); playBtn.textContent = '▶ Play'; playBtn.setAttribute('aria-pressed', 'false');
    pos = {block: 0, rep: 0, counter: 0, live: false};
    if (!root.hidden) drawPosition(store.get());
  });

  sync();
  playBtn.setAttribute('aria-pressed', 'false');

  return {
    togglePlay,
    refresh(){ sync(); },
    /* the engine says a step was heard: {scene, block, rep, counter} — move the bar along the song */
    playhead(m){
      if (root.hidden || !playing) return;
      lanes.playhead(m);
      pos = {block: m.block | 0, rep: m.rep | 0, counter: m.counter | 0, live: true};
      drawPosition(store.get());
    },
    stopped(){ lanes.stopped(); },
  };
}
