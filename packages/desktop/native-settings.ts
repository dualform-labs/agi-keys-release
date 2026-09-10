import { join } from 'node:path';
import { homedir } from 'node:os';
import { BUILD } from './index.js';
import { FollowerOutcomeUnknown, LocalFollowerTransport, NormalFollowerAdapter, parseFollowerCommand, type NativeTaskBinding } from './follower.js';
import { NativeMetadataObserver, type FixtureMetadata } from './fixture-observer.js';
export interface NativeSettingsOptions {
 /** Catalogue validates available choices only. Task ownership/state always come from desktop IPC. */
 modelCatalogue:ReadonlyArray<{id:string;efforts:readonly string[]}>;
 endpoint?:string;
}
export interface NativeSettingsArgs {model?:string;effort?:string}
const activeTargets=new Set<string>();
function binding(threadId:string):NativeTaskBinding{
 if(!/^[a-zA-Z0-9_-]{8,128}$/.test(threadId))throw Error('Exact explicitly selected local task ID required');
 return {conversationId:threadId,purpose:'explicit-selected-task',asarHash:BUILD.asarHash};
}
function catalogue(options:NativeSettingsOptions){
 if(!Array.isArray(options.modelCatalogue)||options.modelCatalogue.length===0)throw Error('Live model catalogue required');
 const result:Record<string,string[]>={};for(const row of options.modelCatalogue){if(typeof row.id!=='string'||!Array.isArray(row.efforts)||!row.efforts.every((e:unknown)=>typeof e==='string'))throw Error('Invalid model catalogue');result[row.id]=[...row.efforts];}return result;
}
function metadata(state:FixtureMetadata){return {threadId:state.conversationId,model:state.model,effort:state.effort,revision:state.revision,capturedAt:state.capturedAt,turnCount:state.turnCount,requestCount:state.requestCount};}
/** Explicit selected local task only; native wire snapshot is immediately projected, never persisted. */
export async function readNativeSettings(targetThreadId:string,options:NativeSettingsOptions){
 const observer=new NativeMetadataObserver(options.endpoint??join(homedir(),'.codex','ipc','ipc.sock'),binding(targetThreadId),catalogue(options));
 try{await observer.connect();return {backend:'normal-desktop-ipc' as const,...metadata(await observer.read())};}finally{observer.close();}
}
/** Production operation: real desktop owner, one bounded write, observed native state, unconditional cleanup. */
export async function executeNativeSettings(targetThreadId:string,args:NativeSettingsArgs,options:NativeSettingsOptions){return performNativeSettings(targetThreadId,args,options);}
export async function cycleNativeSettings(targetThreadId:string,axis:NativeSettingsAxis,delta:number,options:NativeSettingsOptions){return performNativeSettings(targetThreadId,undefined,options,{axis,delta});}
async function performNativeSettings(targetThreadId:string,requested:NativeSettingsArgs|undefined,options:NativeSettingsOptions,cycleInput?:{axis:NativeSettingsAxis;delta:number}){
 const target=binding(targetThreadId),models=catalogue(options);
 if(activeTargets.has(targetThreadId))throw Error('A settings operation for this task is already in progress');
 const endpoint=options.endpoint??join(homedir(),'.codex','ipc','ipc.sock');
 const observer=new NativeMetadataObserver(endpoint,target,models);
 activeTargets.add(targetThreadId);let writeStarted=false;
 try{
 await observer.connect();const before=await observer.read();
 const plan=cycleInput?computeNativeSettingsCycle(before,cycleInput.axis,cycleInput.delta,Object.entries(models).map(([id,efforts])=>({id,efforts}))):{args:requested!,cycle:undefined};const args=plan.args;const command=parseFollowerCommand('native.settings',args as Record<string,unknown>);
 const writer=new NormalFollowerAdapter(target,observer,new LocalFollowerTransport(endpoint));
 const result=await writer.execute(command,cycleInput?before:undefined);writeStarted=true;
 const after=await observer.read();
 const finalMatches=(args.model===undefined||after.model===args.model)&&(args.effort===undefined||after.effort===args.effort);
 return {...result,...(plan.cycle?{cycle:plan.cycle}:{}),executed:result.observed&&finalMatches,observed:result.observed&&finalMatches,model:after.model,effort:after.effort,revision:after.revision,threadId:targetThreadId,before:metadata(before),after:metadata(after),reason:result.observed&&finalMatches?null:'Native settings outcome did not remain observed; inspect before retrying'};
 }catch(error){if(writeStarted&&!(error instanceof FollowerOutcomeUnknown))throw new FollowerOutcomeUnknown('Native settings may have changed; final observation failed. Do not retry automatically.');throw error;}finally{observer.close();activeTargets.delete(targetThreadId);}
}

export type NativeSettingsAxis='model'|'effort';
/** Deterministic catalogue-order cycle; pure calculation, never invents an unsupported effort. */
export function computeNativeSettingsCycle(current:{model:string;effort:string|null},axis:NativeSettingsAxis,delta:number,rows:NativeSettingsOptions['modelCatalogue']){
 if(!['model','effort'].includes(axis)||!Number.isSafeInteger(delta)||delta===0)throw Error('Cycle requires a model/effort axis and nonzero safe integer ticks');
 const models=[...new Map(rows.map(row=>[row.id,row])).values()];const row=models.find(m=>m.id===current.model);if(!row)throw Error('Current native model is absent from live catalogue');
 const advance=(index:number,count:number)=>((index+delta%count)%count+count)%count;
 if(axis==='effort'){
 const efforts=[...new Set(row.efforts)];const index=efforts.indexOf(current.effort??'');if(index<0||efforts.length===0)throw Error('Current native effort is absent from live catalogue');
 return {args:{effort:efforts[advance(index,efforts.length)]} as NativeSettingsArgs,cycle:{axis,delta,effortAdjusted:false,effortPolicy:'catalogue-order'}};
 }
 const next=models[advance(models.indexOf(row),models.length)];const efforts=[...new Set(next.efforts)];if(efforts.length===0)throw Error('Target model has no catalogue-supported effort');
 const keep=current.effort!==null&&efforts.includes(current.effort);const effort=keep?current.effort!:efforts[0];
 return {args:{model:next.id,effort} as NativeSettingsArgs,cycle:{axis,delta,effortAdjusted:!keep,effortPolicy:keep?'preserved':'first-supported-catalogue-effort'}};
}
