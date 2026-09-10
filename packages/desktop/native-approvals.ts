import type { FixtureBinding } from './follower.js';
import { BUILD } from './index.js';
export interface PendingNativeApproval {
 requestId:string|number;kind:'command'|'file';threadId:string;turnId:string;itemId:string;
 approvalId:string|null;ownerClientId:string;revision:number;
}
/** Narrow snapshot projection. Command text, paths, diffs and conversation items never escape. */
export function projectPendingNativeApprovals(message:any,fixture:FixtureBinding,owner:string):PendingNativeApproval[]|null {
 if(fixture.purpose!=='disposable-fixture'||fixture.asarHash!==BUILD.asarHash)throw Error('Current-build disposable fixture required');
 if(message?.type!=='broadcast'||message.method!=='thread-stream-state-changed'||message.version!==11||message.sourceClientId!==owner||message.params?.hostId!=='local'||message.params.conversationId!==fixture.conversationId||message.params.change?.type!=='snapshot')return null;
 const {conversationState:state,revision}=message.params.change;
 if(state?.id!==fixture.conversationId||!Number.isSafeInteger(revision)||revision<0||!Array.isArray(state.requests))throw Error('Invalid approval snapshot');
 return state.requests.flatMap((request:any)=>{
 const kind=request.method==='item/commandExecution/requestApproval'?'command':request.method==='item/fileChange/requestApproval'?'file':null;
 if(!kind)return [];
 const p=request.params,id=request.id;
 if(!(typeof id==='string'&&id.length>0||typeof id==='number'&&Number.isSafeInteger(id))||p?.threadId!==fixture.conversationId||typeof p.turnId!=='string'||!p.turnId||typeof p.itemId!=='string'||!p.itemId)throw Error('Approval request identity missing');
 if(p.approvalId!=null&&typeof p.approvalId!=='string')throw Error('Invalid approval callback identity');
 return [{requestId:id,kind,threadId:fixture.conversationId,turnId:p.turnId,itemId:p.itemId,approvalId:p.approvalId??null,ownerClientId:owner,revision}];
 });
}
/** Installed owner reply and resolution events omit the applied decision. Never promote ACK to success. */
export function nativeApprovalCapability(){return {available:false,observed:false,reason:'Exact pending identity is observable, but native resolution metadata does not identify the applied decision; production approval dispatch remains disabled'} as const;}
