import assert from 'node:assert/strict';
import test from 'node:test';
import {RightCommandHold, normalizeGlobalDictationShortcut} from '../src/global-dictation.js';
test('shortcut validation preserves sides and rejects unsupported input',()=>{
 assert.deepEqual(normalizeGlobalDictationShortcut({code:'KeyD',modifiers:['MetaRight']}),{code:'KeyD',modifiers:['MetaRight']});
 assert.throws(()=>normalizeGlobalDictationShortcut({code:'AudioVolumeUp',modifiers:[]}));
 assert.throws(()=>normalizeGlobalDictationShortcut({code:'KeyA',modifiers:['MetaRight','MetaRight']}));
});
test('different concurrent shortcuts are rejected and selection stays frozen',async()=>{
 const launched:any[]=[];let stops=0;
 const hold=new RightCommandHold(async shortcut=>{launched.push(shortcut);return {async stop(){stops++;}};});
 const config={code:'KeyD',modifiers:['MetaRight']};
 await hold.press('one',config);config.modifiers[0]='MetaLeft';
 await assert.rejects(hold.press('two',config),/CONFLICT/);
 assert.deepEqual(launched[0],{code:'KeyD',modifiers:['MetaRight']});
 await hold.release('one');await hold.release('one');assert.equal(stops,1);
 await hold.press('two',config);await hold.release('two');assert.equal(stops,2);
});

test('inherited object properties are not legacy shortcuts',()=>{
 for (const value of ['toString','constructor','__proto__']) assert.throws(()=>normalizeGlobalDictationShortcut(value),/UNSUPPORTED/);
});
