import { parseThread, type Turn } from './thread.js';

export interface Snippet {
  name: string;
  lang: string;
  content: string;
}

export interface ExtractResult {
  summary: string;
  decisions: string[];
  facts: string[];
  snippets: Snippet[];
}

export interface ExtractInput {
  text?: string;
  thread?: unknown;
}

// No trailing \b — cues like "decision:" end on a non-word char where \b fails.
const DECISION_CUE =
  /\b(we decided|decision:|let'?s (?:go with|use)|we'?ll (?:use|go with)|going with|we chose|chosen|agreed to|settled on|plan is to)/i;

const FENCE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
const BULLET = /^\s*[-*+]\s+(.*\S)\s*$/;

/**
 * Deterministic, dependency-free extraction: decision-cue sentences, bullet-list
 * facts, fenced code snippets, and a summary built from the opening ask.
 *
 * ponytail: heuristic, not an LLM. Swap the decision/fact passes for a model
 * call when recall matters — the ExtractResult shape stays the same, so store,
 * shapes, and search don't change.
 */
export function extract(input: ExtractInput): ExtractResult {
  const turns = parseThread(input);
  const fullText = turns.map((t) => t.content).join('\n');

  return {
    summary: buildSummary(turns),
    decisions: extractDecisions(turns),
    facts: extractFacts(turns),
    snippets: extractSnippets(fullText),
  };
}

function buildSummary(turns: Turn[]): string {
  if (!turns.length) return '';
  const firstAsk = turns.find((t) => isUser(t.role))?.content ?? turns[0]!.content;
  const ask = stripFences(firstAsk).trim().replace(/\s+/g, ' ');
  const head = ask.length > 400 ? `${ask.slice(0, 400)}…` : ask;
  const roles = new Set(turns.map((t) => t.role));
  return `Thread of ${turns.length} turn(s) across ${roles.size} role(s). Opening ask: ${head}`;
}

function extractDecisions(turns: Turn[]): string[] {
  const out: string[] = [];
  for (const t of turns) {
    for (const sentence of sentences(stripFences(t.content))) {
      if (DECISION_CUE.test(sentence)) out.push(sentence.trim());
    }
  }
  return dedup(out);
}

function extractFacts(turns: Turn[]): string[] {
  const out: string[] = [];
  for (const t of turns) {
    for (const line of t.content.split(/\r?\n/)) {
      const m = BULLET.exec(line);
      if (m && m[1]) out.push(m[1].trim());
    }
  }
  return dedup(out);
}

function extractSnippets(text: string): Snippet[] {
  const out: Snippet[] = [];
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  let i = 1;
  while ((m = FENCE.exec(text)) !== null) {
    const lang = (m[1] || 'txt').toLowerCase();
    const content = (m[2] ?? '').replace(/\s+$/, '');
    if (!content.trim()) continue;
    const ord = String(i).padStart(3, '0');
    out.push({ name: `${ord}-snippet.${extForLang(lang)}`, lang, content });
    i++;
  }
  return out;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function stripFences(text: string): string {
  return text.replace(FENCE, ' ');
}

function isUser(role: string): boolean {
  return role === 'user' || role === 'human' || role === 'me';
}

function dedup(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const key = x.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(x);
    }
  }
  return out;
}

export function extForLang(lang: string): string {
  const map: Record<string, string> = {
    typescript: 'ts',
    ts: 'ts',
    javascript: 'js',
    js: 'js',
    python: 'py',
    py: 'py',
    rust: 'rs',
    rs: 'rs',
    go: 'go',
    java: 'java',
    sql: 'sql',
    bash: 'sh',
    sh: 'sh',
    shell: 'sh',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    html: 'html',
    css: 'css',
    txt: 'txt',
  };
  return map[lang] ?? 'txt';
}
