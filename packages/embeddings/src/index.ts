import { HashEmbeddings } from './hash.js';
import { OllamaEmbeddings } from './ollama.js';
import type { EmbeddingProvider } from './types.js';

export { HashEmbeddings } from './hash.js';
export { OllamaEmbeddings } from './ollama.js';
export type { OllamaOptions } from './ollama.js';
export { cosine } from './types.js';
export type { EmbeddingProvider } from './types.js';

export interface AutoOptions {
  preferOllama?: boolean;
  onSelect?: (id: string) => void;
}

/** Prefer a running Ollama for real semantics; degrade to deterministic hash
 *  embeddings when it isn't reachable. Entry points (CLI, MCP) use this;
 *  the Store default stays hash so library use and tests are hermetic. */
export async function autoEmbeddings(opts: AutoOptions = {}): Promise<EmbeddingProvider> {
  if (opts.preferOllama !== false) {
    const ollama = new OllamaEmbeddings();
    if (await ollama.available()) {
      opts.onSelect?.(ollama.id);
      return ollama;
    }
  }
  const hash = new HashEmbeddings();
  opts.onSelect?.(hash.id);
  return hash;
}
