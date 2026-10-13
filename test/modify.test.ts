import {expect,test} from 'vitest';
import {modifyOrders,modifySchema} from '../src/commands/modify.js';
import {mockTrading} from './order.test.js';
import {migrate} from '../src/core/config.js';
test('modify rounds replacements and sends batch only after validation',async()=>{
 const config=migrate({approved:true,masterAddress:'0x'+'1'.repeat(40),agentExpiry:Date.now()+10000});const services=mockTrading();services.orders=async()=>[{coin:'BTC',oid:1,sz:'0.001',limitPx:'20000',side:'B'}];
 await modifyOrders(config,modifySchema.parse({modifications:[{oid:1,price:'20000.5',size:'0.0012345'}]}),services);expect(services.exchange.batchModify).toHaveBeenCalledWith({modifies:[{oid:1,order:{a:0,b:true,p:'20000',s:'0.00123',r:false,t:{limit:{tif:'Gtc'}}}}]});
 await expect(modifyOrders(config,modifySchema.parse({oid:4}),services)).rejects.toMatchObject({code:'ORDER_NOT_FOUND'});
});
