import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// E2E: spawn the REAL built binary over stdio and drive it as a client would.
// Requires `pnpm --filter=@ace/mcp build` first (CI builds before test).
const bin = resolve(__dirname, '..', 'bin', 'ace-mcp.js');
const built = existsSync(resolve(__dirname, '..', 'dist', 'main.js'));

describe.skipIf(!built)('ace-mcp subprocess (E2E over stdio)', () => {
  let home: string;
  let client: Client;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'ace-mcp-e2e-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      env: { ...process.env, ACE_HOME: home },
    });
    client = new Client({ name: 'e2e', version: '0.0.1' });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client?.close();
    await rm(home, { recursive: true, force: true });
  });

  it('lists the context_* tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'context_forget',
      'context_list',
      'context_load',
      'context_save',
      'context_search',
    ]);
  });

  it('round-trips save -> load -> search -> forget through a real process', async () => {
    await client.callTool({
      name: 'context_save',
      arguments: { slug: 'e2e/auth', text: 'we decided session tokens expire in 15 minutes', tags: ['auth'] },
    });

    const load = await client.callTool({ name: 'context_load', arguments: { slug: 'e2e/auth', shape: 'summary' } });
    expect((load.content as Array<{ text: string }>)[0]!.text).toContain('15 minutes');

    const search = await client.callTool({ name: 'context_search', arguments: { query: 'when do tokens expire', topK: 3 } });
    expect((search.content as Array<{ text: string }>)[0]!.text).toContain('e2e/auth');

    const list = await client.callTool({ name: 'context_list', arguments: { prefix: 'e2e/' } });
    expect((list.content as Array<{ text: string }>)[0]!.text).toContain('e2e/auth');

    const forget = await client.callTool({ name: 'context_forget', arguments: { slug: 'e2e/auth', purge: true } });
    expect((forget.content as Array<{ text: string }>)[0]!.text).toMatch(/purged/);
  }, 30000);
});
