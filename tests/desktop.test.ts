import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { BUILD, DesktopAdapter, parseSlots, validateEndpoint } from '../packages/desktop/index.js';
import { Cdp } from '../packages/desktop/cdp.js';
import { validateNativeEvent } from '../packages/desktop/native-event.js';
test('native slot parser preserves exact identity and rejects malformed or reordered stores',()=>{
 const slots=Array.from({length:6},(_,id)=>({id,threadKey:id===0?'local:real':null,title:null,status:'idle',selected:id===0}));
 assert.equal(parseSlots(slots)[0].threadKey,'local:real');
 assert.throws(()=>parseSlots(slots.slice(1)));assert.throws(()=>parseSlots([...slots].reverse()));assert.throws(()=>parseSlots(slots.map(s=>({...s,status:'invented'}))));
});
test('endpoint rejects other builds and arbitrary ports',()=>{
 const e={pid:42,port:49152,version:BUILD.version,asarHash:BUILD.asarHash};validateEndpoint(e);
 for(const change of [{version:'other'},{asarHash:'other'},{port:80},{pid:0}])assert.throws(()=>validateEndpoint({...e,...change}));
});
test('unconnected native adapter never returns synthetic success',async()=>{
 const adapter=new DesktopAdapter();assert.equal(adapter.capability().available,false);
 await assert.rejects(adapter.snapshot(),/Dedicated/);await assert.rejects(adapter.execute('native.key',{key:'AG00',act:1}),/Dedicated/);await assert.rejects(adapter.connect(),/Dedicated/);
});
test('native event validation is finite and preserves physical bindings',()=>{
 const mapping={asarHash:BUILD.asarHash,keys:['ACT06']};
 assert.deepEqual(validateNativeEvent('native.key',{key:'AG03',act:1,threadKey:'local:real'},mapping,BUILD.asarHash),{event:{key:'AG03',act:1,slot:3,threadKey:'local:real'},type:'codex-micro-hid-event'});
 assert.deepEqual(validateNativeEvent('native.encoder',{key:'ENC_CC'},mapping,BUILD.asarHash),{event:{key:'ENC_CC',act:2},type:'codex-micro-hid-event'});
 assert.deepEqual(validateNativeEvent('native.joystick',{angle:90,distance:0.5},mapping,BUILD.asarHash),{event:{angle:90,distance:0.5},type:'codex-micro-joystick-event'});
 assert.throws(()=>validateNativeEvent('native.key',{key:'ACT06',act:1},{asarHash:'stale',keys:['ACT06']},BUILD.asarHash),/Native ACT mapping calibration required/);
 assert.throws(()=>validateNativeEvent('native.key',{key:'AG03',act:1},mapping,BUILD.asarHash),/Exact slot threadKey required/);
 assert.throws(()=>validateNativeEvent('native.joystick',{angle:0,distance:2},mapping,BUILD.asarHash),/Invalid joystick/);
 assert.throws(()=>validateNativeEvent('native.unknown',{},mapping,BUILD.asarHash),/Unsupported native command/);
});

class FakeCdpSocket extends EventEmitter {
 readonly sent:string[]=[];
 send(message:string){this.sent.push(message);}
 close(){this.emit('close');}
}

function cdpFixture(){
 const socket=new FakeCdpSocket();
 return {socket,cdp:new Cdp(socket as unknown as WebSocket)};
}

