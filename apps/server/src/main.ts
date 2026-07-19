import { Store } from '@ace/store';
import { autoEmbeddings } from '@ace/embeddings';
import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 4319);
const embeddings = await autoEmbeddings({
  onSelect: (id) => process.stderr.write(`ace-server embeddings: ${id}\n`),
});
const store = process.env.ACE_HOME
  ? new Store({ home: process.env.ACE_HOME, embeddings })
  : new Store({ embeddings });

const app = buildServer({ store });
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => process.stdout.write(`ace-server: http://127.0.0.1:${port}  (dashboard at /)\n`))
  .catch((err: unknown) => {
    process.stderr.write(`ace-server: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
