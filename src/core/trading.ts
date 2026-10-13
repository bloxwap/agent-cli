import {activeRunner} from '../runner/lifecycle.js';
import {randomUUID} from 'node:crypto';
import {type Config} from './config.js';
import {createClients,type ExchangeAdapter,type Market} from './hlclient.js';
import {privyClient,privySigner} from '../wallet/privy.js';
import {nextNonce} from './nonce.js';
import {hlInfo} from './http.js';
import {type AccountState,type OpenOrder} from '../commands/read.js';
import {AgentCliError} from '../errors/index.js';
import {assertDepositsSettled} from '../funding/status.js';
import {assertTradeAction} from '../wallet/policy.js';
import {mapHyperliquidError} from '../errors/mappers.js';
import {evaluateRisk,type RiskIntent} from './risk.js';
import {Logger} from './logger.js';
export interface TradingServices {exchange:ExchangeAdapter;market:(coin:string)=>Promise<Market>;state:()=>Promise<AccountState>;orders:()=>Promise<OpenOrder[]>;mids:()=>Promise<Record<string,string>>;}
export async function tradingServices(config:Config):Promise<TradingServices>{
 const signer=activeRunner?.signer??await privySigner(config,await privyClient(config));const clients=createClients(config.network,signer,()=>nextNonce(signer.address));
 return {exchange:clients.exchange!,market:coin=>clients.meta.lookup(coin),state:()=>hlInfo(config.network,'clearinghouseState',{user:config.masterAddress}),orders:()=>hlInfo(config.network,'frontendOpenOrders',{user:config.masterAddress}),mids:()=>hlInfo(config.network,'allMids')};
}
export async function assertCanTrade(config:Config){
 if(config.revoked||!config.approved||!config.masterAddress) throw new AgentCliError('AGENT_NOT_APPROVED','Agent approval required');
 if(!config.agentExpiry||config.agentExpiry<=Date.now()) throw new AgentCliError('AGENT_EXPIRED','Rotate expired agent');
 await assertDepositsSettled(config.network,config.masterAddress);
}
export async function checkRisk(config:Config,intent:RiskIntent,services:TradingServices,ignoreOid?:number){
 const [market,state,orders]=await Promise.all([services.market(intent.coin),services.state(),services.orders()]);
 const position=state.assetPositions.find(p=>p.position.coin===intent.coin)?.position;
 const open=orders.filter(o=>o.oid!==ignoreOid);const pending=open.filter(o=>o.coin===intent.coin).reduce((sum,o)=>sum+(o.side==='B'?1:-1)*Number(o.sz),0);
 const logger=new Logger({level:config.logLevel,intentId:randomUUID()});
 try{return evaluateRisk(config,intent,{positionSize:position?.szi??'0',dailyLoss:String(Math.max(0,-state.assetPositions.reduce((sum,p)=>sum+Number(p.position.unrealizedPnl),0))),openOrders:open.length,marketMaxLeverage:market.maxLeverage,pendingSize:String(pending)});}catch(error){logger.log('warn','Risk rejected',{error:mapHyperliquidError(error).toJSON()});await logger.flush();throw error;}
}
export async function exchangeAction(action:string,operation:()=>Promise<unknown>){
 assertTradeAction(action);try{
 const response=await operation();const data=response as {status?:string;response?:{data?:{statuses?:unknown[]}}};
 if(data.status==='err') throw mapHyperliquidError(response);
 for(const status of data.response?.data?.statuses??[]) if(status&&typeof status==='object'&&'error' in status) throw mapHyperliquidError((status as {error:string}).error);
 return response;
 }catch(error){throw mapHyperliquidError(error);}
}
