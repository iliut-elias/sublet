#!/usr/bin/env bash
# PermissionRequest-Hook: fragt das Agent-Haus, ob die Anfrage im Browser erlaubt oder abgelehnt wird.
# Antwortet dort niemand (Schalter aus, kein Browser offen, 60 s vorbei, Server aus),
# gibt das Skript nichts aus und Claude Code zeigt ganz normal den Dialog im Terminal.
curl -s -m 65 -X POST -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:${AGENT_HAUS_PORT:-4317}/permission" 2>/dev/null || true
exit 0
