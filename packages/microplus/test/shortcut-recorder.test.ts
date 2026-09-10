import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
function setup() {
  const window: any = {};
  runInNewContext(readFileSync(new URL('../static/property-inspector/shortcut-recorder.js', import.meta.url), 'utf8'), {window});
  const saved: any[] = [], messages: string[] = [];
  return {r:window.CodexShortcutRecorder.create((v:any)=>saved.push(JSON.parse(JSON.stringify(v))), (s:string)=>messages.push(s)),saved,messages};
}
const event = (code:string, extra = {}) => ({code, preventDefault(){},stopPropagation(){},...extra});
test('records right modifier on release and ignores keys outside capture',()=>{
 const {r,saved}=setup();r.keydown(event('KeyA'));assert.equal(saved.length,0);
 r.start();r.keydown(event('AltRight',{altKey:true}));assert.equal(saved.length,0);r.keyup(event('AltRight'));
 assert.deepEqual(saved,[{code:'AltRight',modifiers:[]}]);
});
test('captures modifier combination and cancels without overwriting',()=>{
 const {r,saved}=setup();r.start();r.keydown(event('MetaRight',{metaKey:true}));r.keydown(event('KeyD',{metaKey:true}));r.keyup(event('KeyD'));
 assert.deepEqual(saved,[{code:'KeyD',modifiers:['MetaRight']}]);
 r.start();r.keydown(event('Escape'));r.keyup(event('KeyA'));assert.equal(saved.length,1);
});
test('rejects unknown modifier side, unsupported key and autorepeat',()=>{
 const {r,saved}=setup();r.start();r.keydown(event('KeyA',{metaKey:true}));r.keyup(event('KeyA'));
 r.keydown(event('AudioVolumeUp'));r.keyup(event('AudioVolumeUp'));
 r.keydown(event('KeyA',{repeat:true}));r.keyup(event('KeyA'));assert.equal(saved.length,0);
 r.cancel();r.keydown(event('KeyB'));r.keyup(event('KeyB'));assert.equal(saved.length,0);
});
