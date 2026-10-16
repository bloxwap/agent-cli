import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { requireTestnetEnvironment, requiredTestnetSecrets, testnetLifecycle } from './testnet-lifecycle.mjs';

const directory = join(homedir(), '.bloxwap');
const config = join(directory, 'e2e-config.json');
const artifacts = resolve('artifacts');
mkdirSync(artifacts, { recursive: true });
const report = {
  schemaVersion: 1, status: 'failed', network: 'testnet',
  accountOwnership: 'company-owned disposable CI account; never a user wallet',
  coverage: {
    hyperliquid: { mode: 'live testnet', verified: false },
    privy: { mode: 'live dedicated test app', verified: false },
    relay: { mode: 'mocked zero-value route; pre-funded collateral', verified: false },
  },
  agentSession: { status: 'not-run', reason: 'Deterministic CI script; issue 39 tracks the independent coding-agent session transferred from issue 37' },
  commit: process.env.GITHUB_SHA ?? null,
  workflowRun: process.env.GITHUB_RUN_ID ?? null,
  startedAt: new Date().toISOString(), stages: [], cleanup: 'not-started',
};
let account;
let childEnv;
let ownedState = false;
let follower;
let followed = '';
let followFailure = false;
let stoppingFollower = false;
function command(name, input = {}) {
  const result = spawnSync(process.execPath, [
    'dist/cli.js', name, '--config', config, '--network', 'testnet',
  ], { input: JSON.stringify(input), encoding: 'utf8', env: childEnv, timeout: 60_000, maxBuffer: 4_194_304 });
  let envelope;
  try { envelope = JSON.parse(result.stdout); }
  catch { throw new Error(`Command ${name} did not return one JSON envelope`); }
  if (result.status !== 0 || !envelope.ok)
    throw new Error(`Command ${name} failed (${envelope.code ?? 'PROCESS_ERROR'})`);
  return envelope.data;
}
async function sign(approval) {
  if (approval.typedData.domain.name !== 'HyperliquidSignTransaction' ||
      approval.typedData.message.hyperliquidChain !== 'Testnet')
    throw new Error('Refusing to sign approval outside Hyperliquid testnet');
  return account.signTypedData(approval.typedData);
}
async function info(type, params = {}) {
  const response = await fetch('https://api.hyperliquid-testnet.xyz/info', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, ...params }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Testnet info request failed');
  return response.json();
}
async function stopRunner() {
  await new Promise((resolveStop) => {
    const socket = createConnection(join(directory, 'run.sock'));
    socket.on('connect', () => socket.end(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'shutdown', params: {},
    }) + '\n'));
    socket.on('error', resolveStop);
    socket.on('close', resolveStop);
    socket.setTimeout(5000, () => { socket.destroy(); resolveStop(); });
  });
}
async function stopFollowing() {
  if (!follower || follower.exitCode !== null) return;
  const child = follower;
  stoppingFollower = true;
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => { followFailure = true; child.kill('SIGKILL'); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolveStop(); });
    child.kill('SIGTERM');
  });
}
function safeArtifact(name, content) {
  // Upload only the explicit journals, never configs, approval payloads, keys or
  // arbitrary process errors. Drop the entire artifact if a known secret leaks.
  for (const secretName of requiredTestnetSecrets) {
    const secret = process.env[secretName];
    if (secret && content.includes(secret)) throw new Error('Secret detected in test artifact');
  }
  if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(content))
    throw new Error('Private key detected in test artifact');
  writeFileSync(join(artifacts, name), content, { mode: 0o600 });
}
try {
  requireTestnetEnvironment(process.env);
  // A different config path alone does not isolate journals or sockets. Refuse
  // any existing state directory so cleanup can only touch this CI run.
  if (existsSync(directory)) throw new Error('Use a clean CI home without ~/.bloxwap');
  ownedState = true;
  account = privateKeyToAccount(process.env.BLOXWAP_TEST_MASTER_KEY);
  const hook = resolve('scripts/e2e-relay-hook.mjs');
  childEnv = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${hook}` };
  delete childEnv.BLOXWAP_TEST_MASTER_KEY;
  await testnetLifecycle({
    command, info, sign, masterAddress: account.address, appId: process.env.BLOXWAP_PRIVY_APP_ID,
    checkpoint: (stage) => {
      report.stages.push({ ...stage, at: new Date().toISOString() });
      if (stage.status === 'passed') {
        if (stage.name === 'test-account-preflight') report.coverage.hyperliquid.verified = true;
        if (stage.name === 'init-agent-and-builder-approvals') report.coverage.privy.verified = true;
        if (stage.name === 'mock-relay-funding-and-settlement') report.coverage.relay.verified = true;
      }
    },
    startFollow: async () => {
      follower = spawn(process.execPath, [
        'dist/cli.js', 'events', '--follow', '--since', '0', '--network', 'testnet', '--config', config,
      ], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      follower.on('error', () => { followFailure = true; });
      follower.on('exit', (code) => { if (!stoppingFollower || code !== 0) followFailure = true; });
      follower.stdout.setEncoding('utf8');
      follower.stdout.on('data', (line) => {
        followed += line;
        if (Buffer.byteLength(followed) > 4_194_304) {
          followFailure = true;
          follower.kill('SIGTERM');
        }
      });
      // Do not echo raw child errors or credentials into hosted logs.
      follower.stderr.resume();
      return async () => {
        await stopFollowing();
        if (followFailure) throw new Error('events --follow terminated unexpectedly');
        const lines = followed.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
        if (!lines.some((event) => event.type === 'order_update'))
          throw new Error('events --follow did not deliver order updates');
      };
    },
  });
  report.status = 'passed';
} catch {
  report.failure = report.stages.findLast((stage) => stage.status === 'failed')?.name ?? 'testnet-preflight';
  report.missingSecrets = requiredTestnetSecrets.filter((name) => !process.env[name]);
  // Never export arbitrary SDK errors: they can contain credentials or payloads.
  console.error('FAIL: dedicated testnet lifecycle; inspect lifecycle-report.json');
  process.exitCode = 1;
} finally {
  if (ownedState && existsSync(config)) {
    try {
      if ((await info('extraAgents', { user: account.address })).length) {
        // Best effort cleanup is itself signed only by the disposable CI
        // account. Remaining approvals are a failed run requiring review.
        const pending = command('revoke', { cancelOrders: true });
        command('revoke', { signature: await sign(pending.approval) });
      }
      const agents = await info('extraAgents', { user: account.address });
      const orders = await info('frontendOpenOrders', { user: account.address });
      if (agents.length || orders.length) throw new Error('Test approvals or orders remain');
      report.cleanup = 'verified-no-orders-or-agents';
    } catch {
      report.cleanup = 'failed-manual-review-required';
      report.status = 'failed';
      process.exitCode = 1;
    }
    await stopFollowing();
    await stopRunner();
    try {
      for (const file of ['events.jsonl', 'audit.jsonl'])
        if (existsSync(join(directory, file))) safeArtifact(file, readFileSync(join(directory, file), 'utf8'));
      if (followed) safeArtifact('events-follow.jsonl', followed);
      const logs = join(directory, 'logs');
      if (existsSync(logs)) for (const file of readdirSync(logs).filter((file) => file.endsWith('.jsonl')))
        safeArtifact(file, readFileSync(join(logs, file), 'utf8'));
    } catch {
      report.status = 'failed';
      report.artifacts = 'rejected-secret-or-unreadable-journal';
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  // A failed preflight still produces an explicit failure artifact; never skip.
  safeArtifact('lifecycle-report.json', JSON.stringify(report, null, 2) + '\n');
  if (report.status === 'passed') console.log('PASS: dedicated testnet lifecycle (Relay mocked; see report)');
}
