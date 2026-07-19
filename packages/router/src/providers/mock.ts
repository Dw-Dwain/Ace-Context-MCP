import type { Provider, ProviderRequest, ProviderResponse } from '../types.js';

export interface MockOptions {
  id?: string;
  /** Force failures to exercise failover. */
  fail?: boolean;
  /** Override the reply text; default echoes the last user message. */
  reply?: (req: ProviderRequest) => string;
}

/** Deterministic, network-free provider for tests, demos, and offline dev. */
export class MockProvider implements Provider {
  readonly id: string;
  private opts: MockOptions;

  constructor(opts: MockOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.opts = opts;
  }

  chat(req: ProviderRequest): Promise<ProviderResponse> {
    if (this.opts.fail) return Promise.reject(new Error(`${this.id} provider forced failure`));
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const content = this.opts.reply
      ? this.opts.reply(req)
      : `mock(${req.model}): ${lastUser?.content ?? ''}`.slice(0, 2000);
    return Promise.resolve({
      provider: this.id,
      model: req.model,
      content,
      usage: {
        inputTokens: estimateTokens(req.messages.map((m) => m.content).join(' ')),
        outputTokens: estimateTokens(content),
      },
      stopReason: 'end_turn',
    });
  }
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
