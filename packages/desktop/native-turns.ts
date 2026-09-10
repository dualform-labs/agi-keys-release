import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {BUILD} from './index.js';
import {LocalFollowerTransport,FollowerOutcomeUnknown,type FixtureBinding} from './follower.js';
export interface NativeTurnMetadata {turnId:string|null;status:string;clientUserMessageId:string|null}
export interface NativeTurnsSnapshot {revision:number;owner:string;threadId:string;runtimeStatus:string;requestCount:number;unconfirmedCount:number;turns:NativeTurnMetadata[]}
/** Current-build metadata projection, including canonical history; never retain item text or input. */
export function projectNativeTurns(message:any,fixture:FixtureBinding,owner:string):NativeTurnsSnapshot|null {
 if(fixture.purpose!=='disposable-fixture'||fixture.asarHash!==BUILD.asarHash)throw Error('Disposable current-build fixture required');
 if(message?.type!=='broadcast'||message.method!=='thread-stream-state-changed'||message.version!==11||message.sourceClientId!==owner||message.params?.conversationId!==fixture.conversationId||message.params.hostId!=='local'||message.params.change?.type!=='snapshot')return null;
 const c=message.params.change.conversationState,revision=message.params.change.revision;
 if(c?.id!==fixture.conversationId||!Number.isSafeInteger(revision)||revision<0)throw Error('Native turn snapshot identity mismatch');
 let turns=c.turns;if(c.turnHistory?.kind==='canonical'){const h=c.turnHistory.history;if(!Array.isArray(h?.islands)||!h.entitiesByKey)throw Error('Unknown canonical history');turns=h.islands.flatMap((island:any)=>island.entries.map((entry:any)=>h.entitiesByKey[entry.value]));}
 if(!Array.isArray(turns)||!Array.isArray(c.requests))throw Error('Missing native turns/requests');
 return {threadId:fixture.conversationId,owner,revision,runtimeStatus:c.threadRuntimeStatus?.type??'unknown',requestCount:c.requests.length,unconfirmedCount:c.unconfirmedTurnSubmissions?.length??0,turns:turns.map((turn:any)=>{
 if(!turn||!(turn.turnId==null||typeof turn.turnId==='string')||typeof turn.status!=='string')throw Error('Invalid native turn metadata');
 return {turnId:turn.turnId??null,status:turn.status,clientUserMessageId:typeof turn.params?.clientUserMessageId==='string'?turn.params.clientUserMessageId:null};})};
}
export function explicitStartRequest(threadId:string,text:string,clientUserMessageId:string){
 if(!/^[a-zA-Z0-9_-]{8,128}$/.test(threadId)||!text.trim()||Buffer.byteLength(text)>8192||!/^[-a-zA-Z0-9]{8,128}$/.test(clientUserMessageId))throw Error('Invalid explicit text start input');
 return {conversationId:threadId,turnStart:{request:{threadId,clientUserMessageId,input:[{type:'text',text,text_elements:[]}]},context:{}}};
}
export function observesStartedTurn(before:NativeTurnsSnapshot,after:NativeTurnsSnapshot,turnId:string,clientId:string){return before.threadId===after.threadId&&before.owner===after.owner&&after.revision>before.revision&&!before.turns.some(t=>t.turnId===turnId)&&after.turns.some(t=>t.turnId===turnId&&t.clientUserMessageId===clientId);}
/** Research fixture only. Never retry: clientUserMessageId is correlation, not a deduplication guarantee. */
export async function startFixtureExplicitText(fixture:FixtureBinding,text:string,endpoint=join(homedir(),'.codex','ipc','ipc.sock')){
 if(fixture.purpose!=='disposable-fixture'||fixture.asarHash!==BUILD.asarHash)throw Error('Disposable current-build fixture required');
 const clientId=randomUUID(),params=explicitStartRequest(fixture.conversationId,text,clientId);let owner='',latestRevision=-1;
 let pending:undefined|{resolve:(s:NativeTurnsSnapshot)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
 const observer=new LocalFollowerTransport(endpoint,(m:any)=>{if(m?.type==='broadcast'&&m.method==='thread-stream-state-changed'&&m.version===11&&m.sourceClientId===owner&&m.params?.conversationId===fixture.conversationId&&m.params?.hostId==='local'&&Number.isSafeInteger(m.params.change?.revision))latestRevision=m.params.change.revision;try{const s=projectNativeTurns(m,fixture,owner);if(s&&pending){const p=pending;pending=undefined;clearTimeout(p.timer);p.resolve(s);}}catch(e){if(pending){clearTimeout(pending.timer);pending.reject(e as Error);pending=undefined;}}});
 const writer=new LocalFollowerTransport(endpoint);let dispatched=false;
 const read=()=>new Promise<NativeTurnsSnapshot>((resolve,reject)=>{pending={resolve,reject,timer:setTimeout(()=>{pending=undefined;reject(Error('Native turn snapshot timeout'));},5000)};observer.followFixture(fixture.conversationId,owner,true);});
 try{
 await observer.connect();const o=await observer.request('thread-owner-discovery',1,{hostId:'local',conversationId:fixture.conversationId});if(o.resultType!=='success'||o.method!=='thread-owner-discovery'||!o.handledByClientId)throw Error('Exact fixture owner unavailable');owner=o.handledByClientId;
 const before=await read();if(before.runtimeStatus!=='idle'||before.requestCount||before.unconfirmedCount||before.turns.some(t=>t.status==='inProgress'))throw Error('Fixture must be idle without pending requests');
 await writer.connect();const confirmed=await writer.request('thread-owner-discovery',1,{hostId:'local',conversationId:fixture.conversationId},owner);if(confirmed.resultType!=='success'||confirmed.method!=='thread-owner-discovery'||confirmed.handledByClientId!==owner)throw Error('Fixture owner changed');
 const fresh=await read();if(fresh.revision!==before.revision||latestRevision!==before.revision)throw Error('Fixture state changed before dispatch');
 dispatched=true;const response=await writer.request('thread-follower-start-turn',2,params,owner);
 const turnId=(response.result as any)?.result?.turn?.id;
 if(response.resultType!=='success'||response.method!=='thread-follower-start-turn'||response.handledByClientId!==owner||typeof turnId!=='string')throw new FollowerOutcomeUnknown('Start response did not provide exact turn identity');
 let after=await read();for(let n=0;n<8&&!observesStartedTurn(before,after,turnId,clientId);n++)after=await read();
 for(let n=0;n<60&&after.turns.find(t=>t.turnId===turnId)?.status==='inProgress';n++){await new Promise(resolve=>setTimeout(resolve,500));after=await read();}
 const terminalStatus=after.turns.find(t=>t.turnId===turnId)?.status??null;
 return {dispatched:true,observed:observesStartedTurn(before,after,turnId,clientId),terminalStatus,terminalObserved:terminalStatus==='completed'||terminalStatus==='failed'||terminalStatus==='interrupted',threadId:fixture.conversationId,turnId,clientUserMessageId:clientId,before,after,retrySafe:false};
 }catch(e){if(dispatched&&!(e instanceof FollowerOutcomeUnknown))throw new FollowerOutcomeUnknown('Start may have been delivered; no automatic retry');throw e;}
 finally{if(pending){clearTimeout(pending.timer);pending=undefined;}try{if(owner)observer.followFixture(fixture.conversationId,owner,false);}finally{observer.close();writer.close();}}
}
export function nativeExplicitInputCapability(){return {start:false,steer:false,reason:'Fixture start is research-only; private start lacks an atomic idle guard and private steer can retarget a changed active turn'} as const;}
