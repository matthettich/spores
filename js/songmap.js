/* js/songmap.js: song bars ↔ blocks, for song-length audio takes (the engine places them with it; the Song screen
 * draws their lane with it). A song bar counts from 0 at the first block's start, through every block and every one of
 * its repeats, in the order the blocks play. Pure functions on the song as stored (store.js), no engine needed.
 *
 *   songMap(song) → {blocks: [{index, scene, bars, repeat, loop, startBar, endBar}], totalBars, loopAt}
 *       bars = the scene's bars (1–4), endBar = startBar + bars × repeat. A Loop-forever block counts as its repeats
 *       here (that is where the lane draws it); when it plays, it goes on for ever and the song bar keeps counting up
 *       inside it, so a take plays on through to its own end. loopAt = index of the first Loop-forever block, or -1
 *       (blocks after it are never reached by playing from the start). Blocks whose scene is gone are left out, as the
 *       engine leaves them out. totalBars = where the song ends (it then starts again from bar 0).
 *   barToBlock(song, bar) → {index, rep, barInScene} | null    which block (and which repeat of it) a song bar is in
 *   blockToBar(song, index) → startBar of that block (0 for a bad index)
 *   takeBars(take) → the take's length in bars (its samples at its own bpm; the same at any song tempo: varispeed)
 *       take = {sr, bpm, n} where n = samples, or pass {sr, bpm, data}
 */
export function songMap(song){
  const scenes = song.scenes || {}, blocks = [];
  let bar = 0, loopAt = -1;
  (song.song || []).forEach(b => {
    const sc = scenes[b.scene]; if (!sc) return;
    const bars = Math.max(1, Math.min(4, sc.bars | 0 || 1)), repeat = Math.max(1, b.repeat | 0);
    const i = blocks.length;
    blocks.push({index: i, scene: b.scene, bars, repeat, loop: !!b.loop, startBar: bar, endBar: bar + bars * repeat});
    if (b.loop && loopAt < 0) loopAt = i;
    bar += bars * repeat;
  });
  return {blocks, totalBars: bar, loopAt};
}

export function barToBlock(song, bar){
  const m = songMap(song);
  for (const b of m.blocks) if (bar >= b.startBar && bar < b.endBar){
    const k = bar - b.startBar;
    return {index: b.index, rep: Math.floor(k / b.bars), barInScene: k % b.bars};
  }
  return null;
}

export function blockToBar(song, index){
  const b = songMap(song).blocks[index | 0];
  return b ? b.startBar : 0;
}

export function takeBars(take){
  const n = take.n ?? (take.data ? take.data.length : 0);
  return n / ((take.sr || 48000) * 240 / (take.bpm || 120));
}
