# Sublet – notes for working on this repo

Shows Claude Code sessions live as a pixel house (see README.md). It is also a Claude Code plugin:
`.claude-plugin/` holds the plugin and marketplace manifests, `hooks/hooks.json` the hooks.

## Rules
- No npm dependencies and no build step. Node 20+ on the server, plain browser JavaScript in `public/`.
- Every visible text exists in English and German in `public/i18n.js`. The server sends language-neutral
  messages as `[key, params]` (see `describeTool` and `ingest` in `server.mjs`) and never finished text.
- Store as little as possible: `sanitize()` in `server.mjs` decides what reaches the log. Never store
  file contents, tool output or full commands.
- Hook scripts are POSIX `sh` with `curl`, must stay fast and must never block Claude Code (short timeouts, `|| true`).
- The server only listens on 127.0.0.1 and checks `Host` and `Origin`. Keep it that way for every new endpoint.

## Testing
- `node server.mjs`, then `node tools/demo.mjs` plays a made-up session (not stored, not in Replay).
- `?time=night|morning|day|evening` and `?lang=en|de` in the URL.
- Use a separate port and data folder for experiments: `SUBLET_PORT=4399 SUBLET_DATA=/tmp/ah node server.mjs`.
- Plugin: `claude --plugin-dir .`. If the plugin is installed too, every event arrives twice.

## Hook facts (Claude Code 2.1.331)
- Subagent events carry `agent_id` and `agent_type`; without `agent_id` it is the main agent.
- `SubagentStart` has no `tool_use_id`: tasks are matched by the order of the Agent tool calls.
- `SendMessage`: the recipient is in `tool_input.to` (agent ID); afterwards the same agent sends `SubagentStart` again.
- `PermissionRequest` answer: `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
  or `{"behavior":"deny","message":"..."}`. Empty output means Claude Code asks in the terminal.
