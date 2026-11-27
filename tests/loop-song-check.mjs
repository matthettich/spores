/* tests/loop-song-check.mjs (dev only; server on 8765, puppeteer-core): Loop song on wraps, off stops on the last sample; the button. */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.setViewport({width: 1280, height: 760}); await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 400));
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const r = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'); const {newSong} = await import('/js/store.js');
  const go = async loop => {
    const s = newSong(), K = s.tracks[0].id; s.loopSong = loop;
    s.scenes.A.steps = {[K]: [0, 4, 8, 12].reduce((a, i) => (a[i] = {on: true, deg: 0, vel: 110, chance: 100}, a), [])};
    s.scenes.B = {name: 'B', bars: 1, steps: {[K]: [{on: true, deg: 0, vel: 110, chance: 100}]}, clips: {}}; s.song = [{scene: 'A', repeat: 1}, {scene: 'B', repeat: 1}];
    const sr = 48000, ctx = new OfflineAudioContext(2, sr * 6, sr); await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: compile(s), play: {mode: 'song', block: 0}}});
    const msgs = []; n.port.onmessage = e => { if (e.data.t === 'stop') msgs.push(+e.data.time.toFixed(3)); };
    n.connect(ctx.destination); const d = (await ctx.startRendering()).getChannelData(0);
    const pk = (a, z) => { let m = 0; for (let i = Math.round(a * sr); i < Math.round(z * sr); i++) m = Math.max(m, Math.abs(d[i])); return m; };
    return {lastBar: pk(2.06, 2.5), after: pk(4.4, 6), wrapKick: pk(4.06, 4.3), stops: msgs};
  };
  return {off: await go(false), on: await go(true)};
});
ok(r.off.lastBar > 0.05 && r.off.after < 1e-4 && r.off.stops.length === 1 && Math.abs(r.off.stops[0] - 4.06) < 0.02, 'Loop song off: B plays, then silence after the song\'s end and a stop at ' + r.off.stops + ' s (song ends at 4.06)');
ok(r.on.wrapKick > 0.05 && !r.on.stops.length, 'Loop song on: it starts again (kick at 4.06 s: ' + r.on.wrapKick.toFixed(3) + '), no stop');
await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Song').click()); await new Promise(r => setTimeout(r, 300));
const st = () => p.evaluate(() => { const l = document.querySelector('.loopsong'); return [l.classList.contains('on'), window.spores.store.get().loopSong]; });
ok(JSON.stringify(await st()) === '[true,true]', 'Loop is on by default (lit)');
await p.click('.loopsong'); await new Promise(r => setTimeout(r, 150)); ok(JSON.stringify(await st()) === '[false,false]', 'click: Loop off, saved in the song');
await p.evaluate(() => window.spores.store.undo()); await new Promise(r => setTimeout(r, 150)); ok(JSON.stringify(await st()) === '[true,true]', 'Undo turns it back on');
const one = await p.evaluate(() => { const hd = [...document.querySelectorAll('header.hdr')].find(x => x.offsetParent); const c = [...hd.children].filter(c => c.offsetParent && c.offsetHeight > 4).map(c => { const r = c.getBoundingClientRect(); return (r.top + r.bottom) / 2; }); return Math.max(...c) - Math.min(...c) < 10 && hd.scrollWidth <= hd.clientWidth + 1; });
ok(one, '1280x760: Song header still on one row');
await p.screenshot({path: '/tmp/songhdr.png', clip: {x: 0, y: 0, width: 1280, height: 64}});
ok(!errs.length, 'no page errors ' + errs.join(' ')); console.log(bad ? bad + ' FAILED' : 'all ok'); await b.close();
