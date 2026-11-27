/* js/takes.js: putting a recorded take into the song (the step between engine.record() and the screens).
 *
 *   keepTake(store, take)  the take's samples go to js/audiostore.js (memory at once, IndexedDB a moment later) and
 *                          scene.clips[take.trackId] points at it, as one store.edit ('Record take'), so Undo brings
 *                          the previous take back and Redo the new one. → the IndexedDB write's promise.
 *   clearTake(store, scene, trackId)   removes a scene's take for a track (Undo brings it back; the samples stay).
 */
import {newClip} from './store.js';
import {putClip} from './audiostore.js';

export function keepTake(store, take, label = 'Record take'){
  const saved = putClip(take.id, {sr: take.sr, data: take.data});
  store.edit(label, s => {
    const sc = s.scenes[take.scene], tr = s.tracks.find(t => t.id === take.trackId);
    if (!sc || !tr || tr.type !== 'audio') return;           // the scene or track went while recording: nothing to change
    sc.clips = sc.clips || {};
    sc.clips[take.trackId] = newClip(take);
  });
  return saved;
}

export function clearTake(store, scene, trackId){
  store.edit('Remove take', s => { const sc = s.scenes[scene]; if (sc && sc.clips) delete sc.clips[trackId]; });
}
