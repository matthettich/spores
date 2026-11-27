/* tests/note-preview-check.mjs (dev only; server on PORT (default 8765), puppeteer-core, CHROME): "Preview on click" (engine.hit is
   spied) when a step is added / a note changes, the File-menu setting, dragging a note step (one Undo), ↑ / ↓ and Shift = octave. */
import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
const p = await b.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
await p.setViewport({width: 1280, height: 900});
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
await p.goto(`http://localhost:${process.env.PORT || 8765}/`, {waitUntil: 'networkidle0'}); await sleep(400);
// spy: every engine.hit call is recorded (and still made)
await p.evaluate(() => { const e = window.spores.engine, h = e.hit.bind(e); window.hits = []; e.hit = (ti, deg, vel) => { window.hits.push({ti, deg, vel}); return h(ti, deg, vel); }; });
const hits = () => p.evaluate(() => window.hits.length), last = () => p.evaluate(() => window.hits[window.hits.length - 1]);
const song = () => p.evaluate(() => window.spores.store.get());
const bass = await p.evaluate(() => window.spores.store.get().tracks.findIndex(t => t.sound === 'Acid bass'));
const kick = await p.evaluate(() => window.spores.store.get().tracks.findIndex(t => t.type === 'drum'));
const step = async (ti, i) => { const t = (await song()).tracks[ti]; return ((await song()).scenes.A.steps[t.id] || [])[i]; };
const cellBox = async (ti, i) => { const h = await p.evaluateHandle((ti, i) => document.querySelectorAll('.srow')[ti].querySelectorAll('.cell')[i], ti, i); await h.evaluate(e => e.scrollIntoView({block: 'center', inline: 'center'})); const r = await h.boundingBox(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; };
const clickCell = async (ti, i) => { const c = await cellBox(ti, i); await p.mouse.click(c.x, c.y); await sleep(120); };
const depth = () => p.evaluate(() => window.spores.store.canUndo);
// pick a bass step that is off and a kick step that is off
const iB = 5, iK = 5;
await p.evaluate((ti, i) => { const s = window.spores.store; s.edit('x', d => { for (const k of Object.keys(d.scenes.A.steps)) { const l = d.scenes.A.steps[k]; if (l) l.forEach(x => x && (x.on = false)); } }); }, bass, 0);

// 1. preview on add
let n = await hits(); await clickCell(bass, iB);
ok((await step(bass, iB)).on && await hits() === n + 1, 'adding a synth step previews it once');
n = await hits(); await clickCell(kick, iK);
let l = await last();
ok(await hits() === n + 1 && l.ti === kick, 'adding a drum step previews that drum');
n = await hits(); await clickCell(kick, iK);
ok(!(await step(kick, iK)).on && await hits() === n, 'switching a step off plays nothing');

// 2. File menu setting, default on, stored on this computer; off = no preview
const menuItem = () => p.evaluate(() => { const m = [...document.querySelectorAll('.menu button')].find(x => /^Preview on click/.test(x.textContent.trim())); return m && m.getAttribute('aria-checked'); });
await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.offsetParent && x.textContent.trim() === 'File ▾').click()); await sleep(100);
ok(await menuItem() === 'true', 'File menu has "Preview on click", ticked by default');
await p.evaluate(() => [...document.querySelectorAll('.menu button')].find(x => /^Preview on click/.test(x.textContent.trim())).click()); await sleep(100);
ok(await menuItem() === 'false' && await p.evaluate(() => localStorage.getItem('spores.preview')) === '0', 'clicking it turns it off and stores that');
await p.keyboard.press('Escape'); await sleep(100);
n = await hits(); await clickCell(bass, 7);
ok((await step(bass, 7)).on && await hits() === n, 'setting off: adding a step plays nothing');
await p.evaluate(() => localStorage.removeItem('spores.preview'));   // back on (read at each click)

// 3. drag a note step up: pitch rises, preview as it goes, ONE undo
const d0 = (await step(bass, iB)).deg || 0;
const c = await cellBox(bass, iB);
n = await hits();
await p.mouse.move(c.x, c.y); await p.mouse.down();
for (let k = 1; k <= 5; k++){ await p.mouse.move(c.x, c.y - k * 14 - 2); await sleep(30); }
await sleep(700);   // a pause longer than the usual merge window
await p.mouse.move(c.x, c.y - 6 * 14 - 2); await sleep(30);
await p.mouse.up(); await sleep(150);
const d1 = (await step(bass, iB)).deg;
ok(d1 > d0 && d1 === d0 + 6, `drag up 6 steps raised the note ${d0} -> ${d1}`);
ok((await step(bass, iB)).on, 'a drag does not switch the step off');
ok(await hits() - n >= 5, `the drag previewed as it went (${await hits() - n} hits)`);
await p.evaluate(() => window.spores.store.undo()); await sleep(100);
ok((await step(bass, iB)).deg === d0 && (await step(bass, iB)).on, 'ONE undo puts the whole drag back');
// drag down
const c2 = await cellBox(bass, iB);
await p.mouse.move(c2.x, c2.y); await p.mouse.down(); await p.mouse.move(c2.x, c2.y + 30); await p.mouse.move(c2.x, c2.y + 3 * 14 + 2); await p.mouse.up(); await sleep(150);
ok((await step(bass, iB)).deg === d0 - 3, 'drag down lowers it');
await p.evaluate(() => window.spores.store.undo()); await sleep(100);

// 4. arrow keys on the selected step
await p.evaluate((ti, i) => document.querySelectorAll('.srow')[ti].querySelectorAll('.cell')[i].dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true})), bass, iB); await sleep(150);
const sel = (await step(bass, iB)).deg || 0, n7 = await p.evaluate(() => { const sc = window.spores.store.get().scale; return {major: 7, minor: 7, penta: 5, chromatic: 12}[sc] || 7; });
n = await hits(); await p.keyboard.press('ArrowUp'); await sleep(100);
ok((await step(bass, iB)).deg === sel + 1 && await hits() === n + 1, 'ArrowUp raises the selected note and previews it');
await p.keyboard.press('ArrowDown'); await sleep(100);
ok((await step(bass, iB)).deg === sel, 'ArrowDown lowers it');
await p.keyboard.down('Shift'); await p.keyboard.press('ArrowUp'); await p.keyboard.up('Shift'); await sleep(100);
ok((await step(bass, iB)).deg === sel + n7, `Shift+ArrowUp = one octave (${n7} scale steps)`);
await p.evaluate(() => window.spores.store.undo()); await sleep(100);
ok((await step(bass, iB)).deg === sel, 'each key press is its own Undo');
// not in a focused select / input
await p.evaluate(() => { const s = document.querySelector('select'); s.focus(); });
await p.keyboard.press('ArrowDown'); await sleep(100);
ok((await step(bass, iB)).deg === sel, 'arrows in a focused list do not move the note');
await p.evaluate(() => document.activeElement.blur());
// drum step selected: arrows do nothing
await clickCell(kick, iK);
await p.evaluate((ti, i) => document.querySelectorAll('.srow')[ti].querySelectorAll('.cell')[i].dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true})), kick, iK); await sleep(150);
const kd = (await step(kick, iK)).deg || 0; await p.keyboard.press('ArrowUp'); await sleep(100);
ok(((await step(kick, iK)).deg || 0) === kd, 'a drum step ignores the arrows');
ok(errs.length === 0, 'no page errors ' + errs.join('|'));
await b.close(); console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
