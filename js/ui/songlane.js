/* js/ui/songlane.js: the Song screen's lane for each song-length audio track (track.span 'song'): a strip under the
 * scene blocks that draws the take as a waveform where it plays (js/songmap.js + js/ui/songwave.js), and a card of
 * controls under it: ● Record from start / from the selected block (count-in "1 2 3 4", "Recording… bar N", Stop keeps
 * the take), Volume, Mute, Solo, and More (js/ui/songmore.js). Takes are kept with keepSongTake (one Undo step).
 * The input picker, level meter, Hear myself and latency are the shared ones in audioinput.js.
 *
 *   const lanes = songLanes({store, engine, blocksEl, stripsEl, cardsEl, getSel})
 *   lanes.sync(song)  after the blocks were drawn (and on any change) · lanes.playhead(m) · lanes.stopped()
 * The strip is as wide as the blocks' row (stripsEl is the same width as blocksEl), so x lines up with each card.
 */
import {el} from './dom.js';
import {songMap} from '../songmap.js';
import {isSongTrack, isMuted, isSolo, anySolo, setQuiet} from '../store.js';
import {keepSongTake} from '../takes.js';
import {trackColour} from './trackcolor.js';
import {peaksFor, missing} from './peaks.js';
import {inputControls} from './audioinput.js';
import {moreControls} from './songmore.js';
import {geometry, xOfBar, drawTake} from './songwave.js';

