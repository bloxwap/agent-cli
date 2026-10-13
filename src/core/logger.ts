import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, stat, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir } from './config.js';
export const levels={debug:10,info:20,warn:30,error:40};
export type Level=keyof typeof levels;
export function redact(value: unknown): unknown {
 if (typeof value==='string') return value.replace(/(?:0x)?[a-fA-F0-9]{64,}/g,'[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]');
 if (Array.isArray(value)) return value.map(redact);
 if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,/secret|signature|token|authorization|private.?key|seed|mnemonic|password|app.?key/i.test(key) ? '[REDACTED]' : redact(v)]));
 return value;
}
export class Logger {
 private queue:Promise<void>=Promise.resolve();
 private day=new Date().toISOString().slice(0,10);
 readonly requestId: string;
 constructor(private options:{level?:Level;directory?:string;maxBytes?:number;requestId?:string;intentId?:string;stderr?:(line:string)=>void}={}) {this.requestId=options.requestId??randomUUID();}
 log(level:Level,message:string,fields:Record<string,unknown>={}) {
  if(levels[level]<levels[this.options.level??'info']) return;
  const line=JSON.stringify(redact({...fields,time:new Date().toISOString(),level,message,requestId:this.requestId,intentId:this.options.intentId}))+'\n';
  (this.options.stderr??(line=>process.stderr.write(line)))(line);
  this.queue=this.queue.then(async()=>{
   const dir=this.options.directory??join(stateDir(),'logs');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
   const path=join(dir,'runner.jsonl');const day=new Date().toISOString().slice(0,10);
   try {const info=await stat(path);if(info.size+Buffer.byteLength(line)>(this.options.maxBytes??5_000_000)||day!==this.day) await rename(path,join(dir,`runner.${Date.now()}.${randomUUID()}.jsonl`));} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
   this.day=day;await appendFile(path,line,{mode:0o600});
  });
 }
 async flush(){await this.queue;}
}
