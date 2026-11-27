/* tests/header-fit-check.mjs (dev only; server on 8765, puppeteer-core): the top bar at 1024–1680 wide in every skin, with seven
 * scenes, on both screens: nothing overlaps, nothing is squashed, the + keeps its size, nothing runs off the right. FONT="DejaVu Sans"
 * tries a wide font (the Mac draws it in Futura). */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
let bad = 0;
for (const skin of (process.env.SKINS || ',tr909,tr808,idmpg').split(',')) for (const screen of ['steps', 'song']) for (const w of [1024, 1100, 1150, 1180, 1220, 1280, 1366, 1440, 1680]){
  const p = await b.newPage(); p.on('dialog', d => d.accept()); await p.setViewport({width: w, height: 760});
  await p.evaluateOnNewDocument(s => { localStorage.setItem('spores.skin', s); localStorage.removeItem('spores.song'); }, skin);
  if (process.env.FONT) await p.evaluateOnNewDocument(f => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = `:root, :root[data-skin] { --font: '${f}' !important; }`; document.head.append(st); }); }, process.env.FONT);
  await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 250));
  await p.evaluate(() => window.spores.store.edit('t', s => { for (const k of 'CDEFG') s.scenes[k] = {name: 'Scene ' + k, bars: 1, steps: {}, clips: {}}; }));
  if (screen === 'song') await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim().toLowerCase() === 'song').click());
  await new Promise(r => setTimeout(r, 250));
  const r = await p.evaluate(() => {
    const hd = [...document.querySelectorAll('header.hdr')].find(x => x.offsetParent);
    // every visible control in the bar, left to right: none may overlap another, none narrower than its content
    const els = [...hd.querySelectorAll('button, select, input, .scenewrap, .mmeter, .tempo')].filter(e => e.offsetParent && !e.closest('.menu') && !e.closest('.scenewrap .scn') || e.matches('.scenewrap'));
    const top = els.filter(e => !els.some(o => o !== e && o.contains(e)));
    const rs = top.map(e => ({e, r: e.getBoundingClientRect()})).filter(x => x.r.width > 0);
    let overlap = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++){ const a = rs[i].r, c = rs[j].r; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) overlap.push((rs[i].e.className || rs[i].e.tagName) + ' × ' + (rs[j].e.className || rs[j].e.tagName)); }
    const squashed = rs.filter(x => x.e.scrollWidth > x.e.clientWidth + 2 && !x.e.matches('.scenewrap, select')).map(x => x.e.className || x.e.tagName);
    const rows = new Set(rs.map(x => Math.round((x.r.top + x.r.bottom) / 2 / 20))).size;
    const plus = document.querySelector('.addscn'); const pw = plus && plus.offsetParent ? plus.offsetWidth : 44;
    return {overlap, squashed, rows, pw, over: hd.scrollWidth - hd.clientWidth};
  });
  const okk = !r.overlap.length && !r.squashed.length && r.pw >= 44 && r.over <= 1;
  if (!okk) bad++;
  console.log(`${okk ? 'ok  ' : 'FAIL'} ${skin || 'default'} ${screen} ${w}: rows ${r.rows} over ${r.over}${r.overlap.length ? ' overlap ' + r.overlap.join(', ') : ''}${r.squashed.length ? ' squashed ' + r.squashed : ''}${r.pw < 44 ? ' + is ' + r.pw + 'px' : ''}`);
  if (process.env.SHOT && screen === 'steps' && !skin) await p.screenshot({path: `/tmp/hdr${w}.png`, clip: {x: 0, y: 0, width: w, height: 110}});
  await p.evaluate(() => { window.onbeforeunload = null; }); await p.close();
}
console.log(bad ? bad + ' FAILED' : 'all ok'); await b.close();
