import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Manifest } from './manifest.js';

export interface IndexRow {
  slug: string;
  tags: string[];
  sourceKind: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  ttlDays: number | null;
  tokensSummary: number;
  tokensWorking: number;
  tokensFull: number;
}

export class MetaIndex {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        slug TEXT PRIMARY KEY,
        tags TEXT NOT NULL DEFAULT '[]',
        source_kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL,
        ttl_days INTEGER,
        tokens_summary INTEGER NOT NULL DEFAULT 0,
        tokens_working INTEGER NOT NULL DEFAULT 0,
        tokens_full INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS ix_contexts_prefix ON contexts(slug);
      CREATE INDEX IF NOT EXISTS ix_contexts_updated ON contexts(updated_at DESC);
    `);
  }

  upsert(m: Manifest): void {
    this.db
      .prepare(
        `INSERT INTO contexts
         (slug, tags, source_kind, created_at, updated_at, version, ttl_days,
          tokens_summary, tokens_working, tokens_full)
         VALUES (@slug, @tags, @sk, @ca, @ua, @v, @ttl, @ts, @tw, @tf)
         ON CONFLICT(slug) DO UPDATE SET
           tags=excluded.tags,
           source_kind=excluded.source_kind,
           updated_at=excluded.updated_at,
           version=excluded.version,
           ttl_days=excluded.ttl_days,
           tokens_summary=excluded.tokens_summary,
           tokens_working=excluded.tokens_working,
           tokens_full=excluded.tokens_full`,
      )
      .run({
        slug: m.slug,
        tags: JSON.stringify(m.tags),
        sk: m.sourceKind,
        ca: m.createdAt,
        ua: m.updatedAt,
        v: m.version,
        ttl: m.ttlDays,
        ts: m.tokens.summary,
        tw: m.tokens.working,
        tf: m.tokens.full,
      });
  }

  delete(slug: string): void {
    this.db.prepare('DELETE FROM contexts WHERE slug = ?').run(slug);
  }

  list(opts: { prefix?: string; tag?: string; limit?: number } = {}): IndexRow[] {
    const { prefix, tag, limit = 100 } = opts;
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (prefix) {
      clauses.push('slug LIKE @prefix');
      params.prefix = `${prefix}%`;
    }
    if (tag) {
      clauses.push(`EXISTS (SELECT 1 FROM json_each(tags) WHERE value = @tag)`);
      params.tag = tag;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT slug, tags, source_kind, created_at, updated_at, version, ttl_days,
                tokens_summary, tokens_working, tokens_full
         FROM contexts ${where}
         ORDER BY updated_at DESC
         LIMIT @limit`,
      )
      .all(params) as Array<{
      slug: string;
      tags: string;
      source_kind: string;
      created_at: number;
      updated_at: number;
      version: number;
      ttl_days: number | null;
      tokens_summary: number;
      tokens_working: number;
      tokens_full: number;
    }>;
    return rows.map((r) => ({
      slug: r.slug,
      tags: JSON.parse(r.tags) as string[],
      sourceKind: r.source_kind,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version,
      ttlDays: r.ttl_days,
      tokensSummary: r.tokens_summary,
      tokensWorking: r.tokens_working,
      tokensFull: r.tokens_full,
    }));
  }

  close(): void {
    this.db.close();
  }
}
