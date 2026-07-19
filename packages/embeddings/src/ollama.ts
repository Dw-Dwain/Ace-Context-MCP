import type { EmbeddingProvider } from './types.js';

export interface OllamaOptions {
  host?: string;
  model?: string;
  dim?: number;
  timeoutMs?: number;
}

/** Local embeddings via a running Ollama server. Opt-in: real semantics when
 *  Ollama is installed and the model is pulled. Falls back is the caller's job
 *  (see autoEmbeddings). */
export class OllamaEmbeddings implements EmbeddingProvider {
  readonly id: string;
  readonly dim: number;
  private host: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: OllamaOptions = {}) {
    this.host = (opts.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = opts.model ?? 'nomic-embed-text';
    this.dim = opts.dim ?? 768;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.id = `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.host}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`ollama embed HTTP ${res.status}`);
      const json = (await res.json()) as { embeddings?: number[][] };
      if (!json.embeddings) throw new Error('ollama embed: missing embeddings in response');
      return json.embeddings.map((e) => normalizeToF32(e));
    } finally {
      clearTimeout(timer);
    }
  }

  async available(): Promise<boolean> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: ctl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeToF32(e: number[]): Float32Array {
  const v = Float32Array.from(e);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i]! /= norm;
  return v;
}
