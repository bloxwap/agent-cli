import assert from 'node:assert/strict';

// Keep this dependency-free: hosted summaries must work even if npm ci failed.
export const lifecycleStages = Object.freeze([
  'test-account-preflight',
  'configure',
  'init-agent-and-builder-approvals',
  'mock-relay-funding-and-settlement',
  'runner-readiness',
  'events-follow-start',
  'place-and-reconcile-resting-order',
  'modify-and-reconcile',
  'cancel-and-reconcile',
  'websocket-events-and-replay',
  'rotate-and-revoke-old-agent',
  'post-rotation-order-and-cancel',
  'revoke-and-confirm-exchange-state',
  'audit-integrity-and-intent-linkage',
  'events-follow-verification',
]);
const stageNames = new Set(lifecycleStages);
const failureNames = new Set([
  ...lifecycleStages,
  'testnet-preflight',
  'testnet-cleanup',
  'testnet-artifacts',
  'testnet-runner-shutdown',
  'testnet-report-verification',
]);
const stageStatuses = new Set(['running', 'passed', 'failed']);
const cleanupStatuses = new Set(['not-started', 'failed', 'verified']);
const services = Object.freeze([
  ['hyperliquid', 'Hyperliquid testnet approvals and account reads'],
  ['orders', 'Hyperliquid orders (mocked)'],
  ['privy', 'Privy dedicated test app'],
  ['relay', 'Relay zero-value mock'],
]);
const serviceEvidence = {
  hyperliquid: 'test-account-preflight',
  orders: 'place-and-reconcile-resting-order',
  privy: 'init-agent-and-builder-approvals',
  relay: 'mock-relay-funding-and-settlement',
};
const resources = ['orders', 'agents', 'positions'];
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function verifyTestnetReport(report) {
  assert.ok(object(report), 'Lifecycle report must be an object');
  assert.equal(
    report.schemaVersion,
    2,
    'Lifecycle report schemaVersion must be 2',
  );
  assert.equal(
    report.network,
    'testnet',
    'Lifecycle report must target testnet',
  );
  assert.ok(
    ['passed', 'failed'].includes(report.status),
    'Invalid lifecycle status',
  );
  assert.ok(Array.isArray(report.stages), 'Lifecycle stages must be an array');
  for (const stage of report.stages) {
    assert.ok(
      object(stage) && stageNames.has(stage.name),
      'Unknown lifecycle stage',
    );
    assert.ok(
      stageStatuses.has(stage.status),
      'Invalid lifecycle stage status',
    );
  }
  assert.ok(object(report.coverage), 'Service coverage is required');
  for (const [service] of services) {
    assert.ok(
      object(report.coverage[service]),
      'Service coverage entry is required',
    );
    assert.equal(
      typeof report.coverage[service].verified,
      'boolean',
      'Service verification must be boolean',
    );
    if (report.status !== 'passed' && report.coverage[service].verified) {
      const evidence = report.stages.filter(
        (stage) => stage.name === serviceEvidence[service],
      );
      assert.ok(
        evidence.length > 0 &&
          evidence.at(-1).status === 'passed' &&
          !evidence.some((stage) => stage.status === 'failed'),
        'Verified service coverage requires a passed evidence stage',
      );
    }
  }
  assert.ok(
    object(report.cleanup) && cleanupStatuses.has(report.cleanup.status),
    'Invalid cleanup status',
  );
  for (const resource of resources) {
    const count = report.cleanup[resource];
    if (
      (count !== undefined && count !== null) ||
      report.cleanup.status === 'verified'
    )
      assert.ok(
        Number.isSafeInteger(count) && count >= 0,
        'Cleanup counts must be nonnegative integers',
      );
    if (report.cleanup.status === 'verified')
      assert.equal(count, 0, 'Verified cleanup must leave no test resources');
  }
  // This report proves a deterministic lifecycle only. Independent coding-agent
  // sessions require separate evidence and must never be inferred from its pass.
  assert.ok(
    object(report.agentSession),
    'Independent agent session status is required',
  );
  assert.equal(
    report.agentSession.status,
    'not-run',
    'A deterministic report cannot verify an independent agent session',
  );
  if (report.status === 'passed') {
    for (const name of lifecycleStages) {
      const events = report.stages.filter((stage) => stage.name === name);
      assert.ok(
        events.length > 0,
        'Passed lifecycle is missing a required stage',
      );
      assert.ok(
        !events.some((stage) => stage.status === 'failed'),
        'Passed lifecycle contains a failed stage',
      );
      assert.equal(
        events.at(-1).status,
        'passed',
        'Passed lifecycle contains an incomplete stage',
      );
    }
    for (const [service] of services)
      assert.equal(
        report.coverage[service].verified,
        true,
        'Passed lifecycle has unverified service coverage',
      );
    assert.equal(
      report.cleanup.status,
      'verified',
      'Passed lifecycle has unverified cleanup',
    );
  }
  return report;
}

function unprovenSummary() {
  return [
    'Deterministic testnet lifecycle: **unproven**.',
    '',
    'No valid schemaVersion 2 lifecycle report was available.',
    '',
    ...services.map(([, label]) => `- ${label}: **unverified**.`),
    '- Cleanup: **unverified**.',
    '- Independent agent session: **unverified**.',
    '',
    'Live Relay coverage, live Hyperliquid order placement and an independent AI-agent session are unproven.',
    '',
  ].join('\n');
}

export function formatTestnetSummary(report) {
  try {
    verifyTestnetReport(report);
  } catch {
    return unprovenSummary();
  }
  const stageOutcome = (name) => {
    const events = report.stages.filter((stage) => stage.name === name);
    return events.some((stage) => stage.status === 'failed')
      ? 'failed'
      : (events.at(-1)?.status ?? 'not-run');
  };
  const cleanup =
    report.cleanup.status === 'verified'
      ? 'verified (0 orders, 0 agents, 0 positions)'
      : `${report.cleanup.status} (unverified)`;
  // Only fixed labels, known enums and booleans reach CI output. Never echo raw
  // errors, reasons, account metadata, report paths or arbitrary service modes.
  return [
    `Deterministic testnet lifecycle: **${report.status}**.`,
    '',
    ...(report.status === 'failed'
      ? [
          `- Failure: **${failureNames.has(report.failure) ? report.failure : 'unclassified'}**.`,
        ]
      : []),
    ...services.map(
      ([key, label]) =>
        `- ${label}: **${report.coverage[key].verified ? 'verified' : 'unverified'}**.`,
    ),
    `- Cleanup: **${cleanup}**.`,
    '- Independent agent session: **not-run (unverified)**.',
    '',
    'Relay verification covers the zero-value mock only; live Relay remains unverified. Hyperliquid order placement, modification and cancellation are mocked and blocked from the exchange. A passing deterministic script does not verify an independent AI-agent session.',
    '',
    '| Lifecycle stage | Outcome |',
    '| --- | --- |',
    ...lifecycleStages.map((name) => `| ${name} | ${stageOutcome(name)} |`),
    '',
  ].join('\n');
}
