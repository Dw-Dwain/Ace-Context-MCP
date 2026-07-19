export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export interface PolicyConfig {
  maxTokensPerRequest?: number;
  allowModels?: string[];
  denyModels?: string[];
  rateLimit?: RateLimitConfig;
  /** Injected clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export interface PolicyInput {
  key?: string;
  model?: string;
  tokensEstimate?: number;
}

export interface PolicyDecision {
  allowed: boolean;
  reasons: string[];
}

/** Fixed-window counter. ponytail: swap for a sliding window or token bucket
 *  if burst behavior at window edges matters. */
class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  constructor(
    private cfg: RateLimitConfig,
    private now: () => number,
  ) {}

  check(key: string): boolean {
    const t = this.now();
    const rec = this.hits.get(key);
    if (!rec || t - rec.windowStart >= this.cfg.windowMs) {
      this.hits.set(key, { count: 1, windowStart: t });
      return true;
    }
    if (rec.count >= this.cfg.max) return false;
    rec.count++;
    return true;
  }
}

export class Policy {
  private cfg: PolicyConfig;
  private limiter: RateLimiter | null;

  constructor(cfg: PolicyConfig = {}) {
    this.cfg = cfg;
    const now = cfg.now ?? Date.now;
    this.limiter = cfg.rateLimit ? new RateLimiter(cfg.rateLimit, now) : null;
  }

  evaluate(input: PolicyInput): PolicyDecision {
    const reasons: string[] = [];

    if (this.cfg.maxTokensPerRequest !== undefined && input.tokensEstimate !== undefined) {
      if (input.tokensEstimate > this.cfg.maxTokensPerRequest) {
        reasons.push(`over token budget (${input.tokensEstimate} > ${this.cfg.maxTokensPerRequest})`);
      }
    }

    if (input.model) {
      if (this.cfg.denyModels?.includes(input.model)) reasons.push(`model denied: ${input.model}`);
      if (this.cfg.allowModels && !this.cfg.allowModels.includes(input.model)) {
        reasons.push(`model not in allow-list: ${input.model}`);
      }
    }

    if (this.limiter && !this.limiter.check(input.key ?? 'default')) {
      reasons.push('rate limit exceeded');
    }

    return { allowed: reasons.length === 0, reasons };
  }
}
