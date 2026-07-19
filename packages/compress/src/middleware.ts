import { defineMiddleware, recordDecision, type ChatRequest, type Middleware } from '@ace/core';
import { Compressor, type CompressMessage } from './compress.js';

export interface CompressMiddlewareOptions {
  budgetTokens: number;
  keepRecent?: number;
}

/**
 * Compress the conversation when it exceeds the token budget. Reads/writes
 * ctx.meta.normalizedMessages so it composes with normalize/optimize upstream
 * and cache/router downstream. No-op (and traced as skipped) when under budget.
 */
export function compressChatMiddleware(opts: CompressMiddlewareOptions): Middleware {
  const compressor = new Compressor();
  return defineMiddleware({
    name: 'compress',
    appliesTo: ['chat'],
    before: (ctx) => {
      if (ctx.meta.cacheHit) return;
      const input = ctx.op.input as ChatRequest;
      const messages = (ctx.meta.normalizedMessages as CompressMessage[] | undefined) ?? input.messages;
      const compressOpts =
        opts.keepRecent !== undefined
          ? { budgetTokens: opts.budgetTokens, keepRecent: opts.keepRecent }
          : { budgetTokens: opts.budgetTokens };
      const result = compressor.compress(messages, compressOpts);
      ctx.meta.normalizedMessages = result.messages;
      recordDecision(ctx, 'compress', result.stats);
    },
  });
}
