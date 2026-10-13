import {expect,test} from 'vitest';
import {markRevoked} from '../src/commands/revoke.js';
import {assertCanTrade} from '../src/core/trading.js';
import {migrate} from '../src/core/config.js';
test('revocation immediately blocks every trading entrypoint',async()=>{const config=migrate({approved:true,agentExpiry:Date.now()+10000,masterAddress:'0x'+'a'.repeat(40)});markRevoked(config);await expect(assertCanTrade(config)).rejects.toMatchObject({code:'AGENT_NOT_APPROVED'});});
