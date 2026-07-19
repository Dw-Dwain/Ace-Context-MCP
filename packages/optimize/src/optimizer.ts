import { HashEmbeddings, cosine, type EmbeddingProvider } from '@ace/embeddings';
import { cleanText } from './clean.js';
import { expand, type ExpansionTemplate } from './expand.js';

export interface OptimizerOptions {
  embedder?: EmbeddingProvider;
  /** Reusable constraint bundle appended to the system prompt. */
  constraints?: string[];
  /** Persona system prompt prepended to the system message. */
  persona?: string;
  /** Minimum cleaned-vs-original similarity to accept cleaning. Default 0.85. */
  railThreshold?: number;
  templates?: ExpansionTemplate[];
  enableClean?: boolean;
  enableExpand?: boolean;
}

export interface OptimizeResult {
  text: string;
  system?: string;
  applied: string[];
  rail: { similarity: number; passed: boolean };
  originalTokens: number;
  optimizedTokens: number;
}

/**
 * Turns a weak prompt into a stronger one without changing intent.
 * Cleaning is guarded by a similarity rail (revert if it drifts); expansion,
 * constraints, and persona are additive and logged. The rail is the structural
 * defense against a "prompt compiler" silently distorting the ask.
 */
export class Optimizer {
  private embedder: EmbeddingProvider;
  private constraints: string[];
  private persona: string | undefined;
  private railThreshold: number;
  private templates: ExpansionTemplate[] | undefined;
  private enableClean: boolean;
  private enableExpand: boolean;

  constructor(opts: OptimizerOptions = {}) {
    this.embedder = opts.embedder ?? new HashEmbeddings();
    this.constraints = opts.constraints ?? [];
    this.persona = opts.persona;
    this.railThreshold = opts.railThreshold ?? 0.85;
    this.templates = opts.templates;
    this.enableClean = opts.enableClean ?? true;
    this.enableExpand = opts.enableExpand ?? true;
  }

  async optimize(userText: string): Promise<OptimizeResult> {
    const applied: string[] = [];
    let rail = { similarity: 1, passed: true };
    let core = userText;

    if (this.enableClean) {
      const cleaned = cleanText(userText);
      if (cleaned !== userText) {
        const [ov, cv] = await this.embedder.embed([userText, cleaned]);
        const similarity = cosine(ov!, cv!);
        const passed = similarity >= this.railThreshold;
        rail = { similarity, passed };
        if (passed) {
          core = cleaned;
          applied.push('clean');
        } else {
          applied.push('clean-reverted');
        }
      }
    }

    let text = core;
    if (this.enableExpand) {
      const ex = expand(core, this.templates);
      if (ex.applied) {
        text = ex.text;
        applied.push(`expand:${ex.applied}`);
      }
    }

    const systemParts: string[] = [];
    if (this.persona) {
      systemParts.push(this.persona);
      applied.push('persona');
    }
    if (this.constraints.length) {
      systemParts.push(`Constraints: ${this.constraints.join(' ')}`);
      applied.push('constraints');
    }

    const result: OptimizeResult = {
      text,
      applied,
      rail,
      originalTokens: estimateTokens(userText),
      optimizedTokens: estimateTokens(text),
    };
    if (systemParts.length) result.system = systemParts.join('\n\n');
    return result;
  }
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
