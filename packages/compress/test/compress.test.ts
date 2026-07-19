import { describe, it, expect } from 'vitest';
import { Engine, type ChatRequest } from '@ace/core';
import { Compressor, compressChatMiddleware, type CompressMessage } from '../src/index.js';

function convo(n: number): CompressMessage[] {
  const out: CompressMessage[] = [{ role: 'system', content: 'You are helpful.' }];
  for (let i = 0; i < n; i++) {
    out.push({ role: 'user', content: `Question ${i}: ${'detail '.repeat(20)}` });
    out.push({ role: 'assistant', content: `Answer ${i}: ${'reply '.repeat(20)}` });
  }
  return out;
}

describe('Compressor', () => {
  it('is a no-op under budget', () => {
    const r = new Compressor().compress(convo(1), { budgetTokens: 100000 });
    expect(r.stats.skipped).toBe(true);
    expect(r.stats.ratio).toBe(1);
  });

  it('collapses the middle when over budget, keeping system + head + recent', () => {
    const messages = convo(20);
    const r = new Compressor().compress(messages, { budgetTokens: 200, keepRecent: 4 });
    expect(r.stats.skipped).toBe(false);
    expect(r.stats.compressedTokens).toBeLessThan(r.stats.originalTokens);
    expect(r.stats.collapsed).toBeGreaterThan(0);
    expect(r.messages[0]!.role).toBe('system');
    expect(r.messages.some((m) => m.content.startsWith('[prior context digest'))).toBe(true);
    // last message is one of the recent tail turns, kept verbatim
    expect(r.messages[r.messages.length - 1]!.content).toContain('Answer 19');
  });

  it('dedups repeated turns', () => {
    const messages: CompressMessage[] = [
      { role: 'user', content: 'same thing '.repeat(30) },
      { role: 'user', content: 'same thing '.repeat(30) },
      { role: 'user', content: 'different '.repeat(30) },
    ];
    const r = new Compressor().compress(messages, { budgetTokens: 10 });
    expect(r.stats.deduped).toBe(1);
  });

  it('reports a meaning-preservation score', () => {
    const r = new Compressor().compress(convo(20), { budgetTokens: 200 });
    expect(r.stats.meaningPreservationScore).toBeGreaterThan(0);
    expect(r.stats.meaningPreservationScore).toBeLessThanOrEqual(1);
  });
});

describe('compress middleware', () => {
  it('rewrites normalizedMessages when over budget', async () => {
    const eng = new Engine().use(compressChatMiddleware({ budgetTokens: 200, keepRecent: 3 }));
    const input: ChatRequest = { model: 'auto', messages: convo(15) };
    const res = await eng.run({ kind: 'chat', input });
    const stats = res.trace.find((t) => t.stage === 'compress')?.decision as { skipped: boolean; collapsed: number };
    expect(stats.skipped).toBe(false);
    const out = res.meta.normalizedMessages as CompressMessage[];
    expect(out.length).toBeLessThan(input.messages.length);
  });
});
