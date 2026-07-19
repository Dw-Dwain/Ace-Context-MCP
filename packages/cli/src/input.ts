import { readFile } from 'node:fs/promises';

export interface InputOptions {
  file?: string;
  text?: string;
  fromClipboard?: boolean;
  fromStdin?: boolean;
}

export async function collectInput(opts: InputOptions): Promise<string> {
  const picks = [opts.file, opts.text, opts.fromClipboard, opts.fromStdin].filter(Boolean);
  if (picks.length > 1) throw new Error('pick exactly one input source (--file | --text | --from-clipboard | --stdin)');
  if (opts.file) return readFile(opts.file, 'utf8');
  if (opts.text !== undefined) return opts.text;
  if (opts.fromClipboard) {
    const { default: clipboard } = await import('clipboardy');
    return clipboard.read();
  }
  return readStdin();
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('no input on stdin; pass --file, --text, --from-clipboard, or pipe content');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
