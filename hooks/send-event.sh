#!/bin/sh
# Forwards the hook payload (stdin) to the Sublet server.
# If the server is not running, nothing happens: short timeout, errors ignored,
# so Claude Code is never slowed down or blocked.
curl -s -m 1 -o /dev/null -X POST \
  -H 'content-type: application/json' \
  --data-binary @- \
  "http://127.0.0.1:${SUBLET_PORT:-4317}/event" 2>/dev/null || true
exit 0
