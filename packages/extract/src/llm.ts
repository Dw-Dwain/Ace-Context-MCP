import { extract, type ExtractInput, type ExtractResult, type Snippet } from './extract.js';

/** Minimal LLM interface — structurally satisfied by router's asLlmClient().
 *  Kept here so @ace/extract stays free of any provider dependency. */
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

const PROMPT = `You extract structured context from a conversation. Return ONLY minified JSON with these keys:
- "summary": one-sentence gist (string)
- "decisions": concluded choices, each a full sentence (string[])
- "facts": durable factual statements (string[])
- "snippets": code blocks, each {"lang": string, "content": string}

No prose, no markdown fences. Conversation:
`;

/**
 * LLM-backed extraction. Produces the same ExtractResult as the heuristic
 * extractor, so it drops into the store with no downstream change. Falls back
 * to the heuristic extractor if the model output can't be parsed — never throws
 * on bad output.
 */
export async function llmExtract(client: LlmClient, input: ExtractInput): Promise<ExtractResult> {
  const text = input.text ?? '';
  const fallback = () => extract(input);
  if (!text.trim() && input.thread === undefined) return fallback();

  let raw: string;
  try {
    raw = await client.complete(PROMPT + text);
  } catch {
    return fallback();
  }

  const parsed = parseJson(raw);
  if (!parsed) return fallback();

  const result: ExtractResult = {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : extract(input).summary,
    decisions: strings(parsed.decisions),
    facts: strings(parsed.facts),
    snippets: snippets(parsed.snippets),
  };
  return result;
}

export class LlmExtractor {
  constructor(private client: LlmClient) {}
  extract(input: ExtractInput): Promise<ExtractResult> {
    return llmExtract(this.client, input);
  }
}

function parseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

function snippets(v: unknown): Snippet[] {
  if (!Array.isArray(v)) return [];
  const out: Snippet[] = [];
  let i = 1;
  for (const s of v) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const content = typeof o.content === 'string' ? o.content : '';
    if (!content.trim()) continue;
    const lang = typeof o.lang === 'string' && o.lang ? o.lang.toLowerCase() : 'txt';
    out.push({ name: `${String(i).padStart(3, '0')}-snippet.${lang}`, lang, content });
    i++;
  }
  return out;
}
