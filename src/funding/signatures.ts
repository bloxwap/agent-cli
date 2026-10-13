import { AgentCliError } from '../errors/index.js';
import { jsonRequest } from '../core/http.js';
import { readDeposits, writeDeposits, type Deposit } from './store.js';
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
  } = {},
) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new AgentCliError('CONFIG_INVALID', 'Expected wallet signature');
  const deposits = await readDeposits(options.path);
  const deposit = deposits.find((d) => d.id === depositId);
  if (!deposit) throw new AgentCliError('CONFIG_INVALID', 'Unknown deposit');
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
  if (url.origin !== new URL(base).origin)
    throw new AgentCliError(
      'POLICY_REJECTED',
      'Untrusted signature destination',
    );
  // Relay's generic step contract puts the wallet signature in the query.
  url.searchParams.set('signature', signature);
  await (options.submit ?? jsonRequest)(url.toString(), post.body);
  deposit.completedSteps.push(step.id);
  await writeDeposits(deposits, options.path);
  return { depositId, steps: signatureSteps(deposit) };
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
