import type { EngineRunResult } from '@ace/core';

export interface TraceSummary {
  id: string;
  op: string;
  stages: number;
  totalMs: number;
  cacheHit: boolean;
  errored: boolean;
  decisions: Array<{ stage: string; decision: unknown }>;
}

/** Fixed-size ring buffer of recent run summaries for the dashboard/API. */
export class TraceLog {
  private buf: TraceSummary[] = [];
  constructor(private capacity = 200) {}

  push(result: EngineRunResult): TraceSummary {
    const summary: TraceSummary = {
      id: result.id,
      op: result.op.kind,
      stages: result.trace.length,
      totalMs: Number(result.trace.reduce((n, t) => n + t.durationMs, 0).toFixed(2)),
      cacheHit: Boolean(
        (result.trace.find((t) => t.stage === 'cache')?.decision as { hit?: boolean } | undefined)?.hit,
      ),
      errored: result.trace.some((t) => t.error),
      decisions: result.trace
        .filter((t) => t.decision !== undefined)
        .map((t) => ({ stage: t.stage, decision: t.decision })),
    };
    this.buf.push(summary);
    if (this.buf.length > this.capacity) this.buf.shift();
    return summary;
  }

  recent(limit = 50): TraceSummary[] {
    return this.buf.slice(-limit).reverse();
  }

  size(): number {
    return this.buf.length;
  }
}
