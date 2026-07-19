export interface CompressMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompressOptions {
  budgetTokens: number;
  /** Recent turns kept verbatim. Default 4. */
  keepRecent?: number;
}

export interface CompressStats {
  skipped: boolean;
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
  meaningPreservationScore: number;
  deduped: number;
  collapsed: number;
}

export interface CompressResult {
  messages: CompressMessage[];
  stats: CompressStats;
}

/**
 * Deterministic, budget-triggered compression: dedup repeated turns, then
 * collapse the middle of a long conversation into an extractive digest while
 * keeping the system prompt, the opening ask, and the most recent turns.
 * ponytail: swap the extractive digest for an LLM summary when fidelity matters.
 */
export class Compressor {
  compress(messages: CompressMessage[], opts: CompressOptions): CompressResult {
    const keepRecent = opts.keepRecent ?? 4;
    const originalTokens = totalTokens(messages);
    if (originalTokens <= opts.budgetTokens) {
      return {
        messages,
        stats: {
          skipped: true,
          originalTokens,
          compressedTokens: originalTokens,
          ratio: 1,
          meaningPreservationScore: 1,
          deduped: 0,
          collapsed: 0,
        },
      };
    }

    const beforeDedup = messages.length;
    let msgs = dedup(messages);
    const deduped = beforeDedup - msgs.length;

    let collapsed = 0;
    if (totalTokens(msgs) > opts.budgetTokens) {
      const system = msgs.filter((m) => m.role === 'system');
      const rest = msgs.filter((m) => m.role !== 'system');
      if (rest.length > keepRecent + 1) {
        const head = rest[0]!;
        const tail = rest.slice(-keepRecent);
        const middle = rest.slice(1, rest.length - keepRecent);
        collapsed = middle.length;
        const digestBody = middle.map((m) => `${m.role}: ${firstSentence(m.content)}`).join(' ');
        // Bound the digest to whatever budget the kept turns leave, so collapsing
        // always shrinks the payload even with many long middle turns.
        const reservedChars = charLen([...system, head, ...tail]);
        const capChars = Math.max(160, opts.budgetTokens * 4 - reservedChars);
        const prefix = `[prior context digest of ${middle.length} turns] `;
        const digestMsg: CompressMessage = {
          role: 'user',
          content: prefix + truncate(digestBody, capChars),
        };
        msgs = [...system, head, digestMsg, ...tail];
      }
    }

    const compressedTokens = totalTokens(msgs);
    return {
      messages: msgs,
      stats: {
        skipped: false,
        originalTokens,
        compressedTokens,
        ratio: originalTokens ? compressedTokens / originalTokens : 1,
        meaningPreservationScore: jaccard(wordSet(messages), wordSet(msgs)),
        deduped,
        collapsed,
      },
    };
  }
}

function totalTokens(messages: CompressMessage[]): number {
  return messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
}

function dedup(messages: CompressMessage[]): CompressMessage[] {
  const seen = new Set<string>();
  const out: CompressMessage[] = [];
  for (const m of messages) {
    const key = `${m.role}:${m.content.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^(.*?[.!?])(\s|$)/.exec(flat);
  const s = m ? m[1]! : flat;
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function charLen(messages: CompressMessage[]): number {
  return messages.reduce((n, m) => n + m.content.length, 0);
}

function wordSet(messages: CompressMessage[]): Set<string> {
  const s = new Set<string>();
  for (const m of messages) {
    for (const w of m.content.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 3) s.add(w);
    }
  }
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of b) if (a.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 1;
}
