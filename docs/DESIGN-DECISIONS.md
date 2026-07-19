# Design Decisions

Load-bearing trade-offs, each: what was chosen, what was skipped, why, the cost, and when to revisit. Every deliberate shortcut is also marked with a `// ponytail:` comment at its call site.

---

## 1. Brute-force cosine, not a native vector extension

**Chosen:** store each chunk's embedding as a `Float32Array` BLOB in SQLite; search = load candidate vectors, dot-product against the query, sort, take top-K ([store.ts](../packages/store/src/store.ts) `search`, [types.ts](../packages/embeddings/src/types.ts) `cosine`).

**Skipped:** sqlite-vss / sqlite-vec native vector index (the plan's original call).

**Why:**
- **Native-extension loading on Windows is fragile.** Loading a compiled SQLite extension into better-sqlite3 on Win11 is a real runtime-failure risk. This session already ate one native build failure (better-sqlite3 v11 gyp error → fixed with v12); not eager for a second failure mode that only shows at query time.
- **Scale doesn't warrant an index.** A personal context store is hundreds to low-thousands of chunks. Brute-force dot-product over ~2000 × 1024-float vectors is a couple million multiply-adds — sub-10ms. Index structures earn their keep above ~50k vectors, not below.
- **Zero dependencies.** The whole "install and it works offline" promise dies if step one is a native extension that might not load.

**Cost:** O(n) scan per query. Latency grows linearly with chunk count.

**Revisit when:** chunk count crosses ~50k, or search latency appears in traces. Upgrade is a drop-in behind the same code path — swap the JS cosine loop for sqlite-vec (maintained successor, npm prebuilts) or pgvector. Vectors are unit-normalized already, so the math is identical.

---

## 2. Hash embeddings as the default; real semantics opt-in

**Chosen:** deterministic feature-hashing embedder as the default ([hash.ts](../packages/embeddings/src/hash.ts)); Ollama `nomic-embed-text` opt-in, auto-selected when reachable ([index.ts](../packages/embeddings/src/index.ts) `autoEmbeddings`).

**What hash embeddings are:** tokenize → drop stopwords → hash each word + bigram into a 1024-dim vector (sign from a hash bit) → L2-normalize. Captures **lexical overlap** (shared words rank higher), **not** meaning — "car" and "automobile" score ~0 similarity.

**Why default to the weaker one:**
- **Deterministic ⇒ hermetic tests.** Identical text → identical vector, every run, no network. The suite asserts exact rankings without mocking a model.
- **Zero deps, offline.** No model download, no Ollama, no API key. Works on a fresh laptop instantly.
- **Real semantics are one probe away.** `autoEmbeddings()` checks for a live Ollama; present → uses it, absent → hash. CLI and MCP entry points call it, so a user running Ollama gets semantic search for free.

**Cost:** default-mode search is lexical, not semantic — paraphrases miss. (Observed live: the first cut at dim 256 mis-ranked a "session tokens" query on hash collisions; fixed with stopword removal + dim 1024, but it is still lexical.)

**Hard constraint:** save and search must use the **same provider** — vectors from different embedders aren't comparable. Provider id is stored per chunk; a query skips mismatched chunks and emits a reindex hint. That's why both `save` and `search` route through one `autoEmbeddings()` selection.

**Revisit when:** semantic quality is wanted by default → bundle a small ONNX embedder (e.g. MiniLM) or default Ollama on. New `EmbeddingProvider` impl + default swap; nothing downstream changes.

---

## 3. Heuristic extraction, not an LLM pass

**Chosen:** regex/heuristic extraction ([extract.ts](../packages/extract/src/extract.ts)) — decision-cue sentences, bullet facts, fenced snippets, opening-ask summary.

**Skipped:** the plan's "LLM-assisted extraction."

**Why:**
- **No API key, no network, no cost, deterministic.** Save stays an instant local write; tests assert exact output.
- **Save is the hot path.** An LLM round-trip on every save would add latency + tokens + a key requirement to something meant to be fast and offline.
- **The shape is the contract, not the method.** `ExtractResult = { summary, decisions[], facts[], snippets[] }` is what the store, shapes, and search consume. Swap the internals for an LLM later and nothing downstream changes.

**Cost:** heuristic recall/precision. Misses decisions phrased without a cue word; occasionally grabs weak ones (anaphoric "let's go with *that*"). No paraphrase understanding.

**Revisit when:** extraction quality matters more than offline/instant → add an `LlmExtractor` producing the same `ExtractResult`, gated behind a flag or `hints.extract`.

---

## Cross-cutting: deterministic + offline default, heavy version behind an interface

All three follow one rule: the **default** is deterministic, offline, zero-dependency, so the tool works on any laptop with no setup; the **real/heavy** implementation sits behind a stable interface (`EmbeddingProvider`, `Provider`, `ExtractResult`) for later. Swaps are impl/config changes, not rewrites. The interfaces are the insurance.

## Other decisions carried from the plan

- **Monorepo of small packages** > single package: a store-only consumer shouldn't pull the dashboard, embedding SDKs, or a vendor LLM SDK.
- **Trace as the single observability primitive** > side-channel logging: one source of truth for dashboard, audit, learning, replay.
- **Contexts are directories of markdown/JSON on disk** > rows in a DB: grep-able, diff-able, git-able, hand-editable. SQLite holds the index + vectors, never the sole copy.
- **SQLite + filesystem default** > Postgres/pgvector default: zero services to run. Postgres remains the documented scale-out path behind the same store API.
- **Provider-agnostic by construction:** the only file importing a vendor LLM SDK is [anthropic.ts](../packages/router/src/providers/anthropic.ts). Everything else speaks the `Provider` interface.
