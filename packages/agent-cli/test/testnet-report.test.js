import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  formatTestnetSummary,
  lifecycleStages,
  verifyTestnetReport,
} from '../scripts/testnet-report.mjs';

const complete = () => ({
  schemaVersion: 2,
  status: 'passed',
  network: 'testnet',
  coverage: {
    hyperliquid: { mode: 'live testnet', verified: true },
    privy: { mode: 'live dedicated test app', verified: true },
    relay: {
      mode: 'mocked zero-value route; pre-funded collateral',
      verified: true,
    },
  },
  stages: lifecycleStages.flatMap((name) => [
    { name, status: 'running' },
    { name, status: 'passed' },
  ]),
  cleanup: { status: 'verified', orders: 0, agents: 0, positions: 0 },
  agentSession: { status: 'not-run', reason: 'Deterministic lifecycle only' },
});

const failed = () => ({
  ...complete(),
  status: 'failed',
  stages: [],
  coverage: {
    hyperliquid: { verified: false },
    privy: { verified: false },
    relay: { verified: false },
  },
  cleanup: { status: 'not-started' },
});

test('a complete report validates without treating the script as an independent agent session', () => {
  const report = complete();
  expect(lifecycleStages).toHaveLength(15);
  expect(new Set(lifecycleStages).size).toBe(15);
  expect(verifyTestnetReport(report)).toBe(report);
  const summary = formatTestnetSummary(report);
  expect(summary).toContain('Deterministic testnet lifecycle: **passed**');
  expect(summary).toContain(
    'Independent agent session: **not-run (unverified)**',
  );
  expect(summary).toContain('live Relay remains unverified');
  expect(summary).toContain('verified (0 orders, 0 agents, 0 positions)');
  for (const name of lifecycleStages)
    expect(summary).toContain(`| ${name} | passed |`);
});

test.each(lifecycleStages)(
  'a passed report cannot omit required stage %s',
  (name) => {
    const report = complete();
    report.stages = report.stages.filter((stage) => stage.name !== name);
    expect(() => verifyTestnetReport(report)).toThrow(
      'missing a required stage',
    );
  },
);

test('a passed report cannot hide a failed stage with a later passed event', () => {
  const report = complete();
  report.stages.splice(1, 0, { name: lifecycleStages[0], status: 'failed' });
  expect(() => verifyTestnetReport(report)).toThrow('failed stage');
});

test('a passed report cannot leave a stage running', () => {
  const report = complete();
  report.stages.pop();
  expect(() => verifyTestnetReport(report)).toThrow('incomplete stage');
});

test.each(['hyperliquid', 'privy', 'relay'])(
  'a passed report requires verified %s coverage',
  (name) => {
    for (const value of [false, undefined, 'true', 1]) {
      const report = complete();
      report.coverage[name].verified = value;
      expect(() => verifyTestnetReport(report)).toThrow();
    }
  },
);

test.each(['orders', 'agents', 'positions'])(
  'verified cleanup requires a zero %s count',
  (name) => {
    for (const value of [1, -1, undefined, null, '0', 0.5, Infinity]) {
      const report = complete();
      report.cleanup[name] = value;
      expect(() => verifyTestnetReport(report)).toThrow();
    }
  },
);

test.each(['not-started', 'failed'])(
  'a passed report cannot use %s cleanup',
  (status) => {
    const report = complete();
    report.cleanup = { status };
    expect(() => verifyTestnetReport(report)).toThrow('unverified cleanup');
  },
);

test('a failed preflight remains a valid failed report with explicitly unverified coverage', () => {
  const report = failed();
  expect(verifyTestnetReport(report)).toBe(report);
  const summary = formatTestnetSummary(report);
  expect(summary).toContain('Deterministic testnet lifecycle: **failed**');
  expect(summary).toContain('Hyperliquid testnet: **unverified**');
  expect(summary).toContain('Privy dedicated test app: **unverified**');
  expect(summary).toContain('Relay zero-value mock: **unverified**');
  expect(summary).toContain('Cleanup: **not-started (unverified)**');
  expect(summary).not.toMatch(/\| .* \| passed \|/);
});

test('a failed report preserves partial verified coverage and failed stage outcomes', () => {
  const report = failed();
  report.coverage.hyperliquid.verified = true;
  report.stages = [
    { name: lifecycleStages[0], status: 'passed' },
    { name: lifecycleStages[1], status: 'failed' },
  ];
  report.cleanup = { status: 'failed' };
  const summary = formatTestnetSummary(report);
  expect(summary).toContain('Hyperliquid testnet: **verified**');
  expect(summary).toContain('Privy dedicated test app: **unverified**');
  expect(summary).toContain(`| ${lifecycleStages[0]} | passed |`);
  expect(summary).toContain(`| ${lifecycleStages[1]} | failed |`);
});

test('failed cleanup can record unreadable resource counts as null without claiming verification', () => {
  const report = failed();
  report.cleanup = {
    status: 'failed',
    orders: null,
    agents: null,
    positions: null,
  };
  expect(verifyTestnetReport(report)).toBe(report);
  expect(formatTestnetSummary(report)).toContain(
    'Cleanup: **failed (unverified)**',
  );
});

