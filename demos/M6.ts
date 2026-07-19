// Milestone M6-M7 demo: the cache decision engine. Exact hit, semantic hit,
// and an intent-mismatch miss — each with its explainable score panel.
import { Engine } from '@ace/core';
import { MockProvider, Router, routerMiddleware, normalizeChatMiddleware } from '@ace/router';
import { Cache, cacheMiddleware } from '@ace/cache';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

let providerCalls = 0;
const router = new Router({ providers: [new MockProvider({ reply: () => `LLM answer #${++providerCalls}` })] });
const cache = new Cache({ threshold: 0.7 });

const engine = new Engine()
  .use(normalizeChatMiddleware())
  .use(cacheMiddleware(cache))
  .use(routerMiddleware(router));

const ask = (content: string) => ({ model: 'auto', messages: [{ role: 'user' as const, content }] });

async function run(label: string, content: string) {
  const res = await engine.chat(ask(content));
  const dec = res.trace.find((t) => t.stage === 'cache')?.decision as {
    hit: boolean;
    reason: string;
    scores?: { semantic: number; intent: number; context: number; safety: number; confidence: number };
  };
  rule();
  line(`${label}  "${content}"`);
  rule();
  line(`  response:  ${(res.response as { content: string }).content}`);
  line(`  cache:     ${dec.hit ? 'HIT' : 'MISS'} (${dec.reason})`);
  if (dec.scores) {
    const s = dec.scores;
    line(
      `  scores:    semantic=${s.semantic.toFixed(2)} intent=${s.intent} context=${s.context} safety=${s.safety} → confidence=${s.confidence.toFixed(2)}`,
    );
  }
  line(`  provider calls so far: ${providerCalls}`);
  line('');
}

await run('1. cold      ', 'explain how session tokens expire and rotate on use');
await run('2. exact     ', 'explain how session tokens expire and rotate on use');
await run('3. paraphrase', 'explain how the session tokens expire and rotate when used');
await run('4. new intent', 'debug why session tokens expire and rotate on use');

rule();
line(`Total provider calls: ${providerCalls}  (4 requests, ${4 - providerCalls} served from cache)`);
