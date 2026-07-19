import Fastify, { type FastifyInstance } from 'fastify';
import { Engine } from '@ace/core';
import { Store, storeMiddleware } from '@ace/store';
import { Metrics, TraceLog, observeMiddleware, type Observer } from '@ace/observe';
import { DASHBOARD_HTML } from './dashboard.js';

export interface ServerOptions {
  store: Store;
  observer?: Observer;
}

/** Fastify app exposing the context store as REST, with live metrics + traces
 *  and an embedded dashboard. Build the engine once (observe first so its
 *  `after` runs outermost), then route each request through it. */
export function buildServer(opts: ServerOptions): FastifyInstance {
  const observer: Observer = opts.observer ?? { metrics: new Metrics(), traces: new TraceLog() };
  const engine = new Engine().use(observeMiddleware(observer)).use(storeMiddleware(opts.store));
  const app = Fastify({ logger: false });

  app.get('/health', () => ({ ok: true }));

  app.get('/', (_req, reply) => {
    reply.type('text/html').send(DASHBOARD_HTML);
  });

  app.get('/metrics', (_req, reply) => {
    reply.type('text/plain').send(observer.metrics.render());
  });

  app.get('/v1/traces', (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    return observer.traces.recent(limit);
  });

  app.post('/v1/contexts', async (req, reply) => {
    const body = req.body as { slug?: string; text?: string; tags?: string[]; ttlDays?: number };
    if (!body?.slug || typeof body.text !== 'string') {
      return reply.code(400).send({ error: 'slug and text are required' });
    }
    const hints: { tags?: string[]; ttlDays?: number } = {};
    if (body.tags) hints.tags = body.tags;
    if (body.ttlDays !== undefined) hints.ttlDays = body.ttlDays;
    const res = await engine.run({ kind: 'save', input: { slug: body.slug, source: { text: body.text }, hints } });
    return res.response;
  });

  app.get('/v1/contexts', async (req) => {
    const q = req.query as { prefix?: string; tag?: string; limit?: string };
    const input: { prefix?: string; tag?: string; limit?: number } = {};
    if (q.prefix) input.prefix = q.prefix;
    if (q.tag) input.tag = q.tag;
    if (q.limit) input.limit = Number(q.limit);
    const res = await engine.run({ kind: 'list', input });
    return res.response;
  });

  app.post('/v1/contexts/search', async (req, reply) => {
    const body = req.body as { query?: string; scope?: string; topK?: number; budgetTokens?: number };
    if (!body?.query) return reply.code(400).send({ error: 'query is required' });
    const input: { query: string; scope?: string; topK?: number; budgetTokens?: number } = { query: body.query };
    if (body.scope) input.scope = body.scope;
    if (body.topK !== undefined) input.topK = body.topK;
    if (body.budgetTokens !== undefined) input.budgetTokens = body.budgetTokens;
    const res = await engine.run({ kind: 'search', input });
    return res.response;
  });

  app.get('/v1/contexts/*', async (req, reply) => {
    const slug = (req.params as Record<string, string>)['*'] ?? '';
    const q = req.query as { shape?: string; budget?: string };
    const input: { slug: string; shape?: 'pointer' | 'summary' | 'working' | 'full'; budgetTokens?: number } = { slug };
    if (q.shape === 'pointer' || q.shape === 'summary' || q.shape === 'working' || q.shape === 'full') {
      input.shape = q.shape;
    }
    if (q.budget) input.budgetTokens = Number(q.budget);
    try {
      const res = await engine.run({ kind: 'load', input });
      return res.response;
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.delete('/v1/contexts/*', async (req) => {
    const slug = (req.params as Record<string, string>)['*'] ?? '';
    const purge = (req.query as { purge?: string }).purge === 'true';
    const res = await engine.run({ kind: 'forget', input: { slug, purge } });
    return res.response;
  });

  return app;
}
