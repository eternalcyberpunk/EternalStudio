/**
 * htmltest/smoke.mjs — boots enstudio.html in jsdom and drives it.
 * WebGL and MediaRecorder do not exist here, so the graceful-degradation paths
 * are exercised too: the app must still boot, edit and undo without a GPU.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync('/home/claude/enstudio.html', 'utf8');
const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.matchMedia = q => ({ matches: /max-width:\s*(760|1180)px/.test(q) ? false : false,
      addEventListener(){}, removeEventListener(){} });
    w.ResizeObserver = class { observe(){} disconnect(){} };
    w.HTMLCanvasElement.prototype.getContext = () => null;   // no GPU in jsdom
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};
    w.onerror = (m) => errors.push(String(m));
  }
});
const w = dom.window;
await new Promise(r => setTimeout(r, 250));
w.addEventListener('error', e => errors.push(String(e.message)));

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? 'pass' : 'FAIL') + '  ' + label); };
const ev = expr => w.eval(expr);
const flush = () => new Promise(r => setTimeout(r, 70)); // renders are rAF-coalesced

/* boot ------------------------------------------------------------------- */
check('boots with no uncaught errors', errors.length === 0);
check('shell rendered', !!w.document.querySelector('.titlebar') && !!w.document.querySelector('#lanes'));
check('workspace bar built', w.document.querySelectorAll('#wsbar .ws').length === 6);
check('mobile nav built', w.document.querySelectorAll('#mobnav button').length === 5);
check('five default tracks', ev('S.tracks.length') === 5);
check('seeded a live Source → Output chain', ev('graphConnected()') === true);
check('preview failure is reported, not thrown', !w.document.querySelector('#vpErr').hidden);
check('timeline lanes rendered', w.document.querySelectorAll('#lanes .lane').length === 5);

/* editing ---------------------------------------------------------------- */
ev(`S.media.push({id:'m1',name:'plate.mp4',kind:'video',url:'blob:x',duration:8,width:1920,height:1080})`);
ev(`addClipFromAsset(S.media[0], S.tracks.find(t=>t.kind==='video').id, 2)`);
check('clip added to timeline', ev('allClips().length') === 1);
await flush();
check('clip element rendered', w.document.querySelectorAll('#lanes .clip').length === 1);

ev(`trimClip(allClips()[0].id,'end',6)`);
check('trim shortened the clip', Math.abs(ev('allClips()[0].duration') - 4) < 1e-6);
ev(`seek(4); splitAt(4)`);
check('split produced two clips', ev('allClips().length') === 2);
ev('undo()');
check('undo restored one clip', ev('allClips().length') === 1);

/* nodes ------------------------------------------------------------------ */
ev(`interpret('make this look like a damaged cyberpunk security recording').apply()`);
check('planner built the full chain', ev('S.graph.nodes.length') === 7);
check('planner wired every link', ev('S.graph.edges.length') === 6);
check('evaluator emits five GPU passes', ev('evaluate(0).length') === 5);
check('pass order starts at grade', ev(`evaluate(0)[0].pass`) === 'grade');
check('pass order ends at timestamp', ev(`evaluate(0)[4].pass`) === 'timestamp');
check('cycles rejected', ev(`canConnect({node:S.graph.nodes.find(n=>n.type==='output').id,port:'out'},
  {node:S.graph.nodes.find(n=>n.type==='source').id,port:'in'})`) === false);
await flush();
check('node cards rendered as SVG', w.document.querySelectorAll('#nodesvg .node').length === 7);
check('wires rendered', w.document.querySelectorAll('#nodesvg .wire').length === 6);

/* animation -------------------------------------------------------------- */
ev(`interpret('create a smooth cinematic camera move').apply()`);
check('camera move keyframed', ev(`S.graph.nodes.find(n=>n.type==='transform').anim.scale.length`) === 2);
check('curve holds before first key', ev(`sampleKeys(S.graph.nodes.find(n=>n.type==='transform').anim.scale,-1)`) === 1);
check('curve interpolates mid-way', ev(`(()=>{const k=S.graph.nodes.find(n=>n.type==='transform').anim.scale;
  const v=sampleKeys(k,k[0].t+2); return v>1 && v<1.12})()`) === true);
check('animated param resolves in the pass list',
  ev(`(()=>{const k=S.graph.nodes.find(n=>n.type==='transform').anim.scale;
    const p=evaluate(k[0].t+2).find(p=>p.pass==='transform'); return !!p && p.params.scale>1})()`) === true);

/* 3D + interaction surface ------------------------------------------------ */
ev(`addPrimitive('torus')`);
check('3D object added', ev('S.scene.objects.length') === 1);
check('3D geometry generator produces a mesh', ev(`geoFrom('torus').idx.length`) > 100);
check('every primitive builds', ev(`['cube','sphere','plane','cylinder','cone','torus','text3d']
  .every(k=>geoFrom(k).pos.length>0 && geoFrom(k).lines.length>0)`) === true);
check('project serialises and reloads', ev(`(()=>{const j=serialize(); deserialize(j);
  return S.graph.nodes.length===8 && S.scene.objects.length===1})()`) === true);

/* clicking through the UI the way a person would --------------------------- */
const click = sel => { const el = w.document.querySelector(sel); if (!el) throw new Error('missing ' + sel);
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
click('[data-act="ws"][data-id="model"]'); await flush();
check('workspace switch shows the 3D viewport', w.document.querySelector('#vp3d').hidden === false);
click('[data-act="ws"][data-id="edit"]'); await flush();
check('back to Edit shows the timeline', w.document.querySelector('#timeline').hidden === false);
click('[data-act="cmd"]');
check('command bar opens', !!w.document.querySelector('#cmdinput'));
click('[data-act="closemodal"]');
check('command bar closes', !w.document.querySelector('#cmdinput'));
click('[data-act="export"]');
check('export panel opens with presets', w.document.querySelectorAll('.preset').length >= 7);
click('[data-act="closemodal"]');
click('[data-act="bintab"][data-id="models"]'); await flush();
check('bin tab switches', !!w.document.querySelector('[data-act="prim"]'));

check('still no uncaught errors after interaction', errors.length === 0);
if (errors.length) console.log(errors);
console.log(fail ? `\n${fail} check(s) failed` : '\nAll checks passed');
process.exit(fail ? 1 : 0);
