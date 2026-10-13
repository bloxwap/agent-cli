import type {Subscriptions} from './subscriptions.js';
import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {stateDir,type Config} from '../core/config.js';
import {Logger} from '../core/logger.js';
import {privyClient,privySigner} from '../wallet/privy.js';
import type {Signer} from '../core/hlclient.js';
import {AgentCliError} from '../errors/index.js';
export interface RunnerInfo {pid:number;startedAt:number;network:Config['network'];}
export const runnerPidPath=()=>join(stateDir(),'runner.pid');
export function isAlive(pid:number){try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}}
export async function runningInfo(path=runnerPidPath()):Promise<RunnerInfo|null>{try{const info=JSON.parse(await readFile(path,'utf8')) as RunnerInfo;return Number.isInteger(info.pid)&&info.pid>0&&isAlive(info.pid)?info:null;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'||error instanceof SyntaxError) return null;throw error;}}
export class Runner {
 subscriptions?:Subscriptions;readonly info:RunnerInfo;readonly logger:Logger;signer?:Signer;private timer?:NodeJS.Timeout;private cleanup:(()=>Promise<void>)[]=[];private closing=false;
 constructor(readonly config:Config,readonly directory=stateDir()){this.info={pid:process.pid,startedAt:Date.now(),network:config.network};this.logger=new Logger({level:config.logLevel,directory:join(directory,'logs')});}
 async start(openSigner:()=>Promise<Signer>=async()=>privySigner(this.config,await privyClient(this.config))){
 await mkdir(this.directory,{recursive:true,mode:0o700});const path=join(this.directory,'runner.pid');
 let handle;try{handle=await open(path,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;const existing=await runningInfo(path);if(existing) return {existing:true,...existing};throw new AgentCliError('RUNNER_NOT_RUNNING','Stale runner lock; inspect and remove runner.pid before restart');}
 try{await handle.writeFile(JSON.stringify(this.info));await handle.close();this.signer=await openSigner();this.timer=setInterval(()=>{},30_000);this.logger.log('info','Runner started',{...this.info});await this.logger.flush();return {existing:false,...this.info};}catch(error){await handle.close().catch(()=>{});await unlink(path).catch(()=>{});throw error;}
 }
 onShutdown(cleanup:()=>Promise<void>){this.cleanup.push(cleanup);}
 async shutdown(){if(this.closing) return;this.closing=true;if(this.timer) clearInterval(this.timer);for(const cleanup of this.cleanup.reverse()) await cleanup();this.signer=undefined;this.logger.log('info','Runner stopped');await this.logger.flush();await unlink(join(this.directory,'runner.pid')).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;});}
 signals(){const handler=()=>{void this.shutdown().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});};process.once('SIGINT',handler);process.once('SIGTERM',handler);this.onShutdown(async()=>{process.off('SIGINT',handler);process.off('SIGTERM',handler);});}
}
export async function detachRunner(args:string[],path=runnerPidPath()){
 const existing=await runningInfo(path);if(existing) return existing;
 const child=spawn(process.execPath,[process.argv[1],'run',...args],{detached:true,stdio:'ignore',env:process.env});child.unref();
 for(let i=0;i<100;i++){const info=await runningInfo(path);if(info) return info;await new Promise(resolve=>setTimeout(resolve,50));}
 throw new AgentCliError('RUNNER_NOT_RUNNING','Detached runner did not become ready');
}
export let activeRunner:Runner|undefined;
export function setActiveRunner(runner:Runner|undefined){activeRunner=runner;}
