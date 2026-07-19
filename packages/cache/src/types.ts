import type { Intent } from './intent.js';

export interface CacheMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CacheQuery {
  model: string;
  messages: CacheMessage[];
}

export interface CachedResponse {
  content: string;
  model: string;
  provider: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface CacheEntry {
  key: string;
  intent: Intent;
  contextFp: string;
  provider: string;
  vector: number[] | null;
  response: CachedResponse;
  createdAt: number;
  reuseCount: number;
}

export interface CacheScores {
  semantic: number;
  intent: number;
  context: number;
  safety: number;
  confidence: number;
}

export interface CacheDecision {
  hit: boolean;
  reason: 'exact' | 'semantic' | 'miss-no-candidate' | 'miss-low-confidence' | 'disabled';
  response?: CachedResponse;
  scores?: CacheScores;
  matchedKey?: string;
}

export interface CacheBackend {
  getExact(key: string): CacheEntry | undefined;
  put(entry: CacheEntry): void;
  candidates(): Iterable<CacheEntry>;
  size(): number;
  clear(): void;
}
