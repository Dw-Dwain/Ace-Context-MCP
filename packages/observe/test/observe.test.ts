import { describe, it, expect } from 'vitest';
import { Engine } from '@ace/core';
import { Metrics, TraceLog, observeMiddleware } from '../src/index.js';

describe('Metrics', () => {
  it('counts and renders Prometheus text', () => {
    const m = new Metrics();
    m.inc('ace_requests_total');
    m.inc('ace_requests_total');
    m.inc('ace_requests_by_op_total', 1, { op: 'chat' });
    expect(m.get('ace_requests_total')).toBe(2);
    const text = m.render();
    expect(text).toContain('# TYPE ace_requests_total counter');
    expect(text).toContain('ace_requests_total 2');
    expect(text).toContain('ace_requests_by_op_total{op="chat"} 1');
  });
});

describe('TraceLog', () => {
  it('keeps recent summaries newest-first and respects capacity', () => {
    const log = new TraceLog(2);
    for (const id of ['a', 'b', 'c']) {
      log.push({ id, op: { kind: 'list', input: {} }, response: undefined, trace: [], meta: {} });
    }
    expect(log.size()).toBe(2);
    expect(log.recent().map((s) => s.id)).toEqual(['c', 'b']);
  });
});

describe('observeMiddleware', () => {
  it('records metrics and a trace summary per run', async () => {
    const metrics = new Metrics();
    const traces = new TraceLog();
    const eng = new Engine()
      .use(observeMiddleware({ metrics, traces }))
      .use({ name: 'stub', before: (ctx) => void (ctx.response = { ok: true }) });

    await eng.run({ kind: 'list', input: {} });
    expect(metrics.get('ace_requests_total')).toBe(1);
    expect(metrics.get('ace_requests_by_op_total', { op: 'list' })).toBe(1);
    expect(traces.recent()[0]!.op).toBe('list');
  });
});
