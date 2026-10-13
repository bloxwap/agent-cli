import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {register} from '../core/router.js';
import {loadConfig,saveConfig,atomicWrite,stateDir} from '../core/config.js';
import {privyClient,createAgent} from '../wallet/privy.js';
import {applyPolicy} from '../wallet/policy.js';
import {approval,submitApproval,rejectMasterKey,type Approval} from '../wallet/approval.js';
import {hlInfo} from '../core/http.js';
import {AgentCliError} from '../errors/index.js';
register('init',{description:'Create agent and emit resumable master-wallet approvals',schema:z.object({masterAddress:z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),validUntil:z.number().int().optional(),signature:z.string().optional(),builderSignature:z.string().optional(),qr:z.boolean().default(true)}),execute:async(input,context)=>{
 rejectMasterKey(input);const config=await loadConfig(context.configPath);if(context.network) config.network=context.network;
 if(config.approved&&!config.revoked) return config;
 config.masterAddress=input.masterAddress as string??config.masterAddress;if(!config.masterAddress) throw new AgentCliError('CONFIG_INVALID','Provide masterAddress');
 const expiry=input.validUntil as number??config.agentExpiry??Date.now()+179*86400000;
 if(expiry<=Date.now()||expiry>Date.now()+180*86400000) throw new AgentCliError('CONFIG_INVALID','Expiry must be within 180 days');config.agentExpiry=expiry;
 const client=await privyClient(config);const policyId=await applyPolicy(config,client,context.configPath);await createAgent(config,client,context.configPath,policyId);
 const path=join(stateDir(),`approval-${config.agentAddress}.json`);let pending:{agent:Approval;builder?:Approval};
 try{pending=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;pending={agent:approval(config.network,'approveAgent',{agentAddress:config.agentAddress,agentName:`bloxwap valid_until ${expiry}`})};if(config.builder.address) pending.builder=approval(config.network,'approveBuilderFee',{builder:config.builder.address,maxFeeRate:`${config.builder.fee/1000}%`},Date.now()+1);await atomicWrite(path,JSON.stringify(pending));}
 if(input.signature) await submitApproval(config.network,pending.agent,input.signature as string);
 if(input.builderSignature&&pending.builder) await submitApproval(config.network,pending.builder,input.builderSignature as string);
 const agents=await hlInfo<{address:string;validUntil:number}[]>(config.network,'extraAgents',{user:config.masterAddress});
 config.approved=agents.some(agent=>agent.address.toLowerCase()===config.agentAddress?.toLowerCase()&&agent.validUntil>=expiry);
 if(config.builder.address){const max=await hlInfo<number>(config.network,'maxBuilderFee',{user:config.masterAddress,builder:config.builder.address});config.approved=config.approved&&max>=config.builder.fee;}
 config.revoked=false;await saveConfig(config,context.configPath);
 const deeplink=`ethereum:${config.masterAddress}?request=${encodeURIComponent(JSON.stringify(pending.agent.typedData))}`;
 return {masterAddress:config.masterAddress,agentAddress:config.agentAddress,expiry,policyId,approved:config.approved,requiresSignature:!config.approved,approvals:pending,deeplink};
}});
