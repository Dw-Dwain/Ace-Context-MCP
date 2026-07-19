# Changelog

## Unreleased (post-0.1.0 hardening)

Closed the launch-blocker gaps identified in a readiness audit:
- **@ace/pipeline** — `createChatPipeline()` assembles the whole chat chain (observe → normalize → validate → security → optimize → cache → compress → policy → router) in one call. The LLM proxy is now a product, not loose parts.
- **LLM-backed extraction + intent** (opt-in) — `LlmExtractor` and a pluggable cache intent classifier, behind the same interfaces; heuristics stay the default and the fallback.
- **Real semantic embeddings** — `LocalEmbeddings` (all-MiniLM via transformers.js, in-process, no server) auto-selected when present; the base install stays lean (zero native ML deps). `pnpm enable:semantic` to turn it on. Copy corrected: keyword search by default, semantic with one command or Ollama.
- **Integration + E2E tests** — store concurrency, an MCP subprocess round-trip over stdio — and a **real concurrency bug** they caught (same-slug save race on Windows), fixed with a per-slug write lock.
- **Location-independent install** — `ace mcp install` uses a PATH-resolved `ace-mcp` when globally installed (survives moving the repo), absolute-path fallback otherwise.
- **CI** — GitHub Actions matrix: build + typecheck + test on Linux, macOS, Windows.

## 0.1.0

First tagged release. The context store and the full middleware pipeline, all deterministic-and-offline by default with heavier implementations behind stable interfaces.

### Context store (the product)
- **M1** — save/load/list/forget on disk with a SQLite metadata index; layered load shapes (pointer/summary/working/full) with budget-fit; atomic writes; slug validation + path-traversal defense.
- **M2** — semantic search across all saved contexts; provider-agnostic embeddings (deterministic hash default, Ollama opt-in); brute-force cosine over blob-stored vectors.
- **M3** — automatic extraction of decisions/facts/snippets/summary from raw threads; merge + dedup on re-save.
- **M4** — MCP server (`ace-mcp`) exposing `context_*` tools; `ace mcp install` for Claude Desktop, Cursor, Cline, and Claude Code.

### LLM proxy pipeline (supporting)
- **M5** — provider-agnostic routing with failover; Anthropic adapter (the only vendor-SDK import); `engine.chat()`.
- **M6–M7** — exact + semantic cache with an explainable confidence decision (semantic × intent × context × safety); 14-label intent classifier.
- **M8** — prompt optimizer: cleaning (rail-guarded ≥0.85 similarity), rule-based expansion, persona + constraint injection.
- **M9** — streaming; OpenAI/OpenRouter/Ollama/Gemini via one fetch-based OpenAI-compatible adapter.
- **M10** — budget-triggered conversation compression with a meaning-preservation score.
- **M11** — security scanners (secrets/PII/injection) + redaction; policy engine (token budget, model allow/deny, rate limit).
- **M12** — learning: feedback-signal quality scoring, response ranking, cache-threshold tuning (tunes middleware decisions, not the model).
- **M13** — observability (Prometheus metrics + trace log), Fastify REST server, and a live dashboard.
- **M14** — Apache-2.0 license, package metadata, plugin cookbook, this changelog.

### Notes
- 120 tests across 15 packages/apps; every non-trivial module ships a runnable check.
- Every deliberate shortcut is marked with a `// ponytail:` comment naming its upgrade path. See [docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md).
