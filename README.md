# Agent-Haus

Zeigt laufende Claude-Code-Sessions als Pixel-Haus: Oben in der Chefetage sitzt der Haupt-Agent, jeder Subagent hat einen eigenen Raum, und alle Figuren zeigen live, was sie gerade tun.

## Starten
```bash
node server.mjs          # dann http://127.0.0.1:4317 öffnen
claude                   # in einem beliebigen Ordner, wie immer
```
Node 24, keine npm-Abhängigkeiten.

## Aufbau
| Datei | Aufgabe |
|---|---|
| `server.mjs` | Lokaler Server auf `127.0.0.1:4317`. Nimmt Hook-Ereignisse an, merkt sich den Zustand, streamt per Server-Sent Events an den Browser, liefert `public/` aus. |
| `hooks/send-event.sh` | Hook für alle Ereignisse: schickt die Payload per curl an den Server. Läuft der Server nicht, passiert nichts. |
| `hooks/permission.sh` | Hook für `PermissionRequest`: fragt das Haus, ob du im Browser erlaubst oder ablehnst. |
| `public/haus.js` | Das Haus: Canvas in Spielpixeln, Figuren, Wege, Tageszeit, Sounds, Panel, Replay, Rückfragen. |
| `public/text.html` | Einfache Textansicht. |
| `data/events.jsonl` | Alle Ereignisse mit Zeitstempel (für Replay, nicht im Git). |
| `CLAUDE.md` | Bittet Claude, Subagents mit `[Name] Aufgabe` zu benennen. |

Die Hooks stehen global in `~/.claude/settings.json`, deshalb erscheint jede Session im Haus, egal in welchem Ordner.

## Was im Haus passiert
| Ereignis | Im Haus |
|---|---|
| Session startet | Chef kommt durch die Tür und klettert in die Chefetage |
| Subagent startet | Figur kommt durch die Tür (nacheinander, wenn mehrere), sagt ihren Auftrag, klettert in ihren Raum |
| Tool-Aufruf | Figur tippt am Tisch, Monitor zeigt Code, Sprechblase sagt was |
| SendMessage | Absender läuft in den Raum des Empfängers und sagt seine Nachricht |
| Subagent fertig | Figur bringt den Bericht zum Chef, geht zurück und schläft (Zzz, Licht aus) |
| Rückfrage | gelbe Sprechblase mit „!“ und, falls eingeschaltet, eine Karte zum Erlauben/Ablehnen |
| Chef wartet auf dich | Chef schlendert durch die Chefetage |

Weitere Details:
- **Namen:** aus `[Name]` in der Agent-Beschreibung, sonst Ersatzname nach Typ („Späher 1“).
- **Möbel nach Typ:** Explore hat eine Landkarte, Plan ein Whiteboard, andere ein Bild. Wer das Terminal oft benutzt, bekommt einen zweiten Bildschirm.
- **Tageszeit nach Uhrzeit:** Nacht, Morgen, Tag, Abend. Zum Testen `?zeit=tag`.
- **Sounds:** Knopf „Ton“, standardmäßig aus.
- **Replay:** Knopf „Replay“ spielt gespeicherte Sessions im Zeitraffer als eigenes Haus ab.
- Die Figuren sind eigene Pixel-Wesen, ohne Anthropic-Branding.

## Rückfragen im Haus beantworten
Der Schalter „Erlauben im Haus“ ist standardmäßig aus und nach jedem Server-Neustart wieder aus.

Ist er an und das Haus offen, wartet der `PermissionRequest`-Hook bis zu 60 Sekunden auf deine Antwort im Browser, danach fragt Claude Code ganz normal im Terminal. Ist er aus oder kein Browser verbunden, antwortet der Hook sofort leer.

**Sicherheit:**
- Der Server hört nur auf `127.0.0.1`.
- Er lehnt fremde `Host`-Header ab (Schutz gegen DNS-Rebinding).
- Er lehnt Browser-Anfragen von fremden Webseiten ab (`Origin`-Prüfung).
- **Grenze:** Ein Programm auf demselben Rechner, das selbst HTTP-Anfragen an `127.0.0.1` schicken kann, kann den Browser nachahmen. Das gilt auch für einen Agent mit Terminal-Rechten. Deshalb den Schalter nur einschalten, wenn du gerade zuschaust.

## Wie ein Agent erkannt wird
- Jedes Hook-Ereignis aus einem Subagent hat `agent_id` und `agent_type`. Fehlt `agent_id`, ist es der Haupt-Agent.
- `SubagentStart` hat keine `tool_use_id`. Die Aufgabe wird deshalb über die Reihenfolge der Agent-Aufrufe zugeordnet.
- Bei `SendMessage` steht der Empfänger in `to` (Agent-ID). Danach meldet derselbe Agent noch einmal `SubagentStart`, weil er weiterarbeitet.
