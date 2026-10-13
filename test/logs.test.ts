import {expect,test} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readLogs} from '../src/commands/logs.js';
test('logs filter level, date and request while preserving redaction',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bloxwap-logread-'));try{
 await writeFile(join(directory,'runner.jsonl'),[{level:'info',time:'2026-01-01',requestId:'a'},{level:'warn',time:'2026-01-02',requestId:'b',token:'sensitive'}].map(value=>JSON.stringify(value)).join('\n')+'\n');
 expect(await readLogs({directory,level:'warn',since:'2026-01-02',requestId:'b'})).toEqual([{level:'warn',time:'2026-01-02',requestId:'b',token:'[REDACTED]'}]);}finally{await rm(directory,{recursive:true,force:true});}
});