test('CDP helper preserves request correlation and renderer errors',async()=>{
 const first=cdpFixture();const value=first.cdp.evaluate('1+1');
 assert.deepEqual(JSON.parse(first.socket.sent[0]),{id:1,method:'Runtime.evaluate',params:{expression:'1+1',awaitPromise:true,returnByValue:true}});
 first.socket.emit('message',Buffer.from(JSON.stringify({id:1,result:{result:{value:2}}})));
 assert.equal(await value,2);

 const protocol=cdpFixture();const rejected=protocol.cdp.evaluate('bad');
 protocol.socket.emit('message',Buffer.from(JSON.stringify({id:1,error:{message:'Protocol rejected'}})));
 await assert.rejects(rejected,/Protocol rejected/);

 const renderer=cdpFixture();const exception=renderer.cdp.evaluate('throw Error()');
 renderer.socket.emit('message',Buffer.from(JSON.stringify({id:1,result:{exceptionDetails:{exception:{description:'Renderer rejected'}},result:{}}})));
 await assert.rejects(exception,/Renderer rejected/);
});

test('CDP helper closes malformed traffic and marks pending outcome unknown',async()=>{
 const {socket,cdp}=cdpFixture();const pending=cdp.evaluate('pending');
 socket.emit('message',Buffer.from('{'));
 await assert.rejects(pending,/CDP disconnected; operation outcome may be unknown/);
});

