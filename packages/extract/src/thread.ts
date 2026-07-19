export interface Turn {
  role: string;
  content: string;
}

const ROLE_LINE = /^\s*(user|assistant|human|claude|system|ai|me)\s*:\s*(.*)$/i;

/** Parse a thread from either a structured value (array of messages, possibly
 *  in Claude/ChatGPT export shapes) or a plain-text transcript with "Role:"
 *  line prefixes. Falls back to a single user turn when there's no structure. */
export function parseThread(input: { text?: string; thread?: unknown }): Turn[] {
  if (input.thread !== undefined && input.thread !== null) {
    const fromStruct = fromStructured(input.thread);
    if (fromStruct.length) return fromStruct;
  }
  if (input.text) return fromText(input.text);
  return [];
}

function fromStructured(thread: unknown): Turn[] {
  if (!Array.isArray(thread)) return [];
  const out: Turn[] = [];
  for (const raw of thread) {
    if (typeof raw !== 'object' || raw === null) continue;
    const m = raw as Record<string, unknown>;
    const role = String(m.role ?? m.author ?? m.sender ?? 'user');
    const content = coerceContent(m.content ?? m.text ?? m.message ?? '');
    if (content.trim()) out.push({ role, content });
  }
  return out;
}

function coerceContent(content: unknown): string {
  if (typeof content === 'string') return content;
  // Claude/OpenAI content-block arrays: [{type:'text', text:'...'}, ...]
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object') {
          const bb = b as Record<string, unknown>;
          if (typeof bb.text === 'string') return bb.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function fromText(text: string): Turn[] {
  const lines = text.split(/\r?\n/);
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const line of lines) {
    const m = ROLE_LINE.exec(line);
    if (m) {
      if (cur) turns.push(cur);
      cur = { role: m[1]!.toLowerCase(), content: m[2] ?? '' };
    } else if (cur) {
      cur.content += (cur.content ? '\n' : '') + line;
    } else if (line.trim()) {
      cur = { role: 'user', content: line };
    }
  }
  if (cur) turns.push(cur);
  if (!turns.length && text.trim()) return [{ role: 'user', content: text.trim() }];
  return turns.map((t) => ({ role: t.role, content: t.content.trim() }));
}
