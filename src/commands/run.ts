import { startHeartbeat } from '../runner/health.js';
import { events, eventTypes, type EventType } from '../runner/events.js';
import { startSubscriptions } from '../runner/subscriptions.js';
import { rpcServer } from '../runner/rpc.js';
import { z } from 'zod';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import { Runner, detachRunner, setActiveRunner } from '../runner/lifecycle.js';
register('run', {
  description: 'Start persistent signing runner (foreground or detach)',
  schema: z.object({
    detach: z.boolean().default(false),
    daemon: z.boolean().default(false),
  }),
  execute: async (input, context) => {
    if (input.detach || input.daemon)
      return detachRunner([
        ...(context.configPath ? ['--config', context.configPath] : []),
        ...(context.network ? ['--network', context.network] : []),
      ]);
    const runner = new Runner(await commandConfig(context));
    const info = await runner.start();
    if (!info.existing) {
      setActiveRunner(runner);
      runner.signals();
      runner.onShutdown(() => events.flush());
      try {
        await rpcServer(runner, context);
        const subscriptions = await startSubscriptions(
          runner,
          async (type, data) => {
            if (eventTypes.includes(type as EventType))
              await events.append(type as EventType, data);
            runner.logger.log(type === 'error' ? 'error' : 'info', type, {
              data,
            });
          },
        );
        startHeartbeat(runner, subscriptions);
        await runner.markReady();
      } catch (error) {
        await runner.shutdown();
        throw error;
      }
    }
    return { ...info, ready: info.existing ? info.ready : runner.info.ready };
  },
});
