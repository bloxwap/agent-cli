import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuditStore,readAudit,verifyAudit} from '../src/core/audit.js';
test('audit chain detects edits and excludes sensitive signatures',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloxwap-audit-'));const path=join(dir,'audit.jsonl');try{const store=new AuditStore(path);await store.append('intent',{signature:'secret'},{intentId:'one',cloid:'client'});await store.append('decision',{allowed:true},{intentId:'one'});const entries=await readAudit(path);expect(verifyAudit(entries)).toBe(true);expect(JSON.stringify(entries)).not.toContain('secret');entries[0].data='tampered';expect(()=>verifyAudit(entries)).toThrow();}finally{await rm(dir,{recursive:true,force:true});}
});
