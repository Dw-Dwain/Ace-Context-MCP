import { defineMiddleware, recordDecision, type ChatRequest, type Middleware } from '@ace/core';
import { Policy } from './policy.js';

/** Enforce policy on chat requests: token budget, model allow/deny, rate limit.
 *  Denied requests throw before a provider is called. Reads the tenant key from
 *  ctx.meta.policyKey when present. Place near the end, before the router. */
export function policyMiddleware(policy: Policy): Middleware {
  return defineMiddleware({
    name: 'policy',
    appliesTo: ['chat'],
    before: (ctx) => {
      if (ctx.meta.cacheHit) return;
      const input = ctx.op.input as ChatRequest;
      const messages =
        (ctx.meta.normalizedMessages as ChatRequest['messages'] | undefined) ?? input.messages;
      const tokensEstimate = messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);

      const evalInput: { key?: string; model?: string; tokensEstimate: number } = { tokensEstimate };
      if (typeof ctx.meta.policyKey === 'string') evalInput.key = ctx.meta.policyKey;
      if (input.model) evalInput.model = input.model;

      const decision = policy.evaluate(evalInput);
      recordDecision(ctx, 'policy', decision);
      if (!decision.allowed) throw new Error(`policy: denied — ${decision.reasons.join('; ')}`);
    },
  });
}
