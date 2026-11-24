#!/bin/sh
# PermissionRequest hook: asks the Agent-Haus whether the request is allowed or denied in the browser.
# If nobody answers there (switch off, no browser open, 60 s over, server not running), it prints nothing
# and Claude Code shows its normal dialog in the terminal.
curl -s -m 65 -X POST -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:${AGENT_HAUS_PORT:-4317}/permission" 2>/dev/null || true
exit 0
