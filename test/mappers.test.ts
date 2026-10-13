import {expect,test} from 'vitest';
import {mapHyperliquidError,mapPrivyError,mapRelayError,mapNetworkError} from '../src/errors/mappers.js';
test.each([['Insufficient margin','INSUFFICIENT_MARGIN',false],['Order must have minimum value of $10','INVALID_SIZE',false],['Invalid price tick','INVALID_PRICE',false],['HTTP 429','RATE_LIMIT',true],['Nonce already used','NONCE_COLLISION',true]])('maps fixture %s',(message,code,retryable)=>{expect(mapHyperliquidError(message).toJSON()).toMatchObject({code,retryable});});
test('policy, relay unknown and network flags redact details',()=>{
 expect(mapPrivyError('Policy denied').code).toBe('POLICY_REJECTED');expect(mapRelayError({message:'unexpected',token:'secret'}).toJSON()).toMatchObject({code:'UPSTREAM_ERROR',details:{upstream:{token:'[REDACTED]'}}});expect(mapNetworkError(new Error('fetch failed')).retryable).toBe(true);
});
