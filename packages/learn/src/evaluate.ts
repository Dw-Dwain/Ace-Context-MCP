import type { EngineRunResult } from '@ace/core';

export interface EvalRecord {
  op: string;
  totalMs: number;
  stages: number;
  cacheHit: boolean;
  errored: boolean;
  tokensIn: number;
  tokensOut: number;
}

/** Summarize a completed run's trace into a flat metrics record for storage
 *  and dashboards. Pure projection over the trace — no side effects. */
export function evaluateTrace(result: EngineRunResult): EvalRecord {
  const totalMs = result.trace.reduce((n, t) => n + t.durationMs, 0);
  const errored = result.trace.some((t) => t.error);
  const cacheDecision = result.trace.find((t) => t.stage === 'cache')?.decision as
    | { hit?: boolean }
    | undefined;
  const routerDecision = result.trace.find((t) => t.stage === 'router')?.decision as
    | { usage?: { inputTokens?: number; outputTokens?: number } }
    | undefined;
  return {
    op: result.op.kind,
    totalMs,
    stages: result.trace.length,
    cacheHit: cacheDecision?.hit ?? false,
    errored,
    tokensIn: routerDecision?.usage?.inputTokens ?? 0,
    tokensOut: routerDecision?.usage?.outputTokens ?? 0,
  };
}
