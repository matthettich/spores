/* js/ui/recstatus.js: what recording is doing right now, for the screens (the Record button, the count-in "1 2 3 4",
 * "Recording… bar 2 of 4", the empty lane's message). One of these is made per page (steps.js) and handed to the panel.
 *
 *   const rec = createRecStatus(engine);
 *   rec.st      {phase: 'idle' | 'count' | 'rec', trackId, scene, bars, countPerf, startPerf, endPerf, n}
 *               (…Perf = performance.now() times; the take's length is endPerf - startPerf)
 *   rec.begin({trackId, scene, bars})   call just before engine.record(): says which track it is for
 *   rec.where(now) → {beat 1…4} while counting in, {bar 1…bars} while recording, null otherwise
 *   rec.onChange(fn) → off()            fn(st) on every change of phase
 */
export function createRecStatus(engine){
  const st = {phase: 'idle', trackId: null, scene: null, bars: 1, countPerf: 0, startPerf: 0, endPerf: 0, n: 0};
  const subs = new Set(), fire = () => subs.forEach(f => { try { f(st); } catch (e){ console.error(e); } });
  engine.on('rec', m => {
    if (m.state === 'count-in'){
      Object.assign(st, {phase: 'count', trackId: m.trackId ?? st.trackId, scene: m.scene ?? st.scene, bars: m.bars || st.bars, n: 0,
        countPerf: engine.toPerf(m.countTime), startPerf: engine.toPerf(m.startTime), endPerf: engine.toPerf(m.endTime)});
    } else if (m.state === 'recording'){
      const len = st.endPerf - st.startPerf, now = performance.now();
      st.phase = 'rec';
      if (m.n > 0) Object.assign(st, {startPerf: now, endPerf: now + len});   // keep going: the next take follows on at once
      st.n = m.n | 0;
    } else if (m.state === 'done' || m.state === 'cancelled') st.phase = 'idle';
    fire();
  });
  engine.on('stop', () => { if (st.phase !== 'idle'){ st.phase = 'idle'; fire(); } });
  return {
    st,
    begin({trackId, scene, bars}){ Object.assign(st, {trackId, scene, bars}); },
    where(now = performance.now()){
      if (st.phase === 'count'){
        const beat = (st.startPerf - st.countPerf) / 4 || 1;
        return {beat: Math.max(1, Math.min(4, Math.floor((now - st.countPerf) / beat) + 1))};
      }
      if (st.phase === 'rec'){
        const bar = (st.endPerf - st.startPerf) / st.bars || 1;
        return {bar: Math.max(1, Math.min(st.bars, Math.floor((now - st.startPerf) / bar) + 1)), take: st.n + 1};
      }
      return null;
    },
    onChange(fn){ subs.add(fn); return () => subs.delete(fn); },
  };
}
