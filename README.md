# AI Context Engine (ACE)

Persistent, local-first context store. Save context in one chat, load it in another. Works from any tool that can shell out to a CLI, hit a REST endpoint, or talk MCP.

**Status: M1 + M4 shipped.** Save/load/list/forget on disk with a SQLite metadata index (M1). MCP server so any chat client can call the store, plus `ace mcp install` for one-command wire-up (M4). Semantic search (M2), extractors (M3), and the LLM proxy pipeline land in later milestones — see the [architecture plan](../../../.claude/plans/ai-context-engine-semantic-parsed-bee.md).

## Try it now

```bash
pnpm install
pnpm -r build

# End-to-end demos (each uses a scratch ACE_HOME, cleans itself up)
pnpm demo:m1   # save/load/list/forget via the SDK
pnpm demo:m4   # spawn ace-mcp over stdio and drive it as an MCP client
```

## Wire it into your chat client (M4)

```bash
# One-command install into Claude Desktop's config
node packages/cli/bin/ace.js mcp install --client=claude-desktop
# Restart Claude Desktop. context_save / context_load / context_list / context_forget
# now appear as tools any conversation can call.
```

Config paths written:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

The command is idempotent, preserves any existing `mcpServers` entries, and backs up the previous file before writing.

## CLI

```bash
# Save context — from a file, stdin, clipboard, or --text
node packages/cli/bin/ace.js save project/auth-refactor --text "we decided to use JWT with 15m expiry"
cat notes.md | node packages/cli/bin/ace.js save notes/today
node packages/cli/bin/ace.js save today/thread --from-clipboard --tag urgent

# Load into any chat — engine picks the largest shape that fits your budget
node packages/cli/bin/ace.js load project/auth-refactor --shape summary --budget 4000

# List with filters
node packages/cli/bin/ace.js list --prefix project/ --tag auth

# Forget (moves to trash by default)
node packages/cli/bin/ace.js forget project/auth-refactor
node packages/cli/bin/ace.js forget project/auth-refactor --purge
```

Override the storage location with `ACE_HOME` (defaults to `~/.ace/store`).

## SDK

```ts
import { Engine } from '@ace/core';
import { Store, storeMiddleware } from '@ace/store';

const store = new Store();                        // uses ACE_HOME or ~/.ace/store
const engine = new Engine().use(storeMiddleware(store));

await engine.run({
  kind: 'save',
  input: { slug: 'project/auth', source: { text: '...' }, hints: { tags: ['auth'] } },
});
const res = await engine.run({
  kind: 'load',
  input: { slug: 'project/auth', shape: 'summary', budgetTokens: 4000 },
});
```

Every operation returns a `trace` — an array of decisions each middleware made, with timing. No hidden math.

## Layout

- `packages/core`  — engine + middleware kernel + types + tracing
- `packages/store` — on-disk context store (SQLite index, markdown content)
- `packages/mcp`   — MCP server (`ace-mcp`) exposing the store as MCP tools
- `packages/cli`   — the `ace` binary (save/load/list/forget/mcp install)
- `demos/`         — per-milestone runnable demos

## On-disk shape

```
$ACE_HOME/
├── contexts/<slug>/
│   ├── manifest.json     # metadata, version, token counts, section pointers
│   ├── summary.md        # the load-shape 'summary' body
│   ├── decisions.md      # (populated by extractor in M3)
│   ├── facts.md          # (populated by extractor in M3)
│   ├── snippets/         # (populated by extractor in M3)
│   ├── files/            # attached files, copied not linked
│   ├── refs.json         # external URLs
│   └── raw/thread.md     # optional full source
├── trash/                # `forget` moves here (recoverable) unless --purge
└── index.db              # SQLite metadata index (rebuildable via Store#rebuildIndex)
```

Everything is human-readable. Grep, diff, and commit the store to git if you want cross-machine sync today.
