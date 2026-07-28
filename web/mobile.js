/* Boots the same file with a phone viewport to exercise the mobile paths. */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const errors = [];
const dom = new JSDOM(readFileSync('/home/claude/enstudio.html','utf8'), {
  runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/',
  beforeParse(w){
    w.matchMedia = q => ({ matches:/max-width:\s*(760|1180)px/.test(q), addEventListener(){}, removeEventListener(){} });
    w.ResizeObserver = class { observe(){} disconnect(){} };
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.onerror = m => errors.push(String(m));
  }});
const w = dom.window; await new Promise(r=>setTimeout(r,250));
const $ = s => w.document.querySelector(s);
const click = s => $(s).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const flush = () => new Promise(r=>setTimeout(r,70));
let fail=0; const check=(l,ok)=>{if(!ok)fail++;console.log((ok?'pass':'FAIL')+'  '+l)};

check('phone boot without errors', errors.length===0);
check('starts on the viewer region', $('#vpVideo').hidden===false && $('#timeline').hidden===true);
click('[data-act="mob"][data-id="edit"]'); await flush();
check('Edit tab shows only the timeline', $('#timeline').hidden===false && $('#vpVideo').hidden===true);
click('[data-act="mob"][data-id="nodes"]'); await flush();
check('Nodes tab switches workspace and region', $('#nodes').hidden===false && w.eval('S.ws')==='node');
click('[data-act="mob"][data-id="3d"]'); await flush();
check('3D tab opens the 3D viewport', $('#vp3d').hidden===false && $('#bottom').hidden===true);
click('[data-act="mob"][data-id="media"]');
check('Media tab slides the project sheet in', $('#pLeft').classList.contains('open'));
click('[data-act="sheet"][data-side="right"]');
check('Inspector sheet toggles', $('#pRight').classList.contains('open'));
w.eval("S.media.push({id:'m1',name:'a.mp4',kind:'video',url:'b',duration:6,width:1920,height:1080})");
w.eval('renderNow()'); await flush();
click('[data-act="addclip"][data-id="m1"]'); await flush();
check('tap-to-add works without drag and drop', w.eval('allClips().length')===1);
check('adding jumps to the timeline region', w.eval("S.ui.mob")==='edit');
check('no errors after mobile interaction', errors.length===0);
if(errors.length) console.log(errors);
console.log(fail?`\n${fail} failed`:'\nAll mobile checks passed');
process.exit(fail?1:0);
