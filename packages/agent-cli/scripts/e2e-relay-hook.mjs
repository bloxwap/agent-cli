// Loaded only by the explicit testnet e2e harness, never by the packaged CLI.
import { createRequire } from 'node:module';
import {
  emitOrderUpdates,
  hyperliquidHostname,
  inspectWebsocketPayload,
  isHyperliquidTestnetHost,
  isHyperliquidTestnetWs,
  isMainnetHarnessHost,
  mockExchangeAction,
  mockOpenOrders,
  readRequestJson,
  registerOrderSocket,
  rememberUniverse,
  websocketPostResponse,
} from './e2e-hl-orders.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const hostname = hyperliquidHostname(url);
  if (isMainnetHarnessHost(hostname))
    throw new Error('Mainnet requests are forbidden in the CI test harness');
  const target = new URL(url instanceof Request ? url.url : String(url));
  if (target.origin === 'https://api.testnets.relay.link') {
    if (target.pathname.startsWith('/quote/')) {
      const quote = await readRequestJson(url, init);
      if (
        quote.originChainId !== 421614 ||
        quote.originCurrency !== '0x' + '0'.repeat(40)
      )
        throw new Error('Expected the explicit test-only Relay fixture route');
      return Response.json({
        steps: [
          {
            id: 'deposit',
            kind: 'transaction',
            requestId: 'mock-testnet-deposit',
            depositAddress: '0x' + 'b'.repeat(40),
            items: [{ status: 'incomplete', data: {} }],
          },
        ],
        fees: {},
        details: {
          currencyOut: { amount: '0', currency: { decimals: 8 } },
          expiresAt: Date.now() + 60000,
        },
      });
    }
    if (target.pathname.startsWith('/intents/status'))
      return Response.json({ status: 'success' });
    throw new Error('Unexpected Relay mock endpoint');
  }
  if (isHyperliquidTestnetHost(hostname)) {
    const body = await readRequestJson(url, init);
    if (target.pathname === '/exchange' || target.pathname.endsWith('/exchange')) {
      const mocked = mockExchangeAction(body);
      if (mocked) {
        emitOrderUpdates(mocked.updates);
        return Response.json(mocked.response);
      }
    } else if (target.pathname === '/info' || target.pathname.endsWith('/info')) {
      const orders = mockOpenOrders(body.type);
      if (orders) return Response.json(orders);
      const response = await originalFetch(url, init);
      if (body.type === 'meta' || body.type === 'metaAndAssetCtxs') {
        try {
          rememberUniverse(await response.clone().json());
        } catch {
          // Live metadata remains authoritative even if the clone cannot be parsed.
        }
      }
      return response;
    }
  }
  return originalFetch(url, init);
};

const require = createRequire(import.meta.url);
try {
  const wsPath = require.resolve('ws');
  const OriginalWebSocket = require(wsPath);
  function HarnessWebSocket(url, protocols, options) {
    const hostname = hyperliquidHostname(url);
    if (isMainnetHarnessHost(hostname))
      throw new Error('Mainnet requests are forbidden in the CI test harness');
    const socket = new OriginalWebSocket(url, protocols, options);
    if (isHyperliquidTestnetWs(url)) {
      registerOrderSocket(socket);
      const send = socket.send.bind(socket);
      socket.send = (data, ...rest) => {
        const intercepted = inspectWebsocketPayload(data);
        if (intercepted === 'pass') return send(data, ...rest);
        let id;
        try {
          id = JSON.parse(String(data)).id;
        } catch {
          id = undefined;
        }
        emitOrderUpdates(intercepted.updates);
        queueMicrotask(() => {
          if (socket.readyState === 1)
            socket.emit(
              'message',
              JSON.stringify(websocketPostResponse(id, intercepted.response)),
              false,
            );
        });
      };
    }
    return socket;
  }
  Object.setPrototypeOf(HarnessWebSocket, OriginalWebSocket);
  Object.assign(HarnessWebSocket, OriginalWebSocket);
  HarnessWebSocket.WebSocket = HarnessWebSocket;
  HarnessWebSocket.prototype = OriginalWebSocket.prototype;
  require.cache[wsPath].exports = HarnessWebSocket;
} catch {
  // The HTTP preload still blocks order endpoints if `ws` cannot be patched.
}
