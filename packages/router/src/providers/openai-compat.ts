import type { Provider, ProviderRequest, ProviderResponse, StreamChunk } from '../types.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAICompatOptions {
  id: string;
  baseURL: string;
  apiKey?: string | undefined;
  defaultModel?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

/**
 * One adapter for every OpenAI-compatible endpoint: OpenAI, OpenRouter, Ollama,
 * and Gemini's compat API all speak POST {baseURL}/chat/completions. fetch-based,
 * so no vendor SDK. Presets below fill in baseURL + id.
 */
export class OpenAICompatProvider implements Provider {
  readonly id: string;
  private baseURL: string;
  private apiKey: string | undefined;
  private defaultModel: string | undefined;
  private fetchImpl: FetchLike;

  constructor(opts: OpenAICompatOptions) {
    this.id = opts.id;
    this.baseURL = opts.baseURL.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.defaultModel;
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch: FetchLike }).fetch);
  }

  private body(req: ProviderRequest, stream: boolean): string {
    const messages = req.system
      ? [{ role: 'system', content: req.system }, ...req.messages]
      : req.messages;
    return JSON.stringify({
      model: this.model(req),
      messages,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      stream,
    });
  }

  private model(req: ProviderRequest): string {
    return req.model === 'auto' ? (this.defaultModel ?? req.model) : req.model;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    const res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(req, false),
    });
    if (!res.ok) throw new Error(`${this.id} HTTP ${res.status}: ${await safeText(res)}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const choice = json.choices?.[0];
    return {
      provider: this.id,
      model: json.model ?? this.model(req),
      content: choice?.message?.content ?? '',
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      ...(choice?.finish_reason ? { stopReason: choice.finish_reason } : {}),
    };
  }

  async *chatStream(req: ProviderRequest): AsyncIterable<StreamChunk> {
    const res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(req, true),
    });
    if (!res.ok || !res.body) throw new Error(`${this.id} stream HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { delta, done: false };
        } catch {
          // partial JSON across chunks — ignore; buffer handles reassembly
        }
      }
    }
    yield { delta: '', done: true };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}

// --- presets --------------------------------------------------------------

export function openai(opts: { apiKey?: string; model?: string; fetchImpl?: FetchLike } = {}): OpenAICompatProvider {
  return new OpenAICompatProvider({
    id: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
    defaultModel: opts.model ?? 'gpt-4o',
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}

export function openrouter(opts: { apiKey?: string; model?: string; fetchImpl?: FetchLike } = {}): OpenAICompatProvider {
  return new OpenAICompatProvider({
    id: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: opts.apiKey ?? process.env.OPENROUTER_API_KEY,
    defaultModel: opts.model ?? 'openai/gpt-4o',
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}

export function ollama(opts: { host?: string; model?: string; fetchImpl?: FetchLike } = {}): OpenAICompatProvider {
  const host = (opts.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '');
  return new OpenAICompatProvider({
    id: 'ollama',
    baseURL: `${host}/v1`,
    apiKey: 'ollama',
    defaultModel: opts.model ?? 'llama3.2',
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}

export function gemini(opts: { apiKey?: string; model?: string; fetchImpl?: FetchLike } = {}): OpenAICompatProvider {
  return new OpenAICompatProvider({
    id: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY,
    defaultModel: opts.model ?? 'gemini-2.0-flash',
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}
