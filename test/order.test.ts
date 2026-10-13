import { expect, test } from 'vitest';
import { prepareOrder, orderSchema } from '../src/commands/order.js';
import { migrate } from '../src/core/config.js';
import { mockTrading } from './fixtures.js';

test('order rounds limit and bounds market IOC', async () => {
  const clients = mockTrading();
  expect(
    await prepareOrder(
      migrate({}),
      orderSchema.parse({
        coin: 'BTC',
        side: 'buy',
        size: '0.0012345',
        price: '20000.1',
      }),
      clients,
    ),
  ).toMatchObject({
    a: 0,
    s: '0.00123',
    p: '20000',
    t: { limit: { tif: 'Gtc' } },
  });
  expect(
    await prepareOrder(
      migrate({}),
      orderSchema.parse({
        coin: 'BTC',
        side: 'sell',
        size: '0.001',
        type: 'market',
      }),
      clients,
    ),
  ).toMatchObject({ p: '19800', t: { limit: { tif: 'Ioc' } } });
  await expect(
    prepareOrder(
      migrate({}),
      orderSchema.parse({ coin: 'BTC', side: 'buy', size: '0', price: '1' }),
      clients,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_SIZE' });
});
test('sell IOC rounding stays inside the slippage floor', async () => {
  const clients = mockTrading();
  clients.mids = async () => ({ BTC: '123.456' });
  const order = await prepareOrder(
    migrate({}),
    orderSchema.parse({
      coin: 'BTC',
      side: 'sell',
      size: '0.001',
      type: 'market',
      slippage: 0.01,
    }),
    clients,
  );
  expect(Number(order.p)).toBeGreaterThanOrEqual(123.456 * 0.99);
  const trigger = await prepareOrder(
    migrate({}),
    orderSchema.parse({
      coin: 'BTC',
      side: 'sell',
      size: '0.001',
      type: 'sl',
      triggerPrice: '100',
      reduceOnly: true,
    }),
    clients,
  );
  expect(trigger.t).toMatchObject({ trigger: { isMarket: true, tpsl: 'sl' } });
});
