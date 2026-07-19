import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from '@ace/store';
import { createAceServer } from './server.js';

const store = process.env.ACE_HOME ? new Store({ home: process.env.ACE_HOME }) : new Store();
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
