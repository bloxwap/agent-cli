#!/usr/bin/env node
import { dispatch, setRouting } from './core/router.js';
import './commands/config.js';
import './commands/init.js';
import './commands/fund.js';
import './commands/deposit.js';
import './commands/read.js';
import './commands/order.js';
import './commands/cancel.js';
import './commands/modify.js';
import './commands/leverage.js';
import './commands/run.js';
import './commands/events.js';
import './commands/logs.js';
import './commands/rotate.js';
import './commands/revoke.js';
import './commands/audit.js';
import './commands/skill.js';
import './commands/market.js';
import './commands/paper.js';
import { routeToRunner } from './runner/rpc.js';
setRouting(routeToRunner);
import { AgentCliError, normalizeError } from './errors/index.js';
try {
  let stdin = '';
  if (!process.stdin.isTTY)
    for await (const chunk of process.stdin) {
      stdin += String(chunk);
      if (Buffer.byteLength(stdin) > 1_048_576)
        throw new AgentCliError('CONFIG_INVALID', 'JSON input exceeds 1 MiB');
    }
  const result = await dispatch(process.argv.slice(2), stdin);
  if (!result.context.streaming || !result.body.ok)
    process.stdout.write(
      JSON.stringify(result.body, null, result.context.pretty ? 2 : undefined) +
        '\n',
    );
  process.exitCode = result.exitCode;
} catch (error) {
  const normalized = normalizeError(error);
  process.stdout.write(JSON.stringify(normalized.toJSON()) + '\n');
  process.exitCode = normalized.exitCode;
}
