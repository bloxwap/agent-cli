import { AsyncLocalStorage } from 'node:async_hooks';
import type { Mode } from './mode.js';
export const requestContext = new AsyncLocalStorage<{
  intentId: string;
  cloid?: string;
  requestId?: string;
  mode?: Mode;
  scope?: string;
  eventId?: string;
}>();
export const currentRequestContext = () => requestContext.getStore();
