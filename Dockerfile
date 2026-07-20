# Runs the ACE MCP server over stdio — used by Glama and any container host.
# Multi-stage: build the self-contained bundle, then a slim runtime with only
# the two external runtime deps (better-sqlite3 uses a Linux prebuilt binary).

# --- build the bundle ---------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
# Build the @ace/* graph (their dist) before tsup bundles ace-context-mcp.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter "ace-context-mcp..." run build

# --- slim runtime -------------------------------------------------------------
FROM node:20-slim
WORKDIR /app
COPY --from=build /src/packages/ace-context-mcp/dist ./dist
COPY --from=build /src/packages/ace-context-mcp/bin ./bin
COPY --from=build /src/packages/ace-context-mcp/package.json ./package.json
# Installs better-sqlite3 (Linux prebuilt) + @modelcontextprotocol/sdk only.
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund

# Context store lives here; mount a volume to persist across runs.
ENV ACE_HOME=/data
VOLUME ["/data"]

# MCP over stdio.
ENTRYPOINT ["node", "bin/ace-mcp.js"]
