#!/usr/bin/env node
import { dispatch } from './core/router.js';
import './commands/config.js';
import './commands/init.js';
import './commands/fund.js';
import './commands/deposit.js';
import './commands/read.js';
import './commands/order.js';
import './commands/cancel.js';
import './commands/modify.js';
import './commands/leverage.js';
let stdin='';
if (!process.stdin.isTTY) for await (const chunk of process.stdin) stdin += String(chunk);
const result=await dispatch(process.argv.slice(2),stdin);
process.stdout.write(JSON.stringify(result.body,null,result.context.pretty ? 2 : undefined)+'\n');
process.exitCode=result.exitCode;
