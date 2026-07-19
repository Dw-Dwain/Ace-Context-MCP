# Writing a plugin

A plugin is a middleware: a `{ name, before?, after? }` object. `engine.use()` appends it; it can read and mutate the `RequestContext`, record a decision on the trace, short-circuit the pipeline, or call out to anything. Same model as Express. No registry, no manifest, no sandbox — you install it, you trust it.

```ts
import { defineMiddleware, type Middleware } from '@ace/core';
```

## 1. A save-notifier (fire-and-forget side effect)

Post to a webhook whenever a context is saved. Runs in `after`, so it sees the result.

```ts
export function saveNotifier(webhookUrl: string): Middleware {
  return defineMiddleware({
    name: 'save-notifier',
    appliesTo: ['save'],
    after: async (ctx) => {
      const res = ctx.response as { slug: string; version: number } | undefined;
      if (!res) return;
      // never let a notification failure break the save
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'context.saved', slug: res.slug, version: res.version }),
        });
      } catch {
        /* swallow */
      }
    },
  });
}
```

## 2. A tenant tagger (mutate context for downstream stages)

Stamp a policy key from an incoming header so `@ace/policy` can rate-limit per tenant. Runs early, in `before`.

```ts
export function tenantTagger(getKey: (ctx: unknown) => string): Middleware {
  return defineMiddleware({
    name: 'tenant-tagger',
    before: (ctx) => {
      ctx.meta.policyKey = getKey(ctx);
    },
  });
}
```

Register it before `policyMiddleware` so the key is set when policy evaluates:

```ts
engine.use(tenantTagger(ctx => currentRequestTenant()))
      .use(policyMiddleware(policy));
```

## 3. A custom cache short-circuit (own the response)

Serve a canned answer for a known prompt without hitting a provider. Set `ctx.response` and a flag your router checks (the built-in router already skips when `ctx.meta.cacheHit` is set).

```ts
export function cannedAnswers(map: Record<string, string>): Middleware {
  return defineMiddleware({
    name: 'canned-answers',
    appliesTo: ['chat'],
    before: (ctx) => {
      const input = ctx.op.input as { messages: Array<{ role: string; content: string }> };
      const lastUser = [...input.messages].reverse().find(m => m.role === 'user')?.content?.trim();
      if (lastUser && map[lastUser]) {
        ctx.response = { provider: 'canned', model: 'canned', content: map[lastUser], usage: { inputTokens: 0, outputTokens: 0 } };
        ctx.meta.cacheHit = true; // router will skip the provider call
      }
    },
  });
}
```

## Ordering & hooks

- `before` hooks run in registration order; `after` hooks run in reverse (onion model). Add cross-cutting stages (observe, tenant tagging) first.
- Record structured decisions with `recordDecision(ctx, 'my-stage', {...})` — they show up on the trace, the dashboard, and `evaluateTrace`.
- Throw to abort (fatal by default). Set `fatalOnError: false` on the middleware to soft-fail — the error is captured on the trace and the pipeline continues.
- Scope with `appliesTo: ['chat']` (etc.) so a plugin only runs for the operations it understands.

## Publishing

A plugin is a normal npm package that depends on `@ace/core`. Export a factory that returns a `Middleware`. That's the whole contract.
