// Milestone M8 demo: prompt optimization with a rewrite safety rail.
// Shows cleaning (rail-guarded), expansion (additive), and persona/constraint
// injection — each logged so nothing changes the ask silently.
import { Optimizer } from '@ace/optimize';

const line = (s: string) => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(60));

const opt = new Optimizer({
  persona: 'You are a senior security engineer.',
  constraints: ['State assumptions.', 'Do not fabricate facts.'],
});

async function show(label: string, prompt: string) {
  const r = await opt.optimize(prompt);
  rule();
  line(label);
  rule();
  line(`  original:  ${prompt}`);
  line(`  optimized: ${r.text.replace(/\n+/g, ' ⏎ ')}`);
  if (r.system) line(`  system+:   ${r.system.replace(/\n+/g, ' ⏎ ')}`);
  line(`  applied:   ${r.applied.join(', ') || '(none)'}`);
  line(`  rail:      similarity=${r.rail.similarity.toFixed(2)} passed=${r.rail.passed}`);
  line(`  tokens:    ${r.originalTokens} → ${r.optimizedTokens}`);
  line('');
}

await show('1. filler cleaning (rail-guarded)', 'just really simply explain how tokens rotate');
await show('2. expansion (additive)', 'review this code');
await show('3. no-op on a clean short prompt', 'list the open files');
