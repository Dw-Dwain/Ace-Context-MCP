import { HashEmbeddings } from './hash.js';
import { OllamaEmbeddings } from './ollama.js';
import { LocalEmbeddings } from './local.js';
import type { EmbeddingProvider } from './types.js';

export { HashEmbeddings } from './hash.js';
export { OllamaEmbeddings } from './ollama.js';
export type { OllamaOptions } from './ollama.js';
export { LocalEmbeddings } from './local.js';
export type { LocalOptions } from './local.js';
export { cosine } from './types.js';
export type { EmbeddingProvider } from './types.js';

export interface AutoOptions {
  preferOllama?: boolean;
  /** Try the in-process transformers.js model when Ollama isn't up. Default true. */
  preferLocal?: boolean;
  onSelect?: (id: string) => void;
}

/**
 * Pick the best available embedder without failing:
 *   1. a running Ollama (real semantics, GPU-capable)
 *   2. in-process transformers.js (real semantics, no server) — if installed
 *   3. deterministic hash embeddings (keyword overlap, always available)
 *
 * Entry points (CLI, MCP, server) call this. The Store default stays hash so
 * library use and tests are hermetic.
 */
export async function autoEmbeddings(opts: AutoOptions = {}): Promise<EmbeddingProvider> {
  if (opts.preferOllama !== false) {
    const ollama = new OllamaEmbeddings();
    if (await ollama.available()) {
      opts.onSelect?.(ollama.id);
      return ollama;
    }
  }
  if (opts.preferLocal !== false) {
    const local = new LocalEmbeddings();
    if (await local.available()) {
      opts.onSelect?.(local.id);
      return local;
    }
  }
  const hash = new HashEmbeddings();
  opts.onSelect?.(hash.id);
  return hash;
}
