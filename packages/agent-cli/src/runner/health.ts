import { collateralBalance } from '../core/account.js';
import { expiryWarnings } from '../wallet/expiry.js';
import { activeRunner, runningInfo, type Runner } from './lifecycle.js';
import type { Subscriptions } from './subscriptions.js';
import { events } from './events.js';
import { hlInfo } from '../core/http.js';
import { pollDeposits } from '../funding/status.js';
import { normalizeError } from '../errors/index.js';
export function health(runner: Runner, now = Date.now()) {
  const subscriptions = runner.subscriptions;
  return {
    pid: String(runner.info.pid),
    uptimeSeconds: String(Math.max(0, (now - runner.info.startedAt) / 1000)),
    wsState: subscriptions?.state ?? 'disconnected',
    wsStale: !subscriptions || now - subscriptions.lastMessage > 90_000,
    lastFillTime: subscriptions?.lastFill ?? null,
    signingSession: runner.signer ? 'ready' : 'unavailable',
  };
}
export async function runnerHealth() {
  if (activeRunner) return health(activeRunner);
  const info = await runningInfo();
  return info
    ? {
        pid: String(info.pid),
        uptimeSeconds: String((Date.now() - info.startedAt) / 1000),
        wsState: 'unknown',
        signingSession: 'unknown',
      }
    : null;
}
export function startHeartbeat(runner: Runner, subscriptions: Subscriptions) {
  runner.subscriptions = subscriptions;
  let queue = Promise.resolve();
  const tick = () => {
    queue = queue
      .then(async () => {
        await events.append('runner_state', health(runner));
        await expiryWarnings(runner.config);
        if (runner.config.masterAddress) {
          const state = await hlInfo<{
            marginSummary: { accountValue: string };
            assetPositions: { position: { unrealizedPnl: string } }[];
          }>(runner.config.network, 'clearinghouseState', {
            user: runner.config.masterAddress,
          });
          await pollDeposits(
            runner.config.network,
            runner.config.masterAddress,
            collateralBalance(state),
            {
              emit: async (deposit) => {
                await events.append('deposit', {
                  id: deposit.id,
                  state: deposit.state,
                });
              },
            },
          );
        }
      })
      .catch(async (error) => {
        await events.append('error', normalizeError(error).toJSON());
      });
  };
  tick();
  const timer = setInterval(tick, 30_000);
  runner.onShutdown(async () => {
    clearInterval(timer);
    await queue;
  });
}
