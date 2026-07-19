import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from '@ace/store';
import { autoEmbeddings } from '@ace/embeddings';
import { createAceServer } from './server.js';

// Log provider selection to stderr — stdout is the MCP transport, keep it clean.
const embeddings = await autoEmbeddings({
  onSelect: (id) => process.stderr.write(`ace-mcp embeddings: ${id}\n`),
});
const store = process.env.ACE_HOME
  ? new Store({ home: process.env.ACE_HOME, embeddings })
  : new Store({ embeddings });
const server = createAceServer({ store });
const transport = new StdioServerTransport();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function shutdown(code: number) {
  try {
    await server.close();
  } catch {
    // ignore
  }
  store.close();
  process.exit(code);
}

server.connect(transport).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ace-mcp: ${msg}\n`);
  shutdown(1);
});
