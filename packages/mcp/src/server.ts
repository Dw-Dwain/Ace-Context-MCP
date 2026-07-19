import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ForgetRequest, ListRequest, LoadRequest, SaveRequest } from '@ace/core';
import { Store } from '@ace/store';

const shapeEnum = z.enum(['pointer', 'summary', 'working', 'full']);

export interface AceServerOptions {
  store: Store;
  name?: string;
  version?: string;
}

export function createAceServer(opts: AceServerOptions): McpServer {
  const { store } = opts;
  const server = new McpServer({
    name: opts.name ?? 'ace',
    version: opts.version ?? '0.0.1',
  });

  server.registerTool(
    'context_save',
    {
      title: 'Save a context',
      description:
        'Persist a chat, notes, or thread under a slug so any other chat can load it. Merges into an existing slug (bumps version).',
      inputSchema: {
        slug: z.string().describe('Unique slug, e.g. "project/auth-refactor"'),
        text: z.string().describe('The full content to save'),
        tags: z.array(z.string()).optional(),
        ttlDays: z.number().int().positive().optional(),
        keepRaw: z.boolean().optional().describe('Retain raw content in full shape (default true)'),
      },
    },
    async ({ slug, text, tags, ttlDays, keepRaw }) => {
      const hints: NonNullable<SaveRequest['hints']> = {};
      if (tags !== undefined) hints.tags = tags;
      if (ttlDays !== undefined) hints.ttlDays = ttlDays;
      if (keepRaw !== undefined) hints.keepRaw = keepRaw;
      const req: SaveRequest = { slug, source: { text }, hints };
      const res = await store.save(req);
      return {
        content: [
          {
            type: 'text',
            text:
              `saved ${res.slug} v${res.version}\n` +
              `tokens summary=${res.tokens.summary} working=${res.tokens.working} full=${res.tokens.full}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'context_load',
    {
      title: 'Load a context',
      description:
        'Fetch a saved context as ready-to-paste markdown. Engine picks the largest shape that fits budgetTokens.',
      inputSchema: {
        slug: z.string(),
        shape: shapeEnum.optional().describe('pointer | summary | working | full (default summary)'),
        budgetTokens: z.number().int().positive().optional(),
      },
    },
    async ({ slug, shape, budgetTokens }) => {
      const req: LoadRequest = { slug };
      if (shape !== undefined) req.shape = shape;
      if (budgetTokens !== undefined) req.budgetTokens = budgetTokens;
      const res = await store.load(req);
      return { content: [{ type: 'text', text: res.markdown }] };
    },
  );

  server.registerTool(
    'context_list',
    {
      title: 'List saved contexts',
      description: 'Enumerate contexts, optionally filtered by slug prefix or tag.',
      inputSchema: {
        prefix: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    ({ prefix, tag, limit }) => {
      const req: ListRequest = {};
      if (prefix !== undefined) req.prefix = prefix;
      if (tag !== undefined) req.tag = tag;
      if (limit !== undefined) req.limit = limit;
      const res = store.list(req);
      const lines = res.contexts.length
        ? res.contexts
            .map(
              (c) =>
                `${c.slug} · v${c.version} · tokens=${c.tokensSummary}/${c.tokensWorking}/${c.tokensFull} · ${new Date(c.updatedAt).toISOString()}${c.tags.length ? ` · [${c.tags.join(', ')}]` : ''}`,
            )
            .join('\n')
        : '(no contexts)';
      return { content: [{ type: 'text', text: lines }] };
    },
  );

  server.registerTool(
    'context_forget',
    {
      title: 'Forget a context',
      description: 'Move a context to trash (recoverable) or purge it permanently.',
      inputSchema: {
        slug: z.string(),
        purge: z.boolean().optional().describe('Permanently delete instead of moving to trash'),
      },
    },
    async ({ slug, purge }) => {
      const req: ForgetRequest = { slug };
      if (purge !== undefined) req.purge = purge;
      const res = await store.forget(req);
      const msg = res.moved
        ? `moved ${res.slug} -> trash: ${res.moved}`
        : purge
          ? `purged ${res.slug}`
          : `no such context: ${res.slug}`;
      return { content: [{ type: 'text', text: msg }] };
    },
  );

  server.registerTool(
    'context_search',
    {
      title: 'Search saved contexts',
      description:
        'Semantic search across every saved context. Returns ranked snippets with their source slug; load the slug for the full context.',
      inputSchema: {
        query: z.string(),
        scope: z.string().optional().describe('Restrict to a slug prefix, e.g. "project/"'),
        topK: z.number().int().positive().max(50).optional(),
        budgetTokens: z.number().int().positive().optional(),
      },
    },
    async ({ query, scope, topK, budgetTokens }) => {
      const req: { query: string; scope?: string; topK?: number; budgetTokens?: number } = { query };
      if (scope !== undefined) req.scope = scope;
      if (topK !== undefined) req.topK = topK;
      if (budgetTokens !== undefined) req.budgetTokens = budgetTokens;
      const res = await store.search(req);
      const body = res.hits.length
        ? res.hits.map((h) => `${h.score.toFixed(3)}  ${h.slug}#${h.section}\n    ${h.snippet}`).join('\n')
        : '(no matches)';
      const note =
        res.skipped > 0
          ? `\n\n(${res.skipped} chunks skipped: different embedding provider than ${res.provider}; re-save to reindex)`
          : '';
      return { content: [{ type: 'text', text: body + note }] };
    },
  );

  return server;
}
