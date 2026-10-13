import {assertSafeInput} from '../wallet/safety.js';
import {createServer,createConnection,type Server} from 'node:net';
import {chmod,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {stateDir,loadConfig} from '../core/config.js';
import {AgentCliError,normalizeError} from '../errors/index.js';
import {commands,type Context} from '../core/router.js';
import type {Runner} from './lifecycle.js';
export const socketPath=(directory=stateDir())=>process.platform==='win32'?`\\\\.\\pipe\\bloxwap-${createHash('sha256').update(directory).digest('hex').slice(0,24)}`:join(directory,'run.sock');
const aliases:Record<string,string>={'status.get':'status','balance.get':'balance','positions.get':'positions','orders.get':'orders','order.place':'order','order.cancel':'cancel','order.modify':'modify','leverage.set':'leverage','config.get':'config','runner.shutdown':'shutdown'};
export const routedCommands=new Set(['status','balance','positions','orders','order','cancel','modify','leverage','rotate','revoke']);
const requestSchema=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string(),z.number(),z.null()]),method:z.string(),params:z.record(z.string(),z.unknown()).default({})});
export async function rpcServer(runner:Runner,context:Context,execute?: (name:string,input:Record<string,unknown>)=>Promise<unknown>):Promise<Server>{
 const path=socketPath(runner.directory);let queue=Promise.resolve();
 const server=createServer(socket=>{
 let buffer='';socket.setEncoding('utf8');socket.setTimeout(30_000,()=>socket.destroy());
 socket.on('data',chunk=>{
 buffer+=chunk;if(Buffer.byteLength(buffer)>1_048_576){socket.destroy();return;}
 let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);queue=queue.then(async()=>{
 let id:unknown=null;
 try{const request=requestSchema.parse(JSON.parse(line));id=request.id;const name=aliases[request.method]??request.method;
 if(name==='shutdown'){socket.write(JSON.stringify({jsonrpc:'2.0',id,result:{stopping:true}})+'\n');setImmediate(()=>{void runner.shutdown();});return;}
 if(!routedCommands.has(name)&&name!=='config') throw new AgentCliError('CONFIG_INVALID','Unknown runner method');
 const command=commands.get(name);if(!command&&!execute) throw new AgentCliError('CONFIG_INVALID','Unavailable method');
 assertSafeInput(request.params);const input=name==='config'?{args:['get']}:request.params;const parsed=command?.schema.safeParse(input);if(parsed&&!parsed.success) throw new AgentCliError('CONFIG_INVALID','Invalid runner input');
 const data=execute?await execute(name,input):await command!.execute(parsed!.data as Record<string,unknown>,{...context,runner:true});
 socket.write(JSON.stringify({jsonrpc:'2.0',id,result:data})+'\n');
 }catch(error){const normalized=error instanceof SyntaxError||error instanceof z.ZodError?new AgentCliError('CONFIG_INVALID','Invalid JSON-RPC request'):normalizeError(error);socket.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32000,message:normalized.message,data:normalized.toJSON()}})+'\n');}
 }).catch(error=>{runner.logger.log('error','RPC write failed',{error:String(error)});socket.destroy();});}
 });socket.on('error',()=>{});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,()=>{server.off('error',reject);resolve();});});
 if(process.platform!=='win32') await chmod(path,0o600);
 runner.onShutdown(async()=>{await queue;await new Promise<void>(resolve=>server.close(()=>resolve()));if(process.platform!=='win32') await unlink(path).catch(()=>{});});return server;
}
export function rpcCall(method:string,params:Record<string,unknown>={},path=socketPath()):Promise<unknown>{
 return new Promise((resolve,reject)=>{const id=1;const socket=createConnection(path);let buffer='';socket.setEncoding('utf8');socket.setTimeout(15_000,()=>socket.destroy(new Error('Runner timeout')));
 socket.once('connect',()=>socket.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'));
 socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>1_048_576){socket.destroy(new Error('Oversize runner response'));return;}if(!buffer.includes('\n')) return;
 try{const response=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));if(response.jsonrpc!=='2.0'||response.id!==id) throw new Error('Invalid runner response');if(response.error){const error=response.error.data;reject(new AgentCliError(error.code,error.message,error.details,error.retryable));}else resolve(response.result);socket.end();}catch(error){reject(error);socket.destroy();}});
 socket.once('error',error=>reject(new AgentCliError('RUNNER_NOT_RUNNING',error.message)));socket.once('end',()=>{if(!buffer.includes('\n')) reject(new AgentCliError('RUNNER_NOT_RUNNING','Runner disconnected'));});
 });
}
export async function routeToRunner(name:string,input:Record<string,unknown>,context:Context){
 if(context.runner||!routedCommands.has(name)) return {routed:false as const};
 const config=await loadConfig(context.configPath);
 try{return {routed:true as const,data:await rpcCall(name,{...input,...(context.network?{network:context.network}:{})})};}catch(error){if(error instanceof AgentCliError&&error.code==='RUNNER_NOT_RUNNING'&&config.runnerFallback) return {routed:false as const};throw error;}
}
