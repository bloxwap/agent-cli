import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
const environment=vi.hoisted(()=>({home:`/tmp/bloxwap-e2e-${process.pid}-${Math.random().toString(16).slice(2)}`,wallets:0,orders:[] as {coin:string;oid:number;side:string;sz:string;limitPx:string}[],agents:[] as {address:string;validUntil:number}[],balance:'0'}));
vi.mock('node:os',async importOriginal=>({...await importOriginal<typeof import('node:os')>(),homedir:()=>environment.home}));
vi.mock('../src/wallet/privy.js',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/wallet/privy.js')>();return {...original,privyClient:async()=>({}),createAgent:async(config:import('../src/core/config.js').Config,_client:unknown,path?:string)=>{const {saveConfig}=await import('../src/core/config.js');config.agentAddress='0x'+String(++environment.wallets).repeat(40);config.privyWalletId='wallet-'+environment.wallets;config.authorizationKeyRef='env:BLOXWAP_E2E_AUTH';await saveConfig(config,path);return {id:config.privyWalletId,address:config.agentAddress};},privySigner:async(config:import('../src/core/config.js').Config)=>({address:config.agentAddress,signTypedData:async()=>('0x'+'11'.repeat(64)+'1b')})};
});
vi.mock('../src/wallet/policy.js',async importOriginal=>({...await importOriginal<typeof import('../src/wallet/policy.js')>(),applyPolicy:async(config:import('../src/core/config.js').Config)=>{config.policyId='policy';config.policyVersion=1;return 'policy';}}));
vi.mock('../src/runner/subscriptions.js',async importOriginal=>({...await importOriginal<typeof import('../src/runner/subscriptions.js')>(),startSubscriptions:async()=>({state:'connected',lastMessage:Date.now(),lastFill:null})}));
import '../src/commands/init.js';
import '../src/commands/fund.js';
import '../src/commands/read.js';
import '../src/commands/order.js';
import '../src/commands/cancel.js';
import '../src/commands/modify.js';
import '../src/commands/leverage.js';
import '../src/commands/run.js';
import '../src/commands/rotate.js';
import '../src/commands/revoke.js';
import '../src/commands/events.js';
import '../src/commands/audit.js';
import {dispatch} from '../src/core/router.js';
import {saveConfig,migrate} from '../src/core/config.js';
import {activeRunner,setActiveRunner} from '../src/runner/lifecycle.js';
import {rpcCall,socketPath} from '../src/runner/rpc.js';
import {readAudit,verifyAudit} from '../src/core/audit.js';
let path:string;
beforeEach(async()=>{
 await mkdir(environment.home,{recursive:true,mode:0o700});path=join(environment.home,'.bloxwap','config.json');environment.wallets=0;environment.orders=[];environment.agents=[];environment.balance='0';
 await saveConfig(migrate({privyAppId:'mock',masterAddress:'0x'+'a'.repeat(40)}),path);
 vi.stubGlobal('fetch',vi.fn(async(url:unknown,options?:RequestInit)=>{
 const body=JSON.parse(String(options?.body??'{}'));const action=body.action;
 if(String(url).includes('/quote/v2')) return Response.json({steps:[{id:'deposit',kind:'transaction',requestId:'deposit-1',depositAddress:'0x'+'b'.repeat(40),items:[{status:'incomplete',data:{}}]}],fees:{},details:{currencyOut:{amount:'1000000000',currency:{decimals:8}},expiresAt:Date.now()+60000}});
 if(String(url).includes('/intents/status')) return Response.json({status:'success'});
 if(action?.type==='approveAgent'){if(action.agentAddress==='0x'+'0'.repeat(40)) environment.agents=[];else environment.agents.push({address:action.agentAddress,validUntil:Number(action.agentName.match(/valid_until (\d+)/)?.[1])});return Response.json({status:'ok',response:{type:'default'}});}
 if(action){const statuses=action.type==='order'?[{resting:{oid:1}}]:['success'];if(action.type==='order') environment.orders=[{coin:'BTC',oid:1,side:'B',sz:'0.001',limitPx:'20000'}];if(action.type==='cancel') environment.orders=[];return Response.json({status:'ok',response:{type:action.type==='batchModify'?'order':action.type,data:{statuses}}});}
 if(body.type==='meta') return Response.json({universe:[{name:'BTC',szDecimals:5,maxLeverage:40}],marginTables:[]});
 if(body.type==='clearinghouseState') return Response.json({marginSummary:{accountValue:environment.balance,totalMarginUsed:'0',totalNtlPos:'0'},withdrawable:environment.balance,assetPositions:[]});
 if(body.type==='extraAgents') return Response.json(environment.agents);
 if(body.type==='frontendOpenOrders') return Response.json(environment.orders);
 if(body.type==='allMids') return Response.json({BTC:'20000'});
 throw new Error('Unexpected mocked request: '+JSON.stringify(body));
 }));
});
afterEach(async()=>{await activeRunner?.shutdown();setActiveRunner(undefined);vi.unstubAllGlobals();await rm(environment.home,{recursive:true,force:true});});
async function command(name:string,input:Record<string,unknown>={}){const result=await dispatch([name,'--config',path,'--json',JSON.stringify(input)]);expect(result.body,JSON.stringify(result.body)).toMatchObject({ok:true});return (result.body as {data:Record<string,unknown>}).data;}
test('mocked full account lifecycle through real CLI router, SDK and runner RPC',async()=>{
 const initialized=await command('init',{qr:false});expect(initialized.requiresSignature).toBe(true);await command('init',{qr:false,signature:'0x'+'11'.repeat(64)+'1b'});
 const deposit=await command('fund',{qr:false,amount:'10'});expect(deposit.depositId).toBe('deposit-1');environment.balance='10';const status=await command('status');expect(status.deposits).toEqual([{id:'deposit-1',state:'settled'}]);
 await command('run');expect(await rpcCall('balance',{},socketPath())).toMatchObject({accountValue:'10'});
 await command('order',{coin:'BTC',side:'buy',size:'0.001',price:'20000',intentId:'lifecycle'});await command('modify',{oid:1,price:'20100'});await command('cancel',{all:true});
 const rotation=await command('rotate');expect(rotation.requiresSignature).toBe(true);expect((await command('rotate',{signature:'0x'+'11'.repeat(64)+'1b'})).swapped).toBe(true);
 await command('revoke',{cancelOrders:true});const rejected=await dispatch(['order','--config',path,'--json','{"coin":"BTC","side":"buy","size":"0.001","price":"20000"}']);expect(rejected.body).toMatchObject({ok:false,code:'AGENT_NOT_APPROVED'});
 const entries=await readAudit(join(environment.home,'.bloxwap','audit.jsonl'));expect(entries.some(entry=>entry.intentId==='lifecycle')).toBe(true);expect(verifyAudit(entries)).toBe(true);expect(await command('events')).toBeDefined();
},20000);
