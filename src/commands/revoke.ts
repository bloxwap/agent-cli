import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {register} from '../core/router.js';
import {commandConfig} from './read.js';
import {cancelOrders,cancelSchema} from './cancel.js';
import {atomicWrite,saveConfig,stateDir,type Config} from '../core/config.js';
import {approval,submitApproval,type Approval} from '../wallet/approval.js';
import {activeRunner} from '../runner/lifecycle.js';
import {AgentCliError} from '../errors/index.js';
export function markRevoked(config:Config){config.revoked=true;config.approved=false;return config;}
register('revoke',{description:'Disable local agent and prepare master-signed exchange revocation',schema:z.object({cancelOrders:z.boolean().default(false),signature:z.string().optional()}),execute:async(input,context)=>{
 const config=await commandConfig(context);if(!config.agentAddress) throw new AgentCliError('AGENT_NOT_APPROVED','No agent to revoke');
 if(input.cancelOrders&&!config.revoked) await cancelOrders(config,cancelSchema.parse({all:true}));
 const path=join(stateDir(),`revoke-${config.agentAddress}.json`);let pending:Approval;
 try{pending=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;pending=approval(config.network,'approveAgent',{agentAddress:'0x'+'0'.repeat(40),agentName:config.agentName});await atomicWrite(path,JSON.stringify(pending));}
 let exchangeRevoked=false;if(input.signature){await submitApproval(config.network,pending,input.signature as string);exchangeRevoked=true;config.authorizationKeyRef=undefined;config.privyWalletId=undefined;}
 markRevoked(config);await saveConfig(config,context.configPath);if(activeRunner){activeRunner.signer=undefined;Object.assign(activeRunner.config,config);}
 return {agentAddress:config.agentAddress,locallyRevoked:true,exchangeRevoked,requiresSignature:!exchangeRevoked,approval:pending};
}});
