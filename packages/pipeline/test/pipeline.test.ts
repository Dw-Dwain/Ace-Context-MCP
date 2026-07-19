import { describe, it, expect } from 'vitest';
import { MockProvider } from '@ace/router';
import { Cache } from '@ace/cache';
import { Optimizer } from '@ace/optimize';
import { Policy } from '@ace/policy';
import { createChatPipeline } from '../src/index.js';

const ask = (content: string, model = 'auto') => ({
  model,
  messages: [{ role: 'user' as const, content }],
});

describe('createChatPipeline', () => {
  it('runs the whole chain end-to-end and records every stage on the trace', async () => {
    let calls = 0;
    const { engine } = createChatPipeline({
      providers: [new MockProvider({ reply: () => `answer ${++calls}` })],
      optimizer: new Optimizer({ persona: 'You are terse.' }),
      security: { mode: 'redact' },
      compress: { budgetTokens: 100000 },
      policy: new Policy({ maxTokensPerRequest: 100000 }),
    });

    const res = await engine.chat(ask('just explain tokens'));
    const stages = res.trace.map((t) => t.stage);
    for (const s of ['observe', 'normalize', 'validate', 'security', 'optimize', 'cache', 'compress', 'policy', 'router']) {
      expect(stages).toContain(s);
    }
    expect((res.response as { content: string }).content).toBe('answer 1');
  });

  it('serves a repeated request from cache (no second provider call)', async () => {
    let calls = 0;
    const { engine } = createChatPipeline({
      providers: [new MockProvider({ reply: () => `answer ${++calls}` })],
    });
    await engine.chat(ask('hello world'));
    await engine.chat(ask('hello world'));
    expect(calls).toBe(1);
  });

  it('redacts secrets before they reach the provider', async () => {
    const fakeKey = `sk-${'abcdefghijklmnopqrstuvwx1234'}`;
    let seen = '';
    const { engine } = createChatPipeline({
      providers: [new MockProvider({ reply: (r) => (seen = r.messages.map((m) => m.content).join(' ')) })],
      security: { mode: 'redact' },
    });
    await engine.chat(ask(`my key ${fakeKey}`));
    expect(seen).toContain('[REDACTED:openai-key]');
    expect(seen).not.toContain(fakeKey);
  });

  it('populates the shared observer with metrics and traces', async () => {
    const { engine, observer } = createChatPipeline({ providers: [new MockProvider()] });
    await engine.chat(ask('hi'));
    expect(observer.metrics.get('ace_requests_total')).toBe(1);
    expect(observer.traces.recent()[0]!.op).toBe('chat');
  });

  it('enforces policy denials before calling a provider', async () => {
    let calls = 0;
    const { engine } = createChatPipeline({
      providers: [new MockProvider({ reply: () => `${++calls}` })],
      policy: new Policy({ maxTokensPerRequest: 3 }),
    });
    await expect(engine.chat(ask('a very long prompt that exceeds the tiny budget'))).rejects.toThrow(/policy: denied/);
    expect(calls).toBe(0);
  });

  it('lets you disable stages with false', async () => {
    const { engine } = createChatPipeline({
      providers: [new MockProvider()],
      cache: false,
    });
    const res = await engine.chat(ask('hi'));
    expect(res.trace.map((t) => t.stage)).not.toContain('cache');
  });
});
