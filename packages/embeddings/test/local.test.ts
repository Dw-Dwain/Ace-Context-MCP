import { describe, it, expect } from 'vitest';
import { LocalEmbeddings, autoEmbeddings, HashEmbeddings } from '../src/index.js';

describe('LocalEmbeddings (optional dependency)', () => {
  it('reports a stable id and dim without loading the model', () => {
    const e = new LocalEmbeddings();
    expect(e.id).toBe('local:Xenova/all-MiniLM-L6-v2');
    expect(e.dim).toBe(384);
  });
  // available()/embed() are covered by the opt-in smoke check, not the unit
  // suite, because they may download a model on first use.
});

describe('autoEmbeddings', () => {
  it('falls back to hash when no server/model is offered', async () => {
    const e = await autoEmbeddings({ preferOllama: false, preferLocal: false });
    expect(e.id).toMatch(/^hash-v/);
    const [v] = await e.embed(['hello world']);
    expect(v!.length).toBe((e as HashEmbeddings).dim);
  });

  it('reports its selection via onSelect', async () => {
    let picked = '';
    await autoEmbeddings({ preferOllama: false, preferLocal: false, onSelect: (id) => (picked = id) });
    expect(picked).toMatch(/^hash-v/);
  });
});
