import { AgentCliError, type ErrorCode } from './index.js';
import { redact } from '../core/logger.js';
function describe(error:unknown):string {if(error instanceof Error) return error.message;if(typeof error==='string') return error;return JSON.stringify(error)??'Unknown upstream error';}
function map(error:unknown,service:string):AgentCliError {
 if(error instanceof AgentCliError) return error;
 const message=String(redact(describe(error)));let code:ErrorCode='UPSTREAM_ERROR';
 const patterns:[RegExp,ErrorCode][]=[[/429|rate.?limit|too many requests/i,'RATE_LIMIT'],[/nonce|duplicate.*timestamp/i,'NONCE_COLLISION'],[/insufficient.*margin|margin.*insufficient/i,'INSUFFICIENT_MARGIN'],[/minimum.*(size|value)|min.*notional|invalid.*size|too small/i,'INVALID_SIZE'],[/tick|invalid.*price/i,'INVALID_PRICE'],[/policy|not allowed|denied/i,'POLICY_REJECTED'],[/agent.*expired/i,'AGENT_EXPIRED'],[/agent.*not.*approved|not.*authorized/i,'AGENT_NOT_APPROVED'],[/order.*not.*found|does not exist/i,'ORDER_NOT_FOUND']];
 for(const [pattern,candidate] of patterns) if(pattern.test(message)){code=candidate;break;}
 return new AgentCliError(code,message,redact({service,upstream:error instanceof Error?{message:error.message}:error}));
}
export const mapHyperliquidError=(error:unknown)=>map(error,'hyperliquid');
export const mapPrivyError=(error:unknown)=>map(error,'privy');
export const mapRelayError=(error:unknown)=>map(error,'relay');
export const mapNetworkError=(error:unknown)=>new AgentCliError('NETWORK_ERROR',String(redact(describe(error))),redact({service:'network',upstream:describe(error)}));
