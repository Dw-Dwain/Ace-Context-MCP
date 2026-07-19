import { readFile, rename, rm, stat, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  ForgetRequest,
  ListRequest,
  LoadRequest,
  SaveRequest,
  Shape,
} from '@ace/core';
import { HashEmbeddings, cosine, type EmbeddingProvider } from '@ace/embeddings';
import { extract } from '@ace/extract';
import { atomicWrite } from './atomic.js';
import { chunkText, type Chunk } from './chunk.js';
import { resolveConfig, type StoreConfig } from './config.js';
import { MetaIndex, type ChunkInsert, type IndexRow } from './index-sqlite.js';
import {
  contextDir,
  decisionsPath,
  factsPath,
  filesDir,
  rawDir,
  refsPath,
  snippetsDir,
  summaryPath,
} from './layout.js';
import {
  newManifest,
  readManifest,
  writeManifest,
  type Manifest,
} from './manifest.js';
import { estimateTokens } from './tokens.js';

export interface StoreOptions {
  home?: string;
  /** Embedding provider for semantic search. Default: deterministic hash
   *  embeddings (offline, hermetic). Pass `false` to skip indexing on save. */
  embeddings?: EmbeddingProvider | false;
}

export interface SearchRequestFull {
  query: string;
  scope?: string;
  topK?: number;
  budgetTokens?: number;
}

export interface SearchHit {
  slug: string;
  section: string;
  snippet: string;
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  provider: string;
  scanned: number;
  skipped: number;
}

export interface SaveResult {
  slug: string;
  version: number;
  tokens: Manifest['tokens'];
}

export interface LoadResult {
  slug: string;
  shape: Shape;
  markdown: string;
  tokens: number;
  updatedAt: number;
  dropped: string[];
}

export interface ListResult {
  contexts: IndexRow[];
}

export interface ForgetResult {
  slug: string;
  moved: string | null;
}

export class Store {
  readonly cfg: StoreConfig;
  private index: MetaIndex | null = null;
  private embedder: EmbeddingProvider | null;
  private readonly indexingEnabled: boolean;

  constructor(opts: StoreOptions = {}) {
    this.cfg = opts.home !== undefined ? resolveConfig(opts.home) : resolveConfig();
    this.indexingEnabled = opts.embeddings !== false;
    this.embedder = opts.embeddings || null;
  }

  private getIndex(): MetaIndex {
    if (!this.index) this.index = new MetaIndex(this.cfg.indexPath);
    return this.index;
  }

  private getEmbedder(): EmbeddingProvider {
    if (!this.embedder) this.embedder = new HashEmbeddings();
    return this.embedder;
  }

  close(): void {
    this.index?.close();
    this.index = null;
  }

