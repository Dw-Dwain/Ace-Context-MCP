export type SignalKind =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'accept'
  | 'reused'
  | 'ignore'
  | 'retry'
  | 'edit'
  | 'corrected';

export type SignalTarget = 'response' | 'context' | 'cache';

export interface Signal {
  target: SignalTarget;
  targetId: string;
  kind: SignalKind;
}

const WEIGHTS: Record<SignalKind, number> = {
  thumbs_up: 1,
  accept: 0.5,
  reused: 0.5,
  ignore: 0,
  retry: -0.5,
  edit: -0.3,
  thumbs_down: -1,
  corrected: -1,
};

/**
 * Learns from feedback signals to tune middleware decisions — never the model.
 * Produces quality scores (to promote better responses / contexts) and nudges
 * the cache confidence threshold based on how often cache hits get corrected.
 * Deterministic and auditable: same signals in, same adjustments out.
 */
export class Learner {
  private signals: Signal[] = [];

  record(signal: Signal): void {
    this.signals.push(signal);
  }

  recordAll(signals: Signal[]): void {
    for (const s of signals) this.record(s);
  }

  /** Weighted quality score for a target id (sum of signal weights). */
  score(targetId: string): number {
    return this.signals
      .filter((s) => s.targetId === targetId)
      .reduce((n, s) => n + WEIGHTS[s.kind], 0);
  }

  /** Rank candidate ids best-first by score. Ties keep input order (stable). */
  rank(ids: string[]): Array<{ id: string; score: number }> {
    return ids
      .map((id, i) => ({ id, score: this.score(id), i }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map(({ id, score }) => ({ id, score }));
  }

  /** Pick the highest-scoring candidate (the one to promote / not supersede). */
  bestOf(ids: string[]): string | null {
    const ranked = this.rank(ids);
    return ranked.length ? ranked[0]!.id : null;
  }

  /**
   * Nudge the cache confidence threshold from observed hit quality.
   * Too many corrected hits → raise (be stricter). Almost none → lower (cache
   * more aggressively). Needs a minimum sample before moving. Clamped [0.5, 0.99].
   */
  tuneCacheThreshold(current: number, step = 0.02, minSample = 5): number {
    const hits = this.signals.filter((s) => s.target === 'cache' && (s.kind === 'reused' || s.kind === 'corrected'));
    if (hits.length < minSample) return current;
    const corrected = hits.filter((s) => s.kind === 'corrected').length;
    const badRate = corrected / hits.length;
    if (badRate > 0.15) return clamp(current + step);
    if (badRate < 0.05) return clamp(current - step);
    return current;
  }

  count(): number {
    return this.signals.length;
  }
}

function clamp(x: number): number {
  return Math.min(0.99, Math.max(0.5, Number(x.toFixed(4))));
}
