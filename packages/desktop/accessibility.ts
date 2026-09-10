import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const bundle='com.openai.codex';
export interface MacAppTransport { run(file:string,args:string[]):Promise<{stdout:string}> }
const transport:MacAppTransport={run:(file,args)=>exec(file,args,{timeout:5000,maxBuffer:16384})};
/** Minimal macOS observation: process identity/frontmost only. No AX conversation tree read. */
export class NormalAppAdapter {
 constructor(private host:MacAppTransport=transport){}
 async snapshot(){
 const {stdout}=await this.host.run('/usr/bin/osascript',['-e',`tell application "System Events"\nset matches to application processes whose bundle identifier is "${bundle}"\nif (count of matches) is not 1 then return "unavailable"\nreturn frontmost of item 1 of matches\nend tell`]);
 const value=stdout.trim();if(!['true','false','unavailable'].includes(value))throw Error('Unexpected app identity response');
 return {backend:'macos-accessibility',running:value!=='unavailable',frontmost:value==='true',conversationRead:false};
 }
 capability(){return {backend:'macos-accessibility',commands:['app.focus'],taskControl:false,model:false,microphone:false};}
 async execute(commandId:string){
 if(commandId!=='app.focus')throw Error('Unsupported or unobserved native UI command');
 if(!(await this.snapshot()).running)throw Error('Codex is not already running; adapter will not launch it');
 await this.host.run('/usr/bin/open',['-b',bundle]);
 const after=await this.snapshot();if(!after.frontmost)throw Error('Codex focus was not observed');
 return {executed:true,observed:true,backend:'macos-accessibility',result:after};
 }
}
