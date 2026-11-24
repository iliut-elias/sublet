#!/usr/bin/env bash
# Leitet die Hook-Payload (stdin) an den Agent-Haus-Server weiter.
# Läuft der Server nicht, passiert nichts: kurzer Timeout, Fehler werden ignoriert,
# damit Claude Code nie blockiert wird.
curl -s -m 1 -o /dev/null -X POST \
  -H 'content-type: application/json' \
  --data-binary @- \
  "http://127.0.0.1:${AGENT_HAUS_PORT:-4317}/event" || true
exit 0
