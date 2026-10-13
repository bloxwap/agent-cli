import {expect,test} from 'vitest';
import {evaluateRisk} from '../src/core/risk.js';
import {migrate} from '../src/core/config.js';
const intent={coin:'BTC',side:'buy' as const,size:'2',price:'10',leverage:2};const state={positionSize:'1',dailyLoss:'5',openOrders:2,marketMaxLeverage:40};
test.each([{allowedMarkets:['ETH']},{limits:{maxOrderSize:1}},{limits:{maxNotional:19}},{limits:{maxPositionNotional:29}},{limits:{dailyLoss:4}},{limits:{maxOpenOrders:2}},{limits:{maxLeverage:1}}])('enforces each risk bound %j',config=>{expect(()=>evaluateRisk(migrate(config),intent,state)).toThrow(expect.objectContaining({code:'POLICY_REJECTED'}));});
test('reduce-only cannot increase exposure and decimals remain exact',()=>{expect(evaluateRisk(migrate({}),intent,state).allowed).toBe(true);expect(()=>evaluateRisk(migrate({}),{...intent,reduceOnly:true},state)).toThrow();expect(evaluateRisk(migrate({}),{...intent,side:'sell',reduceOnly:true},state).allowed).toBe(true);});
