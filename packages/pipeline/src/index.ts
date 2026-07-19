import { Engine } from '@ace/core';
import {
  Router,
  normalizeChatMiddleware,
  validateChatMiddleware,
  routerMiddleware,
  type Provider,
  type RouteRule,
} from '@ace/router';
import { Cache, cacheMiddleware } from '@ace/cache';
import { Optimizer, optimizeChatMiddleware } from '@ace/optimize';
import { compressChatMiddleware } from '@ace/compress';
import { securityMiddleware, type SecurityOptions } from '@ace/security';
import { Policy, policyMiddleware } from '@ace/policy';
import { Metrics, TraceLog, observeMiddleware, type Observer } from '@ace/observe';

export interface ChatPipelineOptions {
  providers: Provider[];
  routes?: RouteRule[];
  fallback?: string;
  /** Cache instance, or false to disable. Default: a fresh in-memory Cache. */
  cache?: Cache | false;
  /** Optimizer instance, or false to disable. Default: disabled. */
  optimizer?: Optimizer | false;
  /** Compression budget (tokens), or false to disable. Default: disabled. */
  compress?: { budgetTokens: number; keepRecent?: number } | false;
  /** Security scanning options, or false to disable. Default: disabled. */
  security?: SecurityOptions | false;
  /** Policy instance, or false to disable. Default: disabled. */
  policy?: Policy | false;
  /** Shared observer; a fresh one is created if omitted. */
  observer?: Observer;
}

export interface ChatPipeline {
  engine: Engine;
  observer: Observer;
  router: Router;
}

/**
 * Assemble the full ACE chat pipeline into one Engine. Stages run in this order
 * (observe added first so its `after` runs outermost and sees everything):
 *
 *   observe -> normalize -> validate -> security -> optimize -> cache ->
 *   compress -> policy -> router
 *
 * Every stage is optional; pass `false` to drop it. The context store flows
 * (save/load/search) are a separate concern — see @ace/store.
 */
export function createChatPipeline(opts: ChatPipelineOptions): ChatPipeline {
  const observer: Observer = opts.observer ?? { metrics: new Metrics(), traces: new TraceLog() };
  const router = new Router({
    providers: opts.providers,
    ...(opts.routes ? { rules: opts.routes } : {}),
    ...(opts.fallback ? { fallback: opts.fallback } : {}),
  });

  const engine = new Engine();
  engine.use(observeMiddleware(observer));
  engine.use(normalizeChatMiddleware());
  engine.use(validateChatMiddleware());

  if (opts.security !== false && opts.security !== undefined) {
    engine.use(securityMiddleware(opts.security));
  }
  if (opts.optimizer) {
    engine.use(optimizeChatMiddleware(opts.optimizer));
  }
  if (opts.cache !== false) {
    engine.use(cacheMiddleware(opts.cache ?? new Cache()));
  }
  if (opts.compress) {
    engine.use(compressChatMiddleware(opts.compress));
  }
  if (opts.policy) {
    engine.use(policyMiddleware(opts.policy));
  }
  engine.use(routerMiddleware(router));

  return { engine, observer, router };
}

export type { Observer } from '@ace/observe';
