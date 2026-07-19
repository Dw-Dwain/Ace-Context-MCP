import { defineMiddleware, recordDecision, type ChatRequest, type Middleware } from '@ace/core';
import { Cache } from './cache.js';
import type { CacheMessage, CachedResponse } from './types.js';

/**
 * Cache middleware for the chat flow. `before` runs the decision engine and,
 * on a hit, sets ctx.response + ctx.meta.cacheHit so the router short-circuits.
 * `after` stores the fresh response on a miss. Place it after normalize/validate
 * and before the router.
 */
export function cacheMiddleware(cache: Cache): Middleware {
  return defineMiddleware({
    name: 'cache',
    appliesTo: ['chat'],
    before: async (ctx) => {
      const input = ctx.op.input as ChatRequest;
      // Streaming callers expect an async iterable, not a buffered hit. Don't
      // serve (or, via the after guard, store) the cache for streaming requests.
      if (input.stream) return;
      const messages = resolveMessages(ctx);
      const decision = await cache.decide({ model: input.model ?? 'auto', messages });
      recordDecision(ctx, 'cache', {
        hit: decision.hit,
        reason: decision.reason,
        scores: decision.scores,
        matchedKey: decision.matchedKey,
      });
      if (decision.hit && decision.response) {
        ctx.response = decision.response;
        ctx.meta.cacheHit = true;
      }
    },
    after: async (ctx) => {
      if (ctx.meta.cacheHit) return;
      if (ctx.meta.streaming) return; // ponytail: buffer + cache streams in a later pass
      if (!ctx.response) return;
      const input = ctx.op.input as ChatRequest;
      await cache.store({ model: input.model ?? 'auto', messages: resolveMessages(ctx) }, ctx.response as CachedResponse);
    },
  });
}

function resolveMessages(ctx: Parameters<NonNullable<Middleware['before']>>[0]): CacheMessage[] {
  const normalized = ctx.meta.normalizedMessages as CacheMessage[] | undefined;
  if (normalized) return normalized;
  return (ctx.op.input as ChatRequest).messages;
}
