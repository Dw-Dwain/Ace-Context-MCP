import { Command } from 'commander';
import { Store } from '@ace/store';
import { collectInput } from './input.js';
import { installMcp } from './mcp-install.js';

const program = new Command()
  .name('ace')
  .description('AI Context Engine — save context in one chat, load it in any other')
  .version('0.0.1');

program
  .command('save <slug>')
  .description('save a context (from --file, --text, --from-clipboard, or piped stdin)')
  .option('-f, --file <path>', 'read content from a file')
  .option('-t, --text <text>', 'inline content')
  .option('-c, --from-clipboard', 'read content from clipboard')
  .option('--tag <tag>', 'tag to attach (repeatable)', collect, [] as string[])
  .option('--ttl-days <n>', 'time-to-live in days', (v) => Number(v))
  .option('--no-raw', 'do not keep raw source')
  .action(async (slug: string, opts) => {
    const store = openStore();
    try {
      const text = await collectInput({
        file: opts.file,
        text: opts.text,
        fromClipboard: opts.fromClipboard,
        fromStdin: !opts.file && opts.text === undefined && !opts.fromClipboard,
      });
      const res = await store.save({
        slug,
        source: { text },
        hints: {
          tags: opts.tag,
          ttlDays: opts.ttlDays,
          keepRaw: opts.raw !== false,
        },
      });
      process.stdout.write(
        `saved ${res.slug} v${res.version} · tokens summary=${res.tokens.summary} working=${res.tokens.working} full=${res.tokens.full}\n`,
      );
    } finally {
      store.close();
    }
  });

program
  .command('load <slug>')
  .description('load a context, sized to fit a token budget')
  .option('-s, --shape <shape>', 'pointer|summary|working|full', 'summary')
  .option('-b, --budget <n>', 'target token budget', (v) => Number(v))
  .action(async (slug: string, opts) => {
    const store = openStore();
    try {
      const res = await store.load({
        slug,
        shape: opts.shape,
        budgetTokens: opts.budget,
      });
      process.stdout.write(res.markdown);
      if (!res.markdown.endsWith('\n')) process.stdout.write('\n');
      if (res.dropped.length) process.stderr.write(`(dropped: ${res.dropped.join(', ')})\n`);
    } finally {
      store.close();
    }
  });

program
  .command('list')
  .description('list saved contexts')
  .option('-p, --prefix <prefix>', 'slug prefix filter')
  .option('-t, --tag <tag>', 'tag filter')
  .option('-n, --limit <n>', 'max rows', (v) => Number(v), 50)
  .action((opts) => {
    const store = openStore();
    try {
      const res = store.list({ prefix: opts.prefix, tag: opts.tag, limit: opts.limit });
      if (!res.contexts.length) {
        process.stdout.write('(none)\n');
        return;
      }
      for (const c of res.contexts) {
        const tags = c.tags.length ? ` [${c.tags.join(', ')}]` : '';
        process.stdout.write(
          `${c.slug}\tv${c.version}\ttokens=${c.tokensSummary}/${c.tokensWorking}/${c.tokensFull}\t${new Date(c.updatedAt).toISOString()}${tags}\n`,
        );
      }
    } finally {
      store.close();
    }
  });

const mcp = program.command('mcp').description('MCP server integration');

mcp
  .command('install')
  .description('register the ace MCP server with a chat client')
  .requiredOption('--client <name>', 'client to install into (currently: claude-desktop)')
  .option('--ace-home <path>', 'ACE_HOME to bake into the client config (default: env or ~/.ace/store)')
  .option('--config-path <path>', 'override the client config path (for tests)')
  .option('--no-backup', 'skip backing up an existing config file')
  .action(async (opts) => {
    const installArgs: Parameters<typeof installMcp>[0] = { client: opts.client };
    if (opts.aceHome) installArgs.aceHome = opts.aceHome;
    else if (process.env.ACE_HOME) installArgs.aceHome = process.env.ACE_HOME;
    if (opts.configPath) installArgs.overrideConfigPath = opts.configPath;
    if (opts.backup === false) installArgs.backup = false;
    const res = await installMcp(installArgs);
    process.stdout.write(
      `ace-mcp registered in ${opts.client}\n` +
        `  action:      ${res.action}\n` +
        `  config file: ${res.configPath}\n` +
        `  server bin:  ${res.binPath}\n` +
        (res.backupPath ? `  backup:      ${res.backupPath}\n` : ''),
    );
    if (res.action !== 'noop') {
      process.stdout.write('Restart the client for the changes to take effect.\n');
    }
  });

program
  .command('forget <slug>')
  .description('remove a context (moves to trash unless --purge)')
  .option('--purge', 'permanently delete instead of moving to trash')
  .action(async (slug: string, opts) => {
    const store = openStore();
    try {
      const res = await store.forget({ slug, purge: opts.purge });
      if (res.moved) process.stdout.write(`moved ${res.slug} -> ${res.moved}\n`);
      else if (opts.purge) process.stdout.write(`purged ${res.slug}\n`);
      else process.stdout.write(`no such context: ${res.slug}\n`);
    } finally {
      store.close();
    }
  });

function openStore(): Store {
  return process.env.ACE_HOME ? new Store({ home: process.env.ACE_HOME }) : new Store();
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ace: ${msg}\n`);
  process.exit(1);
});
