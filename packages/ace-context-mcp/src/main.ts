import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from '@ace/store';
import { autoEmbeddings } from '@ace/embeddings';
import { createAceServer } from '@ace/mcp';

// Standalone stdio entry for the published `ace-context-mcp` binary. Mirrors
// @ace/mcp's main, bundled with all @ace/* code inlined by tsup.
const embeddings = await autoEmbeddings({
  onSelect: (id) => process.stderr.write(`ace-mcp embeddings: ${id}\n`),
});
const store = process.env.ACE_HOME
  ? new Store({ home: process.env.ACE_HOME, embeddings })
  : new Store({ embeddings });

const server = createAceServer({ store, version: '0.1.1' });
const transport = new StdioServerTransport();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function shutdown(code: number) {
  try {
    await server.close();
  } catch {
    /* ignore */
  }
  store.close();
  process.exit(code);
}

server.connect(transport).catch((err: unknown) => {
  process.stderr.write(`ace-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  void shutdown(1);
});
