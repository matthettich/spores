/* tests/live-sounds-check.mjs: every sound in SOUNDS played LIVE (real-time AudioContext, the way she hears it), peak
 * measured at the speakers. Catches sounds that are silent live but fine offline (the Nov 2026 wasm-post bug) and presets
 * that never get loud on short steps. Dev only: python3 -m http.server 8765 · node tests/live-sounds-check.mjs [from to]
 * (run in slices of ~50 to stay quick). Every peak should be above 0.02. */
import puppeteer from 'puppeteer-core';
const [from = 0, to = 999] = process.argv.slice(2).map(Number);
const b = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const p = await b.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.evaluateOnNewDocument(()=>{ const oc=AudioNode.prototype.connect; window.__taps=[];
  AudioNode.prototype.connect=function(d,...a){ if(d instanceof AudioDestinationNode && !this.__t){ this.__t=1; const an=new AnalyserNode(this.context,{fftSize:2048}); oc.call(this,an,...a); window.__taps.push(an);} return oc.call(this,d,...a); }; });
await p.goto('http://localhost:8765/',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,800));
const res = await p.evaluate(async(from,to)=>{
  const {SOUNDS,ENGINES}=await import('/js/engine/sounds.js'); const S=window.spores, st=S.store;
  const names=Object.keys(SOUNDS).slice(from,to), out=[];
  const meas=async ms=>{ const t0=performance.now(); let pk=0; const buf=new Float32Array(2048);
    while(performance.now()-t0<ms){ await new Promise(r=>setTimeout(r,20)); for(const an of window.__taps){an.getFloatTimeDomainData(buf); for(const x of buf){const a=Math.abs(x); if(a>pk)pk=a;}} } return pk; };
  for(const name of names){
    const kind=ENGINES[SOUNDS[name].engine].kind;
    st.edit('t',s=>{ const ti=s.tracks.findIndex(t=>t.type===(kind==='drum'?'drum':'synth')); const t=s.tracks[ti]; t.sound=name; t.params={}; t.mute=false;
      s.tracks.forEach((x,i)=>{x.mute=i!==ti; x.solo=false;}); s.scenes.A.steps[t.id]=Array.from({length:16},(_,i)=>i%4===0?{on:true,deg:[0,2,4,7][i/4],vel:110,chance:100}:null); });
    await S.engine.play('scene','A'); const pk=await meas(1400); S.engine.stop(); await new Promise(r=>setTimeout(r,250));
    out.push([name, SOUNDS[name].engine, +pk.toFixed(3)]);
  } return out; },from,to);
console.log(JSON.stringify({res,errs})); await b.close();
const quiet = res.filter(r => r[2] < 0.02);
console.log(quiet.length || errs.length ? 'FAIL quiet: ' + JSON.stringify(quiet) : `all ${res.length} sounds play`);
