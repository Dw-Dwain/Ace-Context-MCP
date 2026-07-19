// Milestone M1 demo: save a fake thread, load it back at different shapes,
// list, then forget. Uses a scoped ACE_HOME so it doesn't touch your real store.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@ace/core';
import { Store, storeMiddleware } from '@ace/store';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

const home = await mkdtemp(join(tmpdir(), 'ace-demo-'));
const store = new Store({ home });
const engine = new Engine().use(storeMiddleware(store));

try {
  line(`ACE_HOME (demo scratch): ${home}\n`);

  rule();
  line('SAVE  project/auth-refactor');
  rule();
  const fakeThread = [
    'User: We need to swap the session cookie for JWT.',
    'Claude: Recommended: 15-minute access token + 7-day refresh, rotate on use.',
    'User: What about revocation?',
    'Claude: Deny-list refresh tokens on logout, TTL-cleaned nightly.',
    'User: Ok let us go with that.',
  ].join('\n');
  const saveRes = await engine.run({
    kind: 'save',
    input: {
      slug: 'project/auth-refactor',
      source: { text: fakeThread },
      hints: { tags: ['auth', 'security'], ttlDays: 90 },
    },
  });
  console.log('  ->', saveRes.response);
  console.log('  trace stages:', saveRes.trace.map((t) => `${t.stage}:${t.phase}`).join(' '));

  rule();
  line('LOAD  shape=pointer (any budget)');
  rule();
  const p = await engine.run({
    kind: 'load',
    input: { slug: 'project/auth-refactor', shape: 'pointer', budgetTokens: 200 },
  });
  process.stdout.write((p.response as { markdown: string }).markdown + '\n\n');

  rule();
  line('LOAD  shape=summary  budget=4000');
  rule();
  const s = await engine.run({
    kind: 'load',
    input: { slug: 'project/auth-refactor', shape: 'summary', budgetTokens: 4000 },
  });
  process.stdout.write((s.response as { markdown: string }).markdown + '\n\n');

  rule();
  line('LOAD  shape=full  budget=50  (should downgrade)');
  rule();
  const tiny = await engine.run({
    kind: 'load',
    input: { slug: 'project/auth-refactor', shape: 'full', budgetTokens: 50 },
  });
  const tinyR = tiny.response as { shape: string; tokens: number; markdown: string };
  line(`downgraded to shape=${tinyR.shape} tokens=${tinyR.tokens}`);
  process.stdout.write(tinyR.markdown + '\n\n');

  rule();
  line('LIST  prefix=project/');
  rule();
  const l = await engine.run({ kind: 'list', input: { prefix: 'project/' } });
  const rows = (l.response as { contexts: Array<{ slug: string; version: number }> }).contexts;
  for (const r of rows) line(`  ${r.slug}  v${r.version}`);
  line('');

  rule();
  line('FORGET  project/auth-refactor  (moves to trash)');
  rule();
  const f = await engine.run({ kind: 'forget', input: { slug: 'project/auth-refactor' } });
  console.log('  ->', f.response);
} finally {
  store.close();
  await rm(home, { recursive: true, force: true });
}
