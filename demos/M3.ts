// Milestone M3 demo: save a raw chat thread and watch it get distilled into
// decisions / facts / snippets, then load each layered shape.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@ace/core';
import { Store, storeMiddleware } from '@ace/store';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

const thread = `User: We're replacing session cookies with JWT. Thoughts on structure?
Assistant: Here's what I'd recommend:
- Access tokens live for 15 minutes
- Refresh tokens rotate on every use
- Revoked refresh tokens go on a deny-list, cleaned nightly

The token payload:
\`\`\`ts
interface TokenPayload {
  sub: string;      // user id
  exp: number;      // epoch seconds
  jti: string;      // token id for revocation
}
\`\`\`
User: Great. Let's go with that. Decision: ship behind a feature flag first.
Assistant: Agreed to gate it behind auth.jwt.enabled and roll out to 5% first.`;

const home = await mkdtemp(join(tmpdir(), 'ace-demo-m3-'));
const store = new Store({ home });
const engine = new Engine().use(storeMiddleware(store));

try {
  line(`ACE_HOME (demo scratch): ${home}\n`);
  rule();
  line('SAVE  raw thread → extract decisions/facts/snippets');
  rule();
  const saved = await engine.run({
    kind: 'save',
    input: { slug: 'project/jwt', source: { text: thread }, hints: { tags: ['auth'] } },
  });
  console.log('  ->', saved.response);
  line('');

  for (const shape of ['pointer', 'summary', 'working'] as const) {
    rule();
    line(`LOAD  shape=${shape}`);
    rule();
    const res = await engine.run({ kind: 'load', input: { slug: 'project/jwt', shape } });
    process.stdout.write((res.response as { markdown: string }).markdown + '\n\n');
  }
} finally {
  store.close();
  await rm(home, { recursive: true, force: true });
}