import { parseOwnedListener, startDedicated } from '../packages/desktop/launch.js';
test('launcher refuses before spawning when app is running',async()=>{
 let called=false;
 await assert.rejects(startDedicated('/unused',{preflight:async()=>({allowed:false,running:true,buildMatched:true,reason:'Manual quit required',argv:[],automaticallyRestarted:false}),start:async()=>{called=true;return 1;}}),/Manual quit/);
 assert.equal(called,false);
});
test('owned listener parser rejects wildcard and ambiguous listeners',()=>{
 assert.equal(parseOwnedListener('p12\nfc3\nn127.0.0.1:49152\n'),49152);
 assert.throws(()=>parseOwnedListener('n*:49152\n'));
 assert.throws(()=>parseOwnedListener('n127.0.0.1:49152\nn127.0.0.1:49153\n'));
});
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('explicit launcher writes owner-only metadata from injected owned child',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'codex-deck-launch-test-'));let actual:string[]=[];
 const result=await startDedicated(dir,{preflight:async()=>({allowed:true,running:false,buildMatched:true,reason:'Ready',argv:[],automaticallyRestarted:false}),start:async(args)=>{actual=args;return 12345;}},'tcp');
 assert.equal(result.pid,12345);assert.equal(result.port,null);assert.equal(actual[0],BUILD.executable);assert.ok(actual.includes('--remote-debugging-port=0'));
 const path=join(dir,'desktop-launch.json');assert.equal((await stat(path)).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(path,'utf8')).pid,12345);
 // Keep temporary evidence; project rules prohibit hard deletion.
});
test('launcher requires explicit TCP opt in while pipe is unimplemented',async()=>{
 let spawned=false;await assert.rejects(startDedicated('/unused',{preflight:async()=>({allowed:true,running:false,buildMatched:true,reason:'Ready',argv:[],automaticallyRestarted:false}),start:async()=>{spawned=true;return 1;}}),/Explicit --tcp/);assert.equal(spawned,false);
});
import { probeNormalOwner } from '../packages/desktop/normal-ipc.js';
test('normal IPC owner discovery requires exact local identity before touching socket',async()=>{
 await assert.rejects(probeNormalOwner('/unused','', 'local'),/Exact known local/);
 await assert.rejects(probeNormalOwner('/unused','known-task-123','remote'),/Exact known local/);
});
import { NormalDesktopAdapter } from '../packages/desktop/normal-ipc.js';
test('normal adapter exposes owner observation separately and denies all writes',async()=>{
 const adapter=new NormalDesktopAdapter('/unused','known-task-123');assert.equal(adapter.capability().ownerObservation,true);assert.equal(adapter.capability().taskState,false);assert.equal(adapter.capability().settings,false);
 await assert.rejects(adapter.execute('settings',{model:'anything'}),/mutation disabled/);
});
import { NormalAppAdapter } from '../packages/desktop/accessibility.js';
test('native focus observes actual frontmost state and refuses to start absent app',async()=>{
 const calls:string[]=[];let opened=false;
 const adapter=new NormalAppAdapter({run:async(file)=>{calls.push(file);if(file.endsWith('/open')){opened=true;return {stdout:''};}return {stdout:opened?'true':'false'};}});
 assert.equal((await adapter.execute('app.focus')).observed,true);assert.equal(calls.filter(f=>f.endsWith('/open')).length,1);
 const absent=new NormalAppAdapter({run:async()=>({stdout:'unavailable'})});await assert.rejects(absent.execute('app.focus'),/will not launch/);
 await assert.rejects(adapter.execute('microphone.start'),/Unsupported/);
});
import { parseUnreadMetadata } from '../packages/desktop/normal-ipc.js';
test('body-free metadata accepts exact owner/task/version only and preserves false',()=>{
 const event={type:'broadcast',method:'thread-read-state-changed',version:2,sourceClientId:'owner',params:{hostId:'local',conversationId:'task',hasUnreadTurn:false}};
 assert.equal(parseUnreadMetadata(event,'task','owner'),false);
 assert.equal(parseUnreadMetadata({...event,sourceClientId:'other'},'task','owner'),null);
 assert.equal(parseUnreadMetadata({...event,version:1},'task','owner'),null);
 assert.equal(parseUnreadMetadata(event,'other-task','owner'),null);
 assert.equal(parseUnreadMetadata({...event,method:'thread-stream-state-changed'},'task','owner'),null);
});
import { NormalFollowerAdapter, FollowerOutcomeUnknown, buildFollowerRequest, type FollowerState, type FollowerTransport, type FollowerCommand } from '../packages/desktop/follower.js';
function fixtureState():FollowerState{return {conversationId:'fixture-task',ownerClientId:'owner',capturedAt:Date.now(),revision:1,model:'m',effort:'low',allowedModelEfforts:{m:['low','high']},activeTurnId:'turn1',running:true,descendantCount:0,pendingApprovals:[{id:'req1',kind:'command'}]};}
function mockFollower(options:{responseOwner?:string;after?:Partial<FollowerState>;noEffect?:boolean}={}){
 const calls:Array<{method:string;params:any;target?:string}>=[];let reads=0;
 const transport:FollowerTransport={connect:async()=>{},close:()=>{},request:async(method,version,params,target)=>{calls.push({method,params,target});return {type:'response',method,resultType:'success',handledByClientId:method==='thread-owner-discovery'?'owner':options.responseOwner??'owner',result:method==='thread-owner-discovery'?{}:{ok:true,interruptedTurnId:'turn1'}};}};
 const observer={read:async()=>({...fixtureState(),...(reads++===0?{}:{revision:options.noEffect?1:2,...options.after})})};
 return {calls,adapter:new NormalFollowerAdapter({conversationId:'fixture-task',purpose:'disposable-fixture',asarHash:BUILD.asarHash},observer,transport)};
}
test('follower mock: settings use exact owner/versioned route and require state observation',async()=>{
 const {adapter,calls}=mockFollower({after:{effort:'high'}});const r=await adapter.execute({kind:'settings',effort:'high'});assert.equal(r.observed,true);
 assert.deepEqual(calls.map(c=>c.method),['thread-owner-discovery','thread-owner-discovery','thread-follower-update-thread-settings']);
 assert.equal(calls[2].target,'owner');assert.deepEqual(calls[2].params,{conversationId:'fixture-task',threadSettings:{effort:'high'}});
 const noChange=mockFollower({noEffect:true});assert.equal((await noChange.adapter.execute({kind:'settings',effort:'high'})).observed,false);
});
test('follower mock: wrong owner response is unknown, never successful',async()=>{
 const {adapter}=mockFollower({responseOwner:'different',after:{effort:'high'}});await assert.rejects(adapter.execute({kind:'settings',effort:'high'}),FollowerOutcomeUnknown);
});
test('follower builder rejects wrong turn, descendants, unavailable model and approvals',()=>{
 assert.throws(()=>buildFollowerRequest({kind:'interrupt',expectedTurnId:'other'},fixtureState()),/Exact running turn/);
 assert.throws(()=>buildFollowerRequest({kind:'interrupt',expectedTurnId:'turn1'},{...fixtureState(),descendantCount:1}),/no descendants/);
 assert.throws(()=>buildFollowerRequest({kind:'settings',model:'unobserved'},fixtureState()),/not observed/);
 assert.throws(()=>buildFollowerRequest({kind:'approval',approvalKind:'file',requestId:'req1',decision:'accept'},fixtureState()),/pending approval/);
});
test('follower mock: approval ok and disappearance do not prove accepted outcome',async()=>{
 const {adapter}=mockFollower({after:{pendingApprovals:[]}});const r=await adapter.execute({kind:'approval',approvalKind:'command',requestId:'req1',decision:'accept'});assert.equal(r.acknowledged,true);assert.equal(r.approvalRemoved,true);assert.equal(r.observed,false);
});
test('follower mock: interrupt requires matching response turn and later stopped state',async()=>{
 const {adapter}=mockFollower({after:{running:false,activeTurnId:null}});assert.equal((await adapter.execute({kind:'interrupt',expectedTurnId:'turn1'})).observed,true);
});
test('normal adapter wires typed fixture executor and rejects selected task mismatch',async()=>{
 const {adapter:writer}=mockFollower({after:{effort:'high'}});
 const native=new NormalDesktopAdapter('/unused','fixture-task',writer);assert.equal((await native.execute('native.settings',{effort:'high'})).observed,true);
 const wrong=new NormalDesktopAdapter('/unused','other-task',writer);await assert.rejects(wrong.execute('native.settings',{effort:'high'}),/does not match/);
});
test('follower stale metadata fails before any mutation',async()=>{
 const calls:string[]=[];const transport:FollowerTransport={connect:async()=>{},close:()=>{},request:async(method)=>{calls.push(method);return {type:'response',method,resultType:'success',handledByClientId:'owner',result:{}};}};
 const adapter=new NormalFollowerAdapter({conversationId:'fixture-task',purpose:'disposable-fixture',asarHash:BUILD.asarHash},{read:async()=>({...fixtureState(),capturedAt:0})},transport);
 await assert.rejects(adapter.execute({kind:'settings',effort:'high'}),/fresh/);assert.deepEqual(calls,['thread-owner-discovery']);
});
import { projectFixtureSnapshot } from '../packages/desktop/fixture-observer.js';
test('fixture projector excludes content and rejects other owners/tasks',()=>{
 const fixture={conversationId:'fixture-task',purpose:'disposable-fixture' as const,asarHash:BUILD.asarHash};
 const event={type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:'fixture-task',change:{type:'snapshot',revision:3,conversationState:{id:'fixture-task',latestModel:'m',latestReasoningEffort:'high',turns:[],requests:[],secretBody:'must-not-leave-projector'}}}};
 const value=projectFixtureSnapshot(event,fixture,'owner');assert.equal(value?.model,'m');assert.equal(value?.turnCount,0);assert.ok(!JSON.stringify(value).includes('must-not-leave'));
 assert.equal(projectFixtureSnapshot(event,fixture,'different'),null);assert.equal(projectFixtureSnapshot(event,{...fixture,conversationId:'other-task'},'owner'),null);
});
import { computeNativeSettingsCycle } from '../packages/desktop/native-settings.js';
import { assertExpectedNativeSettings } from '../packages/desktop/follower.js';
test('native cycle uses catalogue order, signed ticks and explicit supported fallback',()=>{
 const rows=[{id:'a',efforts:['low','high','max']},{id:'b',efforts:['low','high']}];
 assert.equal(computeNativeSettingsCycle({model:'a',effort:'low'},'effort',-1,rows).args.effort,'max');
 assert.equal(computeNativeSettingsCycle({model:'a',effort:'low'},'effort',4,rows).args.effort,'high');
 const changed=computeNativeSettingsCycle({model:'a',effort:'max'},'model',1,rows);assert.deepEqual(changed.args,{model:'b',effort:'low'});assert.equal(changed.cycle.effortAdjusted,true);
 assert.deepEqual(computeNativeSettingsCycle({model:'b',effort:'high'},'model',1,rows).args,{model:'a',effort:'high'});
 assert.throws(()=>computeNativeSettingsCycle({model:'a',effort:null},'effort',1,rows));assert.throws(()=>computeNativeSettingsCycle({model:'a',effort:'high'},'effort',0,rows));
});
test('cycle stale revision aborts before follower mutation',async()=>{
 const {adapter,calls}=mockFollower({after:{revision:2}});await assert.rejects(adapter.execute({kind:'settings',effort:'high'},fixtureState()),/changed since cycle/);
 assert.deepEqual(calls.map(c=>c.method),['thread-owner-discovery','thread-owner-discovery']);
 const original=fixtureState();for(const change of [{ownerClientId:'other'},{conversationId:'other-task'},{revision:2},{model:'other-model'},{effort:'high'}])assert.throws(()=>assertExpectedNativeSettings({...original,...change},original));
});

