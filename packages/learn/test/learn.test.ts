import { describe, it, expect } from 'vitest';
import { Engine } from '@ace/core';
import { Learner, evaluateTrace, type Signal } from '../src/index.js';

describe('Learner scoring', () => {
  it('accumulates weighted signal scores', () => {
    const l = new Learner();
    l.recordAll([
      { target: 'response', targetId: 'r1', kind: 'thumbs_up' },
      { target: 'response', targetId: 'r1', kind: 'reused' },
      { target: 'response', targetId: 'r2', kind: 'thumbs_down' },
    ]);
    expect(l.score('r1')).toBeCloseTo(1.5);
    expect(l.score('r2')).toBeCloseTo(-1);
  });

  it('ranks and picks the best candidate', () => {
    const l = new Learner();
    l.recordAll([
      { target: 'response', targetId: 'a', kind: 'edit' },
      { target: 'response', targetId: 'b', kind: 'thumbs_up' },
      { target: 'response', targetId: 'b', kind: 'accept' },
    ]);
    expect(l.rank(['a', 'b']).map((r) => r.id)).toEqual(['b', 'a']);
    expect(l.bestOf(['a', 'b'])).toBe('b');
  });
});

describe('cache threshold tuning', () => {
  it('holds steady below the minimum sample', () => {
    const l = new Learner();
    l.record({ target: 'cache', targetId: 'c', kind: 'reused' });
    expect(l.tuneCacheThreshold(0.85)).toBe(0.85);
  });

  it('raises the threshold when hits get corrected too often', () => {
    const l = new Learner();
    for (let i = 0; i < 8; i++) l.record({ target: 'cache', targetId: 'c', kind: 'reused' });
    for (let i = 0; i < 4; i++) l.record({ target: 'cache', targetId: 'c', kind: 'corrected' });
    expect(l.tuneCacheThreshold(0.85)).toBeGreaterThan(0.85);
  });

  it('lowers the threshold when hits are almost never corrected', () => {
    const l = new Learner();
    for (let i = 0; i < 20; i++) l.record({ target: 'cache', targetId: 'c', kind: 'reused' });
    expect(l.tuneCacheThreshold(0.85)).toBeLessThan(0.85);
  });

  it('clamps to [0.5, 0.99]', () => {
    const l = new Learner();
    for (let i = 0; i < 20; i++) l.record({ target: 'cache', targetId: 'c', kind: 'reused' });
    expect(l.tuneCacheThreshold(0.5)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('evaluateTrace', () => {
  it('summarizes a run into a flat metrics record', async () => {
    const eng = new Engine().use({
      name: 'stub',
      before: (ctx) => {
        ctx.response = { ok: true };
      },
    });
    const result = await eng.run({ kind: 'list', input: {} });
    const rec = evaluateTrace(result);
    expect(rec.op).toBe('list');
    expect(rec.stages).toBeGreaterThan(0);
    expect(rec.cacheHit).toBe(false);
    expect(rec.errored).toBe(false);
  });
});
