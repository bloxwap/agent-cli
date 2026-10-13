import {z} from 'zod';
import {register} from '../core/router.js';
import {loadConfig,type Config} from '../core/config.js';
import {hlInfo} from '../core/http.js';
import {RelayClient,PERPS_USDC,parseQuote} from '../funding/relay.js';
import {parseUsdc,formatUsdc} from '../funding/amounts.js';
import {renderQr} from '../funding/qr.js';
import {readDeposits,writeDeposits} from '../funding/store.js';
import {builderRate} from '../core/builder.js';
import {AgentCliError} from '../errors/index.js';
export const fundSchema=z.object({originChain:z.number().int().positive().default(42161),originCurrency:z.string().default('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),originDecimals:z.number().int().min(0).max(30).default(6),amount:z.string().default('10'),qr:z.boolean().default(true),qrPath:z.string().optional()});
export async function fund(config:Config,input:z.infer<typeof fundSchema>,dependencies:{relay?:RelayClient;path?:string;baseline?:()=>Promise<string>;qr?:typeof renderQr}={}){
 if(!config.masterAddress) throw new AgentCliError('AGENT_NOT_APPROVED','Initialize master address');
 const amount=parseUsdc(input.amount,input.originDecimals);if(amount<=0n) throw new AgentCliError('INVALID_SIZE','Positive funding amount required');
 const route=JSON.stringify([config.network,config.masterAddress,input.originChain,input.originCurrency,amount.toString()]);
 const deposits=await readDeposits(dependencies.path);let deposit=deposits.find(d=>d.route===route&&d.expiresAt>Date.now()&&d.state==='awaiting_funds');
 if(!deposit){
  const quote=await (dependencies.relay??new RelayClient(config.network==='testnet'?'https://api.testnets.relay.link':'https://api.relay.link')).quote({user:config.masterAddress,recipient:config.masterAddress,originChainId:input.originChain,originCurrency:input.originCurrency,amount:amount.toString(),destinationChainId:1337,destinationCurrency:PERPS_USDC,useDepositAddress:true,tradeType:'EXACT_INPUT'});
  const parsed=parseQuote(quote);if(amount<BigInt(parsed.minAmount)) throw new AgentCliError('INVALID_SIZE','Below minimum deposit',{minimum:parsed.minAmount});
  const baseline=dependencies.baseline?await dependencies.baseline():(await hlInfo<{marginSummary:{accountValue:string}}>(config.network,'clearinghouseState',{user:config.masterAddress})).marginSummary.accountValue;
  deposit={id:parsed.depositId,network:config.network,recipient:config.masterAddress,route,quote,expiresAt:parsed.expiresAt,state:'awaiting_funds',baseline,createdAt:Date.now(),completedSteps:[]};deposits.push(deposit);await writeDeposits(deposits,dependencies.path);
 }
 const parsed=parseQuote(deposit.quote);const received=formatUsdc(BigInt(parsed.expectedReceived),parsed.receivedDecimals);
 return {...parsed,expectedReceived:parseUsdc(received,8).toString(),expectedReceivedHuman:received,originChain:input.originChain,originCurrency:input.originCurrency,minDeposit:formatUsdc(BigInt(parsed.minAmount),input.originDecimals),builderFeeRate:builderRate(config),state:deposit.state,...await (dependencies.qr??renderQr)(parsed.depositAddress,{enabled:input.qr,path:input.qrPath})};
}
register('fund',{description:'Quote funding with address, QR and transparent fees',schema:fundSchema,execute:async(input,context)=>{const config=await loadConfig(context.configPath);if(context.network) config.network=context.network;return fund(config,input as z.infer<typeof fundSchema>);}});
