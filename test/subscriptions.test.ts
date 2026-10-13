import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runner} from '../src/runner/lifecycle.js';
import {Subscriptions,subscriptionSet} from '../src/runner/subscriptions.js';
import {migrate} from '../src/core/config.js';
test('reconnect gap-fill dedupes fills and persists subscription cursor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloxwap-ws-'));const runner=new Runner(migrate({allowedMarkets:['BTC']}),dir);const events:unknown[]=[];let state:(value:string)=>void=()=>{};
 const backend={subscribe:async()=>({unsubscribe:async()=>{}}),onState:(listener:typeof state)=>{state=listener;},close:async()=>{},gap:async()=>[{tid:1,time:1},{tid:2,time:2}]};const manager=new Subscriptions(runner,backend,async(type,data)=>{events.push({type,data});});
 try{await manager.start();await manager.fill({tid:1,time:1});state('connected');state('reconnecting');state('connected');await manager.flush();expect(events.filter(e=>(e as {type:string}).type==='fill')).toHaveLength(2);expect(subscriptionSet(runner.config)).toContain('l2Book:BTC');await runner.shutdown();}finally{await rm(dir,{recursive:true,force:true});}
});
