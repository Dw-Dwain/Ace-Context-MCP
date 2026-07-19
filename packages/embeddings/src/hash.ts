import type { EmbeddingProvider } from './types.js';

/**
 * Dependency-free, deterministic embeddings via feature hashing.
 * Captures lexical overlap (shared words/bigrams score higher), not deep
 * semantics — but it needs no model, no network, and gives identical vectors
 * for identical text, which keeps tests hermetic and offline use working.
 *
 * ponytail: swap for OllamaEmbeddings (nomic-embed-text) or a cloud embedder
 * when real semantic similarity matters; the EmbeddingProvider interface and
 * per-chunk provider id make that a config change, not a rewrite.
 */
export class HashEmbeddings implements EmbeddingProvider {
  readonly id: string;
  readonly dim: number;

  constructor(dim = 1024) {
    this.dim = dim;
    this.id = `hash-v1-${dim}`;
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((t) => this.embedOne(t)));
  }

  private embedOne(text: string): Float32Array {
    const vec = new Float32Array(this.dim);
    const tokens = tokenize(text);
    // Content words drive matching; stopwords are dropped so shared function
    // words don't create spurious similarity. Bigrams add a little phrase signal.
    const content = tokens.filter((t) => !STOPWORDS.has(t));
    for (let i = 0; i < content.length; i++) {
      addFeature(vec, content[i]!, this.dim);
      if (i + 1 < content.length) addFeature(vec, `${content[i]!}_${content[i + 1]!}`, this.dim);
    }
    normalize(vec);
    return vec;
  }
}

const STOPWORDS = new Set(
  (
    'a an the we i you it to of and or for in on at is are was were be been being do did does done ' +
    'what which that this these those about with as by from our us they them he she his her will would ' +
    'can could should has have had not no but if then so up out get got there here your my me'
  ).split(' '),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function addFeature(vec: Float32Array, feature: string, dim: number): void {
  const h = fnv1a(feature);
  const idx = h % dim;
  const sign = (h & 0x80000000) !== 0 ? -1 : 1;
  vec[idx]! += sign;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalize(vec: Float32Array): void {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) return;
  for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
}
