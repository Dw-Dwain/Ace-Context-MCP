# AI Context Engine — Architecture

## The problem

Every AI chat has a bounded context window. When you hit the wall, start a new chat, or jump between tools (Claude web → Claude Code → Cursor → Claude Desktop), the prior conversation's context is gone. You re-paste background, re-explain the project, re-upload files. The model silently forgets what mattered.

## The thesis

**ACE is a persistent, local-first context store that any chat can save into and any other chat can load from.**

Your sessions can run huge (1M tokens, say). When you leave a chat, that chat is *gone* — a fresh session anywhere starts blank. The only thing that survives is what you deliberately stored in ACE. That local copy is the source of truth: the next session — in any tool — pulls it back in and carries up-to-date context. Each session ties into the last through the store, not through the chat app's memory.

Because not every session is about the same thing, context lives in **named slots** (slugs). One machine, many topics, each its own slot.

```
        Claude web          Claude Code          Cursor / Cline          Claude Desktop
             │                    │                     │                       │
             │   context_save /   │   context_save /    │   context_save /      │
             │   context_load     │   context_load      │   context_load        │
             └─────────┬──────────┴──────────┬──────────┴───────────┬───────────┘
                       │        MCP           │        MCP           │
                       ▼                      ▼                      ▼
                ┌───────────────────────────────────────────────────────────┐
                │              AI CONTEXT ENGINE  (one local store)           │
                │                    $ACE_HOME  (~/.ace/store)                │
                │                                                             │
                │   contexts/<slug>/   manifest + summary/decisions/facts/    │
                │                      snippets/files/raw                     │
                │   index.db           SQLite metadata + chunk vectors        │
                │   trash/             recoverable deletes                    │
                └───────────────────────────────────────────────────────────┘
```

Every surface — MCP (for desktop/web/Cursor/Cline), CLI (for the terminal), SDK (for apps) — points at the **same `$ACE_HOME`**. Set that env var identically across tools and they share one brain.

## How continuity actually works

1. **Slots = slugs.** `project/auth-refactor`, `research/rag-eval`, `personal/trip` — namespaced paths on disk. Multiple topics → multiple slots, no collision.
2. **Local source of truth.** Everything lives under `$ACE_HOME` (default `~/.ace/store`), plain markdown + JSON + one SQLite index. Grep it, diff it, `git init` it, back it up with `cp`.
3. **Save at the end of a session.** `context_save project/x` distills the thread (decisions/facts/snippets), embeds it for search, versions it. Re-saving the same slug **merges and dedups** — the slot accumulates knowledge across sessions instead of overwriting.
4. **Load at the start of the next.** In any client: `context_load project/x` returns paste-ready markdown, or `context_search "what did we decide about tokens"` finds the right slot across everything. The fresh chat is now caught up.
5. **Fit the window.** Load names a *shape* — `pointer` (~40 tok), `summary`, `working`, `full` — and a `budgetTokens`. The engine returns the largest shape that fits the target model's remaining window, so a 1M session and an 8k session both get a right-sized payload.

The binding between "this session" and "the last one" is the **slug you name**. ACE provides the slots and the merge/version/search machinery; you (or the client convention) pick which slot a session belongs to. Auto-resume of the most-recent slot is a planned learning-layer convenience (M12), not a core requirement.

## Two flows, one engine

- **Context flow (primary):** `save` / `load` / `search` / `list` / `forget`. Local-first, no LLM required to save. This *is* the product.
- **LLM proxy flow (supporting):** apps route their raw model calls through `engine.chat()` to get routing, failover, and — as later milestones land — caching, optimization, and compression. Same middleware kernel, same trace.

## Middleware kernel

One interface drives everything ([packages/core](packages/core/src)):

```ts
interface Middleware {
  name: string
  appliesTo?: OpKind[]          // 'save' | 'load' | 'search' | 'list' | 'forget' | 'chat'
  before?(ctx): void | Promise<void>
  after?(ctx): void | Promise<void>
}
```

