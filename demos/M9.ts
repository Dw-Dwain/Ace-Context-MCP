// Milestone M9 demo: streaming through the pipeline + the provider lineup.
// Hermetic (MockProvider streams word-by-word). Real providers plug in by
// swapping MockProvider for anthropic()/openai()/openrouter()/ollama()/gemini().
import { Engine } from '@ace/core';
import {
  Router,
  MockProvider,
  normalizeChatMiddleware,
  routerMiddleware,
  openai,
  openrouter,
  ollama,
  gemini,
  type StreamChunk,
} from '@ace/router';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

const router = new Router({
  providers: [new MockProvider({ reply: () => 'Streaming arrives one token at a time through the same pipeline.' })],
});
const engine = new Engine().use(normalizeChatMiddleware()).use(routerMiddleware(router));

rule();
line('Available OpenAI-compatible providers (fetch-based, no SDK):');
rule();
for (const p of [openai(), openrouter(), ollama(), gemini()]) line(`  ${p.id}`);
line('  anthropic (native SDK)');
line('  mock (deterministic)');
line('');

rule();
line('STREAM  engine.chat({ stream: true })');
rule();
const res = await engine.chat({
  model: 'auto',
  stream: true,
  messages: [{ role: 'user', content: 'explain streaming' }],
});

process.stdout.write('  ');
let full = '';
for await (const chunk of res.response as AsyncIterable<StreamChunk>) {
  if (chunk.done) break;
  process.stdout.write(chunk.delta);
  full += chunk.delta;
}
line('\n');
line(`  (${full.length} chars streamed)`);
const routerDecision = res.trace.find((t) => t.stage === 'router')?.decision;
line(`  router decision: ${JSON.stringify(routerDecision)}`);
