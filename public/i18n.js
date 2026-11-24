// Sublet – texts in English and German.
// Language: ?lang=en|de, otherwise the browser language (German for "de-*", English for everything else).
// The server sends language-neutral messages as [key, params]; tr() turns them into text here.
"use strict";

const LANG = (() => {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "en" || q === "de") return q;
  return String(navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en";
})();
document.documentElement.lang = LANG;

const TYPE_NAMES = {
  en: { "general-purpose": "Helper", Explore: "Scout", Plan: "Planner" },
  de: { "general-purpose": "Helfer", Explore: "Späher", Plan: "Planer" },
};

const STR = {
  en: {
    // header and page
    "page.label": "Sublet: pixel view of the running Claude Code agents",
    "conn.connecting": "connecting …",
    "conn.live": "live",
    "conn.lost": "connection lost, retrying …",
    "btn.replay": "Replay",
    "btn.sound": (p) => `Sound: ${p.on ? "on" : "off"}`,
    "btn.sound.title": "Turn sounds on or off",
    "btn.notify": (p) => `Notify: ${p.on ? "on" : "off"}`,
    "btn.notify.title": "Desktop notification when Claude is waiting for you and this tab is in the background",
    "btn.notify.denied": "The browser blocks notifications for this page",
    "btn.perm": (p) => `Answer in house: ${p.on ? "on" : "off"}`,
    "btn.perm.title": "Answer Claude's permission requests here in the house. Careful: any program on this computer that can send HTTP requests to 127.0.0.1 could answer them too. Off again after a server restart.",
    "link.text": "Text view",
    "link.house": "to the house",
    "hint.noSession": "No session yet: start claude in any folder.",
    "hint.clickRoom": "Click a room to see what the agent is doing.",
    "title.waiting": (p) => `(!) ${p.dir}: Claude is waiting`,
    // house
    "plaque.boss": (p) => `Boss · ${p.dir}`,
    "plaque.bossEmpty": "Top floor",
    "plaque.free": "vacant",
    "sign": "SUBLET",
    "status.working": "working",
    "status.idle": "idle",
    "status.waiting": "needs you",
    "status.done": "done",
    "status.gone": "session over",
    "status.departed": "moved out",
    // speech bubbles
    "say.task": (p) => `Task: ${p.task || "?"}`,
    "say.newSession": "New session!",
    "say.report": "Report's ready!",
    "say.thanks": (p) => `Thanks, ${p.name}!`,
    "say.pack": "Packing up.",
    "say.bye": "Bye!",
    "say.question": "Quick question …",
    "say.lookAt": "Thanks, I'll take a look!",
    "say.onIt": "Okay, on it!",
    "say.unreachable": "Hm, can't reach them.",
    "say.comeBack": (p) => `${p.name}, please come back!`,
    "say.movedOut": (p) => `${p.name} has already moved out.`,
    "say.back": "I'm back!",
    "say.hmm": "Hmm?",
    "say.waiting": "waiting for you",
    // panel
    "panel.close": "Close (Esc)",
    "panel.type": "Type",
    "panel.task": "Task",
    "panel.now": "Now",
    "panel.tools": "Tools",
    "panel.lastAnswer": "Last answer",
    "panel.departed": "Moved out",
    "panel.log": "Log",
    "type.main": "main agent",
    // replay
    "replay.loading": "loading …",
    "replay.speed": "Speed",
    "replay.title": "Replay a session",
    "replay.none": "No saved sessions yet.",
    "replay.off": "The log is off (SUBLET_LOG=0), so there is nothing to replay.",
    "replay.noTime": "no timestamp",
    "replay.subagents": (p) => `${p.n} subagent${p.n === 1 ? "" : "s"}`,
    "replay.events": (p) => `${p.n} events`,
    "replay.tab": "Replay",
    // permission cards
    "perm.allow": "Allow",
    "perm.deny": "Deny",
    "perm.wants": (p) => `wants to: ${p.x}`,
    "perm.jump": "Jump to the agent",
    "perm.left": (p) => `${p.s} s left, then in the terminal`,
    "perm.expiring": "expiring …",
    // text view
    "text.empty": "No events yet. Start a Claude Code session in any folder.",
    // names
    "name.main": "Main agent",
    "name.agent": "Agent",
    // messages from the server
    "tool.bash": (p) => `Terminal: ${p.d}`,
    "tool.read": (p) => `reads ${p.f}`,
    "tool.write": (p) => `writes ${p.f}`,
    "tool.edit": (p) => `edits ${p.f}`,
    "tool.grep": (p) => `searches for “${p.p}”`,
    "tool.glob": (p) => `looks for files ${p.p}`,
    "tool.fetch": (p) => `reads web page ${p.u}`,
    "tool.search": (p) => `searches the web: ${p.q}`,
    "tool.agent": (p) => `assigns ${p.who || "an agent"}: ${p.task}`,
    "tool.todo": "plans tasks",
    "tool.send": (p) => `writes: ${p.m}`,
    "tool.other": (p) => p.n,
    "act.readsPrompt": "reads your request",
    "act.thinking": "thinking",
    "act.continues": "carries on",
    "act.movingIn": "moving in",
    "act.done": "done",
    "act.asks": (p) => `asks: ${p.x}`,
    "act.waitsForYou": "waiting for you",
    "act.waits": "waiting",
    "ev.start": (p) => `Session started (${p.src})`,
    "ev.prompt": (p) => `Request: ${p.p}`,
    "ev.toolDone": (p) => `done: ${p.x}`,
    "ev.toolFail": (p) => `failed: ${p.x}${p.err ? " – " + p.err : ""}`,
    "ev.visit": (p) => `visits ${p.who}: ${p.m}`,
    "ev.visitFail": (p) => `tried to reach ${p.who}, not delivered`,
    "ev.continues": (p) => `${p.who} carries on`,
    "ev.movesIn": (p) => `${p.who} moves in (${p.type}): ${p.task}`,
    "ev.finished": (p) => `${p.who} finished: ${p.r}`,
    "ev.wants": (p) => `wants to: ${p.x}`,
    "ev.note": (p) => `Notice: ${p.m}`,
    "ev.answer": (p) => `Answer ready: ${p.r}`,
    "ev.end": (p) => `Session ended (${p.why})`,
    "ev.other": (p) => p.n,
  },
  de: {
    "page.label": "Sublet: Pixel-Ansicht der laufenden Claude-Code-Agents",
    "conn.connecting": "verbinde …",
    "conn.live": "live",
    "conn.lost": "Verbindung weg, versuche neu …",
    "btn.replay": "Replay",
    "btn.sound": (p) => `Ton: ${p.on ? "an" : "aus"}`,
    "btn.sound.title": "Töne an/aus",
    "btn.notify": (p) => `Melden: ${p.on ? "an" : "aus"}`,
    "btn.notify.title": "Desktop-Benachrichtigung, wenn Claude auf dich wartet und dieser Tab im Hintergrund ist",
    "btn.notify.denied": "Der Browser blockiert Benachrichtigungen für diese Seite",
    "btn.perm": (p) => `Erlauben im Haus: ${p.on ? "an" : "aus"}`,
    "btn.perm.title": "Rückfragen von Claude (Berechtigungen) hier im Haus beantworten. Achtung: Jedes Programm auf diesem Rechner, das HTTP-Anfragen an 127.0.0.1 schicken kann, könnte dann auch antworten. Nach einem Server-Neustart wieder aus.",
    "link.text": "Textansicht",
    "link.house": "zum Haus",
    "hint.noSession": "Noch keine Session: starte claude in einem beliebigen Ordner.",
    "hint.clickRoom": "Klick auf einen Raum, um zu sehen, was der Agent macht.",
    "title.waiting": (p) => `(!) ${p.dir}: Claude wartet`,
    "plaque.boss": (p) => `Chef · ${p.dir}`,
    "plaque.bossEmpty": "Chefetage",
    "plaque.free": "frei",
    "sign": "SUBLET",
    "status.working": "arbeitet",
    "status.idle": "frei",
    "status.waiting": "braucht dich",
    "status.done": "fertig",
    "status.gone": "Session vorbei",
    "status.departed": "ausgezogen",
    "say.task": (p) => `Auftrag: ${p.task || "?"}`,
    "say.newSession": "Neue Session!",
    "say.report": "Bericht ist fertig!",
    "say.thanks": (p) => `Danke, ${p.name}!`,
    "say.pack": "Ich pack zusammen.",
    "say.bye": "Tschüss!",
    "say.question": "Kurze Frage …",
    "say.lookAt": "Danke, schau ich mir an!",
    "say.onIt": "Okay, mach ich!",
    "say.unreachable": "Hm, nicht erreichbar.",
    "say.comeBack": (p) => `${p.name}, komm bitte nochmal!`,
    "say.movedOut": (p) => `${p.name} ist schon ausgezogen.`,
    "say.back": "Bin wieder da!",
    "say.hmm": "Hm?",
    "say.waiting": "wartet auf dich",
    "panel.close": "Schließen (Esc)",
    "panel.type": "Typ",
    "panel.task": "Aufgabe",
    "panel.now": "Gerade",
    "panel.tools": "Tools",
    "panel.lastAnswer": "Letzte Antwort",
    "panel.departed": "Ausgezogen",
    "panel.log": "Verlauf",
    "type.main": "Haupt-Agent",
    "replay.loading": "lade …",
    "replay.speed": "Tempo",
    "replay.title": "Session abspielen",
    "replay.none": "Noch keine gespeicherten Sessions.",
    "replay.off": "Das Log ist aus (SUBLET_LOG=0), es gibt nichts zum Abspielen.",
    "replay.noTime": "ohne Zeitstempel",
    "replay.subagents": (p) => `${p.n} Subagent${p.n === 1 ? "" : "s"}`,
    "replay.events": (p) => `${p.n} Ereignisse`,
    "replay.tab": "Replay",
    "perm.allow": "Erlauben",
    "perm.deny": "Ablehnen",
    "perm.wants": (p) => `möchte: ${p.x}`,
    "perm.jump": "Zum Agent springen",
    "perm.left": (p) => `noch ${p.s} s, dann im Terminal`,
    "perm.expiring": "läuft ab …",
    "text.empty": "Noch keine Ereignisse. Starte eine Claude-Code-Session in einem beliebigen Ordner.",
    "name.main": "Haupt-Agent",
    "name.agent": "Agent",
    "tool.bash": (p) => `Terminal: ${p.d}`,
    "tool.read": (p) => `liest ${p.f}`,
    "tool.write": (p) => `schreibt ${p.f}`,
    "tool.edit": (p) => `bearbeitet ${p.f}`,
    "tool.grep": (p) => `sucht nach „${p.p}“`,
    "tool.glob": (p) => `sucht Dateien ${p.p}`,
    "tool.fetch": (p) => `liest Webseite ${p.u}`,
    "tool.search": (p) => `sucht im Web: ${p.q}`,
    "tool.agent": (p) => `beauftragt ${p.who || "Agent"}: ${p.task}`,
    "tool.todo": "plant Aufgaben",
    "tool.send": (p) => `schreibt: ${p.m}`,
    "tool.other": (p) => p.n,
    "act.readsPrompt": "liest deinen Auftrag",
    "act.thinking": "denkt nach",
    "act.continues": "macht weiter",
    "act.movingIn": "zieht ein",
    "act.done": "fertig",
    "act.asks": (p) => `fragt: ${p.x}`,
    "act.waitsForYou": "wartet auf dich",
    "act.waits": "wartet",
    "ev.start": (p) => `Session gestartet (${p.src})`,
    "ev.prompt": (p) => `Auftrag: ${p.p}`,
    "ev.toolDone": (p) => `fertig: ${p.x}`,
    "ev.toolFail": (p) => `fehlgeschlagen: ${p.x}${p.err ? " – " + p.err : ""}`,
    "ev.visit": (p) => `besucht ${p.who}: ${p.m}`,
    "ev.visitFail": (p) => `wollte ${p.who} erreichen, nicht zugestellt`,
    "ev.continues": (p) => `${p.who} macht weiter`,
    "ev.movesIn": (p) => `${p.who} zieht ein (${p.type}): ${p.task}`,
    "ev.finished": (p) => `${p.who} fertig: ${p.r}`,
    "ev.wants": (p) => `möchte: ${p.x}`,
    "ev.note": (p) => `Hinweis: ${p.m}`,
    "ev.answer": (p) => `Antwort fertig: ${p.r}`,
    "ev.end": (p) => `Session beendet (${p.why})`,
    "ev.other": (p) => p.n,
  },
};

