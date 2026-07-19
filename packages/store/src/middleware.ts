import { defineMiddleware, recordDecision, type Middleware, type Operation } from '@ace/core';
import { Store, type StoreOptions } from './store.js';

export function storeMiddleware(input: Store | StoreOptions = {}): Middleware {
  const store = input instanceof Store ? input : new Store(input);
  return defineMiddleware({
    name: 'store',
    appliesTo: ['save', 'load', 'search', 'list', 'forget'],
    before: async (ctx) => {
      const op = ctx.op as Operation;
      switch (op.kind) {
        case 'save': {
          const res = await store.save(op.input);
          ctx.response = res;
          recordDecision(ctx, 'store', { kind: 'save', slug: res.slug, version: res.version });
          break;
        }
        case 'load': {
          const res = await store.load(op.input);
          ctx.response = res;
          recordDecision(ctx, 'store', {
            kind: 'load',
            slug: res.slug,
            shape: res.shape,
            tokens: res.tokens,
            dropped: res.dropped,
          });
          break;
        }
        case 'list': {
          const res = store.list(op.input);
          ctx.response = res;
          recordDecision(ctx, 'store', { kind: 'list', count: res.contexts.length });
          break;
        }
        case 'forget': {
          const res = await store.forget(op.input);
          ctx.response = res;
          recordDecision(ctx, 'store', { kind: 'forget', slug: res.slug, moved: res.moved });
          break;
        }
        case 'search': {
          const res = await store.search(op.input);
          ctx.response = res;
          recordDecision(ctx, 'store', {
            kind: 'search',
            provider: res.provider,
            scanned: res.scanned,
            skipped: res.skipped,
            hits: res.hits.length,
          });
          break;
        }
      }
    },
  });
}

export { Store } from './store.js';
