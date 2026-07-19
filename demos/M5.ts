// Milestone M5 demo: the LLM proxy pipeline. normalize → validate → route a
// chat request through a provider adapter. Uses MockProvider so the demo is
// hermetic; set ANTHROPIC_API_KEY to route to a real Claude model instead.
import { Engine } from '@ace/core';
import {
  Router,
  MockProvider,
  AnthropicProvider,
  normalizeChatMiddleware,
  validateChatMiddleware,
  routerMiddleware,
  type Provider,
  type ProviderResponse,
} from '@ace/router';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

// Prefer a real Anthropic provider when a key is present; else deterministic mock.
let providers: Provider[];
let usingReal = false;
if (process.env.ANTHROPIC_API_KEY) {
  providers = [new AnthropicProvider(), new MockProvider()];
  usingReal = true;
} else {
  providers = [new MockProvider({ id: 'anthropic' }), new MockProvider()];
}

const router = new Router({
  providers,
  rules: [{ when: (m) => m === 'auto' || m.startsWith('claude'), use: 'anthropic', fallbacks: ['mock'] }],
  fallback: 'mock',
});

const engine = new Engine()
  .use(normalizeChatMiddleware())
  .use(validateChatMiddleware())
  .use(routerMiddleware(router));

line(`provider: ${usingReal ? 'AnthropicProvider (real) with mock fallback' : 'MockProvider (no ANTHROPIC_API_KEY)'}\n`);

rule();
line('CHAT  model=auto');
rule();
const res = await engine.chat({
  messages: [
    { role: 'system', content: 'You are a terse assistant.' },
    { role: 'user', content: 'In one sentence, what is a semantic cache?' },
  ],
  model: 'auto',
  maxTokens: 128,
});

const payload = res.response as ProviderResponse;
line(`response: ${payload.content}`);
line(`model:    ${payload.model}`);
line(`usage:    in=${payload.usage.inputTokens} out=${payload.usage.outputTokens}`);
line('');
rule();
line('TRACE');
rule();
for (const t of res.trace) {
  line(`  ${t.stage}:${t.phase}  ${t.durationMs.toFixed(1)}ms  ${t.decision ? JSON.stringify(t.decision) : ''}`);
}
