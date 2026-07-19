import { estimateTokens } from './tokens.js';

export interface Chunk {
  section: string;
  ord: number;
  content: string;
  tokens: number;
}

/** Split text into ~maxChars windows on paragraph boundaries. A paragraph
 *  larger than maxChars is hard-split. Empty input yields no chunks. */
export function chunkText(section: string, text: string, maxChars = 800): Chunk[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: string[] = [];
  let buf = '';
  for (const para of paras) {
    if (para.length > maxChars) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      for (let i = 0; i < para.length; i += maxChars) out.push(para.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + para.length + 2 > maxChars) {
      out.push(buf);
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf) out.push(buf);

  return out.map((content, ord) => ({ section, ord, content, tokens: estimateTokens(content) }));
}
