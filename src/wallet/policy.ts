import type { PrivyClient } from '@privy-io/node';
import template from '../../policies/agent-trade-only.json' with { type: 'json' };
import { AgentCliError } from '../errors/index.js';
import { mapPrivyError } from '../errors/mappers.js';
import { saveConfig,type Config } from '../core/config.js';
export const policyVersion=1;
const allowed=new Set(['order','cancel','cancelByCloid','batchModify','modify','updateLeverage','scheduleCancel','noop']);
export function assertTradeAction(action:string){if(!allowed.has(action)) throw new AgentCliError('POLICY_REJECTED',`Agent cannot sign ${action}`);}
export function policyFor(network:Config['network']) {
 const policy=structuredClone(template);policy.rules[0].conditions[2].value=network==='mainnet'?'a':'b';return policy;
}
export async function applyPolicy(config:Config,client:PrivyClient,path?:string){
 if(config.policyId) return config.policyId;
 try{
 const policy=await client.policies().create(policyFor(config.network) as Parameters<ReturnType<PrivyClient['policies']>['create']>[0]);
 if(config.privyWalletId) await client.wallets().update(config.privyWalletId,{policy_ids:[policy.id]});
 config.policyId=policy.id;config.policyVersion=policyVersion;await saveConfig(config,path);return policy.id;
 }catch(error){throw mapPrivyError(error);}
}