export function songLanes({store, engine, blocksEl, stripsEl, cardsEl, getSel}){
  let lanes = [], ids = '', cur = null, raf = 0, lastStep = null, last = null;   // cur: the recording in progress {trackId, phase, …}
  const cards = () => [...blocksEl.querySelectorAll('.sblk')];

  engine.on('rec', m => {
    if (!cur) return;
    if (m.state === 'count-in' && m.kind === 'song'){
      Object.assign(cur, {phase: 'count', countPerf: engine.toPerf(m.countTime), startPerf: engine.toPerf(m.startTime), startBar: m.startBar | 0});
    } else if (m.state === 'recording') cur.phase = 'rec';
    else if (m.state === 'done' || m.state === 'cancelled') cur.phase = 'idle';
    paintAll();
  });
  engine.on('stop', () => { if (cur && cur.phase !== 'idle'){ cur.phase = 'idle'; paintAll(); } });

  function build(s){
    lanes.forEach(L => { L.offs.forEach(f => f()); L.strip.remove(); L.card.remove(); });
    lanes = [];
    for (const t of s.tracks.filter(isSongTrack)) lanes.push(makeLane(t));
    ids = s.tracks.filter(isSongTrack).map(t => t.id).join(',');
    for (const L of lanes){ stripsEl.append(L.strip); cardsEl.append(L.card); }
  }

  function makeLane(t){
    const id = t.id, offs = [];
    const track = () => store.get().tracks.find(x => x.id === id) || t;
    const mapOf = () => songMap(store.get());
    /* the strip */
    const band = el('div', {class: 'sbands', 'aria-hidden': 'true'}), canvas = el('canvas', {class: 'wave', 'aria-hidden': 'true'});
    const msg = el('div', {class: 'lanemsg'}), phead = el('div', {class: 'sphead', 'aria-hidden': 'true', hidden: true});
    const label = el('span', {class: 'slabel'});
    const strip = el('div', {class: 'sstrip', 'data-track': id}, band, canvas, label, msg, phead);
    /* the card */
    const inp = inputControls(engine, offs);
    const big = el('button', {class: 'tb bigrec', 'aria-label': 'Record from the start of the song', onclick: () => go(0)}, '● Record from start');
    const fromSel = el('button', {class: 'tb bigrec', onclick: () => go(getSel())}, '● Record from selected block');
    const stop = el('button', {class: 'tb bigrec on', 'aria-label': 'Stop recording', onclick: () => engine.stopRecording()}, '■ Stop');
    const counts = [1, 2, 3, 4].map(n => el('span', {class: 'cnt'}, String(n)));
    const countEl = el('div', {class: 'counts', 'aria-hidden': 'true'}, ...counts);
    const line = el('p', {class: 'recline num', role: 'status', 'aria-live': 'polite'});
    const vol = el('input', {type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': 'Volume'}), vval = el('span', {class: 'pval num'});
    vol.addEventListener('input', () => { vval.textContent = Math.round(+vol.value * 100) + '%'; store.edit('Volume', s => { const x = s.tracks.find(y => y.id === id); if (x) x.vol = +vol.value; }, `${id}:volume`); });
    // a song-length take plays across every scene: its M / S set or clear it in all of them (the Steps screen's are per scene)
    const mute = el('button', {class: 'mute', title: 'Mute this track in every scene', onclick: () => store.edit('Mute', s => setQuiet(s, null, id, 'mute'))}, el('span', {class: 'mbox'}, 'M'));
    const solo = el('button', {class: 'mute solo', title: 'Solo in every scene: hear only this track (and other soloed ones)', onclick: () => store.edit('Solo', s => setQuiet(s, null, id, 'solo'))}, el('span', {class: 'mbox'}, 'S'));
    const moreBtn = el('button', {class: 'tb', 'aria-expanded': 'false', onclick: () => { moreEl.hidden = !moreEl.hidden; moreBtn.setAttribute('aria-expanded', String(!moreEl.hidden)); moreBtn.textContent = moreEl.hidden ? 'More ▾' : 'Less ▴'; if (last) paintAll(); }}, 'More ▾');
    const mc = moreControls({store, engine, id, offs, inp, mapOf});
    const moreEl = el('div', {class: 'slane-more', hidden: true}, ...mc.nodes);
    const name = el('span', {class: 'slane-name'});
    const card = el('div', {class: 'slane', 'data-track': id},
      el('div', {class: 'slane-head'}, name, big, fromSel, stop),
      countEl, line, inp.err,
      el('div', {class: 'prow slane-vol'}, el('span', {class: 'plabel'}, 'Volume'), vol, vval, mute, solo, moreBtn),
      moreEl);
    const L = {id, offs, strip, card, canvas, msg, phead, band, label, name, big, fromSel, stop, counts, countEl, line, vol, vval, mute, solo, mc, moreEl, inp, sig: '', track};

    async function go(fromBlock){
      if (cur && cur.phase !== 'idle') return;
      inp.showErr('');
      if (!await inp.ensureOpen()) return;
      cur = {trackId: id, phase: 'start', fromBlock, startBar: mapOf().blocks[fromBlock] ? mapOf().blocks[fromBlock].startBar : 0};
      const opened = !moreEl.hidden;
      paintAll();
      try { await engine.recordSong({track: id, fromBlock, onTake: take => keepSongTake(store, take)}); }
      catch (e){ inp.showErr(e && e.message || 'Recording didn’t start.'); }
      cur = null; paintAll();
      if (!opened && !engine.recording && engine.input.open) engine.closeInput();   // no recording dot in the tab once the take is in
    }
    return L;
  }

  function paintLane(L, s){
    const t = s.tracks.find(x => x.id === L.id); if (!t) return;
    const map = songMap(s), take = t.take, mine = cur && cur.trackId === L.id && cur.phase !== 'idle', busy = cur && cur.phase !== 'idle';
    const c = trackColour(t);
    L.strip.style.setProperty('--rowc', c);
    L.name.textContent = t.name; L.label.textContent = t.name;
    // M / S lit when on in every scene (they set all scenes); the card dims when it is soloed out everywhere
    const ks = Object.keys(s.scenes), tMute = ks.every(k => isMuted(s, k, t.id)), tSolo = ks.every(k => isSolo(s, k, t.id));
    L.card.classList.toggle('quiet', ks.every(k => anySolo(s, k) && !isSolo(s, k, t.id)));
    /* the strip: a band per block, the take on a canvas */
    const w = stripsEl.clientWidth, h = L.strip.clientHeight;
    const geom = geometry(map, cards());
    const pk = take ? peaksFor(take.id, () => paintAll()) : null;
    const key = [take ? [take.id, take.startBar, take.gain, take.trimStart, take.trimEnd, take.bpm].join(',') : '', !!pk, mine, w, h, devicePixelRatio, c, geom.map(g => g.left + ':' + g.width).join(',')].join('|');
    const txt = mine ? (cur.phase === 'rec' ? '' : cur.phase === 'count' ? 'Counting in…' : 'Starting…')
      : !map.blocks.length ? 'The song is empty' : !take ? 'No take yet · press Record'
      : pk ? '' : missing(take.id) ? 'This take’s sound isn’t on this computer' : 'Loading…';
    L.msg.textContent = txt; L.msg.hidden = !txt;
    L.strip.classList.toggle('empty', !take || mine);
    if (key !== L.sig){
      L.sig = key;
      L.band.replaceChildren(...geom.map(g => el('i', {class: 'sband', style: {left: g.left + 'px', width: g.width + 'px'}})));
      if (w) drawTake(L.canvas, {w, h, map, geom, take: mine ? null : take, pk, colour: getComputedStyle(L.strip).color});
    }
    /* the card */
    const sel = getSel(), has = sel != null && map.blocks[sel];
    L.big.hidden = L.fromSel.hidden = !!busy; L.stop.hidden = !busy || !mine;
    L.big.disabled = L.fromSel.disabled = !map.blocks.length;
    if (!has){ L.fromSel.disabled = true; L.fromSel.textContent = '● Record from selected block'; L.fromSel.title = 'Tap a scene block above to choose where to start'; }
    else { L.fromSel.textContent = `● Record from block ${sel + 1}`; L.fromSel.title = `Start recording at the first bar of block ${sel + 1}`; }
    L.big.title = 'Count in one bar, then record from the start of the song';
    const w2 = mine ? where() : null;
    L.countEl.hidden = !(w2 && w2.beat);
    L.counts.forEach((n, i) => n.classList.toggle('now', !!(w2 && w2.beat === i + 1)));
    L.line.textContent = w2 && w2.beat ? 'Count-in… get ready' : w2 && w2.bar ? `Recording… bar ${w2.bar}` : busy && !mine ? 'Another track is recording' : '';
    if (mine && w2 && w2.bar) { L.msg.textContent = `Recording… bar ${w2.bar}`; L.msg.hidden = false; }
    const v = t.vol ?? 0.8;
    L.vval.textContent = Math.round(v * 100) + '%'; if (document.activeElement !== L.vol) L.vol.value = v;
    L.mute.classList.toggle('on', tMute); L.mute.setAttribute('aria-pressed', tMute ? 'true' : 'false'); L.mute.setAttribute('aria-label', 'Mute ' + t.name);
    L.solo.classList.toggle('on', tSolo); L.solo.setAttribute('aria-pressed', tSolo ? 'true' : 'false'); L.solo.setAttribute('aria-label', 'Solo ' + t.name);
    if (!L.moreEl.hidden) L.mc.update(t);
    L.xOf = bar => xOfBar(map, geom, bar);
  }

  function where(now = performance.now()){
    if (!cur) return null;
    const barMs = 240000 / store.get().bpm;
    if (cur.phase === 'count'){
      const beat = (cur.startPerf - cur.countPerf) / 4 || barMs / 4;
      return {beat: Math.max(1, Math.min(4, Math.floor((now - cur.countPerf) / beat) + 1))};
    }
    if (cur.phase === 'rec') return {bar: cur.startBar + Math.max(0, Math.floor((now - cur.startPerf) / barMs)) + 1};
    return null;
  }

  function paintAll(){
    cancelAnimationFrame(raf);
    if (last) sync(last);
    if (cur && cur.phase !== 'idle' && (cur.phase === 'count' || cur.phase === 'rec')) raf = requestAnimationFrame(paintAll);
  }

  function sync(s){
    last = s;
    const now = s.tracks.filter(isSongTrack).map(t => t.id).join(',');
    if (now !== ids) build(s);
    stripsEl.hidden = cardsEl.hidden = !lanes.length;
    for (const L of lanes) paintLane(L, s);
  }

  new ResizeObserver(() => { if (last) sync(last); }).observe(stripsEl);

  return {
    sync: s => sync(s),
    /* a step was heard: song mode steps carry songStep (÷ 16 = the song bar): the line crosses every strip */
    playhead(m){
      lastStep = m.songStep;
      for (const L of lanes){
        if (m.songStep == null || !L.xOf){ L.phead.hidden = true; continue; }
        L.phead.hidden = false; L.phead.style.left = L.xOf(m.songStep / 16) + 'px';
      }
    },
    stopped(){ lastStep = null; for (const L of lanes) L.phead.hidden = true; },
  };
}
