import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/index.js';

async function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'ace-conc-'));
  const store = new Store({ home });
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('Store concurrency', () => {
  it('handles many concurrent saves to different slugs', async () => {
    await withStore(async (store) => {
      await Promise.all(range(25).map((i) => store.save({ slug: `bulk/${i}`, source: { text: `content number ${i}` } })));
      const rows = store.list({ prefix: 'bulk/', limit: 100 }).contexts;
      expect(rows.length).toBe(25);
      // every one is loadable
      const loaded = await Promise.all(range(25).map((i) => store.load({ slug: `bulk/${i}`, shape: 'summary' })));
      expect(loaded.every((l) => l.markdown.length > 0)).toBe(true);
    });
  });

  it('survives concurrent saves to the SAME slug without corruption (last-writer-wins)', async () => {
    await withStore(async (store) => {
      // Racing writers all target one slug. Atomic tmp+rename writes and
      // synchronous SQLite upserts mean the end state is a valid manifest and
      // exactly one index row — versions may not be sequential (last wins).
      await Promise.all(range(12).map((i) => store.save({ slug: 'race/one', source: { text: `revision ${i} of the content` } })));
      const rows = store.list({ prefix: 'race/' }).contexts;
      expect(rows.length).toBe(1);
      const loaded = await store.load({ slug: 'race/one', shape: 'summary' });
      expect(loaded.markdown).toContain('revision');
      expect(rows[0]!.version).toBeGreaterThanOrEqual(1);
    });
  });

  it('concurrent search + save do not throw', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'seed/a', source: { text: 'token session rotation policy' } });
      const ops: Array<Promise<unknown>> = [];
      for (let i = 0; i < 10; i++) {
        ops.push(store.save({ slug: `more/${i}`, source: { text: `session token entry ${i}` } }));
        ops.push(store.search({ query: 'session token', topK: 3 }));
      }
      await expect(Promise.all(ops)).resolves.toBeDefined();
    });
  });
});
