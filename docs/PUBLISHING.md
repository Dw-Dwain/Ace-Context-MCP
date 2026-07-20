# Publishing to npm + the MCP Registry

Listing ACE in the [MCP Registry](https://registry.modelcontextprotocol.io) is the highest-signal discovery channel (clients auto-find it; Anthropic maintains it). The registry entry points at an npm package, so publish that first.

The publishable package is **`packages/ace-context-mcp`** — a single self-contained bundle (all `@ace/*` code inlined by tsup; only `better-sqlite3` and `@modelcontextprotocol/sdk` stay as runtime deps). Verified working standalone over stdio.

## 1. Publish to npm

Requires an npmjs.org login (your account). From the repo root:

```bash
pnpm install
pnpm --filter ace-context-mcp build     # produces dist/main.js (also runs on prepublishOnly)

cd packages/ace-context-mcp
npm login                                # or: pnpm login
pnpm publish --access public             # use pnpm (rewrites workspace: build-deps; npm can't)
```

Dry run first if you like: `pnpm publish --dry-run --no-git-checks`.

Once live, anyone can run it with zero build step:

```json
{ "mcpServers": { "ace": { "command": "npx", "args": ["-y", "ace-context-mcp"] } } }
```

## 2. Publish the registry entry

`server.json` (repo root) already targets `ace-context-mcp`. Install the publisher and push it:

```bash
npm i -g @modelcontextprotocol/publisher   # or: brew install mcp-publisher
mcp-publisher login github                 # authorizes the io.github.dw-dwain/* namespace
mcp-publisher publish                       # reads ./server.json
```

The `io.github.dw-dwain/*` namespace is granted automatically when you auth with the GitHub account that owns this repo.

## Notes

- Bump `version` in both `packages/ace-context-mcp/package.json` and `server.json` together on each release.
- The `ace-context-mcp` bundle is independent of the workspace `@ace/*` package names, so you never need to claim an `@ace` npm scope.
