import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '@ace/store';
import { createAceServer } from '../src/server.js';

async function connected() {
  const home = await mkdtemp(join(tmpdir(), 'ace-mcp-'));
  const store = new Store({ home });
  const server = createAceServer({ store });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return {
    client,
    async cleanup() {
      await client.close();
      await server.close();
      store.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

describe('ace MCP server', () => {
  it('lists all context_* tools', async () => {
    const { client, cleanup } = await connected();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'context_forget',
        'context_list',
        'context_load',
        'context_save',
        'context_search',
      ]);
    } finally {
      await cleanup();
    }
  });

  it('saves and loads via the tool interface', async () => {
    const { client, cleanup } = await connected();
    try {
      const save = await client.callTool({
        name: 'context_save',
        arguments: {
          slug: 'mcp/roundtrip',
          text: 'we decided to use JWT with 15 minute expiry',
          tags: ['auth'],
        },
      });
      const saveContent = save.content as Array<{ type: string; text: string }>;
      expect(saveContent[0]!.text).toMatch(/saved mcp\/roundtrip v1/);

      const load = await client.callTool({
        name: 'context_load',
        arguments: { slug: 'mcp/roundtrip', shape: 'summary' },
      });
      const loadContent = load.content as Array<{ type: string; text: string }>;
      expect(loadContent[0]!.text).toContain('JWT');
      expect(loadContent[0]!.text).toContain('mcp/roundtrip');
    } finally {
      await cleanup();
    }
  });

  it('lists and forgets', async () => {
    const { client, cleanup } = await connected();
    try {
      await client.callTool({
        name: 'context_save',
        arguments: { slug: 'mcp/a', text: 'first' },
      });
      await client.callTool({
        name: 'context_save',
        arguments: { slug: 'mcp/b', text: 'second' },
      });
      const list = await client.callTool({
        name: 'context_list',
        arguments: { prefix: 'mcp/' },
      });
      const listText = (list.content as Array<{ text: string }>)[0]!.text;
      expect(listText).toContain('mcp/a');
      expect(listText).toContain('mcp/b');

      const forget = await client.callTool({
        name: 'context_forget',
        arguments: { slug: 'mcp/a', purge: true },
      });
      const forgetText = (forget.content as Array<{ text: string }>)[0]!.text;
      expect(forgetText).toMatch(/purged mcp\/a/);
    } finally {
      await cleanup();
    }
  });

  it('search ranks the relevant context first', async () => {
    const { client, cleanup } = await connected();
    try {
      await client.callTool({
        name: 'context_save',
        arguments: {
          slug: 'search/auth',
          text: 'we decided session tokens expire after 15 minutes and rotate on use',
        },
      });
      await client.callTool({
        name: 'context_save',
        arguments: { slug: 'search/lunch', text: 'good ramen near the office, cash only' },
      });
      const res = await client.callTool({
        name: 'context_search',
        arguments: { query: 'what did we decide about session tokens', topK: 3 },
      });
      const text = (res.content as Array<{ text: string }>)[0]!.text;
      const firstLine = text.split('\n')[0]!;
      expect(firstLine).toContain('search/auth');
    } finally {
      await cleanup();
    }
  });
});
