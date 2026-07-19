export interface EmbeddingProvider {
  /** Stable id, e.g. "hash-v1" or "ollama:nomic-embed-text". Chunks embedded
   *  by a different provider id are skipped at search time (dims/space differ). */
  readonly id: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  // Vectors from providers here are unit-normalized, so dot == cosine.
  // Guard length mismatch defensively.
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
