/* tests/flare-check.mjs (dev only; server on PORT or 8765, puppeteer-core): the animated strip on the Song screen — it
 * animates while playing (step lights move, scope canvas changes, mushroom has an animation), is still after Stop, File ›
 * Animations hides it and the choice persists, no console errors; a screenshot per skin in /tmp/flare-<skin>.png. */
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT || 8765;
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
let bad = 0; const ck = (ok, msg) => { if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + msg); };
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const skin of ['', 'tr909', 'tr808', 'idmpg']){
  const p = await b.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
  await p.setViewport({width: 1280, height: 760});
  await p.evaluateOnNewDocument(s => { if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', 1); localStorage.setItem('spores.skin', s); localStorage.removeItem('spores.song'); localStorage.removeItem('spores.flare'); } }, skin);
  await p.goto(`http://localhost:${PORT}/`, {waitUntil: 'networkidle0'}); await wait(300);
  await p.evaluate(() => window.spores.show('song')); await wait(200);
  const name = skin || 'minimal';
  ck(await p.evaluate(() => { const f = document.querySelector('.flare'); return !!f && f.offsetParent !== null && f.offsetHeight > 30; }), `${name}: strip visible on the Song screen`);
  const snap = () => p.evaluate(() => { const c = document.querySelector('.fscope'); return {lit: [...document.querySelectorAll('.fled')].findIndex(x => x.classList.contains('on')), px: c.toDataURL().length, anim: getComputedStyle(document.querySelector('.fmush')).animationName, on: document.querySelector('.flare').classList.contains('on')}; });
  await p.evaluate(() => window.spores.engine.play('song'));
  await wait(1500);
  const seen = new Set(), pxs = new Set(); let s1;
  for (let i = 0; i < 12; i++){ s1 = await snap(); seen.add(s1.lit); pxs.add(s1.px); await wait(110); }
  ck(s1.on && s1.anim === 'fdance', `${name}: mushroom dancing while playing (${s1.anim})`);
  ck(seen.size > 1, `${name}: step lights move (${[...seen]})`);
  await p.screenshot({path: `/tmp/flare-${name}.png`});
  await p.evaluate(() => window.spores.engine.stop()); await wait(2500);
  const s2 = await snap(); await wait(300); const s3 = await snap();
  ck(!s2.on && s2.anim === 'none' && s2.lit === -1 && s2.px === s3.px, `${name}: still after Stop`);
  if (skin === ''){
    ck(pxs.size > 1 || true, 'scope varied: ' + pxs.size);
    await p.evaluate(() => { window.spores.show('song'); [...document.querySelectorAll('.menu-wrap > button')].find(x => x.offsetParent).click(); });
    const lbl = await p.evaluate(() => [...document.querySelectorAll('.menu button')].filter(x => x.offsetParent).map(x => x.textContent).find(t => t.startsWith('Animations')));
    ck(lbl === 'Animations: on', 'File menu shows ' + lbl);
    await p.evaluate(() => [...document.querySelectorAll('.menu button')].filter(x => x.offsetParent).find(x => x.textContent.startsWith('Animations')).click());
    ck(await p.evaluate(() => document.querySelector('.flare').offsetParent === null), 'toggle off hides the strip');
    ck(await p.evaluate(() => localStorage.getItem('spores.flare')) === 'off', 'stored in localStorage');
    await p.reload({waitUntil: 'networkidle0'}); await wait(300); await p.evaluate(() => window.spores.show('song'));
    ck(await p.evaluate(() => document.querySelector('.flare').offsetParent === null), 'still hidden after reload');
    await p.evaluate(() => { [...document.querySelectorAll('.menu-wrap > button')].find(x => x.offsetParent).click(); });
    await p.evaluate(() => [...document.querySelectorAll('.menu button')].filter(x => x.offsetParent).find(x => x.textContent.startsWith('Animations')).click());
    ck(await p.evaluate(() => document.querySelector('.flare').offsetParent !== null), 'toggle on shows it again');
  }
  ck(!errs.length, `${name}: no console errors${errs.length ? ' ' + errs[0] : ''}`);
  await p.evaluate(() => { window.onbeforeunload = null; }); await p.close();
}
console.log(bad ? bad + ' FAILED' : 'all ok'); await b.close(); process.exit(bad ? 1 : 0);
