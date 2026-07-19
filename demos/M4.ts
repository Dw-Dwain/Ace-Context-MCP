// Milestone M4 demo: spawn ace-mcp as a subprocess over stdio, drive it as if
// we were Claude Desktop / Cursor / Cline. Proves any MCP-aware client can
// call the context store without a network hop.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, '..', 'packages', 'mcp', 'bin', 'ace-mcp.js');

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

const home = await mkdtemp(join(tmpdir(), 'ace-demo-m4-'));
line(`ACE_HOME (demo scratch): ${home}`);
line(`ace-mcp binary:         ${binPath}\n`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [binPath],
  env: { ...process.env, ACE_HOME: home },
});
const client = new Client({ name: 'ace-demo-m4', version: '0.0.1' });

try {
  await client.connect(transport);

  rule();
  line('list tools');
  rule();
  const { tools } = await client.listTools();
  for (const t of tools) line(`  ${t.name} — ${t.description?.split('\n')[0] ?? ''}`);
  line('');

  rule();
  line('context_save  project/auth-refactor');
  rule();
  const save = await client.callTool({
    name: 'context_save',
    arguments: {
      slug: 'project/auth-refactor',
      text: [
        'User: swap the session cookie for JWT.',
        'Claude: 15-minute access + 7-day refresh, rotate on use.',
        'User: revocation?',
        'Claude: deny-list refresh tokens on logout, TTL-cleaned nightly.',
      ].join('\n'),
      tags: ['auth', 'security'],
    },
  });
  process.stdout.write((save.content as Array<{ text: string }>)[0]!.text + '\n\n');

  rule();
  line('context_load  shape=summary  budget=4000');
  rule();
  const load = await client.callTool({
    name: 'context_load',
    arguments: { slug: 'project/auth-refactor', shape: 'summary', budgetTokens: 4000 },
  });
  process.stdout.write((load.content as Array<{ text: string }>)[0]!.text + '\n\n');

  rule();
  line('context_list  prefix=project/');
  rule();
  const list = await client.callTool({
    name: 'context_list',
    arguments: { prefix: 'project/' },
  });
  process.stdout.write((list.content as Array<{ text: string }>)[0]!.text + '\n\n');
} finally {
  await client.close();
  await rm(home, { recursive: true, force: true });
}
