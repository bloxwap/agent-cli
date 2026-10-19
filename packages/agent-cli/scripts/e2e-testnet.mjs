import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { testnetLifecycle } from './testnet-lifecycle.mjs';
import {
  requireTestnetEnvironment,
  requiredTestnetSecrets,
  missingTestnetConfiguration,
  createTestnetSigner,
  createTestnetRevocation,
} from './testnet-signers.mjs';
import { verifyTestnetReport } from './testnet-report.mjs';
import { startEventFollower } from './testnet-follower.mjs';
import { cleanupTestnetAccount } from './testnet-cleanup.mjs';
import { stopTestnetRunner } from './testnet-runner.mjs';
import { mockOrdersEnv } from './e2e-hl-orders.mjs';
import './e2e-relay-hook.mjs';

const directory = join(homedir(), '.bloxwap');
const config = join(directory, 'e2e-config.json');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const hook = fileURLToPath(new URL('./e2e-relay-hook.mjs', import.meta.url));
const artifacts = resolve('artifacts');
mkdirSync(artifacts, { recursive: true });
const artifactName = (name) =>
  [
    'lifecycle-report.json',
    'events.jsonl',
    'events-follow.jsonl',
    'audit.jsonl',
  ].includes(name) || /^runner[^/]*\.jsonl$/.test(name);
// Never attach journals from a preceding run to a fresh preflight failure.
for (const name of readdirSync(artifacts).filter(artifactName))
  unlinkSync(join(artifacts, name));
