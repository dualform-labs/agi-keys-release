import { spawn } from 'node:child_process';
import { mkdir, open, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILD, launchPreflight } from './index.js';
export interface LaunchDependencies {
 preflight:typeof launchPreflight;
 start:(args:string[],logFd:number)=>Promise<number>;
}
const dependencies:LaunchDependencies={preflight:launchPreflight,start:async(args,logFd)=>{
 const child=spawn('/usr/bin/taskpolicy',['-B','-t','0','-l','0',...args],{detached:true,stdio:['ignore',logFd,logFd]});
 await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();if(!child.pid)throw Error('No owned launch PID');return child.pid;
}};
/** Explicit user invocation only; never terminates existing or newly started Codex. */
export async function startDedicated(runtimeDirectory:string,deps:LaunchDependencies=dependencies,transport?:'tcp'){
 const preflight=await deps.preflight();if(!preflight.allowed)throw Error(preflight.reason);
 if(transport!=='tcp')throw Error('Pipe transport is not implemented. Explicit --tcp is required to opt into an unauthenticated loopback CDP listener.');
 await mkdir(runtimeDirectory,{recursive:true,mode:0o700});const st=await lstat(runtimeDirectory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw Error('Runtime directory must be owner-only');
 // Reserve metadata before spawning; prevents duplicate launcher starts in this directory.
 const descriptor=await open(join(runtimeDirectory,'desktop-launch.json'),'wx',0o600);
 const log=await open(join(runtimeDirectory,'desktop-launch.log'),'ax',0o600);
 try{
 const pid=await deps.start([BUILD.executable,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'],log.fd);
 const record={pid,version:BUILD.version,asarHash:BUILD.asarHash,transport:'loopback',state:'awaiting-owned-listener',port:null};
 await descriptor.writeFile(JSON.stringify(record));return record;
 }finally{await descriptor.close();await log.close();}
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const exec=promisify(execFile);
export function parseOwnedListener(output:string):number {
 const lines=output.split('\n').filter(l=>l.startsWith('n'));
 if(lines.length!==1||!/^n127\.0\.0\.1:\d+$/.test(lines[0]))throw Error('Expected one strictly loopback owned CDP listener');
 const port=Number(lines[0].split(':')[1]);if(port<1024||port>65535)throw Error('Invalid owned port');return port;
}
export async function discoverEndpoint(runtimeDirectory:string){
 const path=join(runtimeDirectory,'desktop-launch.json');const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw Error('Invalid launch record permissions');
 const record=JSON.parse(await readFile(path,'utf8'));
 if(!Number.isInteger(record.pid)||record.pid<1||record.version!==BUILD.version||record.asarHash!==BUILD.asarHash)throw Error('Invalid launch record');
 const {stdout:identity}=await exec('/bin/ps',['-p',String(record.pid),'-o','uid=,comm=,args=']);
 if(!identity.trim().startsWith(String(process.getuid?.()))||!identity.includes(BUILD.executable)||!identity.includes('--remote-debugging-port=0'))throw Error('Owned launch PID identity changed');
 const {stdout}=await exec('/usr/sbin/lsof',['-nP','-a','-p',String(record.pid),'-iTCP','-sTCP:LISTEN','-Fn']);
 const port=parseOwnedListener(stdout);const endpoint={pid:record.pid,port,version:record.version,asarHash:record.asarHash};
 await writeFile(join(runtimeDirectory,'desktop-endpoint.json'),JSON.stringify(endpoint),{mode:0o600,flag:'wx'});return endpoint;
}
async function main(){
 const [command,runtimeDirectory,transport]=process.argv.slice(2);
 if(command==='preflight'){console.log(JSON.stringify(await launchPreflight(),null,2));return;}
 if(!runtimeDirectory||!['start','discover'].includes(command))throw Error('Usage: launch.ts preflight | start /absolute/runtime-dir | discover /absolute/runtime-dir');
 if(!runtimeDirectory.startsWith('/'))throw Error('Absolute runtime directory required');
 console.log(JSON.stringify(command==='start'?await startDedicated(runtimeDirectory,dependencies,transport==='--tcp'?'tcp':undefined):await discoverEndpoint(runtimeDirectory),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
