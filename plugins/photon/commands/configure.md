---
description: Scaffold or inspect the photon channel's credentials file (~/.claude/channels/photon/.env)
argument-hint: "[KEY=value ...]  (optional; otherwise a template is written for you to fill in)"
allowed-tools: Bash(mkdir:*), Bash(chmod:*), Bash(test:*), Write, Read
---

You are configuring the **photon** Claude Code channel. Its runtime reads
credentials from `~/.claude/channels/photon/.env` at startup (first of
`$CHANNEL_ENV_FILE`, `./.env`, then that path). Set it up as follows.

The arguments passed to this command (if any) are: `$ARGUMENTS`

1. Ensure the directory exists: `mkdir -p ~/.claude/channels/photon`.

2. Check whether `~/.claude/channels/photon/.env` already exists.

   - **If it exists:** read it and report which of the keys below are set vs.
     blank — report only `set` or `missing` for each, **never print a secret
     value**. Then stop unless the user asked to change something.

   - **If it does NOT exist:** write it with this template (keep the comments),
     then `chmod 600 ~/.claude/channels/photon/.env`:

     ```
     # Photon / Spectrum Cloud credentials (from https://app.photon.codes)
     SPECTRUM_PROJECT_ID=
     SPECTRUM_PROJECT_SECRET=
     # Local webhook listener port; your tunnel forwards to this
     WEBHOOK_PORT=8787
     # Your public HTTPS webhook URL (e.g. ngrok), registered in the Photon dashboard
     WEBHOOK_PUBLIC_URL=
     # HMAC secret shared with Photon to verify inbound webhooks are genuine
     SPECTRUM_WEBHOOK_SECRET=
     # Comma-separated iMessage handles allowed to drive/approve (e.g. +15551234567)
     CHANNEL_ALLOWLIST=
     ```

3. If the user supplied any `KEY=value` pairs in the arguments above, set those
   exact values in the file instead of leaving them blank (still `chmod 600`).
   Do not echo back the values of `SPECTRUM_PROJECT_SECRET` or
   `SPECTRUM_WEBHOOK_SECRET`.

4. Tell the user the path (`~/.claude/channels/photon/.env`), which keys still
   need filling in, and the remaining setup:
   - start a tunnel: `ngrok http 8787` (match `WEBHOOK_PORT`)
   - register that HTTPS URL **and** the webhook secret in the Photon dashboard
   - launch: `claude --dangerously-load-development-channels plugin:photon@kennethlng-channels`
   - note: a free ngrok URL changes on restart — update `WEBHOOK_PUBLIC_URL` and
     re-register when it does.

Never print secret values back to the user.
