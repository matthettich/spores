/* js/ui/filestate.js: which file is the song, and has it changed since it was saved?
 *
 * "Current file" = {name, path (desktop app only)}; in Chrome the FileSystemFileHandle sits in IndexedDB so Save still
 * knows where to write after a reload. Dirty = the song's JSON differs from the song as last saved or opened, so
 * undoing back to the saved state is clean again. {name, path, hash} lives in localStorage (`spores.file`), so a
 * reload keeps the name and whether there are unsaved changes. The browser autosave (js/store.js) is separate: it is
 * crash recovery, not the save.
 */
export const FILE_KEY = 'spores.file';
export const stripExt = n => String(n || '').replace(/\.(spores|json)$/i, '');

// a quick 53-bit string hash (cyrb53): enough to tell two songs apart without keeping the whole text
export function hashOf(s){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++){
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// the file handle (Chrome only) is kept in IndexedDB: adapted from ...Thunder Plus (idbOpen)
const DB = 'spores-files', STORE = 'kv';
function idb(){
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e){ rej(e); }
  });
}
const idbPut = (k, v) => idb().then(db => new Promise((res, rej) => {
  const tx = db.transaction(STORE, 'readwrite');
  v == null ? tx.objectStore(STORE).delete(k) : tx.objectStore(STORE).put(v, k);
  tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error);
})).catch(() => {});
const idbGet = k => idb().then(db => new Promise(res => {
  const q = db.transaction(STORE).objectStore(STORE).get(k);
  q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
})).catch(() => null);

export function createFileState(store){
  const now = () => hashOf(JSON.stringify(store.get()));
  let info = null;
  try { const o = JSON.parse(localStorage.getItem(FILE_KEY)); if (o && typeof o.hash === 'string') info = {name: String(o.name || ''), path: String(o.path || ''), hash: o.hash}; }
  catch (e){}
  if (!info) info = {name: '', path: '', hash: now()};   // first run: the song as it is now counts as "nothing to save"
  let handle = null, dirty = now() !== info.hash, timer = 0;
  const handleReady = idbGet('handle').then(h => { if (info.name && !info.path) handle = h; });
  const subs = [];

  function persist(){ try { localStorage.setItem(FILE_KEY, JSON.stringify(info)); } catch (e){} }
  function fire(){
    persist();
    const t = dirty ? ' •' : '';
    document.title = info.name ? `${stripExt(info.name)}${t} — ...Spores` : dirty ? `Untitled${t} — ...Spores` : '...Spores';
    for (const f of subs.slice()){ try { f(api); } catch (e){ console.error(e); } }
  }
  function recompute(){
    clearTimeout(timer); timer = 0;
    const d = now() !== info.hash;
    if (d !== dirty){ dirty = d; fire(); }
  }
  store.subscribe(() => { clearTimeout(timer); timer = setTimeout(recompute, 150); });

  const api = {
    get name(){ return info.name; },
    get path(){ return info.path; },
    // answers straight away (not after the short delay), for closing the window and for Save
    get dirty(){ recompute(); return dirty; },
    async getHandle(){ await handleReady; return handle; },
    /* Remember a file as the song's file: it is saved as of `hash` (the song as it was written; default: as it is now).
       Pass {} / no name for "no file" (New song). */
    setFile({name = '', path = '', handle: h = null} = {}, hash){
      info = {name, path, hash: hash || now()};
      handle = h;
      idbPut('handle', h);
      dirty = now() !== info.hash;
      fire();
    },
    onChange(f){ subs.push(f); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; },
    hashOf,
    nowHash: now,
  };
  fire();
  return api;
}
