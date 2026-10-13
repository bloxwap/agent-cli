import {expect,test} from 'vitest';
import {cancelOrders,cancelSchema} from '../src/commands/cancel.js';
import {mockTrading} from './order.test.js';
import {migrate} from '../src/core/config.js';
test('batch cancellation selects requested orders and rejects unknown ids',async()=>{
 const config=migrate({approved:true,masterAddress:'0x'+'1'.repeat(40),agentExpiry:Date.now()+10000});const services=mockTrading();services.orders=async()=>[{coin:'BTC',oid:1,sz:'1',limitPx:'2',side:'B'},{coin:'BTC',oid:2,sz:'1',limitPx:'2',side:'B'}];
 expect((await cancelOrders(config,cancelSchema.parse({oids:[1,2]}),services)).cancelled).toEqual(['1','2']);await expect(cancelOrders(config,cancelSchema.parse({oid:9}),services)).rejects.toMatchObject({code:'ORDER_NOT_FOUND'});
});
