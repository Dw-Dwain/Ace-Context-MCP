import { defineMiddleware, recordDecision, type ChatRequest, type Middleware } from '@ace/core';
import { Optimizer } from './optimizer.js';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Optimize the last user message and inject persona/constraints into the
 * system prompt. Writes back to ctx.meta.normalizedMessages so downstream
 * cache + router consume the optimized form. Place after normalize, before cache.
 */
export function optimizeChatMiddleware(optimizer: Optimizer): Middleware {
  return defineMiddleware({
    name: 'optimize',
    appliesTo: ['chat'],
    before: async (ctx) => {
      const input = ctx.op.input as ChatRequest;
      const source = (ctx.meta.normalizedMessages as Msg[] | undefined) ?? input.messages;
      const messages = source.map((m) => ({ ...m }));

      let lastUser = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.role === 'user') {
          lastUser = i;
          break;
        }
      }
      if (lastUser === -1) {
        recordDecision(ctx, 'optimize', { applied: [], reason: 'no-user-message' });
        return;
      }

      const r = await optimizer.optimize(messages[lastUser]!.content);
      messages[lastUser] = { role: 'user', content: r.text };

      if (r.system) {
        if (messages[0]?.role === 'system') {
          messages[0] = { role: 'system', content: `${r.system}\n\n${messages[0].content}` };
        } else {
          messages.unshift({ role: 'system', content: r.system });
        }
      }

      ctx.meta.normalizedMessages = messages;
      recordDecision(ctx, 'optimize', {
        applied: r.applied,
        rail: r.rail,
        originalTokens: r.originalTokens,
        optimizedTokens: r.optimizedTokens,
      });
    },
  });
}
