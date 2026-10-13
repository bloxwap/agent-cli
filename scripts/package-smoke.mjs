import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'bloxwap-package-'));
try{
 const packed=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',directory],{encoding:'utf8'}))[0];
 if(!packed.files.some(file=>file.path==='SKILL.md')) throw new Error('Package missing skill');
 execFileSync('npm',['install','--global','--prefix',join(directory,'global'),join(directory,packed.filename),'--ignore-scripts'],{stdio:'pipe'});
 const bin=process.platform==='win32'?join(directory,'global','agent-cli.cmd'):join(directory,'global','bin','agent-cli');
 const help=JSON.parse(execFileSync(bin,['--help'],{input:'',encoding:'utf8'}));if(!help.ok||!help.data.commands.some(command=>command.name==='order')) throw new Error('Global CLI smoke failed');
 const schema=JSON.parse(execFileSync(bin,['schema','order'],{input:'',encoding:'utf8'}));if(!schema.ok) throw new Error('Schema smoke failed');
 if(process.env.BLOXWAP_SMOKE_BUN==='1'){const bun=JSON.parse(execFileSync('bun',[resolve('dist/cli.js'),'--help'],{input:'',encoding:'utf8'}));if(!bun.ok) throw new Error('Bun smoke failed');}
 console.log('PASS: packed global install, CLI/schema and optional Bun smoke');
}finally{rmSync(directory,{recursive:true,force:true});}
