import assert from 'node:assert/strict';
import { formatPrice } from '@bloxwap/hyperliquid/utils';

export {
  requiredTestnetSecrets,
  requireTestnetEnvironment,
} from './testnet-signers.mjs';

// No wallet key enters this driver. Approvals use the caller's external wallet
// or the separate disposable CI-only signer; production keys stay external.
export async function testnetLifecycle({
  command,
  info,
  sign,
  masterAddress,
  appId,
  startFollow,
  rememberAgent = () => {},
  checkpoint = () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const intent = `testnet-lifecycle-${now()}`;
  const ownedOrders = [];
  let orderSerial = 0;
  const decimal = (value) => {
    assert.match(String(value), /^\d+(\.\d+)?$/, 'Expected a decimal string');
    const [whole, fraction = ''] = String(value).split('.');
    return { units: BigInt(whole + fraction), places: fraction.length };
  };
  const decimalEqual = (left, right) => {
    const a = decimal(left),
      b = decimal(right);
    return (
      a.units * 10n ** BigInt(b.places) === b.units * 10n ** BigInt(a.places)
    );
  };
  const fixed = (units, places) => {
    const digits = units.toString().padStart(places + 1, '0');
    return places
      ? `${digits.slice(0, -places)}.${digits.slice(-places)}`
      : digits;
  };
  const discountedPrice = (value, basisPoints, decimals) => {
    const { units, places } = decimal(value);
    return formatPrice(
      fixed(units * BigInt(basisPoints), places + 4),
      decimals,
    );
  };
  async function remember(address, approval) {
    assert.match(
      address,
      /^0x[0-9a-fA-F]{40}$/,
      'Expected a public agent address',
    );
    assert.equal(
      approval.action.agentAddress.toLowerCase(),
      address.toLowerCase(),
    );
    const name = approval.action.agentName.replace(/ valid_until \d+$/, '');
    assert.ok(name.length > 0 && name.length <= 16, 'Expected an agent name');
    await rememberAgent({ address, name });
  }
  function hasOrderUpdates(events, orders = ownedOrders) {
    if (!Array.isArray(events)) return false;
    const updates = events.flatMap((event) =>
      event.type === 'order_update' && Array.isArray(event.data)
        ? event.data
        : [],
    );
    return (
      orders.length > 0 &&
      orders.every((order) =>
        ['open', 'canceled'].every((status) =>
          updates.some(
            (update) =>
              update.status === status &&
              update.order?.coin === 'BTC' &&
              (status === 'canceled'
                ? String(update.order.oid) === String(order.oid)
                : order.oids.has(String(update.order.oid))) &&
              (!update.order.cloid || update.order.cloid === order.cloid),
          ),
        ),
      )
    );
  }
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
    for (
      let attempt = 0;
      attempt < 12 && now() - started < 300_000;
      attempt++
    ) {
      const result = await read();
      if (accept(result)) return result;
      await wait(Math.min(1000 * 2 ** attempt, 15_000));
    }
    throw new Error(message);
  }
  async function placeRestingOrder() {
    const market = await command('market', { coin: 'BTC' });
    const decimals = Number(market.szDecimals);
    assert.ok(
      Number.isInteger(decimals) && decimals >= 0 && decimals <= 6,
      'Invalid market precision',
    );
    // Exact decimal arithmetic keeps the submitted price and reconciled price
    // identical after the SDK applies exchange tick/significant-digit rules.
    const price = discountedPrice(market.mid, 7000, decimals);
    const { units, places } = decimal(price);
    assert.ok(units > 0n);
    const target = 20n * 10n ** BigInt(places + decimals);
    const size = fixed((target + units - 1n) / units, decimals);
    const cloid =
      '0x' +
      (BigInt(now()) * 2n + BigInt(orderSerial++))
        .toString(16)
        .padStart(32, '0');
    const placed = await command('order', {
      coin: 'BTC',
      side: 'buy',
      size,
      price,
      tif: 'Alo',
      cloid,
      intentId: intent,
    });
    const oid = placed.result.response.data.statuses[0].resting?.oid;
    assert.ok(
      Number.isSafeInteger(oid) && oid > 0,
      'Expected a resting post-only test order, not a fill',
    );
    const order = { oid, cloid, decimals, oids: new Set([String(oid)]) };
    ownedOrders.push(order);
    await until(
      () => command('orders'),
      (orders) =>
        orders.some(
          (candidate) =>
            Number(candidate.oid) === oid &&
            candidate.cloid === cloid &&
            candidate.coin === 'BTC' &&
            decimalEqual(candidate.limitPx, price),
        ),
      'Accepted order not visible on exchange',
    );
    return order;
  }
  await stage('test-account-preflight', async () => {
    const state = await info('clearinghouseState', { user: masterAddress });
    assert.ok(
      Number(state.withdrawable) >= 30,
      'Disposable account requires at least 30 test USDC; no real funding is performed',
    );
    assert.ok(
      state.assetPositions.every(
        ({ position }) =>
          typeof position?.szi === 'string' &&
          /^-?0+(\.0+)?$/.test(position.szi),
      ),
      'Disposable test account must have no positions',
    );
    assert.deepEqual(
      await info('frontendOpenOrders', { user: masterAddress }),
      [],
      'Disposable test account must have no open orders',
    );
    assert.deepEqual(
      await info('extraAgents', { user: masterAddress }),
      [],
      'Disposable test account must have no leftover agent approvals',
    );
  });
  await stage('configure', async () => {
    for (const [key, value] of [
      ['privyAppId', appId],
      ['privyAppSecretRef', 'env:BLOXWAP_PRIVY_APP_SECRET'],
      ['allowedMarkets', '["BTC"]'],
      ['limits.maxNotional', '50'],
      ['limits.maxPositionNotional', '50'],
      ['limits.maxOpenOrders', '2'],
    ])
      await command('config', { args: ['set', key, value] });
  });
  await stage('init-agent-and-builder-approvals', async () => {
    const pending = await command('init', { masterAddress, qr: false });
    await remember(pending.agentAddress, pending.approvals.agent);
    assert.equal(pending.approved, false);
    assert.ok(pending.approvals.agent.typedData);
    let approved = await command('init', {
      signature: await sign(pending.approvals.agent),
      qr: false,
    });
    if (pending.approvals.builder)
      approved = await command('init', {
        builderSignature: await sign(pending.approvals.builder),
        qr: false,
      });
    assert.equal(
      approved.approved,
      true,
      'Both exchange approvals must be visible',
    );
  });
  await stage('mock-relay-funding-and-settlement', async () => {
    const deposit = await command('fund', {
      amount: '10',
      originChain: 421614,
      originCurrency: '0x' + '0'.repeat(40),
      originDecimals: 6,
      qr: true,
    });
    assert.equal(
      deposit.expectedReceived,
      '0',
      'Only the explicit zero-value Relay fixture is allowed',
    );
    assert.ok(deposit.qrAscii, 'Funding QR must be rendered');
    await until(
      () => command('status'),
      (status) => {
        const current = status.deposits.find(
          ({ id }) => id === deposit.depositId,
        );
        assert.ok(current, 'Quoted deposit must appear in status');
        assert.ok(
          !['failed', 'refunded'].includes(current.state),
          'Funding failed',
        );
        return current.state === 'settled';
      },
      'Funding did not settle within the polling budget',
    );
  });
  await stage('runner-readiness', async () => {
    const runner = await command('run', { detach: true });
    assert.equal(runner.network, 'testnet');
    assert.equal(runner.ready, true);
    await command('config', { args: ['set', 'runnerFallback', 'false'] });
    const status = await command('status');
    assert.equal(
      status.runner.signingSession,
      'ready',
      'Signing must route through the runner',
    );
    assert.equal(status.runner.wsState, 'connected');
  });
  const stopFollowing = await stage('events-follow-start', startFollow);
  let initialOrder;
  let followStopped = false;
  let causalFailure = false;
  try {
    await stage('place-and-reconcile-resting-order', async () => {
      initialOrder = await placeRestingOrder();
    });
    await stage('modify-and-reconcile', async () => {
      const [original] = (await command('orders')).filter(
        (order) =>
          Number(order.oid) === initialOrder.oid &&
          order.cloid === initialOrder.cloid,
      );
      assert.ok(original, 'Order disappeared before modification');
      const price = discountedPrice(
        original.limitPx,
        9800,
        initialOrder.decimals,
      );
      await command('modify', {
        modifications: [{ oid: initialOrder.oid, price }],
        intentId: intent,
      });
      const matches = (order) =>
        order.cloid === initialOrder.cloid &&
        order.coin === 'BTC' &&
        decimalEqual(order.limitPx, price);
      const orders = await until(
        () => command('orders'),
        (orders) => orders.some(matches),
        'Modified price not visible on exchange',
      );
      initialOrder.oid = Number(orders.find(matches).oid);
      assert.ok(
        Number.isSafeInteger(initialOrder.oid) && initialOrder.oid > 0,
        'Invalid modified order ID',
      );
      initialOrder.oids.add(String(initialOrder.oid));
    });
    await stage('cancel-and-reconcile', async () => {
      await command('cancel', { oid: initialOrder.oid, intentId: intent });
      await until(
        () => command('orders'),
        (orders) => orders.length === 0,
        'Cancellation not visible on exchange',
      );
    });
    await stage('websocket-events-and-replay', async () => {
      const events = await until(
        () => command('events', { since: 0 }),
        (events) =>
          hasOrderUpdates(events) &&
          events.some((event) => event.type === 'runner_state'),
        'Missing correlated open/canceled order updates and runner events',
      );
      assert.ok(
        events.every((event, i) => !i || event.seq > events[i - 1].seq),
      );
      const cursor = events[Math.floor(events.length / 2)].seq;
      const replay = await command('events', { since: cursor });
      assert.deepEqual(
        replay.filter((event) => event.seq <= events.at(-1).seq),
        events.filter((event) => event.seq > cursor),
      );
    });
    const rotatedAddress = await stage(
      'rotate-and-revoke-old-agent',
      async () => {
        const pending = await command('rotate', { intentId: intent });
        await remember(pending.newAgent, pending.approval);
        const swapped = await command('rotate', {
          signature: await sign(pending.approval),
          intentId: intent,
        });
        assert.equal(swapped.swapped, true);
        assert.notEqual(swapped.newAgent, swapped.oldAgent);
        const revoked = await command('rotate', {
          revokeSignature: await sign(swapped.revokeApproval),
          intentId: intent,
        });
        assert.equal(revoked.oldRevoked, true);
        await until(
          () => info('extraAgents', { user: masterAddress }),
          (agents) =>
            agents.some(
              (agent) =>
                agent.address.toLowerCase() === swapped.newAgent.toLowerCase(),
            ) &&
            !agents.some(
              (agent) =>
                agent.address.toLowerCase() === swapped.oldAgent.toLowerCase(),
            ),
          'Rotation not confirmed on exchange',
        );
        assert.equal((await command('status')).runner.signingSession, 'ready');
        return swapped.newAgent;
      },
    );
    await stage('post-rotation-order-and-cancel', async () => {
      assert.equal(
        (await command('status')).agent.address.toLowerCase(),
        rotatedAddress.toLowerCase(),
      );
      const order = await placeRestingOrder();
      await command('cancel', { oid: order.oid, intentId: intent });
      await until(
        () => command('orders'),
        (orders) => orders.length === 0,
        'Post-rotation cancellation not visible on exchange',
      );
      await until(
        () => command('events', { since: 0 }),
        (events) => hasOrderUpdates(events),
        'Missing post-rotation open/canceled order updates',
      );
    });
    await stage('revoke-and-confirm-exchange-state', async () => {
      const pending = await command('revoke', {
        cancelOrders: true,
        intentId: intent,
      });
      assert.equal(pending.locallyRevoked, true);
      const revoked = await command('revoke', {
        signature: await sign(pending.approval),
        intentId: intent,
      });
      assert.equal(revoked.exchangeRevoked, true);
      await until(
        () => command('status'),
        (status) =>
          status.agent.revoked &&
          !status.agent.approved &&
          status.runner.signingSession === 'unavailable',
        'Final revocation not visible locally and on exchange',
      );
      assert.deepEqual(await command('orders'), []);
    });
    await stage('audit-integrity-and-intent-linkage', async () => {
      // The audit command verifies the entire hash chain before filtering.
      const entries = await command('audit', { intent });
      for (const action of ['order', 'modify', 'cancel', 'rotate', 'revoke']) {
        assert.ok(
          entries.some(
            (entry) => entry.stage === 'intent' && entry.data.action === action,
          ),
          `Missing ${action} audit intent`,
        );
        assert.ok(
          entries.some(
            (entry) =>
              entry.stage === 'response' && entry.data.action === action,
          ),
          `Missing ${action} audit response`,
        );
      }
      assert.ok(
        entries.some((entry) => entry.stage === 'signature'),
        'Missing signing audit evidence',
      );
    });
    await stage('events-follow-verification', async () => {
      followStopped = true;
      const events = await stopFollowing();
      assert.ok(
        hasOrderUpdates(events),
        'Follower did not deliver correlated open/canceled updates for both orders',
      );
    });
  } catch (error) {
    causalFailure = true;
    throw error;
  } finally {
    if (!followStopped) {
      try {
        await stopFollowing();
      } catch (error) {
        if (!causalFailure) throw error;
      }
    }
  }
}
