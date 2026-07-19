// Live demo: a real prompt to real Claude through the full ACE pipeline.
// Requires ANTHROPIC_API_KEY in your environment. Uses Haiku by default.
//   $env:ANTHROPIC_API_KEY="sk-ant-..."   # PowerShell
//   pnpm demo:live
import { Engine } from '@ace/core';
import { AnthropicProvider, type StreamChunk } from '@ace/router';
import { createChatPipeline } from '@ace/pipeline';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

if (!process.env.ANTHROPIC_API_KEY) {
  line('ANTHROPIC_API_KEY not set — cannot run the live demo.');
  line('Set it and re-run:  $env:ANTHROPIC_API_KEY="sk-ant-..."; pnpm demo:live');
  process.exit(0);
}

const model = process.env.ACE_LIVE_MODEL ?? 'claude-haiku-4-5-20251001';
const { engine } = createChatPipeline({ providers: [new AnthropicProvider()] });

line(`model: ${model}\n`);
rule();
line('CHAT  (full pipeline: observe → normalize → validate → cache → router → Claude)');
rule();
const res = await engine.chat({
  model,
  maxTokens: 200,
  messages: [{ role: 'user', content: 'In one sentence, what is a semantic cache?' }],
});
const r = res.response as {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};
line(`answer: ${r.content}`);
line(`model:  ${r.model}`);
line(`usage:  in=${r.usage.inputTokens} out=${r.usage.outputTokens}`);
line('');
rule();
line('STREAM  (same pipeline, stream:true)');
rule();
process.stdout.write('  ');
const streamed = await engine.chat({
  model,
  stream: true,
  maxTokens: 120,
  messages: [{ role: 'user', content: 'Name three uses for a persistent context store, as a short list.' }],
});
for await (const c of streamed.response as AsyncIterable<StreamChunk>) process.stdout.write(c.delta);
line('\n');
void Engine;
