/* js/midi.js: Web MIDI ports, note out and clock out.
 *
 * Notes and clock are sent with timestamps worked out by the engine (engine.toPerf), so they leave on the same
 * moment the audio is heard, not when the page happens to get round to it. Timing changes here are 🔴 (Claude).
 *
 *   await midi.init()              // asks the browser for MIDI (Chrome); false if not allowed / not there
 *   midi.outputs()                 // [{id, name}]
 *   midi.onChange(fn)              // ports plugged in or out
 *   midi.attach(engine, getSong)   // MIDI tracks, the Seeds link and clock follow the engine from then on
 */
let access = null;
const changeSubs = [];
const hanging = new Map();   // "port|ch|note" → [portId, status, note]: notes on, so Stop can turn them off

export async function init(){
  if (access) return true;
  if (!navigator.requestMIDIAccess) return false;
  try { access = await navigator.requestMIDIAccess({sysex: false}); }
  catch (e) { console.warn('MIDI not allowed', e); return false; }
  access.onstatechange = () => changeSubs.forEach(f => f(outputs()));
  return true;
}

export const ready = () => !!access;
export function outputs(){ return access ? [...access.outputs.values()].map(o => ({id: o.id, name: o.name})) : []; }
export function onChange(f){ changeSubs.push(f); }

function port(id){
  if (!access || !id) return null;
  return access.outputs.get(id) || [...access.outputs.values()].find(o => o.name === id) || null;   // by id, or by name (ids can change between runs)
}

function send(id, bytes, at){
  const p = port(id); if (!p) return;
  try { at > performance.now() + 1 ? p.send(bytes, at) : p.send(bytes); } catch (e) { console.warn('MIDI send', e); }
}

export function note(id, ch, n, vel, at, lenMs){
  const c = (Math.max(1, Math.min(16, ch | 0 || 1)) - 1);
  send(id, [0x90 | c, n & 127, Math.max(1, Math.min(127, vel | 0))], at);
  send(id, [0x80 | c, n & 127, 0], at + Math.max(5, lenMs));
  const k = `${id}|${c}|${n}`; hanging.set(k, [id, 0x80 | c, n]);
  setTimeout(() => hanging.delete(k), Math.max(0, at + lenMs - performance.now()) + 50);
}

export function allOff(){
  const ports = new Set();
  for (const [, [id, st, n]] of hanging){ send(id, [st, n, 0]); ports.add(id); }
  hanging.clear();
  for (const id of ports){ const p = port(id); if (p && p.clear) try { p.clear(); } catch (e) {} }
}

/* The ports that get MIDI clock and Start / Stop: the Seeds link (if its clock is on) and every MIDI track's port
   whose `midi.clock` is on. */
function clockPorts(song){
  const s = new Set();
  if (song.link && song.link.seedsPort && song.link.clock !== false) s.add(song.link.seedsPort);
  for (const t of song.tracks) if (t.type === 'midi' && t.midi && t.midi.port && t.midi.clock) s.add(t.midi.port);
  return [...s];
}

export function attach(engine, getSong){
  engine.on('start', m => { const s = getSong(); if (!access || !s) return; const at = engine.toPerf(m.time); for (const id of clockPorts(s)) send(id, [0xFA], at); });
  engine.on('stop', () => { const s = getSong(); if (!access || !s) return; for (const id of clockPorts(s)) send(id, [0xFC]); allOff(); });
  engine.on('sched', m => {
    const s = getSong(); if (!access || !s) return;
    const cps = clockPorts(s);
    if (cps.length) for (const t of m.clocks){ const at = engine.toPerf(t); for (const id of cps) send(id, [0xF8], at); }
    const at = engine.toPerf(m.time), link = s.link || {};
    for (const ev of m.events){
      const t = s.tracks[ev.ti]; if (!t) continue;
      const lenMs = ev.len * 1000;
      if (t.type === 'midi' && t.midi && t.midi.port) note(t.midi.port, t.midi.ch, ev.note, ev.vel, at, lenMs);
      // the Seeds link: every drum hit also sends its track's seedsNote on the link channel
      if (t.type === 'drum' && link.seedsPort) note(link.seedsPort, link.seedsCh || 16, t.seedsNote ?? 36, ev.vel, at, Math.min(lenMs, 60));
    }
  });
}
