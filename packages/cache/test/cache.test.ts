import { describe, it, expect } from 'vitest';
import { Engine, type ChatRequest } from '@ace/core';
import { MockProvider, Router, routerMiddleware, normalizeChatMiddleware } from '@ace/router';
import { Cache, cacheMiddleware, classifyIntent } from '../src/index.js';

const q = (content: string, model = 'auto', system?: string): ChatRequest => ({
  model,
  messages: [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    { role: 'user' as const, content },
  ],
});

describe('classifyIntent', () => {
  it('separates topic-identical but intent-different prompts', () => {
    expect(classifyIntent('explain rust ownership')).toBe('Explain');
    expect(classifyIntent('teach me rust ownership')).toBe('Teach');
    expect(classifyIntent('review this rust code')).toBe('Review');
    expect(classifyIntent('debug this rust error')).toBe('Debug');
    expect(classifyIntent('summarize this rust thread')).toBe('Summarize');
  });
});

describe('Cache decisions', () => {
  it('returns exact hit for identical query', async () => {
    const cache = new Cache();
    await cache.store(q('what is a semantic cache'), {
      content: 'a cache keyed by meaning',
      model: 'm',
      provider: 'mock',
    });
    const d = await cache.decide(q('what is a semantic cache'));
    expect(d.hit).toBe(true);
    expect(d.reason).toBe('exact');
    expect(d.response?.content).toBe('a cache keyed by meaning');
  });

  it('misses when there are no candidates', async () => {
    const cache = new Cache();
    const d = await cache.decide(q('anything'));
    expect(d.hit).toBe(false);
    expect(d.reason).toBe('miss-no-candidate');
  });

  it('semantic-hits a near-paraphrase with matching intent', async () => {
    const cache = new Cache({ threshold: 0.7 });
    await cache.store(q('explain how session tokens expire and rotate'), {
      content: 'tokens expire in 15m and rotate',
      model: 'm',
      provider: 'mock',
    });
    const d = await cache.decide(q('explain how session tokens expire and rotate on use'));
    expect(d.hit).toBe(true);
    expect(d.reason).toBe('semantic');
    expect(d.scores!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('rejects reuse when intent differs even if topic matches', async () => {
    const cache = new Cache({ threshold: 0.7 });
    await cache.store(q('explain the session token design'), {
      content: 'explanation text',
      model: 'm',
      provider: 'mock',
    });
    // same topic words, but a Debug intent — should not reuse the Explain answer
    const d = await cache.decide(q('debug the session token design error'));
    expect(d.hit).toBe(false);
    expect(d.scores?.intent).toBe(0);
  });

  it('every scored decision carries explainable scores', async () => {
    const cache = new Cache({ threshold: 0.99, semanticFloor: 0 });
    await cache.store(q('write a haiku about the sea'), { content: 'x', model: 'm', provider: 'mock' });
    const d = await cache.decide(q('write a haiku about the ocean'));
    expect(d.hit).toBe(false);
    expect(d.reason).toBe('miss-low-confidence');
    expect(d.scores).toMatchObject({
      semantic: expect.any(Number),
      intent: expect.any(Number),
      context: expect.any(Number),
      safety: expect.any(Number),
      confidence: expect.any(Number),
    });
  });
});

describe('cache middleware in the chat pipeline', () => {
  function engine() {
    let providerCalls = 0;
    const router = new Router({
      providers: [new MockProvider({ reply: () => `answer #${++providerCalls}` })],
    });
    const cache = new Cache();
    const eng = new Engine()
      .use(normalizeChatMiddleware())
      .use(cacheMiddleware(cache))
      .use(routerMiddleware(router));
    return { eng, calls: () => providerCalls };
  }

  it('serves the second identical request from cache without calling the provider', async () => {
    const { eng, calls } = engine();
    const first = await eng.chat(q('hello world'));
    expect((first.response as { content: string }).content).toBe('answer #1');
    expect(calls()).toBe(1);

    const second = await eng.chat(q('hello world'));
    expect((second.response as { content: string }).content).toBe('answer #1');
    expect(calls()).toBe(1); // provider NOT called again

    const cacheEntry = second.trace.find((t) => t.stage === 'cache' && t.decision);
    expect(cacheEntry?.decision).toMatchObject({ hit: true, reason: 'exact' });
  });

  it('does not serve or store the cache for streaming requests', async () => {
    const { eng, calls } = engine();
    const streamAsk = { ...q('stream me'), stream: true } as const;
    const drain = async (resp: unknown) => {
      for await (const _ of resp as AsyncIterable<unknown>) void _;
    };
    await drain((await eng.chat(streamAsk)).response);
    await drain((await eng.chat(streamAsk)).response); // identical — must NOT be cache-served
    expect(calls()).toBe(2); // provider called both times, no cache short-circuit
  });
});
