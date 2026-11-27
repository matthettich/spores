/* tests/tempo-skin-check.mjs (dev only; server on PORT (default 8765), puppeteer-core, CHROME): the "Style" tempo list on the
   Steps and Song headers (one undo step), and the IDM pink & green skin picked from the Skin dialog. SHOTS=1 writes /tmp/skin-*.png */
import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
const p = await b.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const URL0 = `http://localhost:${process.env.PORT || 8765}/`;
const bpm = () => p.evaluate(() => window.spores.store.get().bpm);
const css = v => p.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v);
const rows = () => p.evaluate(() => { const k = [...document.querySelectorAll('.hdr button, .hdr select, .hdr input')].filter(x => x.offsetParent); return new Set(k.map(x => Math.round(x.getBoundingClientRect().top / 8))).size; });
const click = t => p.evaluate(t => [...document.querySelectorAll('button')].find(x => x.offsetParent && x.textContent.trim() === t).click(), t);
const vis = `[...document.querySelectorAll('select[aria-label="Tempo presets"]')].find(x => x.offsetParent)`;
const pick = async v => { await p.evaluate(`(() => { const s = ${vis}; s.value = '${v}'; s.dispatchEvent(new Event('change', {bubbles: true})); })()`); await sleep(150); };
await p.setViewport({width: 1280, height: 760});
await p.evaluateOnNewDocument(() => { try { localStorage.removeItem('spores.skin'); } catch (e) {} });
await p.goto(URL0, {waitUntil: 'networkidle0'}); await sleep(400);

for (const screen of ['Steps', 'Song']){
  if (screen === 'Song'){ await click('Song'); await sleep(300); }
  ok(await p.evaluate(`!!${vis}`), `${screen}: the tempo presets list is there`);
  const t = await p.evaluate(() => { const s = [...document.querySelectorAll('select[aria-label="Tempo presets"]')].find(x => x.offsetParent); return {label: s.options[s.selectedIndex].text, groups: s.querySelectorAll('optgroup').length, h: s.getBoundingClientRect().height, n: s.querySelectorAll('option').length}; });
  ok(t.label === 'Style' && t.groups === 4 && t.n === 24 && t.h >= 44, `${screen}: shows "Style", 4 groups, 23 styles, 44 px tall ` + JSON.stringify(t));
  const before = await bpm(); const want = before === 174 ? 124 : 174;
  await pick(String(want));
  ok(await bpm() === want, `${screen}: picking sets the tempo to ${want}`);
  ok(await p.evaluate(`${vis}.value`) === '', `${screen}: the list goes back to "Style"`);
  ok(await p.evaluate(() => [...document.querySelectorAll('.tempo input')].find(x => x.offsetParent).value) === String(want), `${screen}: the BPM field shows it`);
  await p.evaluate(() => window.spores.store.undo()); await sleep(100);
  ok(await bpm() === before, `${screen}: one Undo restores ${before}`);
  ok(await rows() === 1, `${screen}: header on one row at 1280x760`);
}
await click('Steps'); await sleep(300);

// the skin, from the Skin dialog
await click('File ▾'); await sleep(150);
await p.evaluate(() => [...document.querySelectorAll('.menu button')].find(x => /^Skin/.test(x.textContent.trim())).click()); await sleep(200);
const before = await css('--gate');
await p.evaluate(() => [...document.querySelectorAll('.skin')].find(x => x.textContent.includes('IDM pink & green')).click()); await sleep(200);
const dots = await p.evaluate(() => [...document.querySelectorAll('.skin')].find(x => x.textContent.includes('IDM pink & green')).querySelectorAll('.skindot').length);
ok(dots === 4, 'the skin is in the Skin dialog with 4 swatches');
ok(await p.evaluate(() => document.documentElement.dataset.skin) === 'idmpg', 'picking it sets data-skin');
ok(before !== '#ff2d8a' && await css('--gate') === '#ff2d8a' && await css('--bench') === '#e9e8e3' && await css('--ink') === '#141414' && await css('--audio') === '#1f9e5a', 'pink gate, paper bench, ink, green audio');
await click('Done'); await sleep(200);
for (const [w, h] of [[1280, 760], [1440, 830]]){
  await p.setViewport({width: w, height: h}); await sleep(250);
  for (const screen of ['Steps', 'Song']){
    await click(screen); await sleep(250);
    ok(await rows() === 1, `${w}x${h} ${screen} (new skin): header on one row`);
    if (process.env.SHOTS && w === 1440) await p.screenshot({path: `/tmp/skin-${screen.toLowerCase()}.png`});
  }
  await click('Steps'); await sleep(200);
}
ok(errs.length === 0, 'no console errors ' + errs.join(' '));
console.log(bad ? bad + ' FAILED' : 'all ok'); await b.close(); process.exit(bad ? 1 : 0);
