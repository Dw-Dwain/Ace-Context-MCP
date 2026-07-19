import { describe, it, expect } from 'vitest';
import { Engine, defineMiddleware, type Middleware, type Operation } from '../src/index.js';

const listOp: Operation = { kind: 'list', input: {} };

describe('Engine', () => {
  it('runs before then after in onion order', async () => {
    const calls: string[] = [];
    const mk = (name: string): Middleware =>
      defineMiddleware({
        name,
        before: () => {
          calls.push(`${name}:before`);
        },
        after: () => {
          calls.push(`${name}:after`);
        },
      });
    const eng = new Engine().use(mk('a')).use(mk('b')).use(mk('c'));
    await eng.run(listOp);
    expect(calls).toEqual([
      'a:before',
      'b:before',
      'c:before',
      'c:after',
      'b:after',
      'a:after',
    ]);
  });

  it('deep-freezes the operation', async () => {
    let caught: unknown;
    const eng = new Engine().use(
      defineMiddleware({
        name: 'mutate',
        before: (ctx) => {
          try {
            (ctx.op as { extra?: string }).extra = 'nope';
          } catch (e) {
            caught = e;
          }
        },
      }),
    );
    await eng.run({ kind: 'list', input: { prefix: 'p/' } });
    expect(caught).toBeInstanceOf(TypeError);
  });

  it('records a trace entry per hook invocation', async () => {
    const eng = new Engine().use(
      defineMiddleware({
        name: 'stage-x',
        before: () => {},
        after: () => {},
      }),
    );
    const res = await eng.run(listOp);
    expect(res.trace).toHaveLength(2);
    expect(res.trace[0]!.stage).toBe('stage-x');
    expect(res.trace[0]!.phase).toBe('before');
    expect(res.trace[1]!.phase).toBe('after');
    expect(typeof res.trace[0]!.durationMs).toBe('number');
  });

  it('filters middleware by appliesTo', async () => {
    const seen: string[] = [];
    const eng = new Engine()
      .use(defineMiddleware({ name: 'all', before: () => void seen.push('all') }))
      .use(
        defineMiddleware({
          name: 'saves-only',
          appliesTo: ['save'],
          before: () => void seen.push('saves-only'),
        }),
      );
    await eng.run(listOp);
    expect(seen).toEqual(['all']);
  });

  it('captures errors in trace and re-throws by default', async () => {
    const eng = new Engine().use(
      defineMiddleware({
        name: 'boom',
        before: () => {
          throw new Error('kaboom');
        },
      }),
    );
    await expect(eng.run(listOp)).rejects.toThrow('kaboom');
  });

  it('swallows errors when fatalOnError=false', async () => {
    const eng = new Engine().use(
      defineMiddleware({
        name: 'soft',
        fatalOnError: false,
        before: () => {
          throw new Error('soft-fail');
        },
      }),
    );
    const res = await eng.run(listOp);
    expect(res.trace[0]!.error?.message).toBe('soft-fail');
  });

  it('rejects duplicate middleware names', () => {
    const eng = new Engine().use(defineMiddleware({ name: 'x' }));
    expect(() => eng.use(defineMiddleware({ name: 'x' }))).toThrow(/duplicate/);
  });

  it('supports insertBefore', async () => {
    const order: string[] = [];
    const eng = new Engine()
      .use(defineMiddleware({ name: 'a', before: () => void order.push('a') }))
      .use(defineMiddleware({ name: 'c', before: () => void order.push('c') }))
      .insertBefore('c', defineMiddleware({ name: 'b', before: () => void order.push('b') }));
    await eng.run(listOp);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('populates response via middleware', async () => {
    const eng = new Engine().use(
      defineMiddleware({
        name: 'dispatch',
        before: (ctx) => {
          ctx.response = { ok: true };
        },
      }),
    );
    const res = await eng.run(listOp);
    expect(res.response).toEqual({ ok: true });
  });
});
