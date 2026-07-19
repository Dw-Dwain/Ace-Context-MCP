import { describe, it, expect } from 'vitest';
import { llmExtract, LlmExtractor, type LlmClient } from '../src/index.js';

const good = (): LlmClient => ({
  complete: () =>
    Promise.resolve(
      '```json\n' +
        JSON.stringify({
          summary: 'Switch to JWT auth.',
          decisions: ['Use 15-minute access tokens.', 'Deny-list refresh tokens on logout.'],
          facts: ['Refresh tokens rotate on use.'],
          snippets: [{ lang: 'ts', content: 'interface Session { userId: string }' }],
        }) +
        '\n```',
    ),
});

const thread = 'User: swap to JWT?\nAssistant: yes, 15m access, deny-list on logout.';

describe('llmExtract', () => {
  it('parses well-formed LLM JSON (even inside code fences)', async () => {
    const res = await llmExtract(good(), { text: thread });
    expect(res.summary).toBe('Switch to JWT auth.');
    expect(res.decisions).toContain('Deny-list refresh tokens on logout.');
    expect(res.facts).toContain('Refresh tokens rotate on use.');
    expect(res.snippets[0]!.lang).toBe('ts');
    expect(res.snippets[0]!.name).toMatch(/^001-snippet\.ts$/);
  });

  it('falls back to heuristic extraction on unparseable output', async () => {
    const bad: LlmClient = { complete: () => Promise.resolve('sorry, I cannot do that') };
    const res = await llmExtract(bad, { text: "User: ok let's go with JWT.\nAssistant: agreed." });
    // heuristic decision cue still captured
    expect(res.decisions.join(' ').toLowerCase()).toContain("let's go with");
  });

  it('falls back when the client throws', async () => {
    const throwing: LlmClient = { complete: () => Promise.reject(new Error('network')) };
    const res = await llmExtract(throwing, { text: 'Assistant:\n- a fact' });
    expect(res.facts).toContain('a fact');
  });

  it('LlmExtractor class wraps the function', async () => {
    const res = await new LlmExtractor(good()).extract({ text: thread });
    expect(res.summary).toBe('Switch to JWT auth.');
  });
});
