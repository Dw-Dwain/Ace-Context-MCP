import { describe, it, expect } from 'vitest';
import { Cache } from '../src/index.js';

const q = (content: string) => ({ model: 'auto', messages: [{ role: 'user' as const, content }] });

describe('Cache with a custom (LLM-style) intent classifier', () => {
  it('uses the injected async classifier for reuse decisions', async () => {
    const calls: string[] = [];
    // A fake "LLM" classifier: everything is 'Explain' except debug wording.
    const cache = new Cache({
      threshold: 0.7,
      semanticFloor: 0, // score all candidates so the intent effect is observable
      intentClassifier: async (text) => {
        calls.push(text);
        return /debug|error|fix/i.test(text) ? 'Debug' : 'Explain';
      },
    });

    await cache.store(q('walk me through how tokens expire and rotate'), {
      content: 'explanation',
      model: 'm',
      provider: 'mock',
    });
    // paraphrase with matching (Explain) intent -> should hit
    const hit = await cache.decide(q('walk me through how the tokens expire and rotate now'));
    expect(hit.hit).toBe(true);

    // same topic but Debug intent -> classifier returns different label -> miss
    const miss = await cache.decide(q('debug why tokens expire and rotate incorrectly'));
    expect(miss.scores?.intent).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
  });
});
