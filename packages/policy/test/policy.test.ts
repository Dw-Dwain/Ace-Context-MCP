import { describe, it, expect } from 'vitest';
import { Engine, type ChatRequest } from '@ace/core';
import { Policy, policyMiddleware } from '../src/index.js';

describe('Policy', () => {
  it('allows a request within limits', () => {
    const p = new Policy({ maxTokensPerRequest: 1000, allowModels: ['claude-opus-4-8'] });
    expect(p.evaluate({ model: 'claude-opus-4-8', tokensEstimate: 100 })).toEqual({ allowed: true, reasons: [] });
  });

  it('denies over the token budget', () => {
    const p = new Policy({ maxTokensPerRequest: 50 });
    const d = p.evaluate({ tokensEstimate: 200 });
    expect(d.allowed).toBe(false);
    expect(d.reasons[0]).toContain('over token budget');
  });

  it('enforces allow and deny model lists', () => {
    const p = new Policy({ allowModels: ['a'], denyModels: ['b'] });
    expect(p.evaluate({ model: 'a' }).allowed).toBe(true);
    expect(p.evaluate({ model: 'b' }).allowed).toBe(false);
    expect(p.evaluate({ model: 'c' }).allowed).toBe(false);
  });

  it('rate-limits within a fixed window using an injected clock', () => {
    let t = 0;
    const p = new Policy({ rateLimit: { max: 2, windowMs: 1000 }, now: () => t });
    expect(p.evaluate({ key: 'u1' }).allowed).toBe(true);
    expect(p.evaluate({ key: 'u1' }).allowed).toBe(true);
    expect(p.evaluate({ key: 'u1' }).allowed).toBe(false); // 3rd in window
    t = 1000;
    expect(p.evaluate({ key: 'u1' }).allowed).toBe(true); // window rolled
  });

  it('scopes the rate limit per key', () => {
    let t = 0;
    const p = new Policy({ rateLimit: { max: 1, windowMs: 1000 }, now: () => t });
    expect(p.evaluate({ key: 'a' }).allowed).toBe(true);
    expect(p.evaluate({ key: 'b' }).allowed).toBe(true);
    expect(p.evaluate({ key: 'a' }).allowed).toBe(false);
  });
});

describe('policyMiddleware', () => {
  it('throws when the request is denied', async () => {
    const eng = new Engine().use(policyMiddleware(new Policy({ maxTokensPerRequest: 5 })));
    const input: ChatRequest = { model: 'auto', messages: [{ role: 'user', content: 'a very long prompt indeed' }] };
    await expect(eng.run({ kind: 'chat', input })).rejects.toThrow(/policy: denied/);
  });

  it('records an allow decision on the trace', async () => {
    const eng = new Engine().use(policyMiddleware(new Policy({ maxTokensPerRequest: 100000 })));
    const input: ChatRequest = { model: 'auto', messages: [{ role: 'user', content: 'hi' }] };
    const res = await eng.run({ kind: 'chat', input });
    const decision = res.trace.find((t) => t.stage === 'policy')?.decision as { allowed: boolean };
    expect(decision.allowed).toBe(true);
  });
});
