import {expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fund,fundSchema} from '../src/commands/fund.js';
import {migrate} from '../src/core/config.js';
import {RelayClient} from '../src/funding/relay.js';
import {quoteFixture} from './relay.test.js';
test('fund persists and reuses unexpired quotes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloxwap-fund-'));const quote=vi.fn(async()=>quoteFixture);const config=migrate({masterAddress:'0x'+'a'.repeat(40)});
 try{const dependencies={path:join(dir,'deposits.json'),relay:{quote} as unknown as RelayClient,baseline:async()=>'0',qr:async()=>({qrAscii:null,qrPath:null})};
 const input=fundSchema.parse({amount:'10',qr:false});const first=await fund(config,input,dependencies);expect(first.expectedReceived).toBe('100000000');expect((await fund(config,input,dependencies)).depositAddress).toBe(first.depositAddress);expect(quote).toHaveBeenCalledTimes(1);
 await expect(fund(config,{...input,amount:'0.1'},dependencies)).rejects.toMatchObject({code:'INVALID_SIZE'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