test.each(['hyperliquid', 'privy', 'relay'])(
  'failed reports cannot claim verified %s without evidence',
  (service) => {
    const report = failed();
    report.coverage[service].verified = true;
    expect(() => verifyTestnetReport(report)).toThrow('passed evidence stage');
    expect(formatTestnetSummary(report)).toContain('lifecycle: **unproven**');
  },
);

test('invalid metadata never produces a passed summary', () => {
  const cases = [
    undefined,
    null,
    [],
    {},
    { ...complete(), schemaVersion: 1 },
    { ...complete(), network: 'mainnet' },
    { ...complete(), status: 'secret-raw-error' },
    { ...complete(), stages: {} },
    { ...complete(), coverage: null },
    { ...complete(), cleanup: 'verified' },
    { ...complete(), cleanup: { status: 'secret-raw-error' } },
    { ...complete(), agentSession: { status: 'passed' } },
    { ...complete(), agentSession: null },
    { ...complete(), stages: [{ name: 'secret-raw-error', status: 'passed' }] },
    {
      ...complete(),
      stages: [{ name: lifecycleStages[0], status: 'secret-raw-error' }],
    },
  ];
  for (const report of cases) {
    expect(() => verifyTestnetReport(report)).toThrow();
    const summary = formatTestnetSummary(report);
    expect(summary).toContain('lifecycle: **unproven**');
    expect(summary).not.toContain('secret-raw-error');
    expect(summary).not.toContain('**passed**');
  }
});

test('freeform metadata and reasons never reach CI output', () => {
  const report = complete();
  const secret = 'sentinel-secret-never-output';
  report.failure = secret;
  report.accountOwnership = secret;
  report.commit = secret;
  report.missingSecrets = [secret];
  report.agentSession.reason = secret;
  report.coverage.hyperliquid.mode = secret;
  report.stages[0].error = secret;
  expect(formatTestnetSummary(report)).not.toContain(secret);
});

test('failed summaries expose only whitelisted lifecycle and finalization failure names', () => {
  for (const failure of [
    ...lifecycleStages,
    'testnet-preflight',
    'testnet-cleanup',
    'testnet-artifacts',
    'testnet-runner-shutdown',
    'testnet-report-verification',
  ]) {
    expect(formatTestnetSummary({ ...failed(), failure })).toContain(
      `Failure: **${failure}**`,
    );
  }
  const summary = formatTestnetSummary({
    ...failed(),
    failure: 'sentinel-secret-raw-sdk-error',
  });
  expect(summary).toContain('Failure: **unclassified**');
  expect(summary).not.toContain('sentinel-secret');
});

const summaryCli = fileURLToPath(
  new URL('../scripts/testnet-summary.mjs', import.meta.url),
);
async function withCli(action) {
  const directory = await mkdtemp(join(tmpdir(), 'bloxwap-testnet-summary-'));
  try {
    await copyFile(summaryCli, join(directory, 'testnet-summary.mjs'));
    await copyFile(
      fileURLToPath(new URL('../scripts/testnet-report.mjs', import.meta.url)),
      join(directory, 'testnet-report.mjs'),
    );
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function runCli(path, env = {}) {
  const childEnv = { ...process.env, ...env };
  if (!('GITHUB_STEP_SUMMARY' in env)) delete childEnv.GITHUB_STEP_SUMMARY;
  return spawnSync(
    process.execPath,
    [join(dirname(path), 'testnet-summary.mjs'), path],
    {
      cwd: dirname(path),
      encoding: 'utf8',
      env: childEnv,
    },
  );
}

test('summary CLI appends a verified pass and succeeds without installed dependencies', async () => {
  await withCli(async (directory) => {
    const path = join(directory, 'report.json');
    const summary = join(directory, 'summary.md');
    await writeFile(path, JSON.stringify(complete()));
    await writeFile(summary, 'Earlier summary\n');
    const result = runCli(path, { GITHUB_STEP_SUMMARY: summary });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(await readFile(summary, 'utf8')).toBe(
      'Earlier summary\n' + formatTestnetSummary(complete()),
    );
  });
});

test('summary CLI fails closed for missing, malformed and falsely passed reports', async () => {
  await withCli(async (directory) => {
    const path = join(directory, 'sentinel-secret-report.json');
    for (const text of [
      undefined,
      'sentinel-secret-not-json',
      JSON.stringify({ ...complete(), stages: [] }),
      JSON.stringify(failed()),
    ]) {
      if (text !== undefined) await writeFile(path, text);
      const result = runCli(path);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        text === JSON.stringify(failed())
          ? 'lifecycle: **failed**'
          : 'lifecycle: **unproven**',
      );
      expect(result.stdout + result.stderr).not.toContain('sentinel-secret');
    }
  });
});

test('summary CLI rejects an unwritable summary destination without leaking its path', async () => {
  await withCli(async (directory) => {
    const path = join(directory, 'report.json');
    await writeFile(path, JSON.stringify(complete()));
    const result = runCli(path, {
      GITHUB_STEP_SUMMARY: join(directory, 'sentinel-secret', 'summary.md'),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('lifecycle: **passed**');
    expect(result.stderr + result.stdout).not.toContain('sentinel-secret');
  });
});
