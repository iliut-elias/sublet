# Agent-Haus

Macht laufende Claude-Code-Sessions sichtbar: Haupt-Agent und Subagents mit dem, was sie gerade tun.

## Stand (Schritt 3): Pixel-Haus
- `public/index.html` + `public/haus.js`: das Haus als Pixel-Art auf einem Canvas, ohne Bibliotheken.
  Oben die Chefetage (Haupt-Agent mit Krone), darunter ein Raum pro Subagent, unten die Lobby, links die Leiter.
  Klick auf einen Raum zeigt rechts Aufgabe, Status, letzte Antwort und Verlauf.
- `public/text.html`: die einfache Textansicht von vorher.
- `server.mjs`: lokaler Server ohne Abhängigkeiten (Node 24), Port 4317. `POST /event` nimmt Hook-Ereignisse an, `GET /stream` streamt sie per Server-Sent Events, alles andere kommt aus `public/`.
- `hooks/send-event.sh`: Hook-Skript, leitet die Payload per curl weiter. Läuft der Server nicht, passiert nichts.
- Die Hooks stehen global in `~/.claude/settings.json` und rufen `hooks/send-event.sh` auf. Damit erscheint jede Claude-Code-Session im Haus, egal in welchem Ordner. Läuft der Server nicht, tun sie nichts.
- Rohdaten landen in `data/events.jsonl` (nicht im Git).

## Starten
```bash
node server.mjs          # dann http://127.0.0.1:4317 öffnen
claude                   # in einem zweiten Terminal, in einem beliebigen Ordner
```

## Wie ein Agent erkannt wird
Jedes Hook-Ereignis aus einem Subagent hat `agent_id` und `agent_type`, ohne `agent_id` ist es der Haupt-Agent.
`SubagentStart` hat keine `tool_use_id`, deshalb wird die Aufgabe über die Reihenfolge der Agent-Aufrufe zugeordnet.

## Namen der Subagents
`CLAUDE.md` bittet den Haupt-Agent, jedem Subagent einen Namen zu geben: `[Name] Aufgabe` in der `description`.
Der Server liest den Namen heraus. Fehlt er, gibt es einen Ersatznamen nach Typ (z. B. „Späher 1“ für Explore).

## Was im Haus passiert
| Ereignis | Animation |
|---|---|
| Session startet | Chef kommt durch die Tür und klettert in die Chefetage |
| Subagent startet | Figur kommt unten durch die Tür (nacheinander, wenn mehrere), klettert in ihren Raum |
| Tool-Aufruf | Figur sitzt am Tisch und tippt, Monitor zeigt Code, Sprechblase sagt was |
| Rückfrage / Berechtigung | gelbe Sprechblase mit „!“ |
| Subagent fertig | Figur bringt den Bericht zum Chef, geht zurück und schläft (Zzz, Licht aus) |
| Chef wartet auf dich | Chef schlendert durch die Chefetage |

Die Figuren sind eigene Pixel-Wesen (kein Anthropic-Branding). Farbe und Accessoire hängen an der Raumnummer, damit Nachbarn verschieden aussehen.
Die Szene füllt den ganzen Bildschirm, Texte sind HTML über dem Canvas (scharf statt Canvas-Text). Das Panel öffnet per Klick auf einen Raum (Esc schließt).
