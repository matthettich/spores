/* tests/clipboard-check.mjs (dev only): right-click copy / paste of scenes and tracks (js/ui/clipboard.js) in headless Chrome.
 *   python3 -m http.server 8765 (in the repo), then: node tests/clipboard-check.mjs (puppeteer-core on your path; Chrome at /usr/bin/google-chrome)
 * Paste a scene over another (keeps its name) and as a new one, Undo; paste a track's steps / the whole track / as a new
 * track (new effect ids), Undo; Shift+F10 opens the menu, Escape closes it; the song still passes migrate(); no console errors. */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.setViewport({width: 1440, height: 900});
await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 500));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rclick = async el => { const r = await el.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2, {button: 'right'}); await sleep(150); };
const items = () => p.$$eval('.ctxmenu button', bs => bs.map(x => (x.disabled ? '(off) ' : '') + x.textContent));
const pick = async t => { await p.evaluate(t => [...document.querySelectorAll('.ctxmenu button')].find(x => x.textContent.startsWith(t)).click(), t); await sleep(200); };
const yes = async t => { await p.evaluate(t => [...document.querySelectorAll('.dialog button')].find(x => x.textContent.trim() === t).click(), t); await sleep(250); };
const S = () => p.evaluate(() => window.spores.store.get());
const scn = k => p.evaluateHandle(k => [...document.querySelectorAll('.scenewrap .scn')].find(x => x.textContent.trim() === k), k);
let ok = 0, bad = 0; const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); c ? ok++ : bad++; };

// scenes
await rclick(await scn('A')); console.log('scene menu:', (await items()).join(' | '));
await pick('Copy scene A');
await rclick(await scn('B')); console.log('on B:', (await items()).join(' | '));
let s0 = await S(); const bBefore = JSON.stringify(s0.scenes.B.steps), aSteps = JSON.stringify(s0.scenes.A.steps), bName = s0.scenes.B.name;
await pick('Paste scene A over B'); console.log('dialog:', await p.$eval('.dialog', d => d.textContent.slice(0, 90))); await yes('Replace it');
let s1 = await S(); check(JSON.stringify(s1.scenes.B.steps) === aSteps && s1.scenes.B.name === bName && s1.scenes.B.bars === s0.scenes.A.bars, 'paste over B: B has A\'s steps and bars, keeps its name "' + bName + '"');
await p.evaluate(() => window.spores.store.undo()); check(JSON.stringify((await S()).scenes.B.steps) === bBefore, 'Undo brings B back');
await rclick(await scn('B')); await pick('Paste as a new scene'); let s2 = await S(); check(s2.scenes.C && JSON.stringify(s2.scenes.C.steps) === aSteps && s2.scenes.C.name === 'Copy of Scene A', 'paste as a new scene: C = copy of A');
// keep editing a copy doesn't change the clipboard source: edit A, paste again -> old copy
// tracks
const rows = async () => p.$$('.track');
await rclick((await rows())[0]); console.log('track menu (nothing copied):', (await items()).join(' | '));
await pick('Copy Kick');
let t = await S(); const sc = t.scenes.A ? 'A' : Object.keys(t.scenes)[0];
const kickId = t.tracks[0].id, snareId = t.tracks[1].id, kickA = JSON.stringify(t.scenes.A.steps[kickId]);
await p.evaluate(() => [...document.querySelectorAll('.scenewrap .scn')].find(x => x.textContent.trim() === 'A').click()); await sleep(200);
await rclick((await rows())[1]); console.log('on Snare:', (await items()).join(' | '));
await pick('Paste steps into this scene'); await yes('Replace them');
let u = await S(); check(JSON.stringify(u.scenes.A.steps[snareId]) === kickA && u.tracks[1].sound === 'Snare', 'paste steps: Snare gets Kick\'s steps in scene A, keeps its sound');
await p.evaluate(() => window.spores.store.undo());
await rclick((await rows())[1]); await pick('Paste Kick over this track'); await yes('Replace it');
u = await S(); check(u.tracks[1].id === snareId && u.tracks[1].sound === 'Kick' && JSON.stringify(u.scenes.A.steps[snareId]) === kickA, 'paste over: track 2 becomes Kick (same place / id), steps in every scene');
await p.evaluate(() => window.spores.store.undo()); check((await S()).tracks[1].sound === 'Snare', 'Undo brings the Snare back');
// a track with an effect, pasted as a new track: effect ids are new
await p.evaluate(async () => { const {addFx} = await import('/js/fxedit.js'); const st = window.spores.store; addFx(st, st.get().tracks[0].id, 'reverb'); });
await rclick((await rows())[0]); await pick('Copy Kick');
await rclick((await rows())[3]); await pick('Paste as a new track');
let v = await S(); const nt = v.tracks[v.tracks.length - 1];
check(v.tracks.length === 9 && nt.sound === 'Kick' && nt.name === 'Kick 2' && nt.fx.length === 1 && nt.fx[0].id !== v.tracks[0].fx[0].id && JSON.stringify(v.scenes.A.steps[nt.id]) === kickA, 'paste as a new track: "Kick 2" at the end, its own effect id, same steps');
check((await p.$$('.track')).length === 9 && await p.$eval('.track.sel .tname', e => e.textContent) === 'Kick 2', 'the new track is drawn and selected');
// keyboard: Shift+F10 on a focused scene button
await p.evaluate(() => [...document.querySelectorAll('.scenewrap .scn')][0].focus()); await p.keyboard.down('Shift'); await p.keyboard.press('F10'); await p.keyboard.up('Shift'); await sleep(150);
check((await p.$$('.ctxmenu')).length === 1, 'Shift+F10 opens the menu'); await p.keyboard.press('Escape'); await sleep(100); check((await p.$$('.ctxmenu')).length === 0, 'Escape closes it');
await rclick((await rows())[2]); await p.screenshot({path: '/tmp/ctx.png', clip: {x: 0, y: 60, width: 700, height: 420}}); await p.keyboard.press('Escape');
// save / open: a song with a pasted track still opens clean
const mig = await p.evaluate(async () => { const {migrate} = await import('/js/store.js'); const s = window.spores.store.get(); const m = migrate(JSON.parse(JSON.stringify(s))); return m.tracks.length + ' tracks, fx ' + m.tracks.map(t => t.fx.length).join(''); });
check(mig.startsWith('9 tracks'), 'the song survives a save / open check: ' + mig);
check(!errs.length, 'no console errors ' + errs.join(' '));
console.log(bad ? bad + ' FAILED' : 'all ok');
await b.close();
