// Milestone M2 demo: save several contexts, then run a natural-language query
// across all of them. Uses deterministic hash embeddings so the demo is
// reproducible offline; a running Ollama would be picked up automatically by
// the CLI/MCP entry points for real semantics.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@ace/core';
import { Store, storeMiddleware } from '@ace/store';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

const home = await mkdtemp(join(tmpdir(), 'ace-demo-m2-'));
const store = new Store({ home }); // default hash embeddings
const engine = new Engine().use(storeMiddleware(store));

const seed: Array<{ slug: string; text: string; tags: string[] }> = [
  {
    slug: 'project/auth-refactor',
    tags: ['auth', 'security'],
    text: 'We decided to swap session cookies for JWT. Access tokens expire after 15 minutes and refresh tokens rotate on use. Revocation is handled with a deny-list, cleaned nightly.',
  },
  {
    slug: 'project/ui-redesign',
    tags: ['ui'],
    text: 'The dashboard moves to a dark theme with a collapsible sidebar. Charts use a colorblind-safe palette. Mobile gets a bottom tab bar.',
  },
  {
    slug: 'notes/infra',
    tags: ['infra'],
    text: 'Postgres is the primary datastore. Redis handles the exact-match cache and rate limiting. We deploy with a Helm chart to a k8s cluster.',
  },
  {
    slug: 'notes/lunch',
    tags: ['personal'],
    text: 'Good ramen spot two blocks north of the office. Cash only. Closed Mondays.',
  },
];

try {
  line(`ACE_HOME (demo scratch): ${home}\n`);
  rule();
  line('SEED  4 contexts');
  rule();
  for (const s of seed) {
    await engine.run({ kind: 'save', input: { slug: s.slug, source: { text: s.text }, hints: { tags: s.tags } } });
    line(`  saved ${s.slug}`);
  }
  line('');

  const queries = [
    'what did we decide about session tokens',
    'which theme does the dashboard use',
    'where do we cache things',
  ];

  for (const q of queries) {
    rule();
    line(`SEARCH  "${q}"`);
    rule();
    const res = await engine.run({ kind: 'search', input: { query: q, topK: 3 } });
    const payload = res.response as {
      hits: Array<{ slug: string; section: string; snippet: string; score: number }>;
      provider: string;
    };
    line(`provider: ${payload.provider}`);
    for (const h of payload.hits) {
      line(`  ${h.score.toFixed(3)}  ${h.slug}#${h.section}`);
      line(`         ${h.snippet.slice(0, 90)}${h.snippet.length > 90 ? '…' : ''}`);
    }
    line('');
  }
} finally {
  store.close();
  await rm(home, { recursive: true, force: true });
}
