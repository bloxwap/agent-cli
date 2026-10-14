import { AsyncLocalStorage } from 'node:async_hooks';
export const requestContext = new AsyncLocalStorage<{
  intentId: string;
  cloid?: string;
  requestId?: string;
}>();
export const currentRequestContext = () => requestContext.getStore();
