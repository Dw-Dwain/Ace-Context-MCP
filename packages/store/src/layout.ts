import { join, normalize, sep } from 'node:path';
import type { StoreConfig } from './config.js';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;

export function assertValidSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `invalid slug "${slug}" — must be lowercase [a-z0-9_-] segments joined by "/"`,
    );
  }
}

export function contextDir(cfg: StoreConfig, slug: string): string {
  assertValidSlug(slug);
  const target = normalize(join(cfg.contextsDir, ...slug.split('/')));
  const root = normalize(cfg.contextsDir) + sep;
  if (!target.startsWith(root)) throw new Error(`path escape detected for slug "${slug}"`);
  return target;
}

export function manifestPath(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'manifest.json');
}

export function summaryPath(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'summary.md');
}

export function decisionsPath(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'decisions.md');
}

export function factsPath(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'facts.md');
}

export function snippetsDir(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'snippets');
}

export function filesDir(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'files');
}

export function refsPath(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'refs.json');
}

export function rawDir(cfg: StoreConfig, slug: string): string {
  return join(contextDir(cfg, slug), 'raw');
}
