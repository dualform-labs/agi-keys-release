import { LocalFollowerTransport, type FixtureBinding, type NativeTaskBinding, type FollowerObserver, type FollowerState, type ExpectedNativeSettings } from './follower.js';
import { BUILD } from './index.js';
export interface FixtureMetadata extends FollowerState { turnCount:number;requestCount:number;settingsKeys:string[]; collaborationMode:string|null }
/** Projects the authorized disposable fixture snapshot immediately. Never retains turns/items/body. */
export function projectFixtureSnapshot(message:any,fixture:NativeTaskBinding,owner:string):FixtureMetadata|null {
 if(message?.type!=='broadcast'||message.method!=='thread-stream-state-changed'||message.version!==11||message.sourceClientId!==owner||message.params?.conversationId!==fixture.conversationId||message.params.hostId!=='local'||message.params.change?.type!=='snapshot')return null;
 const c=message.params.change.conversationState,revision=message.params.change.revision;
 if(!c||c.id!==fixture.conversationId||!Number.isInteger(revision))throw Error('Fixture state identity mismatch');
 const model=c.latestThreadSettings?.model??c.latestModel;const effort=c.latestThreadSettings?.effort??c.latestReasoningEffort??null;
 if(typeof model!=='string'||!(effort===null||typeof effort==='string'))throw Error('Native model/effort missing');
 const turns=Array.isArray(c.turns)?c.turns:[];const requests=Array.isArray(c.requests)?c.requests:[];
 // No transcript fields leave this function. Turn status is only used to prohibit writes to an active fixture.
 const running=turns.length>0; // Conservative: this initial observer only certifies a zero-turn fixture as idle.
 return {conversationId:fixture.conversationId,ownerClientId:owner,capturedAt:Date.now(),revision,model,effort,allowedModelEfforts:{[model]:effort===null?[]:[effort]},activeTurnId:null,running,descendantCount:-1,pendingApprovals:requests.flatMap((r:any)=>r.method==='item/commandExecution/requestApproval'?[{id:r.id,kind:'command' as const}]:r.method==='item/fileChange/requestApproval'?[{id:r.id,kind:'file' as const}]:[]),turnCount:turns.length,requestCount:requests.length,settingsKeys:Object.keys(c.latestThreadSettings??{}),collaborationMode:c.latestCollaborationMode?.mode??null};
}
export class NativeMetadataObserver implements FollowerObserver {
 private transport:LocalFollowerTransport;private owner='';private latestRevision:number|null=null;private pending?:{resolve:(m:FixtureMetadata)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
 constructor(private endpoint:string,private fixture:NativeTaskBinding,private modelCatalogue:Record<string,string[]>={}){
 if(!['disposable-fixture','explicit-selected-task'].includes(fixture.purpose)||fixture.asarHash!==BUILD.asarHash)throw Error('Explicit current-build selected task required');
 this.transport=new LocalFollowerTransport(endpoint,message=>{try{const m=message as any;if(m?.type==='broadcast'&&m.method==='thread-stream-state-changed'&&m.version===11&&m.sourceClientId===this.owner&&m.params?.conversationId===this.fixture.conversationId&&m.params.hostId==='local'&&Number.isInteger(m.params.change?.revision))this.latestRevision=m.params.change.revision;const metadata=projectFixtureSnapshot(message,this.fixture,this.owner);if(metadata&&this.pending){if(Array.isArray(this.modelCatalogue[metadata.model]))metadata.allowedModelEfforts=Object.fromEntries(Object.entries(this.modelCatalogue).map(([model,efforts])=>[model,[...efforts]]));const p=this.pending;this.pending=undefined;clearTimeout(p.timer);p.resolve(metadata);}}catch(e){this.pending?.reject(e as Error);}});
 }
 async connect(){await this.transport.connect();const r=await this.transport.request('thread-owner-discovery',1,{hostId:'local',conversationId:this.fixture.conversationId});if(r.resultType!=='success'||r.method!=='thread-owner-discovery'||!r.handledByClientId){this.close();throw Error('Fixture owner unavailable');}this.owner=r.handledByClientId;}
 async read():Promise<FixtureMetadata>{if(!this.owner)throw Error('Fixture observer not connected');if(this.pending)throw Error('Fixture snapshot already pending');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending=undefined;reject(Error('Fixture metadata snapshot timed out'));},5000);this.pending={resolve,reject,timer};this.transport.followFixture(this.fixture.conversationId,this.owner,true);});}
 assertUnchanged(expected:ExpectedNativeSettings){if(expected.conversationId!==this.fixture.conversationId||expected.ownerClientId!==this.owner||expected.revision!==this.latestRevision)throw Error('Native state changed before dispatch; no command sent');}
 close(){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error('Fixture observer closed'));this.pending=undefined;}try{if(this.owner)this.transport.followFixture(this.fixture.conversationId,this.owner,false);}finally{this.owner='';this.transport.close();}}
}

/** Compatibility name for fixture-only harnesses. Production uses NativeMetadataObserver. */
export class FixtureMetadataObserver extends NativeMetadataObserver {constructor(endpoint:string,fixture:FixtureBinding,catalogue:Record<string,string[]>={}){super(endpoint,fixture,catalogue);}}
