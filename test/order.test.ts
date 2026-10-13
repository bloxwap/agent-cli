import {expect,test,vi} from 'vitest';
import {prepareOrder,orderSchema} from '../src/commands/order.js';
import {migrate} from '../src/core/config.js';
import type {TradingServices} from '../src/core/trading.js';
import {accountFixture} from './read.test.js';
export function mockTrading():TradingServices{return {market:async()=>({name:'BTC',szDecimals:5,maxLeverage:40,asset:0}),state:async()=>accountFixture,orders:async()=>[],mids:async()=>({BTC:'20000'}),exchange:{order:vi.fn(async()=>({status:'ok'})),cancel:vi.fn(async()=>({status:'ok'})),cancelByCloid:vi.fn(async()=>({status:'ok'})),batchModify:vi.fn(async()=>({status:'ok'})),updateLeverage:vi.fn(async()=>({status:'ok'}))}};}
test('order rounds limit and bounds market IOC',async()=>{
 const clients=mockTrading();expect(await prepareOrder(migrate({}),orderSchema.parse({coin:'BTC',side:'buy',size:'0.0012345',price:'20000.1'}),clients)).toMatchObject({a:0,s:'0.00123',p:'20000',t:{limit:{tif:'Gtc'}}});
 expect(await prepareOrder(migrate({}),orderSchema.parse({coin:'BTC',side:'sell',size:'0.001',type:'market'}),clients)).toMatchObject({p:'19800',t:{limit:{tif:'Ioc'}}});
 await expect(prepareOrder(migrate({}),orderSchema.parse({coin:'BTC',side:'buy',size:'0',price:'1'}),clients)).rejects.toMatchObject({code:'INVALID_SIZE'});
});
