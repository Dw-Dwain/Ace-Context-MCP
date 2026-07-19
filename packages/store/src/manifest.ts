import { readFile } from 'node:fs/promises';
import { atomicWrite } from './atomic.js';
import { manifestPath } from './layout.js';
import type { StoreConfig } from './config.js';

export interface Manifest {
  slug: string;
  tags: string[];
  sourceKind: 'chat' | 'file' | 'url' | 'text' | 'mixed';
  createdAt: number;
  updatedAt: number;
  version: number;
  ttlDays: number | null;
  tokens: {
    summary: number;
    working: number;
    full: number;
  };
  sections: {
    summary: boolean;
    decisions: boolean;
    facts: boolean;
    snippets: string[];
    files: string[];
    refs: boolean;
    raw: boolean;
  };
}

export function newManifest(slug: string, sourceKind: Manifest['sourceKind']): Manifest {
  const now = Date.now();
  return {
    slug,
    tags: [],
    sourceKind,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ttlDays: null,
    tokens: { summary: 0, working: 0, full: 0 },
    sections: {
      summary: false,
      decisions: false,
      facts: false,
      snippets: [],
      files: [],
      refs: false,
      raw: false,
    },
  };
}

export async function readManifest(cfg: StoreConfig, slug: string): Promise<Manifest | null> {
  try {
    const raw = await readFile(manifestPath(cfg, slug), 'utf8');
    return JSON.parse(raw) as Manifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeManifest(cfg: StoreConfig, m: Manifest): Promise<void> {
  await atomicWrite(manifestPath(cfg, m.slug), JSON.stringify(m, null, 2));
}
