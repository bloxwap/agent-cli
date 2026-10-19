import { startHeartbeat } from '../runner/health.js';
import { events, eventTypes, paperEvents, type EventType } from '../runner/events.js';
import { startSubscriptions } from '../runner/subscriptions.js';
import { rpcServer } from '../runner/rpc.js';
import { z } from 'zod';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import { paperDir } from '../core/mode.js';
import { startPaperEngine } from '../paper/engine.js';
import { Runner, detachRunner, runnerPidPath, setActiveRunner } from '../runner/lifecycle.js';
register('run', {
  description: 'Start persistent signing runner (foreground or detach)',
  schema: z.object({
    detach: z.boolean().default(false),
    daemon: z.boolean().default(false),
    paper: z.boolean().default(false),
  }),
  execute: async (input, context) => {
    const config = await commandConfig(context);
    const paper = input.paper || config.mode === 'paper';
    if (input.detach || input.daemon)
      return {
        paper,
        ...(await detachRunner(
          [
            ...(context.configPath ? ['--config', context.configPath] : []),
            ...(context.network ? ['--network', context.network] : []),
            ...(paper ? ['--paper'] : []),
          ],
          runnerPidPath(paper ? 'paper' : 'live'),
        )),
      };
    if (paper) {
      const runner = new Runner(config, paperDir());
      const info = await runner.start(async () => undefined as never);
      if (!info.existing) {
        setActiveRunner(runner);
        runner.signals();
        runner.onShutdown(() => paperEvents.flush());
        try {
          await rpcServer(runner, context);
          await startPaperEngine(runner, async (type, data) => {
            if (eventTypes.includes(type as EventType))
              await paperEvents.append(type as EventType, data);
            runner.logger.log(type === 'error' ? 'error' : 'info', type, {
              data,
            });
          });
          await runner.markReady();
        } catch (error) {
          await runner.shutdown();
          throw error;
        }
      }
      return {
        paper: true,
        ...info,
        ready: info.existing ? info.ready : runner.info.ready,
      };
    }
    const runner = new Runner(config);
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
    return {
      paper: false,
      ...info,
      ready: info.existing ? info.ready : runner.info.ready,
    };
  },
});
