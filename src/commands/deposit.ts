import {z} from 'zod';
import {register} from '../core/router.js';
import {readDeposits} from '../funding/store.js';
import {signatureSteps,submitDepositSignature} from '../funding/signatures.js';
import {AgentCliError} from '../errors/index.js';
register('deposit',{description:'Resume deposit steps or submit a master-wallet signature',schema:z.object({depositId:z.string(),stepId:z.string().optional(),signature:z.string().optional()}),execute:async(input)=>{
 if(input.signature&&input.stepId) return submitDepositSignature(input.depositId as string,input.stepId as string,input.signature as string);
 const deposit=(await readDeposits()).find(d=>d.id===input.depositId);if(!deposit) throw new AgentCliError('CONFIG_INVALID','Unknown deposit');return {depositId:deposit.id,steps:signatureSteps(deposit)};
}});
