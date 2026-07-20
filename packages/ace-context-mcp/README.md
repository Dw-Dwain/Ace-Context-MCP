# ace-context-mcp

Persistent, local-first memory for your AI chats. Save context in one chat, load it in any other — across Claude Desktop, Claude Code, Cursor, and Cline — through one MCP server. Local store (`~/.ace/store`), no cloud, no API key.

## Use with an MCP client

Add to your client's MCP config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ace": { "command": "npx", "args": ["-y", "ace-context-mcp"] }
  }
}
```

Restart the client. Tools: `context_save`, `context_load`, `context_search`, `context_list`, `context_forget`.

Set `ACE_HOME` to change the store location (default `~/.ace/store`).

Full project, CLI, and docs: https://github.com/Dw-Dwain/Ace-Context-MCP — Apache-2.0.
