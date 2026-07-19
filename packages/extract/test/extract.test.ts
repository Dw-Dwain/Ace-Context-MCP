import { describe, it, expect } from 'vitest';
import { extract, parseThread } from '../src/index.js';

const thread = `
User: We need to swap the session cookie for JWT. What do you suggest?
Assistant: Recommended approach:
- Access tokens expire after 15 minutes
- Refresh tokens rotate on use
Here is the schema:
\`\`\`ts
interface Session { userId: string; exp: number }
\`\`\`
User: Ok let's go with that. Decision: deny-list refresh tokens on logout.
Assistant: Agreed to clean the deny-list nightly.
`;

describe('parseThread', () => {
  it('splits a Role: transcript into turns', () => {
    const turns = parseThread({ text: thread });
    expect(turns.length).toBe(4);
    expect(turns[0]!.role).toBe('user');
    expect(turns[1]!.role).toBe('assistant');
  });

  it('parses structured Claude-style content blocks', () => {
    const turns = parseThread({
      thread: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: 'hi there' },
      ],
    });
    expect(turns.map((t) => t.content)).toEqual(['hello', 'hi there']);
  });

  it('falls back to a single user turn for unstructured text', () => {
    const turns = parseThread({ text: 'just a blob of notes' });
    expect(turns).toEqual([{ role: 'user', content: 'just a blob of notes' }]);
  });
});

describe('extract', () => {
  const res = extract({ text: thread });

  it('captures decision-cue sentences', () => {
    const joined = res.decisions.join(' | ').toLowerCase();
    expect(joined).toContain("let's go with");
    expect(joined).toContain('deny-list refresh tokens on logout');
    expect(joined).toContain('agreed to clean the deny-list nightly');
  });

  it('captures bullet facts', () => {
    expect(res.facts).toContain('Access tokens expire after 15 minutes');
    expect(res.facts).toContain('Refresh tokens rotate on use');
  });

  it('extracts fenced code as a named snippet with a language', () => {
    expect(res.snippets.length).toBe(1);
    expect(res.snippets[0]!.lang).toBe('ts');
    expect(res.snippets[0]!.name).toMatch(/^001-snippet\.ts$/);
    expect(res.snippets[0]!.content).toContain('interface Session');
  });

  it('summary names the opening ask', () => {
    expect(res.summary).toContain('Opening ask:');
    expect(res.summary).toContain('JWT');
  });

  it('dedups repeated facts', () => {
    const dup = extract({ text: 'Assistant:\n- same fact\n- same fact\n- other' });
    expect(dup.facts).toEqual(['same fact', 'other']);
  });

  it('handles empty input', () => {
    const empty = extract({ text: '' });
    expect(empty).toEqual({ summary: '', decisions: [], facts: [], snippets: [] });
  });
});
