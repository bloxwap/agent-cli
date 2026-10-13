import {signatureAudit} from '../core/audit.js';
import { PrivyClient, generateP256KeyPair } from '@privy-io/node';
import { readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite,saveConfig,stateDir,type Config } from '../core/config.js';
import type { Signer } from '../core/hlclient.js';
import { AgentCliError } from '../errors/index.js';
import { mapPrivyError } from '../errors/mappers.js';
export async function resolveSecret(ref:string|undefined,env=process.env):Promise<string>{
 if(!ref) throw new AgentCliError('CONFIG_INVALID','Missing secret reference');
 if(ref.startsWith('env:')) {const value=env[ref.slice(4)];if(value) return value;}
 if(ref.startsWith('file:')) {const path=ref.slice(5);const info=await stat(path);if(process.platform!=='win32'&&(info.mode&0o077)!==0) throw new AgentCliError('CONFIG_INVALID','Secret file must have mode 0600');return (await readFile(path,'utf8')).trim();}
 throw new AgentCliError('CONFIG_INVALID','Secret unavailable');
}
export async function privyClient(config:Config){
 if(!config.privyAppId) throw new AgentCliError('CONFIG_INVALID','Set privyAppId');
 return new PrivyClient({appId:config.privyAppId,appSecret:await resolveSecret(config.privyAppSecretRef??'env:BLOXWAP_PRIVY_APP_SECRET')});
}
export async function createAgent(config:Config,client:PrivyClient,path?:string,policyId?:string) {
 try {
  if(config.privyWalletId){const wallet=await client.wallets().get(config.privyWalletId);config.agentAddress=wallet.address;await saveConfig(config,path);return wallet;}
  const pair=await generateP256KeyPair();const keyPath=join(stateDir(),`authorization-${Date.now()}.key`);await atomicWrite(keyPath,pair.privateKey);
  const wallet=await client.wallets().create({chain_type:'ethereum',owner:{public_key:pair.publicKey},policy_ids:policyId?[policyId]:[],idempotency_key:`agent-${pair.publicKey}`});
  config.privyWalletId=wallet.id;config.agentAddress=wallet.address;config.authorizationKeyRef=`file:${keyPath}`;await saveConfig(config,path);return wallet;
 }catch(error){throw mapPrivyError(error);}
}
export async function privySigner(config:Config,client:PrivyClient):Promise<Signer>{
 if(!config.agentAddress||!config.privyWalletId) throw new AgentCliError('AGENT_NOT_APPROVED','Initialize agent wallet first');
 const authorizationKey=await resolveSecret(config.authorizationKeyRef);
 return {address:config.agentAddress as `0x${string}`,signTypedData:async data=>{
  try {
   const signed=await client.wallets().ethereum().signTypedData(config.privyWalletId!,{params:{typed_data:{domain:data.domain,types:Object.fromEntries(Object.entries(data.types).map(([key,fields])=>[key,[...fields]])),primary_type:data.primaryType,message:data.message}},authorization_context:{authorization_private_keys:[authorizationKey]}});
   await signatureAudit(signed.signature);return signed.signature as `0x${string}`;
  }catch(error){throw mapPrivyError(error);}
 }};
}
