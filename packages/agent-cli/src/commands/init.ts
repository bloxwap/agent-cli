import { z } from 'zod';
import { renderQr } from '../funding/qr.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { register } from '../core/router.js';
import {
  loadConfig,
  saveConfig,
  atomicWrite,
  stateDir,
  readStoredConfig,
  bindApproval,
} from '../core/config.js';
import { prepareEoaAgent } from '../wallet/eoa.js';
import {
  newApproval,
  submitApproval,
  rejectMasterKey,
  isFreshApproval,
  APPROVAL_MAX_AGE_MS,
  type Approval,
  approvalFingerprint,
  validateApproval,
} from '../wallet/approval.js';
import { AgentCliError } from '../errors/index.js';
import { hlInfo } from '../core/http.js';
import { ensureReferral } from '../core/referral.js';
import { assertLiveMode, withTradeLock } from '../core/trading.js';
register('init', {
  description:
    'Register your own agent key and emit resumable master-wallet approvals',
  schema: z.object({
    masterAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    eoaKeyRef: z
      .string()
      .regex(/^env:[A-Z_][A-Z0-9_]*$|^file:.+/)
      .optional(),
    validUntil: z.number().int().optional(),
    signature: z.string().optional(),
    builderSignature: z.string().optional(),
    qr: z.boolean().default(true),
  }),
  execute: async (input, context) => {
    rejectMasterKey(input);
    const config = await loadConfig(context.configPath);
    if (context.paper !== undefined)
      config.mode = context.paper ? 'paper' : 'live';
    assertLiveMode(config, 'init');
    return withTradeLock(config, async () => {
      const stored = await readStoredConfig(context.configPath);
      const requested = context.network ?? config.network;
      if (stored?.approvedNetwork && requested !== stored.approvedNetwork)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Network does not match the approved network',
          { network: requested, approvedNetwork: stored.approvedNetwork },
        );
      if (
        stored?.agentAddress &&
        !stored.approvedNetwork &&
        requested !== stored.network
      )
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Initialized wallet network differs; use a separate config for another network',
        );
      if (
        config.agentAddress &&
        config.masterAddress &&
        input.masterAddress &&
        (input.masterAddress as string).toLowerCase() !==
          config.masterAddress.toLowerCase()
      )
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Initialized master address differs; use a separate config for another account',
        );
      if (context.network) config.network = context.network;
      if (!config.approvedNetwork) config.approvedNetwork = config.network;
      else if (config.approvedNetwork !== config.network)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Network does not match the approved network',
          { network: config.network, approvedNetwork: config.approvedNetwork },
        );
      config.masterAddress =
        (input.masterAddress as string) ?? config.masterAddress;
      if (!config.masterAddress)
        throw new AgentCliError('CONFIG_INVALID', 'Provide masterAddress');
      const expiry =
        (input.validUntil as number) ??
        config.agentExpiry ??
        Date.now() + 179 * 86400000;
      if (expiry <= Date.now() || expiry > Date.now() + 180 * 86400000)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Expiry must be within 180 days',
        );
      await prepareEoaAgent(
        config,
        null,
        input.eoaKeyRef as string | undefined,
      );
      const previousExpiry = config.agentExpiry;
      config.agentExpiry = expiry;
      if (expiry !== previousExpiry) config.approved = false;
      // Pending requested validity is never an assertion of remote approval.
      await saveConfig(config, context.configPath);
      const path = join(
        stateDir(),
        `approval-${config.network}-${config.masterAddress.toLowerCase()}-${config.agentAddress?.toLowerCase()}.json`,
      );
      const createApprovals = async () => {
        const created: { agent: Approval; builder?: Approval } = {
          agent: await newApproval(config, 'approveAgent', {
            agentAddress: config.agentAddress,
            agentName: `${config.agentName} valid_until ${expiry}`,
          }),
        };
        if (config.builder.fee > 0 && config.builder.address)
          created.builder = await newApproval(config, 'approveBuilderFee', {
            builder: config.builder.address,
            maxFeeRate: `${config.builder.fee / 1000}%`,
          });
        return created;
      };
      let pending: {
        agent: Approval;
        builder?: Approval;
        createdAt: number;
        expiresAt: number;
        fingerprint: string;
      };
      const desired = await createApprovals();
      const fingerprint = JSON.stringify({
        agent: approvalFingerprint(desired.agent),
        builder: desired.builder ? approvalFingerprint(desired.builder) : null,
      });
      let regenerated = false;
      try {
        const stored = JSON.parse(await readFile(path, 'utf8')) as {
          agent?: Approval;
          builder?: Approval;
          createdAt?: number;
          expiresAt?: number;
          fingerprint?: string;
        };
        if (
          stored.agent?.action &&
          stored.fingerprint === fingerprint &&
          isFreshApproval(stored.createdAt)
        )
          pending = {
            fingerprint,
            agent: stored.agent,
            builder: stored.builder,
            createdAt: stored.createdAt!,
            expiresAt:
              stored.expiresAt ?? stored.createdAt! + APPROVAL_MAX_AGE_MS,
          };
        else throw Object.assign(new Error('stale'), { code: 'ESTALE' });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
          (error as NodeJS.ErrnoException).code !== 'ESTALE'
        )
          throw error;
        regenerated = (error as NodeJS.ErrnoException).code === 'ESTALE';
        pending = {
          ...desired,
          fingerprint,
          createdAt: Date.now(),
          expiresAt: Date.now() + APPROVAL_MAX_AGE_MS,
        };
        await atomicWrite(path, JSON.stringify(pending));
      }
      if ((input.signature || input.builderSignature) && regenerated)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Approval payload expired; sign the regenerated payload',
          { expiresAt: pending.expiresAt, approvals: pending },
        );
      const submit = async (approval: Approval, signature: string) => {
        try {
          await submitApproval(config.network, approval, signature);
        } catch (error) {
          if (
            error instanceof AgentCliError &&
            (error.details as { nonceRejected?: boolean } | null)?.nonceRejected
          ) {
            const created = await createApprovals();
            pending = {
              ...created,
              fingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + APPROVAL_MAX_AGE_MS,
            };
            await atomicWrite(path, JSON.stringify(pending));
            throw new AgentCliError(
              'CONFIG_INVALID',
              'Approval nonce was rejected; sign the regenerated payload',
              { expiresAt: pending.expiresAt, approvals: pending },
            );
          }
          throw error;
        }
      };
      validateApproval(config.network, pending.agent);
      if (pending.builder) validateApproval(config.network, pending.builder);
      if (input.signature)
        await submit(pending.agent, input.signature as string);
      if (input.builderSignature && pending.builder)
        await submit(pending.builder, input.builderSignature as string);
      const agents = await hlInfo<{ address: string; validUntil: number }[]>(
        config.network,
        'extraAgents',
        { user: config.masterAddress },
      );
      config.approved = agents.some(
        (agent) =>
          agent.address.toLowerCase() === config.agentAddress?.toLowerCase() &&
          agent.validUntil >= expiry,
      );
      if (config.builder.fee > 0 && config.builder.address) {
        const max = await hlInfo<number>(config.network, 'maxBuilderFee', {
          user: config.masterAddress,
          builder: config.builder.address,
        });
        config.approved = config.approved && max >= config.builder.fee;
      }
      config.revoked = false;
      if (config.approved) bindApproval(config);
      await saveConfig(config, context.configPath);
      const deeplink = `ethereum:${config.masterAddress}?request=${encodeURIComponent(JSON.stringify(pending.agent.typedData))}`;
      return {
        masterAddress: config.masterAddress,
        agentAddress: config.agentAddress,
        expiry,
        approved: config.approved,
        ...(config.approved
          ? await ensureReferral(config)
          : { referralCode: config.referralCode, referralApplied: false }),
        requiresSignature: !config.approved,
        approvalExpiresAt: pending.expiresAt,
        approvals: pending,
        deeplink,
        ...(await renderQr(deeplink, { enabled: input.qr as boolean })),
      };
    });
  },
});
