import {expect,test} from 'vitest';
import {setLeverage,leverageSchema} from '../src/commands/leverage.js';
import {mockTrading} from './order.test.js';
import {migrate} from '../src/core/config.js';
test('cross/isolated leverage enforces both ceilings',async()=>{
 const config=migrate({approved:true,masterAddress:'0x'+'1'.repeat(40),agentExpiry:Date.now()+10000,limits:{maxLeverage:5}});const services=mockTrading();
 await setLeverage(config,leverageSchema.parse({coin:'BTC',leverage:5,mode:'isolated'}),services);expect(services.exchange.updateLeverage).toHaveBeenCalledWith({asset:0,isCross:false,leverage:5});await expect(setLeverage(config,leverageSchema.parse({coin:'BTC',leverage:6}),services)).rejects.toMatchObject({code:'POLICY_REJECTED'});
});
