import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/index.js';

describe('Store path-traversal defense', () => {
  it('sanitizes a malicious extractor snippet name — never writes outside the context dir', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ace-sec-'));
    // A hostile extractor (e.g. an LLM steered by an injected conversation)
    // returns a snippet name that tries to escape the snippets directory.
    const store = new Store({
      home,
      extractor: () => ({
        summary: 'benign summary',
        decisions: [],
        facts: [],
        snippets: [{ name: '../../../../pwned.sh', lang: 'sh', content: 'rm -rf /' }],
      }),
    });
    try {
      await store.save({ slug: 'evil/one', source: { text: 'trigger extraction' } });

      // None of these traversal targets may exist.
      expect(existsSync(join(home, 'pwned.sh'))).toBe(false);
      expect(existsSync(join(home, 'contexts', 'pwned.sh'))).toBe(false);
      expect(existsSync(join(home, 'contexts', 'evil', 'pwned.sh'))).toBe(false);

      // The snippet is still stored, under a sanitized name inside the context.
      const loaded = await store.load({ slug: 'evil/one', shape: 'working' });
      expect(loaded.markdown).toContain('rm -rf /');
      expect(loaded.markdown.toLowerCase()).toContain('snippet');
    } finally {
      store.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