  async save(req: SaveRequest): Promise<SaveResult> {
    const existing = await readManifest(this.cfg, req.slug);
    const manifest = existing ?? newManifest(req.slug, inferSourceKind(req));
    if (existing) manifest.version += 1;

    if (req.hints?.tags) manifest.tags = uniq([...manifest.tags, ...req.hints.tags]);
    if (req.hints?.ttlDays !== undefined) manifest.ttlDays = req.hints.ttlDays;

    const text = req.source.text ?? '';
    const hasSource = Boolean(text || req.source.thread);
    let summaryTokens = 0;
    let workingTokens = 0;
    let fullTokens = 0;
    const chunkSources: Array<{ section: string; text: string }> = [];

    if (hasSource) {
      const want = new Set(req.hints?.extract ?? ['decisions', 'facts', 'snippets']);
      const source: { text?: string; thread?: unknown } = {};
      if (text) source.text = text;
      if (req.source.thread !== undefined) source.thread = req.source.thread;
      const ex = extract(source);

      const summary = ex.summary || firstLines(text, 40);
      await atomicWrite(summaryPath(this.cfg, req.slug), summary);
      manifest.sections.summary = true;
      summaryTokens += estimateTokens(summary);
      chunkSources.push({ section: 'summary', text: summary });

      if (want.has('decisions') && ex.decisions.length) {
        const merged = mergeLines(await readMaybe(decisionsPath(this.cfg, req.slug)), ex.decisions);
        const body = merged.map((d) => `- ${d}`).join('\n');
        await atomicWrite(decisionsPath(this.cfg, req.slug), body);
        manifest.sections.decisions = true;
        summaryTokens += estimateTokens(body);
        chunkSources.push({ section: 'decisions', text: merged.join('\n') });
      }

      if (want.has('facts') && ex.facts.length) {
        const merged = mergeLines(await readMaybe(factsPath(this.cfg, req.slug)), ex.facts);
        const body = merged.map((f) => `- ${f}`).join('\n');
        await atomicWrite(factsPath(this.cfg, req.slug), body);
        manifest.sections.facts = true;
        summaryTokens += estimateTokens(body);
        chunkSources.push({ section: 'facts', text: merged.join('\n') });
      }

      if (want.has('snippets') && ex.snippets.length) {
        const names: string[] = [];
        for (const s of ex.snippets) {
          await atomicWrite(join(snippetsDir(this.cfg, req.slug), s.name), s.content);
          names.push(s.name);
          workingTokens += estimateTokens(s.content);
          chunkSources.push({ section: `snippet:${s.name}`, text: s.content });
        }
        manifest.sections.snippets = names;
      }

      if (text && req.hints?.keepRaw !== false) {
        await atomicWrite(join(rawDir(this.cfg, req.slug), 'thread.md'), text);
        manifest.sections.raw = true;
        fullTokens += estimateTokens(text);
      }
    }

    if (req.source.files?.length) {
      const kept: string[] = [];
      for (const f of req.source.files) {
        const name = basename(f.path).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
        await atomicWrite(join(filesDir(this.cfg, req.slug), name), f.content);
        kept.push(name);
        workingTokens += estimateTokens(f.content);
        chunkSources.push({ section: `file:${name}`, text: f.content });
      }
      manifest.sections.files = uniq([...manifest.sections.files, ...kept]);
    }

    if (req.source.urls?.length) {
      const now = Date.now();
      const refs = req.source.urls.map((u) => ({ url: u, fetchedAt: now }));
      await atomicWrite(refsPath(this.cfg, req.slug), JSON.stringify(refs, null, 2));
      manifest.sections.refs = true;
    }

    manifest.tokens.summary = summaryTokens;
    manifest.tokens.working = summaryTokens + workingTokens;
    manifest.tokens.full = summaryTokens + workingTokens + fullTokens;
    manifest.updatedAt = Date.now();

    await writeManifest(this.cfg, manifest);
    this.getIndex().upsert(manifest);
    await this.indexChunks(req.slug, chunkSources);

    return { slug: manifest.slug, version: manifest.version, tokens: manifest.tokens };
  }

  private async indexChunks(
    slug: string,
    sources: Array<{ section: string; text: string }>,
  ): Promise<void> {
    if (!this.indexingEnabled) return;
    const chunks: Chunk[] = [];
    for (const s of sources) chunks.push(...chunkText(s.section, s.text));
    if (!chunks.length) {
      this.getIndex().replaceChunks(slug, []);
      return;
    }
    const embedder = this.getEmbedder();
    const vectors = await embedder.embed(chunks.map((c) => c.content));
    const rows: ChunkInsert[] = chunks.map((c, i) => ({
      section: c.section,
      ord: c.ord,
      content: c.content,
      tokens: c.tokens,
      provider: embedder.id,
      dim: embedder.dim,
      embedding: f32ToBuffer(vectors[i]!),
    }));
    this.getIndex().replaceChunks(slug, rows);
  }

  async search(req: SearchRequestFull): Promise<SearchResult> {
    const embedder = this.getEmbedder();
    const [queryVec] = await embedder.embed([req.query]);
    const rows = this.getIndex().scanChunks(req.scope);

    let skipped = 0;
    const scored: SearchHit[] = [];
    for (const r of rows) {
      if (r.provider !== embedder.id) {
        skipped++;
        continue;
      }
      const vec = bufferToF32(r.embedding);
      scored.push({
        slug: r.slug,
        section: r.section,
        snippet: snippet(r.content),
        score: cosine(queryVec!, vec),
      });
    }
    scored.sort((a, b) => b.score - a.score);

    const topK = req.topK ?? 5;
    const budget = req.budgetTokens;
    const hits: SearchHit[] = [];
    let spent = 0;
    for (const hit of scored) {
      if (hits.length >= topK) break;
      if (budget !== undefined) {
        const cost = estimateTokens(hit.snippet);
        if (spent + cost > budget && hits.length > 0) break;
        spent += cost;
      }
      hits.push(hit);
    }

    return { hits, provider: embedder.id, scanned: rows.length, skipped };
  }

