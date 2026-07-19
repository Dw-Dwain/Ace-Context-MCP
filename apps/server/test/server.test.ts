import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@ace/store';
import { buildServer } from '../src/server.js';

let home: string;
let store: Store;
let app: ReturnType<typeof buildServer>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ace-server-'));
  store = new Store({ home });
  app = buildServer({ store });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  store.close();
  await rm(home, { recursive: true, force: true });
});

describe('ACE server', () => {
  it('serves the dashboard at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('AI CONTEXT ENGINE');
  });

  it('saves, loads, lists, and searches contexts', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/v1/contexts',
      payload: { slug: 'api/one', text: 'we decided to cache by meaning', tags: ['api'] },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json<{ slug: string }>().slug).toBe('api/one');

    const load = await app.inject({ method: 'GET', url: '/v1/contexts/api/one?shape=summary' });
    expect(load.json<{ markdown: string }>().markdown).toContain('cache by meaning');

    const list = await app.inject({ method: 'GET', url: '/v1/contexts?prefix=api/' });
    expect(list.json<{ contexts: unknown[] }>().contexts.length).toBe(1);

    const search = await app.inject({ method: 'POST', url: '/v1/contexts/search', payload: { query: 'cache by meaning' } });
    expect(search.json<{ hits: unknown[] }>().hits.length).toBeGreaterThan(0);
  });

  it('404s a missing context', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/contexts/missing/thing' });
    expect(res.statusCode).toBe(404);
  });

  it('exposes Prometheus metrics and traces that grow with usage', async () => {
    await app.inject({ method: 'POST', url: '/v1/contexts', payload: { slug: 'm/one', text: 'x' } });
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('ace_requests_total');
    const traces = await app.inject({ method: 'GET', url: '/v1/traces' });
    expect(traces.json<unknown[]>().length).toBeGreaterThan(0);
  });

  it('validates required fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/contexts', payload: { slug: 'x/y' } });
    expect(res.statusCode).toBe(400);
  });
});
