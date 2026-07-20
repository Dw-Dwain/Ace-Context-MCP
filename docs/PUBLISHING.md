# Publishing to the MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io) is how MCP clients auto-discover servers. Listing ACE there is the highest-signal way to be found (Anthropic maintains it).

The registry entry (`server.json`, at the repo root) points at an **npm package**, so the one prerequisite is publishing the MCP server to npm.

## 1. Publish `@ace/mcp` to npm (under a scope/name you own)

`@ace/*` is a workspace alias, not a claimed npm scope. Publish the MCP server under a name you own — e.g. the unscoped `ace-context-mcp` (matches `server.json`) or your own scope. From the repo:

```bash
pnpm -r build

# rename packages/mcp "name" to "ace-context-mcp" (or your scope) + add a
# "bin" already present, then:
cd packages/mcp
npm publish --access public
```

> Note: `@ace/mcp` depends on other `@ace/*` workspace packages via `workspace:*`. To publish standalone you must either (a) publish all `@ace/*` packages under names you own, or (b) bundle them (e.g. `tsup`/`ncc`) so the published `ace-context-mcp` has no unpublished workspace deps. Bundling is the simpler path for a single installable binary.

## 2. Install the registry publisher

```bash
# official MCP registry CLI
npm i -g @modelcontextprotocol/publisher   # or: brew install mcp-publisher
```

## 3. Authenticate + publish

```bash
mcp-publisher login github          # authorizes the io.github.dw-dwain/* namespace
mcp-publisher publish               # reads ./server.json
```

The `io.github.dw-dwain/*` namespace is granted automatically once you auth with the GitHub account that owns this repo.

## Until then

The repo is already installable from source (`git clone` + `pnpm build` + `ace mcp install`), and listed in community indexes (awesome-mcp-servers). The registry entry activates the moment the npm package is live.