  async load(req: LoadRequest): Promise<LoadResult> {
    const manifest = await readManifest(this.cfg, req.slug);
    if (!manifest) throw Object.assign(new Error(`context not found: ${req.slug}`), { code: 'ENOENT' });

    const shape = pickShape(manifest, req.shape ?? 'summary', req.budgetTokens);
    const dropped: string[] = [];
    const parts: string[] = [];

    parts.push(`# ${manifest.slug}`);
    parts.push(`_updated ${new Date(manifest.updatedAt).toISOString()} · v${manifest.version} · shape=${shape}_`);
    if (manifest.tags.length) parts.push(`_tags: ${manifest.tags.join(', ')}_`);

    if (shape === 'pointer') {
      const markdown = parts.join('\n');
      return {
        slug: manifest.slug,
        shape,
        markdown,
        tokens: estimateTokens(markdown),
        updatedAt: manifest.updatedAt,
        dropped,
      };
    }

    if (manifest.sections.summary) {
      const s = await readFile(summaryPath(this.cfg, manifest.slug), 'utf8');
      parts.push('\n## Summary\n', s);
    }

    if (manifest.sections.decisions) {
      const d = await tryRead(this.cfg, manifest.slug, 'decisions');
      if (d) parts.push('\n## Decisions\n', d);
    }
    if (manifest.sections.facts) {
      const f = await tryRead(this.cfg, manifest.slug, 'facts');
      if (f) parts.push('\n## Facts\n', f);
    }

    if (shape === 'working' || shape === 'full') {
      for (const name of manifest.sections.snippets) {
        const p = join(snippetsDir(this.cfg, manifest.slug), name);
        try {
          const body = await readFile(p, 'utf8');
          parts.push(`\n## Snippet: ${name}\n\n\`\`\`\n${body}\n\`\`\``);
        } catch {
          dropped.push(`snippet:${name}`);
        }
      }
      for (const name of manifest.sections.files) {
        const p = join(filesDir(this.cfg, manifest.slug), name);
        try {
          const body = await readFile(p, 'utf8');
          parts.push(`\n## File: ${name}\n\n\`\`\`\n${body}\n\`\`\``);
        } catch {
          dropped.push(`file:${name}`);
        }
      }
    }

    if (shape === 'full' && manifest.sections.raw) {
      const raw = await readFile(join(rawDir(this.cfg, manifest.slug), 'thread.md'), 'utf8').catch(
        () => '',
      );
      if (raw) parts.push('\n## Raw\n', raw);
    }

    let markdown = parts.join('\n');
    let tokens = estimateTokens(markdown);

    if (req.budgetTokens !== undefined && tokens > req.budgetTokens) {
      const trimmed = trimToBudget(parts, req.budgetTokens, dropped);
      markdown = trimmed.markdown;
      tokens = trimmed.tokens;
    }

    return { slug: manifest.slug, shape, markdown, tokens, updatedAt: manifest.updatedAt, dropped };
  }

  list(req: ListRequest): ListResult {
    const opts: { prefix?: string; tag?: string; limit?: number } = {};
    if (req.prefix !== undefined) opts.prefix = req.prefix;
    if (req.tag !== undefined) opts.tag = req.tag;
    if (req.limit !== undefined) opts.limit = req.limit;
    const contexts = this.getIndex().list(opts);
    return { contexts };
  }

