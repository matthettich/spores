/* js/ui/song.js: the Song screen (phase 5). Blocks (scene, name, mini grid, × repeats, loop), drag to reorder,
 * + Add block, a song position bar, the scene library A–H. See docs/SPEC.md "Screens".
 * The engine already plays songs: engine.play('song', null, blockIndex); a block's `loop: true` repeats it forever.
 * Step messages carry {block, rep} for the position bar. */
export function mountSong(root, ctx){ return {playhead(){}, stopped(){}}; }
