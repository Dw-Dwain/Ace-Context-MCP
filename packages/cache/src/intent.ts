export type Intent =
  | 'Explain'
  | 'Teach'
  | 'Summarize'
  | 'Generate'
  | 'Rewrite'
  | 'Review'
  | 'Debug'
  | 'Translate'
  | 'Compare'
  | 'Extract'
  | 'Plan'
  | 'Analyze'
  | 'Brainstorm'
  | 'Classify';

// Ordered: more specific cues first so "summarize" beats the generic "Generate".
const RULES: Array<{ intent: Intent; cues: RegExp }> = [
  { intent: 'Summarize', cues: /\b(summar(y|ize|ise)|tl;?dr|recap|condense)\b/i },
  { intent: 'Translate', cues: /\b(translate|translation|in (french|spanish|german|japanese|chinese))\b/i },
  { intent: 'Debug', cues: /\b(debug|fix|error|bug|stack ?trace|not working|doesn'?t work|why (is|isn'?t|does))\b/i },
  { intent: 'Review', cues: /\b(review|audit|critique|feedback on|code review)\b/i },
  { intent: 'Rewrite', cues: /\b(rewrite|rephrase|reword|revise|refactor this text|make it (shorter|clearer))\b/i },
  { intent: 'Compare', cues: /\b(compare|versus|\bvs\b|difference between|pros and cons)\b/i },
  { intent: 'Extract', cues: /\b(extract|pull out|list all|find all|enumerate)\b/i },
  { intent: 'Plan', cues: /\b(plan|roadmap|steps to|strategy|how (should|do) (i|we))\b/i },
  { intent: 'Analyze', cues: /\b(analy(ze|se|sis)|evaluate|assess|break down)\b/i },
  { intent: 'Brainstorm', cues: /\b(brainstorm|ideas for|suggestions for|what are some)\b/i },
  { intent: 'Classify', cues: /\b(classif(y|ication)|categor(y|ize|ise)|label (this|these))\b/i },
  { intent: 'Teach', cues: /\b(teach|tutorial|walk me through|learn|lesson on)\b/i },
  { intent: 'Explain', cues: /\b(explain|what (is|are)|how does|why does|describe)\b/i },
  { intent: 'Generate', cues: /\b(generate|write|create|draft|build|implement|make (a|an)|compose)\b/i },
];

/** Heuristic intent classification. Deterministic, offline.
 *  ponytail: swap for a fine-tuned small classifier when volume justifies it. */
export function classifyIntent(text: string): Intent {
  for (const r of RULES) if (r.cues.test(text)) return r.intent;
  return 'Generate';
}
