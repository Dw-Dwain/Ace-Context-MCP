import { describe, it, expect } from 'vitest';
import { Engine, type ChatRequest } from '@ace/core';
import {
  Router,
  MockProvider,
  normalizeChatMiddleware,
  validateChatMiddleware,
  routerMiddleware,
  type ProviderResponse,
} from '../src/index.js';

const chat = (input: ChatRequest) => ({ kind: 'chat' as const, input });

describe('Router', () => {
  it('resolves via rules and falls back by default', () => {
    const router = new Router({
      providers: [new MockProvider({ id: 'anthropic' }), new MockProvider({ id: 'openai' })],
      rules: [{ when: (m) => m.startsWith('claude'), use: 'anthropic' }],
      fallback: 'openai',
    });
    expect(router.resolve('claude-opus-4-8').chain).toEqual(['anthropic']);
    expect(router.resolve('gpt-4o').chain).toEqual(['openai']);
    expect(router.resolve().chain).toEqual(['openai']);
  });

  it('calls the chosen provider', async () => {
    const router = new Router({ providers: [new MockProvider()] });
    const out = await router.chat({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] });
    expect(out.chosen).toBe('mock');
    expect(out.result.content).toContain('hi');
    expect(out.attempts).toEqual([{ provider: 'mock', ok: true }]);
  });

  it('fails over to the next provider in the chain', async () => {
    const router = new Router({
      providers: [new MockProvider({ id: 'primary', fail: true }), new MockProvider({ id: 'backup' })],
      rules: [{ when: () => true, use: 'primary', fallbacks: ['backup'] }],
    });
    const out = await router.chat({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] });
    expect(out.chosen).toBe('backup');
    expect(out.attempts).toEqual([
      { provider: 'primary', ok: false, error: expect.stringContaining('forced failure') },
      { provider: 'backup', ok: true },
    ]);
  });

  it('throws when every provider in the chain fails', async () => {
    const router = new Router({
      providers: [new MockProvider({ id: 'a', fail: true })],
      rules: [{ when: () => true, use: 'a' }],
    });
    await expect(router.chat({ model: 'auto', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /all providers failed/,
    );
  });
});

describe('chat pipeline via Engine', () => {
  function engine() {
    const router = new Router({ providers: [new MockProvider()] });
    return new Engine()
      .use(normalizeChatMiddleware())
      .use(validateChatMiddleware())
      .use(routerMiddleware(router));
  }

  it('runs normalize → validate → route and returns a response', async () => {
    const res = await engine().run(
      chat({ messages: [{ role: 'user', content: '  hello  ' }], model: 'auto' }),
    );
    const payload = res.response as ProviderResponse;
    expect(payload.content).toContain('hello');
    expect(payload.content).not.toContain('  hello  ');
    const stages = res.trace.map((t) => t.stage);
    expect(stages).toContain('normalize');
    expect(stages).toContain('router');
  });

  it('records the route decision on the trace', async () => {
    const res = await engine().run(chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const routerEntry = res.trace.find((t) => t.stage === 'router' && t.decision);
    expect(routerEntry?.decision).toMatchObject({ chosen: 'mock' });
  });

  it('splits system messages out of the user/assistant turns', async () => {
    const router = new Router({
      providers: [new MockProvider({ reply: (r) => `system=${r.system ?? ''}|turns=${r.messages.length}` })],
    });
    const eng = new Engine().use(routerMiddleware(router));
    const res = await eng.run(
      chat({
        messages: [
          { role: 'system', content: 'be terse' },
          { role: 'user', content: 'hi' },
        ],
      }),
    );
    const payload = res.response as ProviderResponse;
    expect(payload.content).toBe('system=be terse|turns=1');
  });

  it('rejects a chat with no user message', async () => {
    await expect(
      engine().run(chat({ messages: [{ role: 'assistant', content: 'unsolicited' }] })),
    ).rejects.toThrow(/user message required/);
  });
});
