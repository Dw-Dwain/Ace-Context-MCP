import { defineMiddleware, recordDecision, type ChatRequest, type Middleware } from '@ace/core';
import { Router } from './router.js';
import type { ProviderRequest } from './types.js';

/** Trim message content, drop empty messages. */
export function normalizeChatMiddleware(): Middleware {
  return defineMiddleware({
    name: 'normalize',
    appliesTo: ['chat'],
    before: (ctx) => {
      const input = ctx.op.input as ChatRequest;
      const messages = input.messages
        .map((m) => ({ role: m.role, content: m.content.trim() }))
        .filter((m) => m.content.length > 0);
      ctx.meta.normalizedMessages = messages;
      recordDecision(ctx, 'normalize', { messages: messages.length });
    },
  });
}

/** Reject malformed chat requests before spending a provider call. */
export function validateChatMiddleware(): Middleware {
  return defineMiddleware({
    name: 'validate',
    appliesTo: ['chat'],
    before: (ctx) => {
      const messages = (ctx.meta.normalizedMessages ?? (ctx.op.input as ChatRequest).messages) as ChatRequest['messages'];
      if (!messages.length) throw new Error('chat: no non-empty messages');
      if (!messages.some((m) => m.role === 'user')) throw new Error('chat: at least one user message required');
    },
  });
}

/** Route to a provider and execute the call. Sets ctx.response to the
 *  ProviderResponse and records the route (chain, chosen, attempts, usage). */
export function routerMiddleware(router: Router): Middleware {
  return defineMiddleware({
    name: 'router',
    appliesTo: ['chat'],
    before: async (ctx) => {
      const input = ctx.op.input as ChatRequest;
      const messages = (ctx.meta.normalizedMessages ?? input.messages) as ChatRequest['messages'];
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const preq: ProviderRequest = {
        model: input.model ?? 'auto',
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      };
      if (system) preq.system = system;
      if (input.temperature !== undefined) preq.temperature = input.temperature;
      if (input.maxTokens !== undefined) preq.maxTokens = input.maxTokens;

      const outcome = await router.chat(preq);
      ctx.response = outcome.result;
      recordDecision(ctx, 'router', {
        chosen: outcome.chosen,
        attempts: outcome.attempts,
        model: outcome.result.model,
        usage: outcome.result.usage,
      });
    },
  });
}
