// Stable command data shapes; unknown upstream response fields remain extensible.
const string = { type: 'string' };
const boolean = { type: 'boolean' };
const unknown = {};
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', properties, required });
const array = (items: unknown) => ({ type: 'array', items });
const balance = object(
  {
    accountValue: string,
    accountValueUnits: string,
    withdrawable: string,
    marginUsed: string,
  },
  ['accountValue', 'accountValueUnits', 'withdrawable', 'marginUsed'],
);
const positions = array(
  object(
    {
      coin: string,
      size: string,
      entryPrice: { type: ['string', 'null'] },
      unrealizedPnl: string,
      liquidationPrice: { type: ['string', 'null'] },
      leverage: string,
      marginMode: string,
    },
    ['coin', 'size', 'leverage'],
  ),
);
const event = object(
  {
    seq: { type: 'integer', minimum: 1 },
    timestamp: { type: 'string', format: 'date-time' },
    type: {
      enum: [
        'fill',
        'order_update',
        'position_change',
        'deposit',
        'error',
        'agent_expiry_warning',
        'runner_state',
      ],
    },
    data: unknown,
  },
  ['seq', 'timestamp', 'type', 'data'],
);
export const outputSchemas: Record<string, unknown> = {
  market: object(
    {
      coin: string,
      asset: string,
      szDecimals: string,
      maxLeverage: string,
      mid: string,
    },
    ['coin', 'asset', 'szDecimals', 'maxLeverage', 'mid'],
  ),
  config: unknown,
  init: object(
    {
      masterAddress: string,
      agentAddress: string,
      expiry: { type: 'number' },
      policyId: string,
      approved: boolean,
      requiresSignature: boolean,
      approvals: unknown,
      deeplink: string,
      qrAscii: { type: ['string', 'null'] },
    },
    ['masterAddress', 'agentAddress', 'expiry', 'policyId', 'approved'],
  ),
  fund: object(
    {
      depositId: string,
      depositAddress: string,
      originChain: { type: 'number' },
      originCurrency: string,
      minDeposit: string,
      expectedReceived: string,
      expectedReceivedHuman: string,
      fees: unknown,
      builderFeeRate: string,
      builderAddress: string,
      expiresAt: { type: 'number' },
      state: string,
      signatureSteps: array(unknown),
      qrAscii: { type: ['string', 'null'] },
      qrPath: { type: ['string', 'null'] },
    },
    [
      'depositId',
      'depositAddress',
      'expectedReceived',
      'fees',
      'builderFeeRate',
      'builderAddress',
      'expiresAt',
      'qrAscii',
    ],
  ),
  deposit: object({
    depositId: string,
    steps: array(unknown),
    complete: boolean,
  }),
  balance,
  positions,
  orders: array(
    object(
      {
        coin: string,
        oid: string,
        sz: string,
        limitPx: string,
        side: { enum: ['A', 'B'] },
        cloid: string,
      },
      ['coin', 'oid', 'sz', 'limitPx', 'side'],
    ),
  ),
  status: object(
    {
      balance,
      positions,
      agent: object({
        address: string,
        approved: boolean,
        revoked: boolean,
        expiry: { type: ['number', 'null'] },
        daysRemaining: { type: ['string', 'null'] },
        warnings: array(string),
      }),
      policy: object({ id: { type: ['string', 'null'] }, version: string }),
      deposits: array(
        object({
          id: string,
          state: {
            enum: [
              'awaiting_funds',
              'pending',
              'settled',
              'failed',
              'refunded',
            ],
          },
        }),
      ),
      approvedMaxBuilderFee: string,
      runner: { type: ['object', 'null'] },
    },
    [
      'balance',
      'positions',
      'agent',
      'policy',
      'deposits',
      'approvedMaxBuilderFee',
      'runner',
    ],
  ),
  order: object(
    {
      result: unknown,
      builderFeeRate: string,
      builderAddress: string,
      cloid: { type: ['string', 'null'] },
    },
    ['result', 'builderFeeRate', 'builderAddress', 'cloid'],
  ),
  cancel: object({ cancelled: array(string), result: unknown }, [
    'cancelled',
    'result',
  ]),
  modify: object({ status: string, response: unknown }, ['status']),
  leverage: object({ status: string, response: unknown }, ['status']),
  run: object(
    {
      pid: { type: 'integer' },
      startedAt: { type: 'number' },
      network: { enum: ['mainnet', 'testnet'] },
      ready: boolean,
      existing: boolean,
    },
    ['pid', 'startedAt', 'network'],
  ),
  events: array(event),
  logs: {
    description: 'JSON-line stream of redacted log objects',
    type: 'object',
  },
  rotate: object(
    {
      oldAgent: string,
      newAgent: string,
      swapped: boolean,
      oldRevoked: boolean,
      requiresSignature: boolean,
      approval: unknown,
      revokeApproval: unknown,
    },
    ['oldAgent', 'newAgent', 'swapped', 'oldRevoked'],
  ),
  revoke: object(
    {
      agentAddress: string,
      locallyRevoked: boolean,
      exchangeRevoked: boolean,
      requiresSignature: boolean,
      approval: unknown,
    },
    [
      'agentAddress',
      'locallyRevoked',
      'exchangeRevoked',
      'requiresSignature',
      'approval',
    ],
  ),
  audit: array(
    object(
      {
        seq: { type: 'integer' },
        timestamp: string,
        intentId: string,
        requestId: string,
        cloid: string,
        stage: string,
        data: unknown,
        previousHash: string,
        hash: string,
      },
      ['seq', 'timestamp', 'intentId', 'stage', 'data', 'previousHash', 'hash'],
    ),
  ),
  skill: object(
    {
      target: { enum: ['claude', 'codex'] },
      path: string,
      version: string,
      changed: boolean,
    },
    ['target', 'path', 'version', 'changed'],
  ),
};
