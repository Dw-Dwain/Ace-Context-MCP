import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deepFreeze } from './freeze.js';
import type {
  EngineRunResult,
  Middleware,
  Operation,
  RequestContext,
  TraceEntry,
} from './types.js';

export class Engine {
  private stages: Middleware[] = [];

  use(m: Middleware): this {
    this.assertUniqueName(m.name);
    this.stages.push(m);
    return this;
  }

  insertBefore(existing: string, m: Middleware): this {
    this.assertUniqueName(m.name);
    const idx = this.stages.findIndex((s) => s.name === existing);
    if (idx === -1) throw new Error(`Engine.insertBefore: no stage named "${existing}"`);
    this.stages.splice(idx, 0, m);
    return this;
  }

  insertAfter(existing: string, m: Middleware): this {
    this.assertUniqueName(m.name);
    const idx = this.stages.findIndex((s) => s.name === existing);
    if (idx === -1) throw new Error(`Engine.insertAfter: no stage named "${existing}"`);
    this.stages.splice(idx + 1, 0, m);
    return this;
  }

  remove(name: string): this {
    this.stages = this.stages.filter((s) => s.name !== name);
    return this;
  }

  list(): ReadonlyArray<Middleware> {
    return this.stages;
  }

  async run(op: Operation): Promise<EngineRunResult> {
    const ctx: RequestContext = {
      id: randomUUID(),
      op: deepFreeze(op),
      trace: [],
      meta: {},
    };

    const applicable = this.stages.filter((s) => !s.appliesTo || s.appliesTo.includes(op.kind));

    for (const stage of applicable) {
      const aborted = await this.runHook(stage, 'before', ctx);
      if (aborted) return this.result(ctx);
    }

    for (let i = applicable.length - 1; i >= 0; i--) {
      const stage = applicable[i]!;
      const aborted = await this.runHook(stage, 'after', ctx);
      if (aborted) return this.result(ctx);
    }

    return this.result(ctx);
  }

  private async runHook(
    stage: Middleware,
    phase: 'before' | 'after',
    ctx: RequestContext,
  ): Promise<boolean> {
    const fn = phase === 'before' ? stage.before : stage.after;
    if (!fn) return false;
    const startedAt = performance.now();
    try {
      await fn(ctx);
      const decision = takePendingDecision(ctx, stage.name);
      const entry: TraceEntry = {
        stage: stage.name,
        phase,
        startedAt,
        durationMs: performance.now() - startedAt,
      };
      if (decision !== undefined) entry.decision = decision;
      ctx.trace.push(entry);
      return false;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const error: TraceEntry['error'] =
        e.stack !== undefined
          ? { name: e.name, message: e.message, stack: e.stack }
          : { name: e.name, message: e.message };
      ctx.trace.push({
        stage: stage.name,
        phase,
        startedAt,
        durationMs: performance.now() - startedAt,
        error,
      });
      if (stage.fatalOnError !== false) throw err;
      return false;
    }
  }

  private assertUniqueName(name: string) {
    if (this.stages.some((s) => s.name === name)) {
      throw new Error(`Engine.use: duplicate middleware name "${name}"`);
    }
  }

  private result(ctx: RequestContext): EngineRunResult {
    return {
      id: ctx.id,
      op: ctx.op,
      response: ctx.response,
      trace: ctx.trace,
      meta: ctx.meta,
    };
  }
}

export function defineMiddleware(m: Middleware): Middleware {
  return m;
}

const PENDING_KEY = Symbol.for('@ace/core/pendingDecisions');

export function recordDecision(ctx: RequestContext, stage: string, decision: unknown): void {
  const meta = ctx.meta as Record<string | symbol, unknown>;
  const pending = (meta[PENDING_KEY] ??= {}) as Record<string, unknown>;
  pending[stage] = decision;
}

function takePendingDecision(ctx: RequestContext, stage: string): unknown {
  const meta = ctx.meta as Record<string | symbol, unknown>;
  const pending = meta[PENDING_KEY] as Record<string, unknown> | undefined;
  if (!pending) return undefined;
  const v = pending[stage];
  delete pending[stage];
  return v;
}
