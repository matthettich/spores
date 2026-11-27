// Which file paths the page may read or write through the desktop app. Ported from ...Thunder Plus (electron/path-allow.js).
// The page is untrusted, so main code only touches a path that
//   1. the person chose in a system dialog this session (Open, Save as…), or
//   2. an earlier run kept in <userData>/allowed-paths.txt (the last 64, written only by this app), so Open Recent keeps working.
// Anything else is refused with an error text. No Electron in here: files.js and the tests both load it.
'use strict';
const fs = require('fs'), path = require('path');
const MAX = 64;
const isSongFile = p => typeof p === 'string' && /\.(spores|json)$/i.test(p);

// createAllowList({ file, win32, fsImpl, max }): file is where the kept list lives ('' = memory only).
function createAllowList(o) {
  o = o || {};
  const F = o.fsImpl || fs, file = o.file || '', max = o.max || MAX;
  const win = o.win32 === undefined ? process.platform === 'win32' : !!o.win32;
  const P = win ? path.win32 : path;
  const norm = p => {                       // compare paths normalised (case-folded on Windows); '' for anything not an absolute path
    if (typeof p !== 'string' || !p || p.indexOf('\0') >= 0 || !P.isAbsolute(p)) return '';
    const n = P.normalize(p);
    return win ? n.toLowerCase() : n;
  };
  const session = new Set();                // picked this session
  let kept = [];                            // earlier runs, oldest first, [{key, p}]
  const load = () => {
    try { kept = String(F.readFileSync(file, 'utf8')).split(/\r?\n/).filter(Boolean).filter(p => norm(p)).slice(-max).map(p => ({ key: norm(p), p })); }
    catch (e) { kept = []; }
  };
  const save = () => { if (!file) return; try { F.mkdirSync(P.dirname(file), { recursive: true }); F.writeFileSync(file, kept.map(k => k.p).join('\n') + '\n', 'utf8'); } catch (e) { /* only costs Open Recent across runs */ } };
  const has = p => { const k = norm(p); return !!k && (session.has(k) || kept.some(x => x.key === k)); };
  if (file) load();
  return {
    norm,
    // call this for a path the person picked in a dialog; returns the path ('' if it isn't an absolute path)
    allow(p) {
      const k = norm(p); if (!k) return '';
      session.add(k);
      kept = kept.filter(x => x.key !== k); kept.push({ key: k, p }); if (kept.length > max) kept = kept.slice(-max);
      save(); return p;
    },
    has,
    list() { return kept.map(x => x.p); },   // oldest first
    // the check each file channel makes: null when fine, else the error text for the page
    check(p) {
      if (!isSongFile(p)) return 'not a Spores song file';
      if (!has(p)) return 'Spores only opens or saves files you chose in its own dialogs (use Open or Save as)';
      return null;
    }
  };
}

module.exports = { createAllowList, isSongFile, MAX };
