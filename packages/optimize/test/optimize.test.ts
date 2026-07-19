import { describe, it, expect } from 'vitest';
import { Engine, type ChatRequest } from '@ace/core';
import { Optimizer, cleanText, optimizeChatMiddleware } from '../src/index.js';

describe('cleanText', () => {
  it('strips filler and collapses whitespace', () => {
    expect(cleanText('just    really explain   this')).toBe('explain this');
  });
  it('dedups repeated sentences', () => {
    expect(cleanText('Do the thing. Do the thing. Then stop.')).toBe('Do the thing. Then stop.');
  });
  it('leaves meaning-bearing words alone', () => {
    expect(cleanText('maybe we should not ship')).toBe('maybe we should not ship');
  });
});

describe('Optimizer', () => {
  it('cleans within the safety rail and reports it', async () => {
    const opt = new Optimizer();
    const r = await opt.optimize('just really explain how tokens rotate');
    expect(r.text).toBe('explain how tokens rotate');
    expect(r.applied).toContain('clean');
    expect(r.rail.passed).toBe(true);
    expect(r.rail.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('expands a review-code prompt (additive, logged)', async () => {
    const opt = new Optimizer();
    const r = await opt.optimize('review this code');
    expect(r.text).toContain('security');
    expect(r.applied).toContain('expand:review-code');
  });

  it('injects persona and constraints into system', async () => {
    const opt = new Optimizer({ persona: 'You are a security engineer.', constraints: ['State assumptions.'] });
    const r = await opt.optimize('explain jwt');
    expect(r.system).toContain('security engineer');
    expect(r.system).toContain('State assumptions.');
    expect(r.applied).toEqual(expect.arrayContaining(['persona', 'constraints']));
  });

  it('reverts cleaning when the rail would trip', async () => {
    // railThreshold 1.1 is impossible to meet, so any change reverts.
    const opt = new Optimizer({ railThreshold: 1.1 });
    const r = await opt.optimize('just explain this simply');
    expect(r.rail.passed).toBe(false);
    expect(r.applied).toContain('clean-reverted');
    expect(r.text).toBe('just explain this simply');
  });

  it('is a no-op on an already-clean short prompt', async () => {
    const opt = new Optimizer();
    const r = await opt.optimize('list the files');
    expect(r.text).toBe('list the files');
    expect(r.applied).toEqual([]);
  });
});

describe('optimize middleware', () => {
  it('rewrites the last user message and prepends a system persona', async () => {
    const opt = new Optimizer({ persona: 'You are terse.' });
    const eng = new Engine().use(optimizeChatMiddleware(opt));
    const input: ChatRequest = {
      model: 'auto',
      messages: [{ role: 'user', content: 'just really explain tokens' }],
    };
    const res = await eng.run({ kind: 'chat', input });
    const decision = res.trace.find((t) => t.stage === 'optimize')?.decision as { applied: string[] };
    expect(decision.applied).toContain('clean');
    expect(decision.applied).toContain('persona');
    const messages = res.meta.normalizedMessages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages.find((m) => m.role === 'user')!.content).toBe('explain tokens');
  });
});
