import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@ace/core';
import { Store, storeMiddleware } from '../src/index.js';

async function withStore<T>(fn: (store: Store, home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'ace-store-'));
  const store = new Store({ home });
  try {
    return await fn(store, home);
  } finally {
    store.close();
    await rm(home, { recursive: true, force: true });
  }
}

describe('Store', () => {
  it('rejects invalid slugs', async () => {
    await withStore(async (store) => {
      await expect(store.save({ slug: '../evil', source: { text: 'x' } })).rejects.toThrow(/invalid slug/);
      await expect(store.save({ slug: 'UPPER', source: { text: 'x' } })).rejects.toThrow(/invalid slug/);
      await expect(store.save({ slug: '', source: { text: 'x' } })).rejects.toThrow(/invalid slug/);
    });
  });

  it('saves and loads text', async () => {
    await withStore(async (store) => {
      const save = await store.save({
        slug: 'project/auth',
        source: { text: 'we decided to use JWT with 15 minute expiry.' },
        hints: { tags: ['auth', 'security'] },
      });
      expect(save.version).toBe(1);
      expect(save.tokens.summary).toBeGreaterThan(0);

      const load = await store.load({ slug: 'project/auth', shape: 'summary' });
      expect(load.markdown).toContain('JWT');
      expect(load.markdown).toContain('project/auth');
      expect(load.shape).toBe('summary');
    });
  });

  it('bumps version on re-save', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'x/y', source: { text: 'first' } });
      const two = await store.save({ slug: 'x/y', source: { text: 'second' } });
      expect(two.version).toBe(2);
    });
  });

  it('load fits shape to budget when requested is too large', async () => {
    await withStore(async (store) => {
      await store.save({
        slug: 'big/one',
        source: { text: 'x'.repeat(5000) },
        hints: { keepRaw: true },
      });
      const tiny = await store.load({ slug: 'big/one', shape: 'full', budgetTokens: 50 });
      expect(['pointer', 'summary']).toContain(tiny.shape);
      expect(tiny.tokens).toBeLessThanOrEqual(200);
    });
  });

  it('list filters by prefix and tag', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'project/a', source: { text: 'a' }, hints: { tags: ['proj'] } });
      await store.save({ slug: 'project/b', source: { text: 'b' }, hints: { tags: ['proj', 'x'] } });
      await store.save({ slug: 'notes/c', source: { text: 'c' } });

      const byPrefix = store.list({ prefix: 'project/' });
      expect(byPrefix.contexts.map((c) => c.slug).sort()).toEqual(['project/a', 'project/b']);

      const byTag = store.list({ tag: 'x' });
      expect(byTag.contexts.map((c) => c.slug)).toEqual(['project/b']);
    });
  });

  it('forget moves to trash by default, purges when asked', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'temp/one', source: { text: 't' } });
      const moved = await store.forget({ slug: 'temp/one' });
      expect(moved.moved).toBeTruthy();
      expect(store.list({}).contexts.map((c) => c.slug)).not.toContain('temp/one');

      await store.save({ slug: 'temp/two', source: { text: 't' } });
      const purged = await store.forget({ slug: 'temp/two', purge: true });
      expect(purged.moved).toBeNull();
    });
  });

  it('load throws for missing slug', async () => {
    await withStore(async (store) => {
      await expect(store.load({ slug: 'missing/thing' })).rejects.toThrow(/context not found/);
    });
  });

  it('files are saved and appear in working shape', async () => {
    await withStore(async (store) => {
      await store.save({
        slug: 'code/thing',
        source: {
          text: 'summary text',
          files: [{ path: '/abs/path/to/foo.ts', content: 'export const x = 1;' }],
        },
      });
      const loaded = await store.load({ slug: 'code/thing', shape: 'working' });
      expect(loaded.markdown).toContain('foo.ts');
      expect(loaded.markdown).toContain('export const x = 1');
    });
  });
});

