import type { EmbeddingProvider } from './types.js';

export interface LocalOptions {
  model?: string;
}

/**
 * Real semantic embeddings, in-process, no server: all-MiniLM-L6-v2 via
 * transformers.js. The dependency is OPTIONAL and imported lazily — if it
 * isn't installed, `available()` returns false and callers fall back. The
 * model downloads once on first use, then runs fully offline.
 *
 * Enable with:  pnpm add @huggingface/transformers
 */
export class LocalEmbeddings implements EmbeddingProvider {
  readonly id: string;
  readonly dim = 384;
  private model: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private failed = false;

  constructor(opts: LocalOptions = {}) {
    this.model = opts.model ?? 'Xenova/all-MiniLM-L6-v2';
    this.id = `local:${this.model}`;
  }

  /** Cheap check that the optional dep is installed — does NOT load or
   *  download the model. The (potentially multi-minute) first-run download is
   *  deferred to the first embed() call, so startup selection stays fast. */
  async available(): Promise<boolean> {
    if (this.failed) return false;
    if (this.pipe) return true;
    try {
      const pkg = '@huggingface/transformers';
      await import(pkg);
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  private async load(): Promise<void> {
    if (this.pipe) return;
    // Non-literal specifier so TypeScript doesn't statically require the
    // optional dependency at build time.
    const pkg = '@huggingface/transformers';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(pkg);
    this.pipe = await mod.pipeline('feature-extraction', this.model, { quantized: true });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.load();
    const out: Float32Array[] = [];
    for (const t of texts) {
      const res = await this.pipe(t, { pooling: 'mean', normalize: true });
      out.push(Float32Array.from(res.data as ArrayLike<number>));
    }
    return out;
  }
}
