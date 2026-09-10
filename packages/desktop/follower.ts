import { createConnection, type Socket } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { BUILD } from './index.js';
export type FollowerCommand =
 | { kind:'settings'; model?:string; effort?:string }
 | { kind:'interrupt'; expectedTurnId:string }
 | { kind:'approval'; approvalKind:'command'|'file'; requestId:string|number; decision:'accept'|'decline'|'cancel' };
export interface NativeTaskBinding { conversationId:string; asarHash:string; purpose:'disposable-fixture'|'explicit-selected-task' }
export interface FixtureBinding extends NativeTaskBinding { purpose:'disposable-fixture' }
/** Supplied only by a real metadata observer; no transcript/body field is accepted or needed. */
export interface FollowerState {
 conversationId:string;ownerClientId:string;capturedAt:number;revision:number;
 model:string;effort:string|null;allowedModelEfforts:Record<string,string[]>;
 activeTurnId:string|null;running:boolean;descendantCount:number;
 pendingApprovals:Array<{id:string|number;kind:'command'|'file'}>;
}
export interface ExpectedNativeSettings {conversationId:string;ownerClientId:string;revision:number;model:string;effort:string|null}
export interface FollowerObserver { read():Promise<FollowerState>;assertUnchanged?(expected:ExpectedNativeSettings):void }
export function assertExpectedNativeSettings(state:ExpectedNativeSettings,expected:ExpectedNativeSettings){if(state.conversationId!==expected.conversationId||state.ownerClientId!==expected.ownerClientId||state.revision!==expected.revision||state.model!==expected.model||state.effort!==expected.effort)throw Error('Native state changed since cycle calculation; no command sent');}
export interface FollowerResponse {type:'response';method?:string;resultType:'success'|'error';handledByClientId?:string;result?:unknown;error?:string}
export interface FollowerTransport {
 connect():Promise<void>;
 request(method:string,version:number,params:Record<string,unknown>,targetClientId?:string):Promise<FollowerResponse>;
 close():void;
}
export class FollowerOutcomeUnknown extends Error { readonly retrySafe=false; }
/** Private transport, not a public arbitrary RPC forwarding endpoint. Adapter owns every request. */
export class LocalFollowerTransport implements FollowerTransport {
 private socket?:Socket;private clientId='';private pending=new Map<string,{resolve:(v:FollowerResponse)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private endpoint:string,private broadcastListener?:(message:unknown)=>void){}
 async connect(){
 const [st,bytes]=await Promise.all([lstat(this.endpoint),readFile('/Applications/ChatGPT.app/Contents/Resources/app.asar')]);
 if(!st.isSocket()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw Error('IPC socket must be owner-only');
 if(createHash('sha256').update(bytes).digest('hex')!==BUILD.asarHash)throw Error('Unsupported native build');
 const socket=createConnection(this.endpoint);this.socket=socket;let buffer=Buffer.alloc(0);
 const fail=()=>{if(this.socket!==socket)return;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new FollowerOutcomeUnknown('IPC disconnected; never retry a mutation automatically'));}this.pending.clear();};
 socket.on('error',fail);socket.on('close',fail);
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(size===0||size>1024*1024){socket.destroy();return;}if(buffer.length<size+4)return;let m:any;try{m=JSON.parse(buffer.subarray(4,size+4).toString());}catch{socket.destroy();return;}buffer=buffer.length===size+4?Buffer.alloc(0):Buffer.from(buffer.subarray(size+4));if(m.type==='broadcast'){this.broadcastListener?.(m);continue;}if(m.type!=='response')continue;const p=this.pending.get(m.requestId);if(p){clearTimeout(p.timer);this.pending.delete(m.requestId);p.resolve(m);}}});
 await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>{socket.destroy();reject(Error('IPC connection timeout'));},3000);socket.once('connect',()=>{clearTimeout(t);resolve();});socket.once('error',e=>{clearTimeout(t);reject(e);});});
 const response=await this.request('initialize',0,{clientType:'codex-deck-fixture-adapter'});const result=response.result as any;
 if(response.resultType!=='success'||response.method!=='initialize'||typeof result?.clientId!=='string'){this.close();throw Error('IPC initialization failed');}this.clientId=result.clientId;
 }
 request(method:string,version:number,params:Record<string,unknown>,targetClientId?:string){
 if(!this.socket?.writable)throw Error('IPC not connected');
 if(!['initialize','thread-owner-discovery','thread-follower-start-turn','thread-follower-update-thread-settings','thread-follower-interrupt-turn','thread-follower-command-approval-decision','thread-follower-file-approval-decision'].includes(method))throw Error('Method not allowlisted');
 const requestId=randomUUID();const bytes=Buffer.from(JSON.stringify({type:'request',requestId,sourceClientId:this.clientId||'initializing-client',method,version,params,...(targetClientId?{targetClientId}:{})}));const frame=Buffer.alloc(bytes.length+4);frame.writeUInt32LE(bytes.length);bytes.copy(frame,4);
 return new Promise<FollowerResponse>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new FollowerOutcomeUnknown('IPC response timeout; never retry a mutation automatically'));},12000);this.pending.set(requestId,{resolve,reject,timer});this.socket!.write(frame);});
 }
 followFixture(conversationId:string,ownerClientId:string,following:boolean){if(!this.socket?.writable||!this.clientId)throw Error('IPC not initialized');const bytes=Buffer.from(JSON.stringify({type:'broadcast',method:'thread-stream-following-changed',version:1,sourceClientId:this.clientId,targetClientIds:[ownerClientId],params:{hostId:'local',conversationId,following}}));const frame=Buffer.alloc(bytes.length+4);frame.writeUInt32LE(bytes.length);bytes.copy(frame,4);this.socket.write(frame);}
 close(){this.socket?.destroy();this.socket=undefined;this.clientId='';}
}
function validateState(state:FollowerState,fixture:NativeTaskBinding,owner:string){
 if(state.conversationId!==fixture.conversationId||state.ownerClientId!==owner||!Number.isInteger(state.revision)||state.revision<0||!Number.isFinite(state.capturedAt)||Date.now()-state.capturedAt>2000||state.capturedAt>Date.now()+100)throw Error('Missing fresh exact-owner native metadata');
}
export function buildFollowerRequest(command:FollowerCommand,state:FollowerState){
 const conversationId=state.conversationId;
 if(command.kind==='settings'){
 if(command.model===undefined&&command.effort===undefined)throw Error('Empty settings change');
 const model=command.model??state.model;const efforts=state.allowedModelEfforts[model];if(!Array.isArray(efforts)||command.effort!==undefined&&!efforts.includes(command.effort))throw Error('Model/effort not observed as available');
 return {method:'thread-follower-update-thread-settings',version:1,params:{conversationId,threadSettings:{...(command.model!==undefined?{model:command.model}:{}),...(command.effort!==undefined?{effort:command.effort}:{})}}};
 }
 if(command.kind==='interrupt'){
 if(!state.running||state.activeTurnId!==command.expectedTurnId||state.descendantCount!==0)throw Error('Exact running turn with no descendants required');
 return {method:'thread-follower-interrupt-turn',version:4,params:{conversationId,mode:'user-stop',expectedTurnId:command.expectedTurnId}};
 }
 if(command.kind==='approval'){
 if(!['accept','decline','cancel'].includes(command.decision)||!['command','file'].includes(command.approvalKind)||!state.pendingApprovals.some(p=>p.id===command.requestId&&p.kind===command.approvalKind))throw Error('Exact pending approval required');
 return {method:command.approvalKind==='command'?'thread-follower-command-approval-decision':'thread-follower-file-approval-decision',version:1,params:{conversationId,requestId:command.requestId,decision:command.decision}};
 }
 throw Error('Unsupported typed follower command');
}
export class NormalFollowerAdapter {
 private busy=false;
 constructor(private fixture:NativeTaskBinding,private observer:FollowerObserver,private transport: FollowerTransport){}
 get conversationId(){return this.fixture.conversationId;}
 async execute(command:FollowerCommand,expected?:ExpectedNativeSettings){
 if(this.busy)throw Error('A native operation is already in progress');
 if(!['disposable-fixture','explicit-selected-task'].includes(this.fixture.purpose)||this.fixture.asarHash!==BUILD.asarHash||!this.observer||!this.fixture.conversationId)throw Error('Explicit selected task and observer required');
 this.busy=true;let dispatched=false;
 try{
 await this.transport.connect();
 const ownerResponse=await this.transport.request('thread-owner-discovery',1,{hostId:'local',conversationId:this.fixture.conversationId});
 const owner=ownerResponse.handledByClientId;if(ownerResponse.resultType!=='success'||ownerResponse.method!=='thread-owner-discovery'||!owner)throw Error('Exact fixture owner unavailable');
 const before=await this.observer.read();validateState(before,this.fixture,owner);if(expected)assertExpectedNativeSettings(before,expected);const request=buildFollowerRequest(command,before);
 // Revalidate routing immediately before the write, on the same connection and exact owner.
 const confirmed=await this.transport.request('thread-owner-discovery',1,{hostId:'local',conversationId:this.fixture.conversationId},owner);
 if(confirmed.resultType!=='success'||confirmed.method!=='thread-owner-discovery'||confirmed.handledByClientId!==owner)throw Error('Fixture owner changed before dispatch');
 if(expected){const latest=await this.observer.read();validateState(latest,this.fixture,owner);assertExpectedNativeSettings(latest,expected);this.observer.assertUnchanged?.(expected);}
 if(Date.now()-before.capturedAt>2000)throw Error('Metadata became stale before dispatch');
 dispatched=true;const response=await this.transport.request(request.method,request.version,request.params,owner);
 if(response.resultType!=='success')throw new FollowerOutcomeUnknown('Native operation refused or failed; inspect state before any retry');
 if(response.method!==request.method||response.handledByClientId!==owner)throw new FollowerOutcomeUnknown('Response owner/method mismatch');
 const result=response.result as any;if(result?.ok!==true)throw new FollowerOutcomeUnknown('Unexpected native result');
 const after=await this.observer.read();validateState(after,this.fixture,owner);
 const newer=after.revision>before.revision;let observed=false;
 if(command.kind==='settings')observed=newer&&(command.model===undefined||after.model===command.model)&&(command.effort===undefined||after.effort===command.effort);
 if(command.kind==='interrupt')observed=result.interruptedTurnId===command.expectedTurnId&&newer&&(!after.running||after.activeTurnId!==command.expectedTurnId)&&!result.goalPauseError;
 // Approval handler returns ok even if pending request disappeared. Request removal alone cannot prove the decision.
 const approvalRemoved=command.kind==='approval'?!after.pendingApprovals.some(p=>p.id===command.requestId&&p.kind===command.approvalKind):undefined;
 return {backend:'normal-desktop-ipc',dispatched:true,acknowledged:true,observed,approvalRemoved,reason:observed?null:command.kind==='approval'?'Approval response acknowledged; actual decision outcome has no verified metadata observer':'Native outcome was not observed; do not retry automatically'};
 }catch(error){if(dispatched&&!(error instanceof FollowerOutcomeUnknown))throw new FollowerOutcomeUnknown('Native write may have occurred but observation failed; do not retry automatically');throw error;}
 finally{this.transport.close();this.busy=false;}
 }
}

