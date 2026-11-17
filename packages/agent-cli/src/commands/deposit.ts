import { z } from 'zod';
import { register } from '../core/router.js';
import { readDeposits, selectDeposit } from '../funding/store.js';
import { abandonDeposit } from '../funding/status.js';
import {
  signatureSteps,
  submitDepositSignature,
} from '../funding/signatures.js';
import { commandConfig } from './read.js';
import { assertLiveMode } from '../core/trading.js';
import { AgentCliError } from '../errors/index.js';
register('deposit', {
  description: 'Resume deposit steps or submit a master-wallet signature',
  schema: z.object({
    depositId: z.string(),
    stepId: z.string().optional(),
    signature: z.string().optional(),
    abandon: z.boolean().default(false),
  }),
  execute: async (input, context) => {
    const config = await commandConfig(context);
    assertLiveMode(config, 'deposit');
    const account = {
      network: config.network,
      recipient: config.masterAddress ?? '',
    };
    const selected = selectDeposit(
      await readDeposits(),
      input.depositId as string,
      account,
    );
    if (
      !selected ||
      selected.network !== config.network ||
      selected.recipient.toLowerCase() !== config.masterAddress?.toLowerCase()
    )
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Deposit does not belong to the selected account and network',
      );
    if (input.abandon)
      return abandonDeposit(input.depositId as string, undefined, account);
    if (input.signature && input.stepId)
      return submitDepositSignature(
        input.depositId as string,
        input.stepId as string,
        input.signature as string,
        {
          account: {
            network: config.network,
            recipient: config.masterAddress!,
          },
        },
      );
    const deposit = selected;
    if (!deposit) throw new AgentCliError('CONFIG_INVALID', 'Unknown deposit');
    return { depositId: deposit.id, steps: signatureSteps(deposit) };
  },
});
