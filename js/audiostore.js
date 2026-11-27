/* js/audiostore.js: the samples of recorded loop takes, kept by clip id in this browser's IndexedDB (the song itself
 * only holds {id, bars, bpm, …}: store.js newClip). A .spores file carries them as audio/<id>.wav (js/ui/savefile.js).
 *
 *   putClip(id, {sr, data: Float32Array})  → Promise   (data is copied; the caller may transfer its own)
 *   getClip(id)                            → Promise<{sr, data} | null>
 *   peekClip(id)                           → {sr, data} | undefined   only if it is in memory already (no waiting)
 *   clipStoreIds()                         → Promise<[id]>
 *   gcClips(keep: Set<id>)                 → Promise<number deleted>
 *
 * Keeping takes: Undo / Redo can bring back any take still in the history, so nothing is deleted while the app runs.
 * gcClips runs once at start-up (main.js), when the history is empty: every take the autosaved song doesn't refer to
 * goes. A take is also kept in memory here (`mem`) from the moment it is put, so it plays before the write finishes.
 */
const DB = 'spores-audio', STORE = 'clips';
const mem = new Map();          // id → {sr, data}: recent takes, and every one read this session (small: ~1.5 MB / 8 bars)
let dbp = null;

function db(){
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
function tx(mode, f){
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), st = t.objectStore(STORE), out = f(st);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  }));
}

export async function putClip(id, {sr, data}){
  const copy = {sr, data: new Float32Array(data)};
  mem.set(id, copy);
  try { await tx('readwrite', st => st.put({sr, data: copy.data.buffer.slice(0)}, id)); }
  catch (e){ console.warn('audiostore: could not keep the take in this browser', e); throw e; }
}

export const peekClip = id => mem.get(id);

export async function getClip(id){
  if (mem.has(id)) return mem.get(id);
  try {
    const v = await tx('readonly', st => st.get(id));
    if (!v) return null;
    const c = {sr: v.sr, data: new Float32Array(v.data)};
    mem.set(id, c);
    return c;
  } catch (e){ console.warn('audiostore', e); return null; }
}

export const clipStoreIds = () => tx('readonly', st => st.getAllKeys()).catch(() => []);

export async function gcClips(keep){
  const ids = await clipStoreIds();
  const gone = ids.filter(id => !keep.has(id));
  if (gone.length) await tx('readwrite', st => { for (const id of gone) st.delete(id); }).catch(e => console.warn('audiostore gc', e));
  for (const id of [...mem.keys()]) if (!keep.has(id)) mem.delete(id);
  return gone.length;
}