describe('Store extraction (M3)', () => {
  const thread = [
    'User: We need to swap the session cookie for JWT.',
    'Assistant: Recommended:',
    '- Access tokens expire after 15 minutes',
    '- Refresh tokens rotate on use',
    '```ts',
    'interface Session { userId: string }',
    '```',
    "User: Ok let's go with that.",
  ].join('\n');

  it('populates decisions, facts, and snippets in the working shape', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'ex/auth', source: { text: thread } });
      const loaded = await store.load({ slug: 'ex/auth', shape: 'working' });
      expect(loaded.markdown).toContain('## Decisions');
      expect(loaded.markdown.toLowerCase()).toContain("let's go with");
      expect(loaded.markdown).toContain('## Facts');
      expect(loaded.markdown).toContain('Access tokens expire after 15 minutes');
      expect(loaded.markdown).toContain('interface Session');
    });
  });

  it('merges and dedups decisions/facts across re-saves', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'ex/merge', source: { text: 'User: track notes\nAssistant:\n- fact one\n- fact two' } });
      await store.save({ slug: 'ex/merge', source: { text: 'User: more notes\nAssistant:\n- fact two\n- fact three' } });
      const loaded = await store.load({ slug: 'ex/merge', shape: 'summary' });
      const factsSection = loaded.markdown.slice(loaded.markdown.indexOf('## Facts'));
      const factTwoCount = (factsSection.match(/fact two/g) ?? []).length;
      expect(factTwoCount).toBe(1);
      expect(factsSection).toContain('fact one');
      expect(factsSection).toContain('fact three');
    });
  });

  it('honors extract opt-out', async () => {
    await withStore(async (store) => {
      await store.save({
        slug: 'ex/optout',
        source: { text: 'User: we decided to use JWT' },
        hints: { extract: [] },
      });
      const loaded = await store.load({ slug: 'ex/optout', shape: 'working' });
      expect(loaded.markdown).not.toContain('## Decisions');
    });
  });
});

describe('Store semantic search', () => {
  it('ranks the relevant context above unrelated ones', async () => {
    await withStore(async (store) => {
      await store.save({
        slug: 'project/auth',
        source: { text: 'we decided session tokens expire after 15 minutes and rotate on use' },
      });
      await store.save({
        slug: 'project/ui',
        source: { text: 'the dashboard uses a dark theme with a sidebar navigation' },
      });
      await store.save({
        slug: 'notes/lunch',
        source: { text: 'good ramen place near the office on 3rd street' },
      });

      const res = await store.search({ query: 'what did we decide about session tokens' });
      expect(res.hits.length).toBeGreaterThan(0);
      expect(res.hits[0]!.slug).toBe('project/auth');
      expect(res.provider).toMatch(/^hash-v1/);
    });
  });

  it('respects topK', async () => {
    await withStore(async (store) => {
      for (let i = 0; i < 5; i++) {
        await store.save({ slug: `bulk/${i}`, source: { text: `token session note number ${i}` } });
      }
      const res = await store.search({ query: 'token session', topK: 2 });
      expect(res.hits.length).toBe(2);
    });
  });

  it('scopes search to a slug prefix', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'a/one', source: { text: 'alpha token content' } });
      await store.save({ slug: 'b/one', source: { text: 'beta token content' } });
      const res = await store.search({ query: 'token content', scope: 'a/' });
      expect(res.hits.every((h) => h.slug.startsWith('a/'))).toBe(true);
    });
  });

  it('drops chunks when a context is forgotten', async () => {
    await withStore(async (store) => {
      await store.save({ slug: 'gone/soon', source: { text: 'ephemeral token data' } });
      await store.forget({ slug: 'gone/soon', purge: true });
      const res = await store.search({ query: 'ephemeral token data' });
      expect(res.hits.find((h) => h.slug === 'gone/soon')).toBeUndefined();
    });
  });
});

describe('storeMiddleware via Engine', () => {
  it('handles save then load via engine.run', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ace-store-eng-'));
    const store = new Store({ home });
    const engine = new Engine().use(storeMiddleware(store));
    try {
      const saveRes = await engine.run({
        kind: 'save',
        input: { slug: 'e2e/first', source: { text: 'hello world' } },
      });
      expect((saveRes.response as { slug: string }).slug).toBe('e2e/first');
      expect(saveRes.trace.some((t) => t.decision && (t.decision as { kind: string }).kind === 'save')).toBe(true);

      const loadRes = await engine.run({
        kind: 'load',
        input: { slug: 'e2e/first', shape: 'summary' },
      });
      const payload = loadRes.response as { markdown: string };
      expect(payload.markdown).toContain('hello world');
    } finally {
      store.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
