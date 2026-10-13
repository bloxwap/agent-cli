import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite,type Config,stateDir} from '../core/config.js';
import {AgentCliError} from '../errors/index.js';
import {events} from '../runner/events.js';
export function assertAgentValid(config:Config,now=Date.now()){
 if(!config.agentExpiry||config.agentExpiry<=now) throw new AgentCliError('AGENT_EXPIRED','Rotate expired agent');
}
export async function expiryWarnings(config:Config,options:{now?:number;path?:string;emit?:(data:unknown)=>Promise<void>}={}){
 if(!config.agentExpiry) return [];const now=options.now??Date.now();const path=options.path??join(stateDir(),'expiry-warnings.json');let emitted:string[]=[];
 try{emitted=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
 const days=(config.agentExpiry-now)/86400000;const warnings=[];
 for(const threshold of config.expiryWarningDays){const key=`${config.agentAddress}:${config.agentExpiry}:${threshold}`;if(days<=threshold&&!emitted.includes(key)){const warning={agentAddress:config.agentAddress,expiry:config.agentExpiry,daysRemaining:String(Math.max(0,days)),threshold:String(threshold)};await (options.emit??(async data=>{await events.append('agent_expiry_warning',data);}))(warning);emitted.push(key);warnings.push(warning);}}
 if(warnings.length) await atomicWrite(path,JSON.stringify(emitted));return warnings;
}
