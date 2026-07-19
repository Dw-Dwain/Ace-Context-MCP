import type { CacheBackend, CacheEntry } from './types.js';

/** In-memory cache backend. Exact lookups by key; semantic scan over all
 *  entries. ponytail: add a Redis (exact) + pgvector (semantic) backend for
 *  multi-process / persistent deployments — same CacheBackend interface. */
export class MemoryCacheBackend implements CacheBackend {
  private map = new Map<string, CacheEntry>();

  getExact(key: string): CacheEntry | undefined {
    return this.map.get(key);
  }

  put(entry: CacheEntry): void {
    this.map.set(entry.key, entry);
  }

  candidates(): Iterable<CacheEntry> {
    return this.map.values();
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
