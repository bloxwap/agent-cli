import { expect,test } from 'vitest';
import { mkdtemp,readdir,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../src/core/logger.js';
test('nested secrets are redacted and rotated lines retain correlation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloxwap-logs-'));const lines:string[]=[];
 try {
  const logger=new Logger({directory:dir,maxBytes:100,requestId:'request',stderr:line=>lines.push(line)});
  logger.log('info','safe',{nested:{authorizationKey:'secret'},raw:'0x'+'ab'.repeat(32),token:'sensitive'});logger.log('warn','next');await logger.flush();
  const output=lines.join('');expect(output).not.toContain('secret');expect(output).not.toContain('sensitive');expect(output).not.toContain('ab'.repeat(32));
  expect(lines.every(line=>JSON.parse(line).requestId==='request')).toBe(true);
  const files=await readdir(dir);expect(files.length).toBe(2);expect(await readFile(join(dir,files[0]),'utf8')).toContain('request');
 }finally{await rm(dir,{recursive:true,force:true});}
});
