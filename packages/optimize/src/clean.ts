// Filler words that add nothing to intent. Conservative list — words that
// could carry meaning ("maybe", "should") are deliberately excluded.
const FILLER = /\b(just|really|basically|actually|simply|kinda|sorta)\b/gi;

/** Deterministic cleaning: strip filler, collapse whitespace, drop consecutive
 *  duplicate sentences. Meaning-preserving by construction (the safety rail
 *  double-checks). No LLM. */
export function cleanText(text: string): string {
  let out = text.replace(FILLER, ' ');
  out = out.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  out = dedupeSentences(out);
  return out;
}

function dedupeSentences(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(p);
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}
