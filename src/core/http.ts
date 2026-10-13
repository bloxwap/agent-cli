import {mapNetworkError} from '../errors/mappers.js';
export async function jsonRequest(url:string,body?:unknown,fetcher:typeof fetch=fetch){
 let response:Response;try{response=await fetcher(url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});}catch(error){throw mapNetworkError(error);}
 const data:unknown=await response.json();if(!response.ok) throw {status:response.status,...(data&&typeof data==='object'?data:{message:String(data)})};return data;
}
export const hlEndpoint=(network:'mainnet'|'testnet')=>`https://api${network==='testnet'?'.hyperliquid-testnet':'.hyperliquid'}.xyz`;
export async function hlInfo<T>(network:'mainnet'|'testnet',type:string,params:Record<string,unknown>={}):Promise<T>{return await jsonRequest(`${hlEndpoint(network)}/info`,{type,...params}) as T;}
