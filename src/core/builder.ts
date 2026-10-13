import type {Config} from './config.js';
import {hlInfo} from './http.js';
import {AgentCliError} from '../errors/index.js';
export async function approvedBuilder(config:Config,fetchMaximum=(user:string,builder:string)=>hlInfo<number>(config.network,'maxBuilderFee',{user,builder})){
 if(!config.builder.address){if(config.builder.fee) throw new AgentCliError('CONFIG_INVALID','Builder address is required for a fee');return undefined;}
 if(!config.masterAddress) throw new AgentCliError('AGENT_NOT_APPROVED','Master address missing');
 const maximum=await fetchMaximum(config.masterAddress,config.builder.address);
 if(config.builder.fee>maximum) throw new AgentCliError('AGENT_NOT_APPROVED','Approve configured builder fee with master wallet',{approvedMax:maximum,requested:config.builder.fee});
 return {b:config.builder.address.toLowerCase(),f:config.builder.fee};
}
export const builderRate=(config:Config)=>`${config.builder.fee/1000}%`;
