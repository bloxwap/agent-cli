import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const mockOrdersEnv = 'BLOXWAP_E2E_MOCK_HL_ORDERS';
const liveExchangeActions = new Set(['approveAgent', 'approveBuilderFee']);
const mockedExchangeActions = new Set([
  'order',
  'cancel',
  'cancelByCloid',
  'batchModify',
  'modify',
  'updateLeverage',
  'updateIsolatedMargin',
  'scheduleCancel',
  'twapOrder',
  'twapCancel',
]);
const orderInfoTypes = new Set(['frontendOpenOrders', 'openOrders']);
const mainnetHosts = new Set([
  'api.hyperliquid.xyz',
  'rpc.hyperliquid.xyz',
  'api.relay.link',
]);
const testnetHosts = new Set([
  'api.hyperliquid-testnet.xyz',
  'rpc.hyperliquid-testnet.xyz',
]);
const universe = ['BTC'];
const orderSockets = new Set();
const home = () => process.env.HOME || homedir();
const mockFile = () => join(home(), '.bloxwap', 'e2e-hl-orders.json');

export function mockHyperliquidOrdersEnabled(env = process.env) {
  return env[mockOrdersEnv] === '1';
}

export function hyperliquidHostname(url) {
  return new URL(url instanceof Request ? url.url : String(url)).hostname;
}

export function isMainnetHarnessHost(hostname) {
  return mainnetHosts.has(hostname);
}

export function isHyperliquidTestnetHost(hostname) {
  return testnetHosts.has(hostname);
}

export function isHyperliquidTestnetWs(url) {
  const target = new URL(String(url));
  return (
    (target.protocol === 'ws:' || target.protocol === 'wss:') &&
    isHyperliquidTestnetHost(target.hostname)
  );
}

export async function readRequestJson(url, init) {
  const text =
    url instanceof Request
      ? await url.clone().text()
      : init?.body == null
        ? ''
        : String(init.body);
  return text ? JSON.parse(text) : {};
}

function loadOrders() {
  try {
    const state = JSON.parse(readFileSync(mockFile(), 'utf8'));
    if (
      Number.isSafeInteger(state.nextOid) &&
      state.nextOid > 0 &&
      Array.isArray(state.orders)
    )
      return state;
  } catch {
    // A missing or unreadable mock book starts empty; never consult the exchange.
  }
  return { nextOid: 1, orders: [] };
}

function saveOrders(state) {
  const directory = join(home(), '.bloxwap');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = mockFile();
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, target);
}

export function rememberUniverse(meta) {
  if (!Array.isArray(meta?.universe)) return;
  for (const [index, market] of meta.universe.entries()) {
    if (market?.name) universe[index] = market.name;
  }
}

function coinForAsset(asset) {
  return universe[asset] ?? (asset === 0 ? 'BTC' : `ASSET_${asset}`);
}

function assertSignedExchange(body) {
  const signature = body?.signature;
  if (
    !Number.isSafeInteger(body?.nonce) ||
    body.nonce < 0 ||
    typeof signature?.r !== 'string' ||
    typeof signature?.s !== 'string' ||
    ![0, 1, 27, 28].includes(signature.v)
  )
    throw new Error(
      'Unsigned Hyperliquid order request blocked by the CI test harness',
    );
}

function exchangeOk(type, statuses) {
  return {
    status: 'ok',
    response: { type, data: { statuses } },
  };
}

function orderUpdate(order, status) {
  return {
    order: {
      coin: order.coin,
      side: order.side,
      limitPx: order.limitPx,
      sz: order.sz,
      oid: order.oid,
      timestamp: Date.now(),
      origSz: order.origSz ?? order.sz,
      cloid: order.cloid,
    },
    status,
    statusTimestamp: Date.now(),
  };
}

function resting(order) {
  const cloid = typeof order.c === 'string' ? order.c : undefined;
  return {
    coin: coinForAsset(order.a),
    side: order.b ? 'B' : 'A',
    limitPx: String(order.p),
    sz: String(order.s),
    oid: 0,
    cloid,
    reduceOnly: Boolean(order.r),
    tif: order.t?.limit?.tif ?? 'Gtc',
    origSz: String(order.s),
  };
}

