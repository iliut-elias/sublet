#!/bin/sh
# SessionStart hook: forwards the event to Sublet and asks Claude to give its subagents names,
# which the house shows on the room signs. Set SUBLET_NAMES=0 to leave the names out.
curl -s -m 1 -o /dev/null -X POST -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:${SUBLET_PORT:-4317}/event" 2>/dev/null || true
[ "${SUBLET_NAMES:-1}" = "0" ] && exit 0
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"The user watches this session in Sublet, a pixel house where every subagent lives in its own room with a name sign. When you start a subagent with the Agent tool, begin its `description` with a nickname in square brackets: `[Name] short task`, for example `[Pixel] check index.html for errors`. Rules: one word, at most 16 characters, a playful nickname that fits the task (not a plain job title like \"Reader\"), made up fresh each time, never two alike in one session; keep the rest of the description a short task of 3-6 words. The name is only for display: for SendMessage always use the agent ID you get back when the agent starts, not the name."}}
JSON
exit 0
