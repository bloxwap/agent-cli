import { createHash } from 'node:crypto';
import { withFileLock } from '../core/lock.js';
import { isTerminalDeposit } from './status.js';
import { AgentCliError } from '../errors/index.js';
import { jsonRequest } from '../core/http.js';
import {
  readDeposits,
  updateDeposits,
  depositPath,
  selectDeposit,
  type Deposit,
} from './store.js';
export function signatureSteps(deposit: Deposit) {
  return deposit.quote.steps.flatMap((step) =>
    step.kind === 'signature'
      ? step.items.map((item, index) => ({
          id: `${step.id}:${index}`,
          requiresSignature: !deposit.completedSteps.includes(
            `${step.id}:${index}`,
          ),
          payload: signaturePayload(item.data.sign),
          deeplink: `ethereum:${deposit.recipient}?request=${encodeURIComponent(JSON.stringify(signaturePayload(item.data.sign)))}`,
          post: item.data.post,
          check: item.check,
        }))
      : [],
  );
}
export async function submitDepositSignature(
  depositId: string,
  stepId: string,
  signature: string,
  options: {
    path?: string;
    base?: string;
    submit?: (url: string, body: unknown) => Promise<unknown>;
    check?: (url: string) => Promise<unknown>;
    account?: { network: Deposit['network']; recipient: string };
  } = {},
) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new AgentCliError('CONFIG_INVALID', 'Expected wallet signature');
  return withFileLock((options.path ?? depositPath()) + '.lock', async () => {
    const deposits = await readDeposits(options.path);
    const deposit = selectDeposit(deposits, depositId, options.account);
    if (!deposit) throw new AgentCliError('CONFIG_INVALID', 'Unknown deposit');
    if (
      options.account &&
      (deposit.network !== options.account.network ||
        deposit.recipient.toLowerCase() !==
          options.account.recipient.toLowerCase())
    )
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Deposit belongs to a different account',
      );
    if (isTerminalDeposit(deposit.state))
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Cannot submit a signature for a terminal deposit',
      );
    if (
      deposit.state === 'awaiting_funds' &&
      Date.now() > deposit.expiresAt &&
      !deposit.stepClaims?.[stepId]
    )
      throw new AgentCliError('CONFIG_INVALID', 'Deposit quote expired');
    const pending = signatureSteps(deposit).filter((s) => s.requiresSignature);
    if (!pending.length) return { complete: true };
    const step = pending[0];
    if (step.id !== stepId)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Submit signatures in step order',
        { nextStep: step.id },
      );
    const post = step.post as {
      endpoint: string;
      method: string;
      body: Record<string, unknown>;
    };
    if (
      !post ||
      post.method !== 'POST' ||
      !post.endpoint.startsWith('/') ||
      post.endpoint.startsWith('//')
    )
      throw new AgentCliError(
        'UPSTREAM_ERROR',
        'Invalid signature submission endpoint',
      );
    const base =
      options.base ??
      (deposit.network === 'testnet'
        ? 'https://api.testnets.relay.link'
        : 'https://api.relay.link');
    const url = new URL(post.endpoint, base);
    const claim = deposit.stepClaims?.[stepId];
    if (claim) {
      if (step.check?.method === 'GET') {
        const checkUrl = new URL(step.check.endpoint, base);
        if (checkUrl.origin !== new URL(base).origin)
          throw new AgentCliError(
            'POLICY_REJECTED',
            'Untrusted signature status destination',
          );
        const status = (await (options.check ?? jsonRequest)(
          checkUrl.toString(),
        )) as { status?: string };
        if (status.status === 'complete' || status.status === 'success') {
          await updateDeposits(options.path, (fresh) => {
            const current = selectDeposit(fresh, depositId, options.account);
            current.completedSteps.push(stepId);
            delete current.stepClaims?.[stepId];
          });
          return { depositId, reconciled: true };
        }
      }
      throw new AgentCliError(
        'NETWORK_ERROR',
        'Signature step outcome is unresolved; reconcile before retrying',
        { outcome: 'unknown', depositId, stepId },
        false,
      );
    }
    if (url.origin !== new URL(base).origin)
      throw new AgentCliError(
        'POLICY_REJECTED',
        'Untrusted signature destination',
      );
    // Relay's generic step contract puts the wallet signature in the query.
    url.searchParams.set('signature', signature);
    await updateDeposits(options.path, (fresh) => {
      const current = selectDeposit(fresh, depositId, options.account);
      current.stepClaims ??= {};
      current.stepClaims[stepId] = {
        state: 'submitting',
        signatureHash: createHash('sha256').update(signature).digest('hex'),
      };
      current.state = 'pending';
    });
    try {
      await (options.submit ?? jsonRequest)(url.toString(), post.body);
    } catch {
      throw new AgentCliError(
        'NETWORK_ERROR',
        'Signature step outcome is unresolved; reconcile before retrying',
        { outcome: 'unknown', depositId, stepId },
        false,
      );
    }
    let steps = signatureSteps(deposit);
    await updateDeposits(options.path, (fresh) => {
      const current = selectDeposit(fresh, depositId, options.account);
      if (!current)
        throw new AgentCliError('CONFIG_INVALID', 'Unknown deposit');
      if (!current.completedSteps.includes(step.id))
        current.completedSteps.push(step.id);
      delete current.stepClaims?.[stepId];
      steps = signatureSteps(current);
    });
    return { depositId, steps };
  });
}

function signaturePayload(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const sign = value as Record<string, unknown>;
  if (sign.signatureKind === 'eip712')
    return {
      domain: sign.domain,
      types: sign.types,
      primaryType: sign.primaryType,
      message: sign.message ?? sign.value,
    };
  return value;
}
