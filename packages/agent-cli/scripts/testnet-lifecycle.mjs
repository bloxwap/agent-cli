import assert from 'node:assert/strict';

export const requiredTestnetSecrets = [
  'BLOXWAP_TEST_MASTER_KEY',
  'BLOXWAP_PRIVY_APP_ID',
  'BLOXWAP_PRIVY_APP_SECRET',
];

export function requireTestnetEnvironment(env) {
  assert.equal(env.BLOXWAP_E2E, '1', 'Explicit BLOXWAP_E2E=1 is required');
  assert.ok(['true', '1'].includes(env.CI), 'Test master signing is CI-only');
  assert.equal(env.BLOXWAP_TEST_ACCOUNT_ONLY, '1',
    'A disposable company-owned test account must be explicitly acknowledged');
  const missing = requiredTestnetSecrets.filter((name) => !env[name]);
  assert.equal(missing.length, 0, `Missing testnet secrets: ${missing.join(', ')}`);
}

// No wallet key enters this driver. CI supplies a narrowly scoped external test
// signer; production approvals always stay in the user's external wallet.
export async function testnetLifecycle({
  command, info, sign, masterAddress, appId, startFollow,
  checkpoint = () => {}, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const intent = `testnet-lifecycle-${now()}`;
  async function stage(name, action) {
    checkpoint({ name, status: 'running' });
    try {
      const result = await action();
      checkpoint({ name, status: 'passed' });
      return result;
    } catch (error) {
      checkpoint({ name, status: 'failed' });
      throw error;
    }
  }
  async function until(read, accept, message) {
    const started = now();
    for (let attempt = 0; attempt < 12 && now() - started < 300_000; attempt++) {
      const result = await read();
      if (accept(result)) return result;
      await wait(Math.min(1000 * 2 ** attempt, 15_000));
    }
    throw new Error(message);
  }
  await stage('test-account-preflight', async () => {
    const state = await info('clearinghouseState', { user: masterAddress });
    assert.ok(Number(state.withdrawable) >= 30,
      'Disposable account requires at least 30 test USDC; no real funding is performed');
    assert.ok(state.assetPositions.every(({ position }) => Number(position.szi) === 0),
      'Disposable test account must have no positions');
    assert.deepEqual(await info('frontendOpenOrders', { user: masterAddress }), [],
      'Disposable test account must have no open orders');
    assert.deepEqual(await info('extraAgents', { user: masterAddress }), [],
      'Disposable test account must have no leftover agent approvals');
  });
  await stage('configure', async () => {
    for (const [key, value] of [
      ['privyAppId', appId],
      ['privyAppSecretRef', 'env:BLOXWAP_PRIVY_APP_SECRET'],
      ['allowedMarkets', '["BTC"]'],
      ['limits.maxNotional', '50'],
      ['limits.maxPositionNotional', '50'],
      ['limits.maxOpenOrders', '2'],
    ]) await command('config', { args: ['set', key, value] });
  });
  await stage('init-agent-and-builder-approvals', async () => {
    const pending = await command('init', { masterAddress, qr: false });
    assert.equal(pending.approved, false);
    assert.ok(pending.approvals.agent.typedData);
    let approved = await command('init', {
      signature: await sign(pending.approvals.agent), qr: false,
    });
    if (pending.approvals.builder) approved = await command('init', {
      builderSignature: await sign(pending.approvals.builder), qr: false,
    });
    assert.equal(approved.approved, true, 'Both exchange approvals must be visible');
  });
  await stage('mock-relay-funding-and-settlement', async () => {
    const deposit = await command('fund', {
      amount: '10', originChain: 421614,
      originCurrency: '0x' + '0'.repeat(40), originDecimals: 6, qr: true,
    });
    assert.equal(deposit.expectedReceived, '0', 'Only the explicit zero-value Relay fixture is allowed');
    assert.ok(deposit.qrAscii, 'Funding QR must be rendered');
    await until(() => command('status'), (status) => {
      const current = status.deposits.find(({ id }) => id === deposit.depositId);
      assert.ok(current, 'Quoted deposit must appear in status');
      assert.ok(!['failed', 'refunded'].includes(current.state), 'Funding failed');
      return current.state === 'settled';
    }, 'Funding did not settle within the polling budget');
  });
  await stage('runner-readiness', async () => {
    const runner = await command('run', { detach: true });
    assert.equal(runner.network, 'testnet');
    assert.equal(runner.ready, true);
    await command('config', { args: ['set', 'runnerFallback', 'false'] });
    const status = await command('status');
    assert.equal(status.runner.signingSession, 'ready', 'Signing must route through the runner');
    assert.equal(status.runner.wsState, 'connected');
  });
  const stopFollowing = await startFollow();
  let oid;
  try {
    await stage('place-and-reconcile-resting-order', async () => {
      const market = await command('market', { coin: 'BTC' });
      const mid = Number(market.mid);
      const decimals = Number(market.szDecimals);
      assert.ok(Number.isFinite(mid) && mid > 0 && Number.isInteger(decimals));
      // Size ~20 test USD at a post-only bid well below the market; never an IOC.
      const price = String(Math.floor(mid * 0.7));
      const size = (Math.ceil(20 / Number(price) * 10 ** decimals) / 10 ** decimals)
        .toFixed(decimals);
      const cloid = '0x' + now().toString(16).padStart(32, '0');
      const placed = await command('order', {
        coin: 'BTC', side: 'buy', size, price, tif: 'Alo', cloid, intentId: intent,
      });
      oid = placed.result.response.data.statuses[0].resting?.oid;
      assert.ok(oid, 'Expected a resting post-only test order, not a fill');
      await until(() => command('orders'),
        (orders) => orders.some((order) => Number(order.oid) === oid && order.cloid === cloid),
        'Accepted order not visible on exchange');
    });
    await stage('modify-and-reconcile', async () => {
      const [original] = (await command('orders')).filter((order) => Number(order.oid) === oid);
      assert.ok(original, 'Order disappeared before modification');
      const price = String(Math.floor(Number(original.limitPx) * 0.98));
      await command('modify', { modifications: [{ oid, price }], intentId: intent });
      const orders = await until(() => command('orders'),
        (orders) => orders.some((order) => Number(order.limitPx) === Number(price)),
        'Modified price not visible on exchange');
      oid = Number(orders.find((order) => Number(order.limitPx) === Number(price)).oid);
    });
    await stage('cancel-and-reconcile', async () => {
      await command('cancel', { oid, intentId: intent });
      await until(() => command('orders'), (orders) => orders.length === 0,
        'Cancellation not visible on exchange');
    });
    await stage('websocket-events-and-replay', async () => {
      const events = await until(() => command('events', { since: 0 }),
        (events) => events.some((event) => event.type === 'order_update') &&
          events.some((event) => event.type === 'runner_state'),
        'No real order-update and runner events observed');
      assert.ok(events.every((event, i) => !i || event.seq > events[i - 1].seq));
      const cursor = events[Math.floor(events.length / 2)].seq;
      const replay = await command('events', { since: cursor });
      assert.deepEqual(replay.filter((event) => event.seq <= events.at(-1).seq),
        events.filter((event) => event.seq > cursor));
    });
    await stage('rotate-and-revoke-old-agent', async () => {
      const pending = await command('rotate', { intentId: intent });
      const swapped = await command('rotate', {
        signature: await sign(pending.approval), intentId: intent,
      });
      assert.equal(swapped.swapped, true);
      assert.notEqual(swapped.newAgent, swapped.oldAgent);
      const revoked = await command('rotate', {
        revokeSignature: await sign(swapped.revokeApproval), intentId: intent,
      });
      assert.equal(revoked.oldRevoked, true);
      await until(() => info('extraAgents', { user: masterAddress }),
        (agents) => agents.some((agent) => agent.address.toLowerCase() === swapped.newAgent.toLowerCase()) &&
          !agents.some((agent) => agent.address.toLowerCase() === swapped.oldAgent.toLowerCase()),
        'Rotation not confirmed on exchange');
      assert.equal((await command('status')).runner.signingSession, 'ready');
    });
    await stage('revoke-and-confirm-exchange-state', async () => {
      const pending = await command('revoke', { cancelOrders: true, intentId: intent });
      assert.equal(pending.locallyRevoked, true);
      const revoked = await command('revoke', {
        signature: await sign(pending.approval), intentId: intent,
      });
      assert.equal(revoked.exchangeRevoked, true);
      await until(() => command('status'), (status) =>
        status.agent.revoked && !status.agent.approved &&
        status.runner.signingSession === 'unavailable',
      'Final revocation not visible locally and on exchange');
      assert.deepEqual(await command('orders'), []);
    });
    await stage('audit-integrity-and-intent-linkage', async () => {
      // The audit command verifies the entire hash chain before filtering.
      const entries = await command('audit', { intent });
      for (const action of ['order', 'modify', 'cancel', 'rotate', 'revoke']) {
        assert.ok(entries.some((entry) => entry.stage === 'intent' && entry.data.action === action),
          `Missing ${action} audit intent`);
        assert.ok(entries.some((entry) => entry.stage === 'response' && entry.data.action === action),
          `Missing ${action} audit response`);
      }
      assert.ok(entries.some((entry) => entry.stage === 'signature'), 'Missing signing audit evidence');
    });
  } finally {
    await stopFollowing();
  }
}
