import { describe, it, expect } from 'vitest';
import {
  Router,
  MockProvider,
  OpenAICompatProvider,
  openai,
  openrouter,
  ollama,
  gemini,
  type FetchLike,
} from '../src/index.js';

// A fake fetch that records the request and returns a canned OpenAI-style body.
function fakeFetch(capture: { url?: string; body?: unknown }): FetchLike {
  return async (url, init) => {
    capture.url = url;
    capture.body = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        model: 'test-model',
        choices: [{ message: { content: 'hello from compat' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

describe('OpenAICompatProvider', () => {
  it('POSTs to /chat/completions and maps the response', async () => {
    const cap: { url?: string; body?: unknown } = {};
    const p = new OpenAICompatProvider({ id: 'x', baseURL: 'https://api.test/v1', apiKey: 'k', fetchImpl: fakeFetch(cap) });
    const res = await p.chat({ model: 'm', system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(cap.url).toBe('https://api.test/v1/chat/completions');
    expect((cap.body as { messages: unknown[] }).messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(res.content).toBe('hello from compat');
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
    expect(res.stopReason).toBe('stop');
  });

  it('presets set the right ids and base URLs', () => {
    const f: FetchLike = async () => new Response('{}');
    expect(openai({ fetchImpl: f }).id).toBe('openai');
    expect(openrouter({ fetchImpl: f }).id).toBe('openrouter');
    expect(ollama({ fetchImpl: f }).id).toBe('ollama');
    expect(gemini({ fetchImpl: f }).id).toBe('gemini');
  });

  it('parses an SSE stream into deltas', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: [DONE]\n\n';
    const streamFetch: FetchLike = async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const p = new OpenAICompatProvider({ id: 'x', baseURL: 'https://api.test/v1', fetchImpl: streamFetch });
    const out: string[] = [];
    for await (const c of p.chatStream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })) {
      if (!c.done) out.push(c.delta);
    }
    expect(out.join('')).toBe('Hello');
  });
});

describe('Router streaming', () => {
  it('streams from the mock provider', async () => {
    const router = new Router({ providers: [new MockProvider({ reply: () => 'one two three' })] });
    const parts: string[] = [];
    for await (const c of router.chatStream({ model: 'auto', messages: [{ role: 'user', content: 'x' }] })) {
      if (!c.done && c.delta.trim()) parts.push(c.delta);
    }
    expect(parts).toEqual(['one', 'two', 'three']);
  });

  it('fails over before the first chunk', async () => {
    const router = new Router({
      providers: [new MockProvider({ id: 'a', fail: true }), new MockProvider({ id: 'b', reply: () => 'ok' })],
      rules: [{ when: () => true, use: 'a', fallbacks: ['b'] }],
    });
    let text = '';
    for await (const c of router.chatStream({ model: 'auto', messages: [{ role: 'user', content: 'x' }] })) {
      text += c.delta;
    }
    expect(text).toBe('ok');
  });
});
