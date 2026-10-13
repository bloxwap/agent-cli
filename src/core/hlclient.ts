import { ExchangeClient, HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from '@bloxwap/hyperliquid';
import type { AbstractViemLocalAccount } from '@bloxwap/hyperliquid/signing';
import { formatPrice, formatSize } from '@bloxwap/hyperliquid/utils';
import { AgentCliError } from '../errors/index.js';
export type Signer=AbstractViemLocalAccount;
export interface Market {name:string;szDecimals:number;maxLeverage:number;asset:number;}
export class MetaCache {
 private markets=new Map<string,Market>(); private updated=0;
 constructor(private fetchMeta:()=>Promise<{universe:{name:string;szDecimals:number;maxLeverage:number}[]}>,private ttl=60_000){}
 async refresh(){const meta=await this.fetchMeta();this.markets=new Map(meta.universe.map((market,asset)=>[market.name,{...market,asset}]));this.updated=Date.now();}
 async lookup(coin:string){if(Date.now()-this.updated>this.ttl) await this.refresh();const market=this.markets.get(coin);if(!market) throw new AgentCliError('UNKNOWN_MARKET',`Unknown market ${coin}`);return market;}
}
export function roundSize(size:string,szDecimals:number){
 if(!/^\d+(\.\d+)?$/.test(size)||Number(size)<=0) throw new AgentCliError('INVALID_SIZE','Size must be positive');
 const rounded=formatSize(size,szDecimals);if(Number(rounded)<=0) throw new AgentCliError('INVALID_SIZE','Size rounds to zero');return rounded;
}
export function roundPrice(price:string,szDecimals:number){
 if(!/^\d+(\.\d+)?$/.test(price)||Number(price)<=0) throw new AgentCliError('INVALID_PRICE','Price must be positive');
 const rounded=formatPrice(price,szDecimals);if(Number(rounded)<=0) throw new AgentCliError('INVALID_PRICE','Price rounds to zero');return rounded;
}
// Bound SDK generic depth at the adapter boundary; runtime clients remain unchanged.
const Exchange = ExchangeClient as unknown as new (options: {transport:HttpTransport;wallet:Signer;nonceManager?:()=>Promise<number>}) => ExchangeAdapter;
export interface ExchangeAdapter {
 order(params:Record<string,unknown>):Promise<unknown>; cancel(params:Record<string,unknown>):Promise<unknown>; cancelByCloid(params:Record<string,unknown>):Promise<unknown>; batchModify(params:Record<string,unknown>):Promise<unknown>; updateLeverage(params:Record<string,unknown>):Promise<unknown>;
}
export function createClients(network:'mainnet'|'testnet',signer?:Signer,nonce?:()=>Promise<number>) {
 const transport=new HttpTransport({isTestnet:network==='testnet'});const info=new InfoClient({transport});
 return {info,meta:new MetaCache((info as unknown as {meta:()=>Promise<{universe:{name:string;szDecimals:number;maxLeverage:number}[]}>}).meta.bind(info)),exchange:signer ? new Exchange({transport,wallet:signer,nonceManager:nonce}) : undefined,
  subscriptions:()=>{const transport=new WebSocketTransport({isTestnet:network==='testnet'});return {transport,client:new SubscriptionClient({transport})};}};
}
