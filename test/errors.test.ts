import { expect, test } from 'vitest';
import { AgentCliError, errorDefaults, success } from '../src/errors/index.js';
const original = ['INSUFFICIENT_MARGIN','POLICY_REJECTED','AGENT_EXPIRED','AGENT_NOT_APPROVED','DEPOSIT_PENDING','NONCE_COLLISION','RATE_LIMIT','INVALID_SIZE','INVALID_PRICE','UNKNOWN_MARKET','ORDER_NOT_FOUND','RUNNER_NOT_RUNNING','CONFIG_INVALID','NETWORK_ERROR','UPSTREAM_ERROR','INTERNAL'];
test('catalog is append-only', () => original.forEach(code => expect(errorDefaults).toHaveProperty(code)));
test('stable wire shapes', () => {
 expect(new AgentCliError('RATE_LIMIT','wait').toJSON()).toEqual({ok:false,code:'RATE_LIMIT',message:'wait',retryable:true,details:null});
 expect(success('yes')).toEqual({ok:true,data:'yes'});
});