function applyMockedAction(action) {
  const state = loadOrders();
  const updates = [];
  const type = action?.type;
  if (type === 'order') {
    const statuses = [];
    for (const order of action.orders ?? []) {
      const placed = { ...resting(order), oid: state.nextOid++ };
      state.orders.push(placed);
      statuses.push({ resting: { oid: placed.oid } });
      updates.push(orderUpdate(placed, 'open'));
    }
    if (!statuses.length)
      throw new Error('Mocked Hyperliquid order request had no orders');
    saveOrders(state);
    return { response: exchangeOk('order', statuses), updates };
  }
  if (type === 'cancel' || type === 'cancelByCloid') {
    const requests = action.cancels ?? action.cancelsByCloid ?? [];
    const statuses = [];
    for (const request of requests) {
      const index = state.orders.findIndex((order) =>
        type === 'cancelByCloid'
          ? order.cloid === request.c &&
            (request.a === undefined || order.coin === coinForAsset(request.a))
          : order.oid === request.o,
      );
      if (index < 0) {
        statuses.push({ error: 'Order was never placed on the mocked book' });
        continue;
      }
      const [removed] = state.orders.splice(index, 1);
      statuses.push('success');
      updates.push(orderUpdate(removed, 'canceled'));
    }
    saveOrders(state);
    return { response: exchangeOk('cancel', statuses), updates };
  }
  if (type === 'batchModify' || type === 'modify') {
    const modifies = action.modifies ?? (action.oid ? [action] : []);
    const statuses = [];
    for (const request of modifies) {
      const index = state.orders.findIndex((order) =>
        typeof request.oid === 'string'
          ? order.cloid === request.oid
          : order.oid === request.oid,
      );
      if (index < 0 || !request.order) {
        statuses.push({ error: 'Order was never placed on the mocked book' });
        continue;
      }
      const next = {
        ...state.orders[index],
        ...resting(request.order),
        oid: state.orders[index].oid,
        cloid: state.orders[index].cloid,
      };
      state.orders[index] = next;
      statuses.push({ resting: { oid: next.oid } });
    }
    saveOrders(state);
    return { response: exchangeOk('order', statuses), updates };
  }
  saveOrders(state);
  return { response: { status: 'ok', response: { type: 'default' } }, updates };
}

export function blockedOrderMessage(kind = 'order') {
  return `Hyperliquid ${kind} request blocked by the CI test harness; order endpoints must not reach the exchange`;
}

export function inspectExchangeAction(action) {
  const type = action?.type;
  if (liveExchangeActions.has(type)) return 'live';
  if (mockedExchangeActions.has(type)) return 'order';
  return 'forbidden';
}

export function mockExchangeAction(body) {
  const decision = inspectExchangeAction(body?.action);
  if (decision === 'live') return null;
  if (decision === 'forbidden')
    throw new Error(
      `Unexpected Hyperliquid exchange action ${body?.action?.type ?? 'unknown'} blocked by the CI test harness`,
    );
  if (!mockHyperliquidOrdersEnabled())
    throw new Error(blockedOrderMessage(body.action.type));
  assertSignedExchange(body);
  return applyMockedAction(body.action);
}

export function mockOpenOrders(type) {
  return orderInfoTypes.has(type) && mockHyperliquidOrdersEnabled()
    ? loadOrders().orders
    : null;
}

export function registerOrderSocket(socket) {
  orderSockets.add(socket);
  const cleanup = () => orderSockets.delete(socket);
  if (typeof socket.once === 'function') socket.once('close', cleanup);
  else if (typeof socket.addEventListener === 'function')
    socket.addEventListener('close', cleanup, { once: true });
}

export function emitOrderUpdates(updates) {
  if (!updates?.length) return;
  const frame = JSON.stringify({ channel: 'orderUpdates', data: updates });
  for (const socket of orderSockets) {
    if (socket.readyState !== 1) continue;
    socket.emit('message', frame, false);
  }
}

export function inspectWebsocketPayload(data) {
  let parsed;
  try {
    parsed = JSON.parse(String(data));
  } catch {
    return 'pass';
  }
  if (parsed?.method !== 'post' || parsed.request?.type !== 'action')
    return 'pass';
  const action = parsed.request.payload?.action ?? parsed.request.payload;
  const decision = inspectExchangeAction(action);
  if (decision === 'live') return 'pass';
  if (decision === 'forbidden')
    throw new Error(
      `Unexpected Hyperliquid WebSocket action ${action?.type ?? 'unknown'} blocked by the CI test harness`,
    );
  if (!mockHyperliquidOrdersEnabled())
    throw new Error(blockedOrderMessage(action?.type ?? 'order'));
  assertSignedExchange(parsed.request.payload ?? parsed.request);
  return applyMockedAction(action);
}

export function websocketPostResponse(id, response) {
  return {
    channel: 'post',
    data: {
      id,
      response: { type: 'action', payload: response },
    },
  };
}
