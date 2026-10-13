import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {privateKeyToAccount} from 'viem/accounts';
if(process.env.BLOXWAP_E2E!=='1'||!process.env.BLOXWAP_TEST_MASTER_KEY||!process.env.BLOXWAP_PRIVY_APP_ID||!process.env.BLOXWAP_PRIVY_APP_SECRET){console.log('SKIP: set BLOXWAP_E2E=1 and dedicated testnet master/Privy credentials');process.exit(0);}
const account=privateKeyToAccount(process.env.BLOXWAP_TEST_MASTER_KEY);
const config=join(homedir(),'.bloxwap','e2e-config.json');
if(existsSync(config)) throw new Error('Refusing to replace an existing e2e config; use a clean CI account');
const hook=resolve('scripts/e2e-relay-hook.mjs');const env={...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import=${hook}`};
const run=(name,input={})=>{const raw=execFileSync(process.execPath,['dist/cli.js',name,'--config',config,'--network','testnet','--json',JSON.stringify(input)],{input:'',encoding:'utf8',env});const result=JSON.parse(raw);if(!result.ok) throw new Error(JSON.stringify(result));return result.data;};
const sign=payload=>account.signTypedData(payload.typedData);
const info=async(type,params={})=>(await fetch('https://api.hyperliquid-testnet.xyz/info',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,...params})})).json();
try{
 run('config',{args:['set','privyAppId',process.env.BLOXWAP_PRIVY_APP_ID]});
 const init=run('init',{masterAddress:account.address,qr:false});if(!init.approved) run('init',{signature:await sign(init.approvals.agent),qr:false});
 const state=await info('clearinghouseState',{user:account.address});if(Number(state.withdrawable)<30) throw new Error('Dedicated testnet account needs at least 30 test USDC; no real funding is performed');
 run('fund',{amount:'10',qr:false});const status=run('status');if(status.deposits.some(d=>d.state!=='settled')) throw new Error('Mocked Relay funding did not settle');
 run('run',{detach:true});
 const meta=await info('meta');const market=meta.universe.find(m=>m.name==='BTC');const mids=await info('allMids');const mid=Number(mids.BTC);const size=(Math.ceil(20/mid*10**market.szDecimals)/10**market.szDecimals).toFixed(market.szDecimals);const cloid='0x'+Date.now().toString(16).padStart(32,'0');
 const order=run('order',{coin:'BTC',side:'buy',size,price:String(Math.floor(mid*0.7)),cloid,intentId:'nightly-lifecycle'});
 const oid=order.result.response.data.statuses[0].resting?.oid;if(!oid) throw new Error('Expected resting test order');run('modify',{oid,price:String(Math.floor(mid*0.69))});run('cancel',{oid});run('events',{since:0});
 const rotation=run('rotate');const swapped=run('rotate',{signature:await sign(rotation.approval)});run('rotate',{revokeSignature:await sign(swapped.revokeApproval)});
 const revoke=run('revoke',{cancelOrders:true});run('revoke',{signature:await sign(revoke.approval)});run('audit',{intent:'nightly-lifecycle'});
 console.log('PASS: testnet init/fund/run/order/modify/cancel/events/rotate/revoke');
}finally{
 mkdirSync('artifacts',{recursive:true});for(const file of ['events.jsonl','audit.jsonl']) if(existsSync(join(homedir(),'.bloxwap',file))) copyFileSync(join(homedir(),'.bloxwap',file),join('artifacts',file));
 // A failed run records its stage via journals; credentials are never exported.
 writeFileSync('artifacts/network.txt','testnet\n');
 const {createConnection}=await import('node:net');await new Promise(resolveStop=>{const socket=createConnection(join(homedir(),'.bloxwap','run.sock'));socket.on('connect',()=>socket.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n'));socket.on('error',resolveStop);socket.on('close',resolveStop);socket.setTimeout(5000,()=>{socket.destroy();resolveStop();});});
}