import { projectPendingNativeApprovals, nativeApprovalCapability } from '../packages/desktop/native-approvals.js';
test('approval projection binds callback identity and drops content; no ACK capability',()=>{
 const fixture={purpose:'disposable-fixture' as const,conversationId:'fixture',asarHash:BUILD.asarHash};
 const m:any={type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:'fixture',change:{type:'snapshot',revision:1,conversationState:{id:'fixture',requests:[{id:7,method:'item/commandExecution/requestApproval',params:{threadId:'fixture',turnId:'turn',itemId:'item',approvalId:'callback',command:'SECRET'}}]}}}};
 const p=projectPendingNativeApprovals(m,fixture,'owner');assert.equal(p?.[0].approvalId,'callback');assert.equal(JSON.stringify(p).includes('SECRET'),false);
 assert.equal(projectPendingNativeApprovals(m,fixture,'other'),null);m.params.change.conversationState.requests[0].params.threadId='other';assert.throws(()=>projectPendingNativeApprovals(m,fixture,'owner'));
 assert.equal(nativeApprovalCapability().available,false);
});

import { explicitStartRequest, projectNativeTurns, observesStartedTurn, nativeExplicitInputCapability } from '../packages/desktop/native-turns.js';
test('explicit start finite schema and correlated native observation reject ACK-only',()=>{
 const request=explicitStartRequest('fixture-id','hello','client-id');assert.deepEqual(Object.keys(request.turnStart.request).sort(),['clientUserMessageId','input','threadId']);assert.throws(()=>explicitStartRequest('fixture-id','x'.repeat(8193),'client-id'));
 const fixture={purpose:'disposable-fixture' as const,conversationId:'fixture-id',asarHash:BUILD.asarHash};
 const m:any={type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:'fixture-id',change:{type:'snapshot',revision:2,conversationState:{id:'fixture-id',requests:[],threadRuntimeStatus:{type:'idle'},turns:[],turnHistory:{kind:'canonical',history:{islands:[{entries:[{value:'key'}]}],entitiesByKey:{key:{turnId:'turn',status:'completed',params:{clientUserMessageId:'client-id',input:'SECRET'},items:['SECRET']}}}}}}}};
 const after=projectNativeTurns(m,fixture,'owner')!;const before={...after,revision:1,turns:[]};assert.equal(observesStartedTurn(before,after,'turn','client-id'),true);assert.equal(observesStartedTurn(before,after,'turn','wrong'),false);assert.equal(observesStartedTurn(after,after,'turn','client-id'),false);assert.equal(JSON.stringify(after).includes('SECRET'),false);assert.equal(nativeExplicitInputCapability().steer,false);
});
