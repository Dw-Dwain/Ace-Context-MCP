import Anthropic from '@anthropic-ai/sdk';
import type { Provider, ProviderRequest, ProviderResponse, StreamChunk } from '../types.js';

export interface AnthropicOptions {
  apiKey?: string;
  defaultModel?: string;
  baseURL?: string;
}

/** The only file in the codebase that imports a vendor SDK. Everything else
 *  talks to the Provider interface, keeping the engine provider-agnostic. */
export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  private client: Anthropic;
  private defaultModel: string;

  constructor(opts: AnthropicOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('AnthropicProvider: ANTHROPIC_API_KEY is not set');
    this.client = new Anthropic(opts.baseURL ? { apiKey, baseURL: opts.baseURL } : { apiKey });
    this.defaultModel = opts.defaultModel ?? 'claude-opus-4-8';
  }

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    const model = req.model === 'auto' ? this.defaultModel : req.model;
    const msg = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.system ? { system: req.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const content = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      provider: this.id,
      model: msg.model,
      content,
      usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
      ...(msg.stop_reason ? { stopReason: msg.stop_reason } : {}),
    };
  }

  async *chatStream(req: ProviderRequest): AsyncIterable<StreamChunk> {
    const model = req.model === 'auto' ? this.defaultModel : req.model;
    const stream = this.client.messages.stream({
      model,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.system ? { system: req.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { delta: event.delta.text, done: false };
      }
    }
    yield { delta: '', done: true };
  }
}
