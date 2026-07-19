# AI Context Engine (ACE)

Persistent, local-first context store. Save context in one chat, load it in another. Works from any tool that can shell out to a CLI, hit a REST endpoint, or talk MCP.

**Status: M1 + M2 + M3 + M4 shipped.** Save/load/list/forget on disk with a SQLite metadata index (M1). Semantic search across all saved contexts (M2). Automatic extraction of decisions/facts/snippets from raw threads (M3). MCP server so any chat client can call the store, plus `ace mcp install` for one-command wire-up (M4). The LLM proxy pipeline lands next — see the [architecture plan](../../../.claude/plans/ai-context-engine-semantic-parsed-bee.md).

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

# Semantic search across everything you've saved
node packages/cli/bin/ace.js search "what did we decide about session tokens"
node packages/cli/bin/ace.js search "caching strategy" --scope project/ --top-k 3

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

- `packages/core`       — engine + middleware kernel + types + tracing
- `packages/store`      — on-disk context store (SQLite index, markdown content)
- `packages/embeddings` — provider-agnostic embeddings (hash default, Ollama opt-in)
- `packages/extract`    — thread → decisions / facts / snippets / summary
- `packages/mcp`        — MCP server (`ace-mcp`) exposing the store as MCP tools
- `packages/cli`        — the `ace` binary (save/load/search/list/forget/mcp install)
- `demos/`              — per-milestone runnable demos

## Extraction

On save, a raw chat thread (a `Role:`-prefixed transcript, or a structured message array) is distilled into:

- **decisions** — sentences with decision cues ("we decided", "let's go with", "decision:", "agreed to", …)
- **facts** — bullet-point statements, deduplicated
- **snippets** — fenced code blocks, named and language-tagged
- **summary** — the opening ask plus thread shape

These populate the layered load shapes: `summary` returns summary+decisions+facts; `working` adds snippets+files; `full` adds the raw thread. Re-saving the same slug merges and dedups decisions/facts. Opt out with `ace save --no-extract` or `hints.extract: []`. Extraction is heuristic and offline — swap in an LLM pass later without changing the store.

## Semantic search

`ace search` (and the `context_search` MCP tool) embeds your query and ranks chunks of every saved context by cosine similarity.

- **Default embeddings:** deterministic, dependency-free hash embeddings — offline, hermetic, lexical-overlap quality. No model or network needed.
- **Real semantics:** if a local [Ollama](https://ollama.com) server is running with `nomic-embed-text` pulled, the CLI and MCP server pick it up automatically (`OLLAMA_HOST` to override). Save and search use the same provider so vectors stay comparable.
- Vectors are stored as blobs in the SQLite index; matching is a brute-force cosine scan. Fast at personal-store scale; swap in a vector extension (sqlite-vec / pgvector) when chunk counts get large.

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
