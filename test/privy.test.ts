import {expect,test,vi} from 'vitest';
import type {PrivyClient} from '@privy-io/node';
import {privySigner,resolveSecret,privyClient} from '../src/wallet/privy.js';
import {migrate} from '../src/core/config.js';
test('remote typed-data signing preserves EIP-712 and maps denial',async()=>{
 const signTypedData=vi.fn().mockResolvedValue({signature:'0x1234'});const client={wallets:()=>({ethereum:()=>({signTypedData})})} as unknown as PrivyClient;
 process.env.BLOXWAP_TEST_AUTH='test-key';
 try{const signer=await privySigner(migrate({agentAddress:'0x'+'a'.repeat(40),privyWalletId:'wallet',authorizationKeyRef:'env:BLOXWAP_TEST_AUTH'}),client);
 const data={domain:{name:'Exchange',version:'1',chainId:1337,verifyingContract:'0x'+'0'.repeat(40) as `0x${string}`},types:{Agent:[{name:'source',type:'string'}]},primaryType:'Agent',message:{source:'b'}};
 expect(await signer.signTypedData(data)).toBe('0x1234');expect(signTypedData.mock.calls[0][1].params.typed_data.primary_type).toBe('Agent');signTypedData.mockRejectedValue(new Error('Policy denied'));await expect(signer.signTypedData(data)).rejects.toMatchObject({code:'POLICY_REJECTED'});
 }finally{delete process.env.BLOXWAP_TEST_AUTH;}
 expect(await resolveSecret('env:BLOXWAP_SECRET',{BLOXWAP_SECRET:'ok'})).toBe('ok');
});
test.skipIf(!process.env.BLOXWAP_PRIVY_SANDBOX)('Privy sandbox credentials',async()=>{const client=await privyClient(migrate({privyAppId:process.env.BLOXWAP_PRIVY_APP_ID}));expect(await client.wallets().list()).toBeDefined();});
