import { defineConfig } from 'tsup';

// Bundle the whole @ace/* graph into one file so the published package is a
// single self-contained MCP binary. Native (better-sqlite3) and the MCP SDK
// stay external and are declared as runtime dependencies.
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  noExternal: [/^@ace\//],
  external: ['better-sqlite3', '@modelcontextprotocol/sdk'],
  clean: true,
  minify: false,
  shims: false,
});