  async forget(req: ForgetRequest): Promise<ForgetResult> {
    const dir = contextDir(this.cfg, req.slug);
    const exists = await stat(dir).catch(() => null);
    if (!exists) return { slug: req.slug, moved: null };

    if (req.purge) {
      await rm(dir, { recursive: true, force: true });
      this.getIndex().delete(req.slug);
      this.getIndex().deleteChunks(req.slug);
      return { slug: req.slug, moved: null };
    }

    const trashName = `${req.slug.replace(/\//g, '__')}-${Date.now()}-${randomBytes(3).toString('hex')}`;
    const trashPath = join(this.cfg.trashDir, trashName);
    await mkdir(this.cfg.trashDir, { recursive: true });
    await rename(dir, trashPath);
    this.getIndex().delete(req.slug);
    this.getIndex().deleteChunks(req.slug);
    return { slug: req.slug, moved: trashPath };
  }

  async rebuildIndex(): Promise<number> {
    const idx = this.getIndex();
    let n = 0;
    for (const slug of await scanSlugs(this.cfg.contextsDir, '')) {
      const m = await readManifest(this.cfg, slug);
      if (m) {
        idx.upsert(m);
        n++;
      }
    }
    return n;
  }
}

async function readMaybe(p: string): Promise<string> {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return '';
  }
}

/** Merge existing bullet lines with new items, case-insensitive dedup, order
 *  preserved (existing first). Used to accumulate decisions/facts across saves. */
function mergeLines(existingBody: string, incoming: string[]): string[] {
  const prev = existingBody
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*+]\s+/, '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...prev, ...incoming]) {
    const key = x.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(x);
    }
  }
  return out;
}

function f32ToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function bufferToF32(b: Buffer): Float32Array {
  // Copy out of the pooled buffer so alignment + lifetime are safe.
  const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Float32Array(copy);
}

function snippet(content: string, max = 240): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function inferSourceKind(req: SaveRequest): Manifest['sourceKind'] {
  const has = {
    text: !!req.source.text,
    files: !!req.source.files?.length,
    urls: !!req.source.urls?.length,
    thread: !!req.source.thread,
  };
  const count = Object.values(has).filter(Boolean).length;
  if (count === 0) return 'text';
  if (count > 1) return 'mixed';
  if (has.thread) return 'chat';
  if (has.files) return 'file';
  if (has.urls) return 'url';
  return 'text';
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function firstLines(text: string, n: number): string {
  return text.split(/\r?\n/).slice(0, n).join('\n').trim();
}

async function tryRead(cfg: StoreConfig, slug: string, kind: 'decisions' | 'facts'): Promise<string | null> {
  const p = kind === 'decisions' ? decisionsPath(cfg, slug) : factsPath(cfg, slug);
  try {
    return await readFile(p, 'utf8');
  } catch {
    return null;
  }
}

function pickShape(m: Manifest, requested: Shape, budget: number | undefined): Shape {
  if (budget === undefined) return requested;
  // ponytail: pointer size is manifest-header only (~40 tokens); always fits any real budget.
  const order: Shape[] = ['full', 'working', 'summary', 'pointer'];
  const cap: Record<Shape, number> = {
    full: m.tokens.full,
    working: m.tokens.working,
    summary: m.tokens.summary,
    pointer: 0,
  };
  const startIdx = Math.max(0, order.indexOf(requested));
  for (let i = startIdx; i < order.length; i++) {
    const s = order[i]!;
    if (cap[s] <= budget) return s;
  }
  return 'pointer';
}

function trimToBudget(
  parts: string[],
  budget: number,
  dropped: string[],
): { markdown: string; tokens: number } {
  // Drop from the end (snippets/files/raw sit after summary/decisions/facts).
  const kept = [...parts];
  while (kept.length > 2) {
    const removed = kept.pop()!;
    const first = removed.split('\n')[0] ?? '';
    dropped.push(first.replace(/^#+\s*/, '').slice(0, 60) || 'section');
    const md = kept.join('\n');
    if (estimateTokens(md) <= budget) return { markdown: md, tokens: estimateTokens(md) };
  }
  const md = kept.join('\n');
  return { markdown: md, tokens: estimateTokens(md) };
}

async function scanSlugs(root: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const child = prefix ? `${prefix}/${e.name}` : e.name;
    const hasManifest = await stat(join(root, child, 'manifest.json')).then(
      () => true,
      () => false,
    );
    if (hasManifest) out.push(child);
    else out.push(...(await scanSlugs(root, child)));
  }
  return out;
}
