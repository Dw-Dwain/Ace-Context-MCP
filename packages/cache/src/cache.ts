import { createHash } from 'node:crypto';
import { HashEmbeddings, cosine, type EmbeddingProvider } from '@ace/embeddings';
import { MemoryCacheBackend } from './backend.js';
import { classifyIntent, type Intent } from './intent.js';
import type {
  CacheBackend,
  CacheDecision,
  CacheEntry,
  CacheQuery,
  CacheScores,
  CachedResponse,
} from './types.js';

export interface CacheWeights {
  semantic: number;
  intent: number;
  context: number;
  safety: number;
}

export interface CacheOptions {
  embedder?: EmbeddingProvider;
  backend?: CacheBackend;
  weights?: CacheWeights;
  /** Minimum reuse confidence for a semantic hit. Default 0.85. */
  threshold?: number;
  /** Minimum cosine to even consider a candidate. Default 0.6. */
  semanticFloor?: number;
  /** Override intent classification (e.g. an LLM-backed classifier). Default:
   *  the heuristic classifyIntent. May be sync or async. */
  intentClassifier?: (text: string) => Intent | Promise<Intent>;
}

const DEFAULT_WEIGHTS: CacheWeights = { semantic: 0.4, intent: 0.3, context: 0.2, safety: 0.1 };

/**
 * Multi-stage cache decision engine. Exact hash first; on miss, semantic
 * search + an explainable confidence score (semantic × intent × context ×
 * safety) gates reuse. Every decision carries its scores so the trace can
 * show WHY a request hit or missed — no hidden math.
 */
export class Cache {
  private embedder: EmbeddingProvider;
  private backend: CacheBackend;
  private weights: CacheWeights;
  private threshold: number;
  private semanticFloor: number;
  private classify: (text: string) => Intent | Promise<Intent>;

  constructor(opts: CacheOptions = {}) {
    this.embedder = opts.embedder ?? new HashEmbeddings();
    this.backend = opts.backend ?? new MemoryCacheBackend();
    this.weights = opts.weights ?? DEFAULT_WEIGHTS;
    this.threshold = opts.threshold ?? 0.85;
    this.semanticFloor = opts.semanticFloor ?? 0.6;
    this.classify = opts.intentClassifier ?? classifyIntent;
  }

  async decide(query: CacheQuery): Promise<CacheDecision> {
    const exactKey = this.exactKey(query);
    const exact = this.backend.getExact(exactKey);
    if (exact) {
      exact.reuseCount++;
      return {
        hit: true,
        reason: 'exact',
        response: exact.response,
        matchedKey: exact.key,
        scores: { semantic: 1, intent: 1, context: 1, safety: 1, confidence: 1 },
      };
    }

    const queryText = this.queryText(query);
    const intent = await this.classify(queryText);
    const contextFp = this.contextFingerprint(query);
    const [vec] = await this.embedder.embed([queryText]);

    let best: { entry: CacheEntry; scores: CacheScores } | null = null;
    for (const entry of this.backend.candidates()) {
      if (entry.provider !== this.embedder.id || !entry.vector) continue;
      const semantic = cosine(vec!, Float32Array.from(entry.vector));
      if (semantic < this.semanticFloor) continue;
      const scores = this.score(semantic, intent, contextFp, entry);
      if (!best || scores.confidence > best.scores.confidence) best = { entry, scores };
    }

    if (!best) return { hit: false, reason: 'miss-no-candidate' };
    if (best.scores.confidence < this.threshold) {
      return { hit: false, reason: 'miss-low-confidence', scores: best.scores, matchedKey: best.entry.key };
    }
    best.entry.reuseCount++;
    return {
      hit: true,
      reason: 'semantic',
      response: best.entry.response,
      scores: best.scores,
      matchedKey: best.entry.key,
    };
  }

  async store(query: CacheQuery, response: CachedResponse): Promise<void> {
    const queryText = this.queryText(query);
    const [vec] = await this.embedder.embed([queryText]);
    const entry: CacheEntry = {
      key: this.exactKey(query),
      intent: await this.classify(queryText),
      contextFp: this.contextFingerprint(query),
      provider: this.embedder.id,
      vector: vec ? Array.from(vec) : null,
      response,
      createdAt: 0, // ponytail: Date.now() unavailable in some harnesses; stamp externally if needed
      reuseCount: 0,
    };
    this.backend.put(entry);
  }

  size(): number {
    return this.backend.size();
  }

  clear(): void {
    this.backend.clear();
  }

  private score(semantic: number, intent: Intent, contextFp: string, entry: CacheEntry): CacheScores {
    const intentMatch = entry.intent === intent ? 1 : 0;
    const contextMatch = entry.contextFp === contextFp ? 1 : 0.3;
    const safety = 1; // ponytail: real post-cache safety re-check lands with @ace/security (M11)
    const w = this.weights;
    const confidence =
      w.semantic * semantic + w.intent * intentMatch + w.context * contextMatch + w.safety * safety;
    return { semantic, intent: intentMatch, context: contextMatch, safety, confidence };
  }

  private exactKey(query: CacheQuery): string {
    const norm = query.messages.map((m) => `${m.role}:${m.content.trim()}`).join('\n');
    return createHash('sha256').update(`${query.model}\n${norm}`).digest('hex');
  }

  private queryText(query: CacheQuery): string {
    const users = query.messages.filter((m) => m.role === 'user');
    const last = users[users.length - 1];
    return (last ?? query.messages[query.messages.length - 1])?.content ?? '';
  }

  private contextFingerprint(query: CacheQuery): string {
    const system = query.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content.trim())
      .join('\n');
    return createHash('sha256').update(system).digest('hex').slice(0, 16);
  }
}
