# Agent-Haus

Dieses Projekt zeigt Claude-Code-Sessions live als Haus mit Agent-Figuren (siehe README.md).

## Subagents benennen
Jeder Subagent wohnt im Haus in einem eigenen Raum und trägt dort einen Namen.
Wenn du einen Subagent startest (Agent-Tool), denk dir einen eigenen Namen für ihn aus
und schreib ihn in eckigen Klammern an den Anfang der `description`.

Format: `[Name] kurze Aufgabe`, z. B. `[Name] index.html auf Fehler prüfen`.

Regeln:
- Ein Wort, höchstens 16 Zeichen, mit Charakter und passend zur Aufgabe
  (ein Spitzname wie für eine Figur, keine reine Funktionsbezeichnung wie "Reader").
- Jedes Mal neu ausdenken, keine festen Lieblingsnamen wiederverwenden.
- Keine zwei gleichen Namen in einer Session.
- Der Rest der Beschreibung bleibt eine kurze Aufgabe (3–6 Wörter).

Der Name ist nur für die Anzeige im Haus. Für `SendMessage` an einen Subagent nimm seine
**Agent-ID** (die du beim Start zurückbekommst), nicht den Namen aus den Klammern.
