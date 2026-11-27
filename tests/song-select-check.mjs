/* tests/song-select-check.mjs (dev only; PORT env, default 8765; puppeteer-core): Song screen multi-select, Copy / Paste (insert, replace), Duplicate, one Undo each, Escape. */
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT || 8765, wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.setViewport({width: 1600, height: 900}); await p.goto(`http://localhost:${PORT}/`, {waitUntil: 'networkidle0'}); await wait(400);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Song').click()); await wait(300);
const song = () => p.evaluate(() => window.spores.store.get().song.map(b => b.scene + b.repeat).join(' '));
const setup = async () => { await p.evaluate(() => { const s = window.spores.store; s.edit('t', x => { x.scenes.B = JSON.parse(JSON.stringify(x.scenes.A)); x.scenes.C = JSON.parse(JSON.stringify(x.scenes.A)); x.song = ['A', 'B', 'C', 'A', 'B'].map((k, i) => ({scene: k, repeat: i + 1, loop: false})); }); }); await wait(200); };
const card = i => p.evaluate(i => { const c = document.querySelectorAll('.sblocks .sblk')[i].getBoundingClientRect(); return {l: c.left, w: c.width, y: c.top + 6}; }, i);
const click = async (i, f, shift) => { const c = await card(i); if (shift) await p.keyboard.down('Shift'); await p.mouse.click(c.l + c.w * f, c.y); if (shift) await p.keyboard.up('Shift'); await wait(150); };
const multi = () => p.evaluate(() => [...document.querySelectorAll('.sblocks .sblk')].map((c, i) => c.classList.contains('multi') || c.classList.contains('sel') ? i : -1).filter(i => i >= 0).join(','));
const menu = async (i, label) => { const c = await card(i); await p.mouse.click(c.l + c.w / 2, c.y, {button: 'right'}); await wait(150);
  const r = await p.evaluate(l => { const m = [...document.querySelectorAll('.ctxmenu button')].find(x => x.textContent.startsWith(l)); if (!m) return null; const d = m.disabled; if (!d) m.click(); return d ? 'disabled:' + m.title : 'clicked'; }, label); await wait(150); return r; };
const undo = async () => { await p.evaluate(() => window.spores.store.undo()); await wait(150); };
await setup(); ok(await song() === 'A1 B2 C3 A4 B5', 'setup: 5 blocks');
await click(1, .5); ok(await multi() === '1', 'plain click picks one');
await click(3, .5, true); ok(await multi() === '1,2,3', 'Shift-click picks the run 1..3');
await click(0, .5, true); ok(await multi() === '0,1', 'Shift from the anchor (1) back to 0 picks 0..1');
await click(4, .5); ok(await multi() === '4', 'plain click again collapses to one');
// duplicate
await click(1, .5); await click(2, .5, true);
ok(await menu(2, 'Duplicate') === 'clicked' && await song() === 'A1 B2 C3 B2 C3 A4 B5', 'Duplicate B,C inserts a copy right after');
await undo(); ok(await song() === 'A1 B2 C3 A4 B5', 'one Undo undoes the duplicate');
// copy + paste-insert
await click(1, .5); await click(2, .5, true);
ok(await menu(1, 'Copy') === 'clicked', 'Copy');
ok((await menu(4, 'Paste')) === 'clicked', 'Paste… arms a paste');
ok(await p.evaluate(() => !document.querySelector('.pastebar').hidden), 'paste bar shows');
const c3 = await card(3); await p.mouse.move(c3.l + 5, c3.y); await wait(100);
ok(await p.evaluate(() => !!document.querySelector('.sblk.ins-before')), 'insertion marker shows over a gap');
await p.mouse.click(c3.l + 5, c3.y); await wait(200);
ok(await song() === 'A1 B2 C3 B2 C3 A4 B5', 'paste-insert before block 3');
ok(await p.evaluate(() => document.querySelector('.pastebar').hidden), 'paste bar gone');
await undo(); ok(await song() === 'A1 B2 C3 A4 B5', 'one Undo undoes the insert');
// paste-replace (clip kept): click the middle of block 4 (not part of a selection)
await click(0, .5); await menu(0, 'Paste');
const c4 = await card(4); await p.mouse.click(c4.l + c4.w / 2, c4.y); await wait(200);
ok(await song() === 'A1 B2 C3 A4 B2 C3', 'paste-replace swaps block 5 for the copy');
await undo(); ok(await song() === 'A1 B2 C3 A4 B5', 'one Undo undoes the replace');
// replace the whole selection when clicking inside it
await click(0, .5); await click(1, .5, true); await menu(0, 'Paste');
const c1 = await card(1); await p.mouse.click(c1.l + c1.w / 2, c1.y); await wait(200);
ok(await song() === 'B2 C3 C3 A4 B5', 'replace over a 2-block pick');
await undo();
// Escape
await click(0, .5); await menu(0, 'Paste'); await p.keyboard.press('Escape'); await wait(100);
ok(await p.evaluate(() => document.querySelector('.pastebar').hidden), 'Escape cancels a waiting paste');
const c2 = await card(2); await p.mouse.click(c2.l + 4, c2.y); await wait(150); ok(await song() === 'A1 B2 C3 A4 B5', 'a click after Escape pastes nothing');
// limit
await p.evaluate(() => window.spores.store.edit('t', x => { x.song = Array.from({length: 127}, () => ({scene: 'A', repeat: 1, loop: false})); })); await wait(200);
await click(0, .5); await click(1, .5, true);
const r = await menu(0, 'Duplicate'); ok(/^disabled:.*128/.test(r), 'Duplicate is disabled at the limit, with a reason: ' + r);
ok(!errs.length, 'no page errors ' + errs.join(' ')); console.log(bad ? bad + ' FAILED' : 'all ok'); await b.close();
