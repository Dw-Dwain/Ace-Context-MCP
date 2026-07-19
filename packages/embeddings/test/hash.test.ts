import { describe, it, expect } from 'vitest';
import { HashEmbeddings, cosine } from '../src/index.js';

describe('HashEmbeddings', () => {
  it('is deterministic', async () => {
    const e = new HashEmbeddings();
    const [a] = await e.embed(['session tokens rotate on use']);
    const [b] = await e.embed(['session tokens rotate on use']);
    expect(Array.from(a!)).toEqual(Array.from(b!));
  });

  it('produces unit vectors', async () => {
    const e = new HashEmbeddings();
    const [v] = await e.embed(['hello world foo bar']);
    let norm = 0;
    for (const x of v!) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it('ranks lexically-related text above unrelated text', async () => {
    const e = new HashEmbeddings();
    const [query] = await e.embed(['what did we decide about session tokens']);
    const [related] = await e.embed([
      'we decided session tokens expire after 15 minutes and rotate on use',
    ]);
    const [unrelated] = await e.embed(['the weather in paris is mild in spring']);
    expect(cosine(query!, related!)).toBeGreaterThan(cosine(query!, unrelated!));
  });

  it('reports a stable provider id and dim', () => {
    const e = new HashEmbeddings(128);
    expect(e.id).toBe('hash-v1-128');
    expect(e.dim).toBe(128);
  });
});