const report = {
  schemaVersion: 2,
  status: 'failed',
  network: 'testnet',
  accountOwnership:
    'Dedicated disposable test account controlled by the caller; never a production wallet',
  coverage: {
    hyperliquid: {
      mode: 'live testnet approvals, account info and non-order websocket',
      verified: false,
    },
    orders: {
      mode: 'mocked placement, modification, cancellation and order websocket; exchange order endpoints blocked',
      verified: false,
    },
    privy: { mode: 'live dedicated test app', verified: false },
    relay: {
      mode: 'mocked zero-value route; no token transfer',
      verified: false,
    },
  },
  agentSession: {
    status: 'not-run',
    reason:
      'Deterministic script; the independent coding-agent skill session requires separate evidence',
  },
  commit: process.env.GITHUB_SHA ?? null,
  workflowRun: process.env.GITHUB_RUN_ID ?? null,
  startedAt: new Date().toISOString(),
  stages: [],
  cleanup: { status: 'not-started' },
};
let signer;
let childEnv;
let ownedState = false;
let follower;
let runnerPid;
let nonce = 0;
const agents = new Map();
function command(name, input = {}) {
  const result = spawnSync(
    process.execPath,
    [cli, name, '--config', config, '--network', 'testnet'],
    {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: childEnv,
      timeout: 60_000,
      maxBuffer: 4_194_304,
    },
  );
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Command ${name} did not return one JSON envelope`);
  }
  if (result.status !== 0 || !envelope.ok) {
    const errorMsg = envelope.message || 'Unknown error';
    const errorCode = envelope.code || 'UNKNOWN';
    throw new Error(`Command ${name} failed: [${errorCode}] ${errorMsg}`);
  }
  if (name === 'run') {
    runnerPid = envelope.data.pid;
    if (
      !Number.isSafeInteger(runnerPid) ||
      runnerPid <= 0 ||
      runnerPid === process.pid
    )
      throw new Error('Runner did not identify its detached process');
  }
  return envelope.data;
}
async function info(type, params = {}) {
  const response = await fetch('https://api.hyperliquid-testnet.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Testnet info request failed');
  return response.json();
}
async function revoke({ name }) {
  nonce = Math.max(Date.now(), nonce + 1);
  const approval = createTestnetRevocation(name, nonce);
  const signature = await signer.sign(approval);
  const recovery = Number.parseInt(signature.slice(-2), 16);
  const response = await fetch('https://api.hyperliquid-testnet.xyz/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: approval.action,
      nonce,
      signature: {
        r: signature.slice(0, 66),
        s: '0x' + signature.slice(66, 130),
        v: recovery < 27 ? recovery + 27 : recovery,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || (await response.json()).status !== 'ok')
    throw new Error('Testnet cleanup revocation failed');
}
function safeArtifact(name, content) {
  // Only explicit journals/report are exported, never configs, approvals, keys,
  // or raw SDK errors. Reject the entire artifact if a known secret appears.
  for (const secretName of requiredTestnetSecrets) {
    const secret = process.env[secretName];
    if (secret && content.includes(secret))
      throw new Error('Secret detected in test artifact');
  }
  if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(content))
    throw new Error('Private key detected in test artifact');
  writeFileSync(join(artifacts, name), content, { mode: 0o600 });
}
function saveReport() {
  safeArtifact('lifecycle-report.json', JSON.stringify(report, null, 2) + '\n');
}
function fail(stage) {
  report.status = 'failed';
  report.failure ??= stage;
  process.exitCode = 1;
}
try {
  const configuration = requireTestnetEnvironment(process.env);
  // Config paths do not isolate sockets/journals. Use a clean OS account or
  // container, keeping the production state location unchanged at ~/.bloxwap.
  if (existsSync(directory))
    throw new Error('Use a clean QA home without ~/.bloxwap');
  signer = await createTestnetSigner(configuration);
  report.signerMode = signer.mode;
  ownedState = true;
  childEnv = {
    ...process.env,
    BLOXWAP_MASTER_ADDRESS: signer.address,
    BLOXWAP_NETWORK: 'testnet',
    [mockOrdersEnv]: '1',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${JSON.stringify(hook)}`,
  };
  delete childEnv.BLOXWAP_TEST_MASTER_KEY;
  delete childEnv.BLOXWAP_TEST_SIGNER;
  await testnetLifecycle({
    command,
    info,
    sign: (approval) => {
      nonce = Math.max(nonce, approval.action.nonce);
      return signer.sign(approval);
    },
    masterAddress: signer.address,
    appId: process.env.BLOXWAP_PRIVY_APP_ID,
    rememberAgent: (agent) => {
      agents.set(agent.address.toLowerCase(), agent);
    },
    checkpoint: (stage) => {
      report.stages.push({ ...stage, at: new Date().toISOString() });
      if (stage.status === 'passed') {
        if (stage.name === 'test-account-preflight')
          report.coverage.hyperliquid.verified = true;
        if (stage.name === 'place-and-reconcile-resting-order')
          report.coverage.orders.verified = true;
        if (stage.name === 'init-agent-and-builder-approvals')
          report.coverage.privy.verified = true;
        if (stage.name === 'mock-relay-funding-and-settlement')
          report.coverage.relay.verified = true;
      }
      saveReport();
    },
    startFollow: async () => {
      follower = startEventFollower({
        command: process.execPath,
        args: [
          cli,
          'events',
          '--follow',
          '--since',
          '0',
          '--network',
          'testnet',
          '--config',
          config,
        ],
        env: childEnv,
      });
      return () => follower.stop();
    },
  });
  report.status = 'passed';
} catch (error) {
  const stageName =
    report.stages.find((stage) => stage.status === 'failed')?.name ??
    'testnet-preflight';
  fail(stageName);
  report.missingConfiguration = missingTestnetConfiguration();
  report.missingSecrets = requiredTestnetSecrets.filter((name) =>
    report.missingConfiguration.includes(name),
  );
  // Sanitize error message, redacting secrets and private keys
  let errorMessage = 'Unknown error';
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else {
    try {
      errorMessage = JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }
  }
  // Redact secrets from error message
  for (const secretName of requiredTestnetSecrets) {
    const secret = process.env[secretName];
    if (secret && secret.length >= 4) {
      errorMessage = errorMessage.split(secret).join('[REDACTED]');
    }
  }
  // Redact private keys
  errorMessage = errorMessage
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[REDACTED]')
    .replace(/(?:0x)?[a-fA-F0-9]{64,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  report.error = {
    stage: stageName,
    message: errorMessage,
  };
  console.error(
    `FAIL: dedicated testnet lifecycle at stage '${stageName}': ${errorMessage}`,
  );
  console.error('Full report: lifecycle-report.json');
} finally {
  if (ownedState && existsSync(config)) {
    report.cleanup = await cleanupTestnetAccount({
      info,
      masterAddress: signer.address,
      agents: [...agents.values()],
      revoke,
      cancel: (order) => command('cancel', { oid: Number(order.oid) }),
    });
    if (report.cleanup.status !== 'verified') fail('testnet-cleanup');
  }
  if (follower) {
    try {
      await follower.stop();
    } catch {
      fail('events-follow-verification');
    }
  }
  if (ownedState && existsSync(config)) {
    try {
      await stopTestnetRunner({ directory, expectedPid: runnerPid });
    } catch {
      fail('testnet-runner-shutdown');
    }
    try {
      for (const file of ['events.jsonl', 'audit.jsonl'])
        if (existsSync(join(directory, file)))
          safeArtifact(file, readFileSync(join(directory, file), 'utf8'));
      if (follower?.text) safeArtifact('events-follow.jsonl', follower.text);
      const logs = join(directory, 'logs');
      if (existsSync(logs))
        for (const file of readdirSync(logs).filter((file) =>
          /^runner[^/]*\.jsonl$/.test(file),
        ))
          safeArtifact(file, readFileSync(join(logs, file), 'utf8'));
    } catch {
      fail('testnet-artifacts');
      report.artifacts = 'rejected-secret-or-unreadable-journal';
    }
  }
  report.finishedAt = new Date().toISOString();
  try {
    verifyTestnetReport(report);
  } catch {
    fail('testnet-report-verification');
  }
  // Even failed preflight emits a failure artifact and never becomes a skip.
  saveReport();
  if (report.status === 'passed')
    console.log(
      'PASS: dedicated testnet lifecycle (Relay and Hyperliquid orders mocked; see report)',
    );
}