- `engine.use(m)` appends; `insertBefore/After` splice. No dependency graph, no topological sort — a plain ordered array, like Express.
- The operation is **deep-frozen** on entry; no stage can mutate the original request.
- Every hook invocation appends a `TraceEntry` (stage, phase, durationMs, decision, error). The **trace is the single observability primitive** — dashboard, audit log, learning engine, and replay all read it. No side-channel logging.
- A stage throws → captured on the trace, re-thrown by default, or soft-failed when `fatalOnError: false`.

## Packages

| Package | Role |
|---|---|
| `@ace/core` | Engine + middleware kernel + types + tracing. `engine.chat/save/load/search/...` |
| `@ace/store` | On-disk context store: layout, manifest, SQLite index, chunk vectors, save/load/search/list/forget |
| `@ace/embeddings` | `EmbeddingProvider` interface; deterministic `HashEmbeddings` default, `OllamaEmbeddings` opt-in, `autoEmbeddings()` selector |
| `@ace/extract` | Thread → decisions / facts / snippets / summary (heuristic, deterministic) |
| `@ace/router` | `Provider` interface, `AnthropicProvider` (only vendor SDK import), `MockProvider`, rule-based routing + failover |
| `@ace/mcp` | Stdio MCP server (`ace-mcp`) exposing the store as `context_*` tools |
| `@ace/cli` | The `ace` binary: save/load/search/list/forget + `mcp install` |

Monorepo of small packages so a consumer who only wants the store doesn't install the dashboard, embedding SDKs, or a vendor LLM SDK.

## On-disk layout

```
$ACE_HOME/
├── contexts/<slug>/
│   ├── manifest.json     # tags, version, token counts per shape, section pointers
│   ├── summary.md        # opening ask + thread shape (load shape: summary)
│   ├── decisions.md      # extracted decision-cue sentences (merged across saves)
│   ├── facts.md          # extracted bullet facts (deduped)
│   ├── snippets/         # fenced code blocks, language-tagged
│   ├── files/            # attached files, copied not linked
│   ├── refs.json         # external URLs
│   └── raw/thread.md     # full source (load shape: full), optional
├── trash/                # `forget` moves here unless --purge
└── index.db              # SQLite: contexts metadata + chunk vectors (blobs)
```

Human-readable by design. SQLite holds the *index* and *vectors*, never the only copy of content.

## Load shapes

| Shape | Contains | Use |
|---|---|---|
| `pointer` | slug + header + tags (~40 tok) | "does this exist?" |
| `summary` | + summary + decisions + facts | default cross-chat load |
| `working` | + snippets + files | active work on the topic |
| `full` | + raw thread | audit / recovery |

`load({ slug, budgetTokens })` returns the largest shape that fits; if even that overflows, it trims lowest-priority sections and records the drops on the trace.

## Semantic search

`search` embeds the query and ranks chunks of every saved context by cosine similarity ([store.ts](packages/store/src/store.ts)).

- Default embeddings: deterministic, dependency-free hash embeddings — offline, hermetic, lexical-overlap quality.
- Real semantics: a running Ollama (`nomic-embed-text`) is auto-detected by the CLI/MCP entry points; save and search use the same provider so vectors stay comparable. Mismatched-provider chunks are skipped with a reindex hint.
- Matching is a brute-force cosine scan over blob-stored vectors — fast at personal-store scale; swap in a vector extension when chunk counts get large.

## Roadmap status

Shipped: **M0** scaffold · **M1** store (save/load/list/forget) · **M2** semantic search · **M3** extraction · **M4** MCP + `ace mcp install` (claude-desktop/cursor/cline/claude-code) · **M5** LLM proxy routing.

Ahead: **M6–M7** cache (exact + semantic decision engine) · **M8** optimizer · **M9** streaming + OpenAI/Gemini/Ollama/OpenRouter · **M10** compression · **M11** security/policy · **M12** learning · **M13** dashboard · **M14** docs/release.

See [DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md) for the load-bearing trade-offs.
