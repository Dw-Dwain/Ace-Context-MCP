# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Open a [GitHub security advisory](https://github.com/Dw-Dwain/Ace-Context-MCP/security/advisories/new) rather than a public issue, or email the maintainer. You'll get an acknowledgement within a few days.

Do not open a public issue for anything that could expose user data or credentials until a fix is available.

## Scope & design notes

ACE is **local-first**: by default all context lives on the user's own disk under `$ACE_HOME` (`~/.ace/store`) and never leaves the machine. There is no telephone-home, no bundled cloud endpoint.

- **Secrets never committed.** The test suite builds fake credentials at runtime, so no secret-shaped literal is ever stored in the repository.
- **Built-in scanning.** `@ace/security` detects secrets, PII (Luhn-validated cards), and prompt-injection markers, and can redact or block them in the `save` and `chat` flows. Finding previews are always redacted — a raw secret never reaches a log or trace.
- **Provider keys** (Anthropic/OpenAI/etc.) are read from environment variables only and are never persisted by ACE.
- **Trust boundary.** Content loaded from the store or returned by a provider is data, not instructions. The injection scanner flags common override attempts, but downstream applications remain responsible for their own handling of model output.

## Supported versions

The `0.1.x` line receives security fixes. Pre-1.0, only the latest minor is supported.
