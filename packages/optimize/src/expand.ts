export interface ExpansionTemplate {
  id: string;
  when: (text: string) => boolean;
  append: string;
}

// Rule-based expansions keyed by cheap text matching. Additive and logged —
// never rail-gated, because they intentionally add scope rather than change it.
// ponytail: grow this into a template library keyed by the intent classifier.
export const DEFAULT_TEMPLATES: ExpansionTemplate[] = [
  {
    id: 'review-code',
    when: (t) => /\breview\b/i.test(t) && /\b(code|function|pr|diff|implementation)\b/i.test(t),
    append:
      'Cover correctness, security, performance, maintainability, readability, edge cases, potential bugs, and suggested fixes.',
  },
  {
    id: 'debug',
    when: (t) => /\b(debug|fix|why (is|isn'?t|does))\b/i.test(t),
    append: 'State the most likely root cause, how to confirm it, and the minimal fix.',
  },
];

/** Append at most one matching template. Only fires on short prompts that don't
 *  already contain the guidance, so we never bloat an already-detailed ask. */
export function expand(text: string, templates: ExpansionTemplate[] = DEFAULT_TEMPLATES): {
  text: string;
  applied: string | null;
} {
  if (text.length > 400) return { text, applied: null };
  for (const t of templates) {
    if (t.when(text) && !alreadyCovered(text, t.append)) {
      return { text: `${text}\n\n${t.append}`, applied: t.id };
    }
  }
  return { text, applied: null };
}

function alreadyCovered(text: string, append: string): boolean {
  const keywords = append
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 5);
  const lower = text.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k)).length;
  return hits >= Math.ceil(keywords.length / 2);
}