/** Display name of an agent: its own name, "Main agent", or a fallback like "Scout 2". */
function agentName(p) {
  if (!p) return t("name.agent");
  if (p.main || p.key === "main") return t("name.main");
  if (p.name) return p.name;
  const type = TYPE_NAMES[LANG][p.type] || p.type || t("name.agent");
  return p.n || p.num ? `${type} ${p.n || p.num}` : type;
}

/** Text for a key. Parameters that are messages themselves ([key, params]) are translated first. */
function t(key, params = {}) {
  if (key === "name") return agentName(params);
  const s = STR[LANG][key] ?? STR.en[key];
  if (s == null) return key;
  if (typeof s !== "function") return s;
  const p = {};
  for (const [k, v] of Object.entries(params)) p[k] = Array.isArray(v) ? tr(v) : v;
  return s(p);
}

/** A server message ([key, params]) or plain text to display text. */
function tr(m) {
  if (m == null) return "";
  if (Array.isArray(m)) return t(m[0], m[1] || {});
  return String(m);
}

/** Static texts in the HTML: data-i18n (text), data-i18n-title (tooltip), data-i18n-label (aria-label). */
function applyStaticTexts(root = document) {
  for (const e of root.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
  for (const e of root.querySelectorAll("[data-i18n-title]")) e.title = t(e.dataset.i18nTitle);
  for (const e of root.querySelectorAll("[data-i18n-label]")) e.setAttribute("aria-label", t(e.dataset.i18nLabel));
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString(LANG === "de" ? "de-AT" : "en-GB", { hour12: false });