export function parseFollowerCommand(commandId:string,args:Record<string,unknown>):FollowerCommand {
 if(commandId==='native.settings'){
 if(args.model!==undefined&&(typeof args.model!=='string'||args.model.length===0||args.model.length>128)||args.effort!==undefined&&(typeof args.effort!=='string'||args.effort.length===0||args.effort.length>32))throw Error('Invalid model/effort input');
 return {kind:'settings',...(args.model!==undefined?{model:args.model as string}:{}),...(args.effort!==undefined?{effort:args.effort as string}:{})};
 }
 if(commandId==='native.interrupt'){
 if(typeof args.expectedTurnId!=='string'||args.expectedTurnId.length===0||args.expectedTurnId.length>128)throw Error('Exact expected turn ID required');return {kind:'interrupt',expectedTurnId:args.expectedTurnId};
 }
 if(commandId==='native.approval'){
 if(!['command','file'].includes(String(args.approvalKind))||!['accept','decline','cancel'].includes(String(args.decision))||!(typeof args.requestId==='string'&&args.requestId.length>0&&args.requestId.length<=128||typeof args.requestId==='number'&&Number.isSafeInteger(args.requestId)))throw Error('Invalid approval input');
 return {kind:'approval',approvalKind:args.approvalKind as 'command'|'file',decision:args.decision as 'accept'|'decline'|'cancel',requestId:args.requestId as string|number};
 }
 throw Error('Unsupported normal follower command');
}
