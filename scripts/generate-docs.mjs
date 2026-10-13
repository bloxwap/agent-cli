import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,mkdirSync,readdirSync} from 'node:fs';
import {marked} from 'marked';
const invoke=(args)=>JSON.parse(execFileSync(process.execPath,['dist/cli.js',...args],{input:'',encoding:'utf8'})).data;
const commands=invoke(['--help']).commands;
let reference='# Command reference\n\nGenerated from `agent-cli schema <command>`. Do not edit by hand.\n\nGlobal flags: `--config PATH`, `--network mainnet|testnet`, `--pretty`, `--json OBJECT`.\n\n';
for(const command of commands) reference+=`## ${command.name}\n\n${command.description}\n\n\`\`\`json\n${JSON.stringify(invoke(['schema',command.name]),null,2)}\n\`\`\`\n\n`;
writeFileSync('docs/commands.md',reference);
mkdirSync('site',{recursive:true});
for(const name of readdirSync('docs').filter(name=>name.endsWith('.md'))){const content=marked(readFileSync(`docs/${name}`,'utf8')).replace(/href="([^"#]+)\.md/g,'href="$1.html');writeFileSync(`site/${name.replace('.md','.html')}`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>agent-cli</title><style>body{max-width:960px;margin:2rem auto;padding:0 1rem;font:16px system-ui;line-height:1.5}pre{overflow:auto;background:#eee;padding:1rem}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.4rem}a{color:#245ea3}</style><nav><a href="index.html">agent-cli docs</a></nav>${content}</html>`);}
