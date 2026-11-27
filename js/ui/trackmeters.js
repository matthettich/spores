/* js/ui/trackmeters.js: a thin light meter under each track's name on the Steps screen, so you can see that a track
 * is making sound. The engine sends {trackId: peak} about 60 times a second (worklet.js postLevels); the bars live in
 * the track rows as <span class="tmeter" data-id="…"><span class="tmfill"></span></span> (steps.js).
 * dB scale like the input meter: -60 dB (nothing) … 0 dB (full); rises at once, falls away smoothly.
 */
export function trackMeters(engine, root){
  const peak = new Map(), shown = new Map();
  let raf = 0;
  const off = engine.on('tlevels', lv => {
    for (const [id, p] of Object.entries(lv)) if (p > (peak.get(id) || 0)) peak.set(id, p);
    if (!raf) raf = requestAnimationFrame(paint);
  });
  function paint(){
    raf = 0; let moving = false;
    for (const bar of root.querySelectorAll('.tmeter')){
      const id = bar.dataset.id, p = peak.get(id) || 0;
      const now = p > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(p) + 60) / 60)) : 0;
      let v = Math.max(now, (shown.get(id) || 0) * 0.86); if (v < 0.01) v = 0;
      shown.set(id, v); if (v > 0) moving = true;
      bar.firstChild.style.transform = `scaleX(${v.toFixed(3)})`;
    }
    peak.clear();
    if (moving) raf = requestAnimationFrame(paint);   // keep falling after the engine goes quiet
  }
  return () => { off(); cancelAnimationFrame(raf); };
}
