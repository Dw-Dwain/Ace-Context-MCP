import type { Provider } from './types.js';

/** Adapt a Provider to the minimal `{ complete(prompt) }` client that
 *  @ace/extract and @ace/cache use for LLM-backed extraction / classification.
 *  Structural — no import coupling between those packages and this one. */
export function asLlmClient(
  provider: Provider,
  opts: { model?: string; maxTokens?: number } = {},
): { complete(prompt: string): Promise<string> } {
  const model = opts.model ?? 'auto';
  return {
    async complete(prompt: string): Promise<string> {
      const res = await provider.chat({
        model,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: opts.maxTokens ?? 1024,
      });
      return res.content;
    },
  };
}
