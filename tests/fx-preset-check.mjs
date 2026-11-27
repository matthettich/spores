/* tests/fx-preset-check.mjs (dev only): the preset list on each effect card (js/ui/fxpanel.js, js/engine/fxpresets.js, applyFxPreset).
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… [PORT=…] node tests/fx-preset-check.mjs   (puppeteer-core on your path)
 * Every effect has "Default" first and 3+ presets with in-range whole numbers, add Echo and pick a preset: the song's values
 * match it, one Undo puts every value back, Redo applies it again, the list shows "Custom" after a slider moves and the
 * preset's name again when the values match, "Default" = Reset, the list is 44 px tall and inside the card at 1280x760
 * and 1440x830, no console errors. */
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT || 8765;
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
for (const [w, h] of [[1280, 760], [1440, 830]]){
  const p = await b.newPage(); const errs = []; await p.setViewport({width: w, height: h});
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/MIDI/.test(m.text()) && errs.push(m.text()));
  await p.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); } });
  await p.goto(`http://localhost:${PORT}/`, {waitUntil: 'networkidle0'}); await sleep(500);
  const tag = `${w}x${h}: `;
  const fx0 = () => p.evaluate(() => JSON.parse(JSON.stringify(window.spores.store.get().tracks[0].fx[0].p)));
  const sel = () => p.evaluate(() => { const s = document.querySelector('.fxpre'); return s && s.options[s.selectedIndex].textContent; });
  const eq = (a, c) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(c).sort());

  if (w === 1280){   // the table itself
    const t = await p.evaluate(async () => {
      const {FX_TYPES, fxInfo} = await import('/js/engine/fx.js'), {fxPresets} = await import('/js/engine/fxpresets.js'); const bad = [];
      let n = 0;
      for (const ty of FX_TYPES){
        const L = fxPresets(ty), info = fxInfo(ty); n += L.length - 1;
        if (L[0].name !== 'Default' || L.length < 4) bad.push(ty + ' list');
        if (new Set(L.map(x => x.name)).size !== L.length) bad.push(ty + ' duplicate names');
        for (const x of L) for (const q of info.params){ const v = x.p[q.key]; if (!Number.isInteger(v) || v < q.min || v > q.max) bad.push(`${ty}/${x.name}/${q.key}=${v}`); }
      }
      return {bad, types: FX_TYPES.length, n};
    });
    ok(!t.bad.length, `all ${t.types} effects: Default first, 3+ presets (${t.n} in all), whole numbers in range ${t.bad.slice(0, 3)}`);
  }

  await p.evaluate(() => window.spores.engine.fxReady);
  await p.evaluate(() => document.querySelector('.track').click()); await sleep(150);
  await p.click('.fxadd'); await sleep(60);
  await p.evaluate(() => document.querySelector('.fxitem[data-type="delay"]').click()); await sleep(200);
  ok(await p.evaluate(() => document.querySelector('.fxpre').getAttribute('aria-label')) === 'Tape echo preset', tag + 'list is labelled "Tape echo preset"');
  ok(await sel() === 'Default', tag + 'a new effect shows Default');
  const def = await fx0();

  const names = await p.evaluate(() => [...document.querySelectorAll('.fxpre option')].map(o => o.textContent));
  ok(names[0] === 'Default' && names.includes('Dub echo') && names.at(-1) === 'Custom', tag + 'options: ' + names.join(', '));
  const want = await p.evaluate(async () => { const {fxPresets} = await import('/js/engine/fxpresets.js'); return fxPresets('delay').find(x => x.name === 'Dub echo').p; });
  await p.select('.fxpre', String(names.indexOf('Dub echo'))); await sleep(200);
  let now = await fx0();
  ok(eq(now, want) && !eq(now, def), tag + 'picking Dub echo sets every value: ' + JSON.stringify(now));
  ok(await sel() === 'Dub echo', tag + 'list shows Dub echo');
  // ONE undo step
  await p.evaluate(() => window.spores.store.undo()); await sleep(150);
  ok(eq(await fx0(), def), tag + 'one Undo restores the old values');
  ok(await sel() === 'Default', tag + 'list shows Default again');
  await p.evaluate(() => window.spores.store.redo()); await sleep(150);
  ok(eq(await fx0(), want) && await sel() === 'Dub echo', tag + 'Redo applies the preset again');
  // move a slider → Custom
  await p.evaluate(() => { const i = document.querySelector('.fxcard input[aria-label="Tape echo Repeats"]'); i.value = i.value > 100 ? 90 : 200; i.dispatchEvent(new Event('input', {bubbles: true})); }); await sleep(150);
  ok(await sel() === 'Custom', tag + 'list shows Custom after a slider moves');
  await p.evaluate(() => window.spores.store.undo()); await sleep(150);
  ok(await sel() === 'Dub echo', tag + 'Undo of the slider shows Dub echo again');
  // Default = Reset
  await p.select('.fxpre', '0'); await sleep(150);
  ok(eq(await fx0(), def) && await sel() === 'Default', tag + 'picking Default gives the defaults');
  // size
  const geo = await p.evaluate(() => { const s = document.querySelector('.fxpre').getBoundingClientRect(), c = document.querySelector('.fxcard').getBoundingClientRect(); return {h: s.height, l: s.left >= c.left, r: s.right <= c.right + 0.5, w: s.width}; });
  ok(geo.h >= 44 && geo.l && geo.r, tag + `list ${Math.round(geo.w)} x ${Math.round(geo.h)} px, inside the card`);
  ok(!errs.length, tag + 'no console errors ' + errs.slice(0, 2));
  await p.close();
}
await b.close(); console.log(bad ? bad + ' FAILED' : 'all ok'); process.exit(bad ? 1 : 0);
