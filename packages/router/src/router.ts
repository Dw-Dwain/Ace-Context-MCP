import type { Provider, ProviderRequest, RouteAttempt, RouteOutcome, StreamChunk } from './types.js';

export interface RouteRule {
  /** Match on the requested model string (e.g. starts-with 'claude'). */
  when: (model: string) => boolean;
  use: string;
  model?: string;
  fallbacks?: string[];
}

export interface RouterOptions {
  providers: Provider[];
  rules?: RouteRule[];
  /** Provider id used when no rule matches. Defaults to the first provider. */
  fallback?: string;
}

export class Router {
  private providers = new Map<string, Provider>();
  private rules: RouteRule[];
  private fallback: string;

  constructor(opts: RouterOptions) {
    if (!opts.providers.length) throw new Error('Router: at least one provider required');
    for (const p of opts.providers) this.providers.set(p.id, p);
    this.rules = opts.rules ?? [];
    this.fallback = opts.fallback ?? opts.providers[0]!.id;
  }

  /** Resolve a requested model to an ordered provider chain + concrete model. */
  resolve(model?: string): { chain: string[]; model: string } {
    const requested = model ?? 'auto';
    const rule = this.rules.find((r) => r.when(requested));
    if (rule) {
      return {
        chain: [rule.use, ...(rule.fallbacks ?? [])],
        model: rule.model ?? requested,
      };
    }
    return { chain: [this.fallback], model: requested };
  }

  async chat(req: ProviderRequest): Promise<RouteOutcome> {
    const { chain, model } = this.resolve(req.model);
    const attempts: RouteAttempt[] = [];
    let lastErr: unknown;
    for (const id of chain) {
      const provider = this.providers.get(id);
      if (!provider) {
        attempts.push({ provider: id, ok: false, error: 'provider not registered' });
        continue;
      }
      try {
        const result = await provider.chat({ ...req, model });
        attempts.push({ provider: id, ok: true });
        return { result, chosen: id, attempts };
      } catch (err) {
        lastErr = err;
        attempts.push({ provider: id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const detail = attempts.map((a) => `${a.provider}: ${a.error ?? 'ok'}`).join('; ');
    throw new Error(`Router: all providers failed [${detail}]`, { cause: lastErr });
  }

  /** Stream from the first provider in the chain that supports streaming.
   *  Fails over only if a provider throws before emitting any chunk. */
  async *chatStream(req: ProviderRequest): AsyncIterable<StreamChunk> {
    const { chain, model } = this.resolve(req.model);
    let lastErr: unknown;
    for (const id of chain) {
      const provider = this.providers.get(id);
      if (!provider?.chatStream) continue;
      let yielded = false;
      try {
        for await (const chunk of provider.chatStream({ ...req, model })) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (yielded) throw err; // mid-stream failure — can't safely restart
        lastErr = err;
      }
    }
    throw new Error('Router: no streaming provider succeeded', { cause: lastErr });
  }
}
