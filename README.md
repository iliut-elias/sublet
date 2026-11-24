# Agent-Haus

Macht laufende Claude-Code-Sessions sichtbar: Haupt-Agent und Subagents mit dem, was sie gerade tun.

## Stand (Schritt 2): Live-Text
- `server.mjs`: lokaler Server ohne Abhängigkeiten (Node 24), Port 4317. `POST /event` nimmt Hook-Ereignisse an, `GET /stream` streamt sie per Server-Sent Events, `/` zeigt die Seite.
- `hooks/send-event.sh`: Hook-Skript, leitet die Payload per curl weiter. Läuft der Server nicht, passiert nichts.
- `.claude/settings.json`: Hooks nur für dieses Projekt.
- Rohdaten landen in `data/events.jsonl` (nicht im Git).

## Starten
```bash
node server.mjs          # dann http://127.0.0.1:4317 öffnen
claude                   # in einem zweiten Terminal, in diesem Ordner
```

## Wie ein Agent erkannt wird
Jedes Hook-Ereignis aus einem Subagent hat `agent_id` und `agent_type`, ohne `agent_id` ist es der Haupt-Agent.
`SubagentStart` hat keine `tool_use_id`, deshalb wird die Aufgabe über die Reihenfolge der Agent-Aufrufe zugeordnet.

## Namen der Subagents
`CLAUDE.md` bittet den Haupt-Agent, jedem Subagent einen Namen zu geben: `[Name] Aufgabe` in der `description`.
Der Server liest den Namen heraus. Fehlt er, gibt es einen Ersatznamen nach Typ (z. B. „Späher 1“ für Explore).
