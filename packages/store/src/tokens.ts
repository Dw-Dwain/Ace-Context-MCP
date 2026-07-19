// ponytail: chars/4 is a rough approximation of OpenAI/Claude tokenization.
// Swap for @dqbd/tiktoken or a native tokenizer when budget accuracy matters.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
