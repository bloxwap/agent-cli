import {expect,test} from 'vitest';
import {renderQr} from '../src/funding/qr.js';
test('QR deterministic terminal snapshot stays off stdout',async()=>{
 let stderr='';const result=await renderQr('bloxwap:test',{stderr:value=>{stderr=value;}});
 expect(result.qrAscii).toMatchSnapshot();expect(stderr).toContain(result.qrAscii);expect(await renderQr('disabled',{enabled:false})).toEqual({qrAscii:null,qrPath:null});
});
