import { describe, it, expect } from 'vitest';
import { AnthropicProvider, type StreamChunk } from '@ace/router';
import { createChatPipeline } from '../src/index.js';

// Real end-to-end check: sends an actual prompt to Anthropic through the full
// pipeline. Runs only when ANTHROPIC_API_KEY is set (so CI without a key skips
// it). Uses Haiku + tiny max_tokens to keep cost negligible.
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ACE_LIVE_MODEL ?? 'claude-haiku-4-5-20251001';

describe.skipIf(!KEY)('live Anthropic E2E (needs ANTHROPIC_API_KEY)', () => {
  it('gets a real answer through the full pipeline', async () => {
    const { engine } = createChatPipeline({ providers: [new AnthropicProvider()] });
    const res = await engine.chat({
      model: MODEL,
      maxTokens: 16,
      messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }],
    });
    const r = res.response as {
      content: string;
      provider: string;
      usage: { inputTokens: number; outputTokens: number };
    };
    expect(r.provider).toBe('anthropic');
    expect(r.content.toLowerCase()).toContain('pong');
    expect(r.usage.outputTokens).toBeGreaterThan(0);
    // full chain actually ran
    expect(res.trace.map((t) => t.stage)).toContain('router');
  }, 30000);

  it('streams a real response through the pipeline', async () => {
    const { engine } = createChatPipeline({ providers: [new AnthropicProvider()] });
    const res = await engine.chat({
      model: MODEL,
      stream: true,
      maxTokens: 32,
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    });
    let text = '';
    for await (const c of res.response as AsyncIterable<StreamChunk>) text += c.delta;
    expect(text.trim().length).toBeGreaterThan(0);
  }, 30000);
});
