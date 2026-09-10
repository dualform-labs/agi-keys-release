import { createConnection } from 'node:net';
import { lstat, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { BUILD } from './index.js';
import { parseFollowerCommand, type NormalFollowerAdapter } from './follower.js';
/** Only source-confirmed read-only requests. No subscriptions, listing guesses or follower writes. */
export interface NormalOwnerObservation {initialized:boolean;ownerFound:boolean;ownerClientId:string|null;reason:string|null;hasUnreadTurn?:boolean|null;metadataEventObserved?:boolean}
export async function probeNormalOwner(endpoint:string,conversationId:string,hostId='local',observeMs=0){
 if(!Number.isInteger(observeMs)||observeMs<0||observeMs>30000)throw Error('Invalid metadata observation window');
 if(!/^[a-zA-Z0-9_-]{8,128}$/.test(conversationId)||hostId!=='local')throw Error('Exact known local task ID required');
 const hash=createHash('sha256').update(await readFile('/Applications/ChatGPT.app/Contents/Resources/app.asar')).digest('hex');if(hash!==BUILD.asarHash)throw Error('Unsupported Codex build for normal IPC probe');
 const st=await lstat(endpoint);if(!st.isSocket()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw Error('IPC endpoint is not owner-only socket');
 return new Promise<NormalOwnerObservation>((resolve,reject)=>{
 const socket=createConnection(endpoint);let buffer=Buffer.alloc(0),clientId='',requestId=randomUUID(),stage='initialize',settled=false;let observation:NormalOwnerObservation|undefined;
 const finish=(error?:Error,result?:NormalOwnerObservation)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result!);};
 let timer=setTimeout(()=>finish(Error('Normal IPC owner probe timed out')),12000);
 const send=(method:string,params:object,version:number)=>{requestId=randomUUID();const bytes=Buffer.from(JSON.stringify({type:'request',requestId,sourceClientId:clientId||'initializing-client',version,method,params}));const frame=Buffer.alloc(bytes.length+4);frame.writeUInt32LE(bytes.length);bytes.copy(frame,4);socket.write(frame);};
 socket.once('connect',()=>send('initialize',{clientType:'codex-deck-owner-probe'},0));socket.once('error',e=>finish(e));socket.once('close',()=>{if(!settled)finish(Error('Normal IPC closed before owner response'));});
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(size===0||size>1024*1024){finish(Error('IPC frame exceeds metadata probe bound'));return;}if(buffer.length<size+4)return;let message:any;try{message=JSON.parse(buffer.subarray(4,size+4).toString());}catch{finish(Error('Malformed IPC response'));return;}buffer=buffer.subarray(size+4);
 // Read only the finite metadata event from the exact resolved owner; never subscribe to conversation streams.
 if(stage==='observe'&&observation){const unread=parseUnreadMetadata(message,conversationId,observation.ownerClientId!);if(unread!==null){observation.hasUnreadTurn=unread;observation.metadataEventObserved=true;}continue;}
 // Discard unrelated broadcasts without persisting or exposing their contents.
 if(message.type!=='response'||message.requestId!==requestId)continue;
 if(stage==='initialize'){
 if(message.resultType!=='success'||typeof message.result?.clientId!=='string'){finish(Error('IPC initialization refused'));return;}
 clientId=message.result.clientId;stage='owner';send('thread-owner-discovery',{hostId,conversationId},1);
 }else{
 const found=message.resultType==='success'&&typeof message.handledByClientId==='string';observation={initialized:true,ownerFound:found,ownerClientId:found?message.handledByClientId:null,reason:found?null:message.error==='no-client-found'?'No running owner found for this exact task':'Owner discovery refused'};if(found&&observeMs>0){stage='observe';observation.hasUnreadTurn=null;observation.metadataEventObserved=false;clearTimeout(timer);timer=setTimeout(()=>finish(undefined,observation),observeMs);continue;}finish(undefined,observation);return;
 }
 }});
 });
}

/** Normal-start, plugin-callable owner observation. Does not pretend ownership is task status. */
export class NormalDesktopAdapter {
 private ownerClientId:string|null=null;
 constructor(private endpoint:string,private conversationId:string,private follower?:NormalFollowerAdapter){}
 capability(){return {
 backend:'normal-desktop-ipc', ownerObservation:true, taskState:false, settings:false, steer:false, interrupt:false, approval:false, composer:false,
 reason:'Owner discovery is verified. Native state subscription includes the full conversation; metadata-only observation is not established.'
 };}
 async snapshot(){
 const result=await probeNormalOwner(this.endpoint,this.conversationId);
 const ownerChanged=this.ownerClientId!==null&&result.ownerClientId!==this.ownerClientId;
 this.ownerClientId=result.ownerClientId;
 return {backend:'normal-desktop-ipc',conversationId:this.conversationId,ownerPresent:result.ownerFound,ownerChanged,taskStatus:null,model:null,effort:null,observedAt:Date.now(),reason:result.reason};
 }
 async observeMetadata(durationMs=1000){const result=await observeNormalMetadata(this.endpoint,this.conversationId,durationMs);const {ownerClientId,...metadata}=result;const ownerChanged=this.ownerClientId!==null&&ownerClientId!==this.ownerClientId;this.ownerClientId=ownerClientId;return {backend:'normal-desktop-ipc',conversationId:this.conversationId,ownerChanged,...metadata};}
 async execute(commandId:string,args:Record<string,unknown>={}){if(!this.follower)throw Error('Normal desktop mutation disabled: explicit fixture and exact live state/result observer have not been established');if(this.follower.conversationId!==this.conversationId)throw Error('Follower fixture does not match selected task');return this.follower.execute(parseFollowerCommand(commandId,args));}
}

/** Installed renderer emits this body-free metadata at offset3036197; method version2. */
export function parseUnreadMetadata(message:any,conversationId:string,ownerClientId:string):boolean|null {
 if(message?.type!=='broadcast'||message.method!=='thread-read-state-changed'||message.version!==2||message.sourceClientId!==ownerClientId||message.params?.conversationId!==conversationId||message.params.hostId!=='local'||typeof message.params.hasUnreadTurn!=='boolean')return null;
 return message.params.hasUnreadTurn;
}
export async function observeNormalMetadata(endpoint:string,conversationId:string,durationMs=1000){return probeNormalOwner(endpoint,conversationId,'local',durationMs);}
