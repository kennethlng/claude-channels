# Security Policy

## Reporting a vulnerability

Please report security issues **privately**, not via public issues:

- Open a [GitHub security advisory](https://github.com/kennethlng/claude-channels/security/advisories/new), or
- Email the maintainer (see the GitHub profile at https://github.com/kennethlng).

Please include steps to reproduce and the affected version. You'll get an
acknowledgement, and a fix or mitigation will be coordinated before public
disclosure.

## Scope / what to keep in mind

This tool handles credentials and exposes a webhook, so the sensitive surfaces are:

- **The sender allowlist is the primary trust boundary.** Anyone an allowlisted
  sender can approve the session's tool-use prompts (Bash/Write/Edit). Keep
  `CHANNEL_ALLOWLIST` tight.
- **The webhook endpoint is internet-facing** (via your tunnel). Inbound requests
  are HMAC-verified against `SPECTRUM_WEBHOOK_SECRET`, deduplicated, and
  size-bounded; a missing/invalid signature is rejected.
- **Credentials** (`SPECTRUM_PROJECT_SECRET`, `SPECTRUM_WEBHOOK_SECRET`) live in
  `~/.claude/channels/photon/.env` (or `$CHANNEL_ENV_FILE`), never in the repo or
  the plugin manifest. They are redacted from logs.
- **stdout is the MCP transport** — the process logs only to stderr.

Untrusted content from inbound messages and from Claude Code's permission
`description`/`input_preview` fields is treated as inert text.
