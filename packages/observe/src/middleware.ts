import { defineMiddleware, type Middleware } from '@ace/core';
import { Metrics } from './metrics.js';
import { TraceLog } from './tracelog.js';

export interface Observer {
  metrics: Metrics;
  traces: TraceLog;
  onTrace?: (summary: ReturnType<TraceLog['push']>) => void;
}

/**
 * Records metrics and pushes a trace summary after each run. Add it FIRST so
 * its `after` hook runs LAST (outermost), seeing the full trace. Feeds
 * /metrics, /v1/traces, and the live SSE stream.
 */
export function observeMiddleware(observer: Observer): Middleware {
  return defineMiddleware({
    name: 'observe',
    after: (ctx) => {
      const op = ctx.op.kind;
      observer.metrics.inc('ace_requests_total');
      observer.metrics.inc('ace_requests_by_op_total', 1, { op });
      const cache = ctx.trace.find((t) => t.stage === 'cache')?.decision as { hit?: boolean } | undefined;
      if (cache?.hit) observer.metrics.inc('ace_cache_hits_total');
      if (ctx.trace.some((t) => t.error)) observer.metrics.inc('ace_errors_total');

      const summary = observer.traces.push({
        id: ctx.id,
        op: ctx.op,
        response: ctx.response,
        trace: ctx.trace,
        meta: ctx.meta,
      });
      observer.onTrace?.(summary);
    },
  });
}
