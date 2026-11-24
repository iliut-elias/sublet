// Agent-Haus: nimmt Hook-Ereignisse von Claude Code an und streamt sie per SSE an den Browser.
// Start: node server.mjs   ->   http://127.0.0.1:4317
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.AGENT_HAUS_PORT || 4317);
const HOST = "127.0.0.1";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(ROOT, "data", "events.jsonl");
const MAX_HISTORY = 500;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

/** Zustand: sessionId -> { id, cwd, startedAt, agents: Map<agentKey, agent>, pendingTasks: [] } */
const sessions = new Map();
const history = [];
const clients = new Set();

function short(text, n = 120) {
  if (text == null) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Der Haupt-Agent schreibt "[Name] Aufgabe" in die description (siehe CLAUDE.md). */
function parseTask(desc) {
  const s = short(desc, 80);
  const m = s.match(/^\[([^\]]{1,24})\]\s*(.*)$/);
  return m ? { name: m[1].trim(), task: m[2] || m[1].trim() } : { name: "", task: s };
}

/** Ersatzname, falls der Haupt-Agent keinen vergeben hat: Typ + laufende Nummer. */
const TYPE_LABELS = { "general-purpose": "Helfer", Explore: "Späher", Plan: "Planer" };
function fallbackName(s, type) {
  s.typeCounts[type] = (s.typeCounts[type] || 0) + 1;
  return `${TYPE_LABELS[type] || type} ${s.typeCounts[type]}`;
}

/** Macht aus Tool + Eingabe einen kurzen, lesbaren Satz. */
function describeTool(name, input = {}) {
  const file = (p) => (p ? path.basename(p) : "");
  switch (name) {
    case "Bash": return `Terminal: ${short(input.description || input.command, 80)}`;
    case "Read": return `liest ${file(input.file_path)}`;
    case "Write": return `schreibt ${file(input.file_path)}`;
    case "Edit":
    case "MultiEdit": return `bearbeitet ${file(input.file_path)}`;
    case "Grep": return `sucht nach „${short(input.pattern, 40)}“`;
    case "Glob": return `sucht Dateien ${short(input.pattern, 40)}`;
    case "WebFetch": return `liest Webseite ${short(input.url, 60)}`;
    case "WebSearch": return `sucht im Web: ${short(input.query, 60)}`;
    case "Agent":
    case "Task": {
      const { name: who, task } = parseTask(input.description);
      return `beauftragt ${who || "Agent"}: ${task}`;
    }
    case "TodoWrite": return "plant Aufgaben";
    case "SendMessage": return `schreibt: ${short(input.summary || input.message, 60)}`;
    default: return name;
  }
}

/** Findet den Empfänger einer SendMessage: per Agent-ID, Name oder als Haupt-Agent. */
function resolveAgent(s, to) {
  if (!to) return null;
  const t = String(to).toLowerCase();
  for (const a of s.agents.values()) {
    if (a.key.toLowerCase() === t || (a.name && a.name.toLowerCase() === t)) return a;
  }
  if (["main", "lead", "team-lead", "leader", "haupt-agent", "chef"].includes(t)) return s.agents.get("main") || null;
  return null;
}

function getSession(e) {
  let s = sessions.get(e.session_id);
  if (!s) {
    s = { id: e.session_id, cwd: e.cwd, startedAt: Date.now(), agents: new Map(), pendingTasks: [], typeCounts: {} };
    sessions.set(e.session_id, s);
  }
  if (e.cwd) s.cwd = e.cwd;
  return s;
}

function getAgent(s, e) {
  const key = e.agent_id || "main";
  let a = s.agents.get(key);
  if (!a) {
    a = {
      key,
      type: e.agent_id ? e.agent_type || "subagent" : "main",
      name: e.agent_id ? "" : "Haupt-Agent",
      task: e.agent_id ? "" : "Haupt-Agent",
      status: "idle",
      activity: "",
      startedAt: Date.now(),
      lastAt: Date.now(),
      tools: 0,
    };
    s.agents.set(key, a);
  }
  return a;
}

/** Verarbeitet ein Roh-Ereignis, aktualisiert den Zustand und liefert eine schlanke Meldung für den Browser. */
function ingest(e, now = Date.now()) {
  const s = getSession(e);
  const ev = e.hook_event_name;
  
  const existed = s.agents.has(e.agent_id || "main");
  let a = getAgent(s, e);
  let text = "";
  let visit = null;

  switch (ev) {
    case "SessionStart":
      a.status = "idle";
      text = `Session gestartet (${e.source || "?"})`;
      break;
    case "UserPromptSubmit":
      a.status = "working";
      a.activity = "liest deinen Auftrag";
      text = `Auftrag: ${short(e.prompt, 160)}`;
      break;
    case "PreToolUse": {
      a.status = "working";
      a.activity = describeTool(e.tool_name, e.tool_input);
      a.tools++;
      text = a.activity;
      if ((e.tool_name === "Agent" || e.tool_name === "Task") && !e.agent_id) {
        s.pendingTasks.push(parseTask(e.tool_input?.description || e.tool_input?.prompt));
      }
      break;
    }
    case "PostToolUse":
      text = `fertig: ${describeTool(e.tool_name, e.tool_input)}`;
      a.activity = "denkt nach";
      if (e.tool_name === "SendMessage") {
        // Besuch erst jetzt, wenn feststeht, ob die Nachricht angekommen ist
        const ti = e.tool_input || {};
        const target = resolveAgent(s, ti.to || ti.recipient);
        const ok = !(e.tool_response && e.tool_response.success === false);
        const what = short(ti.summary || ti.message, 60);
        if (target && target !== a) {
          visit = { to: target.key, text: what, ok };
          text = ok ? `besucht ${target.name || "Agent"}: ${what}` : `wollte ${target.name || "Agent"} erreichen, nicht zugestellt`;
        }
      }
      break;
    case "PostToolUseFailure":
      text = `fehlgeschlagen: ${describeTool(e.tool_name, e.tool_input)}${e.error ? " – " + short(e.error, 80) : ""}`;
      a.activity = "denkt nach";
      break;
    case "SubagentStart": {
      if (existed && a.name) {
        // derselbe Agent macht weiter (z. B. nach einer SendMessage): Name und Aufgabe bleiben
        a.status = "working";
        a.activity = "macht weiter";
        text = `${a.name} macht weiter`;
        break;
      }
      // Kein tool_use_id im Ereignis: Aufgabe über die Reihenfolge der Agent-Aufrufe zuordnen.
      const p = s.pendingTasks.shift();
      a.task = p?.task || a.type;
      a.name = p?.name || fallbackName(s, a.type);
      a.status = "working";
      a.activity = "zieht ein";
      text = `${a.name} zieht ein (${a.type}): ${a.task}`;
      break;
    }
    case "SubagentStop":
      a.status = "done";
      a.activity = "fertig";
      a.result = short(e.last_assistant_message, 400);
      text = `${a.name || "Agent"} fertig: ${short(e.last_assistant_message, 160)}`;
      break;
    case "PermissionRequest":
      a.status = "waiting";
      a.activity = `fragt: ${describeTool(e.tool_name, e.tool_input)}`;
      text = `möchte: ${describeTool(e.tool_name, e.tool_input)}`;
      break;
    case "Notification":
      a.status = "waiting";
      a.activity = short(e.message, 80) || "wartet auf dich";
      text = `Hinweis: ${short(e.message, 160)}`;
      break;
    case "Stop":
      a.status = "idle";
      a.activity = "wartet";
      a.result = short(e.last_assistant_message, 400);
      text = `Antwort fertig: ${short(e.last_assistant_message, 160)}`;
      break;
    case "SessionEnd":
      for (const ag of s.agents.values()) ag.status = "gone";
      text = `Session beendet (${e.reason || "?"})`;
      break;
    default:
      text = ev || "unbekanntes Ereignis";
  }
  a.lastAt = now;

  return {
    t: now,
    session: s.id,
    cwd: s.cwd,
    agent: a.key,
    event: ev,
    text,
    visit,
    state: { ...a },
  };
}

function snapshot() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    cwd: s.cwd,
    startedAt: s.startedAt,
    agents: [...s.agents.values()],
  }));
}

function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

function clampSpeed(v) { const n = Number(v); return Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 4; }

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------- Schutz
// Nur Anfragen an unseren eigenen Host (gegen DNS-Rebinding) und keine fremden Webseiten (gegen CSRF).
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function hostOk(req) { return OWN_HOSTS.has(req.headers.host); }
function originOk(req, required) {
  const o = req.headers.origin;
  if (!o) return !required; // curl aus den Hooks schickt keinen Origin
  try { const u = new URL(o); return u.protocol === "http:" && OWN_HOSTS.has(u.host); } catch { return false; }
}
function json(res, code, data) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

/** Verarbeitet ein Hook-Ereignis: Zustand aktualisieren, an alle Browser schicken, optional ins Log schreiben. */
function handleEvent(e, { log }) {
  if (log) fs.appendFile(LOG_FILE, JSON.stringify({ ...e, _t: Date.now() }) + "\n", () => {});
  const msg = ingest(e);
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
  broadcast({ kind: "event", ...msg });
  return msg;
}

// ---------------------------------------------------------------- Berechtigungen im Haus beantworten
// Standardmäßig aus und nach jedem Neustart wieder aus. Ohne offenes Haus antwortet der Hook sofort leer,
// dann fragt Claude Code ganz normal im Terminal.
const PERMISSION_WAIT = 60_000;
const settings = { answerInHouse: false };
const pending = new Map(); // id -> { res, timer, info }

function finishPermission(id, decision) {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  clearTimeout(p.timer);
  if (!p.res.writableEnded) {
    if (decision) {
      const d = decision === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "Im Agent-Haus abgelehnt." };
      p.res.writeHead(200, { "content-type": "application/json" });
      p.res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } }));
    } else {
      p.res.writeHead(204).end();
    }
  }
  console.log(`Rückfrage ${p.info.name} (${p.info.what}): ${decision || "keine Antwort, weiter im Terminal"}`);
  broadcast({ kind: "permission-done", id, result: decision || "timeout" });
  return true;
}

// ---------------------------------------------------------------- Replay
function readLog() {
  try {
    return fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
function listSessions() {
  const by = new Map();
  for (const e of readLog()) {
    // nur echte Claude-Sessions (UUID), keine Replays oder Test-Ereignisse
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(e.session_id))) continue;
    let s = by.get(e.session_id);
    if (!s) { s = { id: e.session_id, cwd: e.cwd || "", first: e._t || null, last: e._t || null, events: 0, agents: new Set() }; by.set(e.session_id, s); }
    s.events++;
    if (e.cwd) s.cwd = e.cwd;
    if (e._t) { s.first = s.first ?? e._t; s.last = e._t; }
    if (e.agent_id) s.agents.add(e.agent_id);
  }
  return [...by.values()]
    .filter((s) => s.events >= 3)
    .map((s) => ({ ...s, agents: s.agents.size }))
    .reverse()
    .slice(0, 30);
}
function startReplay(sessionId, speed) {
  const events = readLog().filter((e) => e.session_id === sessionId);
  if (!events.length) return null;
  const id = `replay-${Date.now().toString(36)}`;
  let delay = 0, prevT = null;
  for (const e of events) {
    const gap = e._t && prevT ? (e._t - prevT) / speed : 300;
    delay += Math.min(2500, Math.max(60, gap));
    if (e._t) prevT = e._t;
    const copy = { ...e, session_id: id };
    delete copy._t;
    setTimeout(() => handleEvent(copy, { log: false }), delay);
  }
  return { id, events: events.length, seconds: Math.round(delay / 1000) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (!hostOk(req)) { res.writeHead(403).end(); return; }

  if (req.method === "POST" && url.pathname === "/event") {
    if (!originOk(req, false)) { res.writeHead(403).end(); return; }
    try {
      const e = JSON.parse(await readBody(req));
      if (!e.session_id || !e.hook_event_name) throw new Error("kein Hook-Ereignis");
      handleEvent(e, { log: true });
      res.writeHead(204).end();
    } catch (err) {
      res.writeHead(400, { "content-type": "text/plain" }).end(String(err.message));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/permission") {
    if (!originOk(req, false)) { res.writeHead(403).end(); return; }
    let e;
    try { e = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
    if (!e.session_id) { res.writeHead(400).end(); return; }
    const msg = handleEvent({ ...e, hook_event_name: "PermissionRequest" }, { log: true });
    if (!settings.answerInHouse || clients.size === 0) { res.writeHead(204).end(); return; }
    const id = crypto.randomUUID();
    const ti = e.tool_input || {};
    const info = {
      id, session: msg.session, cwd: msg.cwd, agent: msg.agent, name: msg.state.name || "Agent",
      what: describeTool(e.tool_name, ti),
      detail: String(ti.command || ti.file_path || ti.url || ti.pattern || JSON.stringify(ti)).slice(0, 400),
      expiresAt: Date.now() + PERMISSION_WAIT,
    };
    pending.set(id, { res, info, timer: setTimeout(() => finishPermission(id, null), PERMISSION_WAIT) });
    res.on("close", () => { if (pending.has(id)) finishPermission(id, null); }); // Claude hat aufgegeben
    broadcast({ kind: "permission", ...info });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/permission") {
    if (!originOk(req, true)) { res.writeHead(403).end(); return; }
    try {
      const { id, decision } = JSON.parse(await readBody(req, 10_000));
      if (decision !== "allow" && decision !== "deny") throw new Error();
      json(res, finishPermission(String(id), decision) ? 200 : 404, { ok: true });
    } catch {
      json(res, 400, { error: "ungültige Anfrage" });
    }
    return;
  }

  if (url.pathname === "/api/settings") {
    if (req.method === "POST") {
      if (!originOk(req, true)) { res.writeHead(403).end(); return; }
      try {
        const body = JSON.parse(await readBody(req, 10_000));
        settings.answerInHouse = body.answerInHouse === true;
        broadcast({ kind: "settings", settings });
      } catch { json(res, 400, { error: "ungültige Anfrage" }); return; }
    }
    json(res, 200, settings);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    json(res, 200, listSessions());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/replay") {
    if (!originOk(req, true)) { res.writeHead(403).end(); return; }
    try {
      const { session, speed } = JSON.parse(await readBody(req, 10_000));
      const r = startReplay(String(session), clampSpeed(speed));
      if (!r) { json(res, 404, { error: "Session nicht gefunden" }); return; }
      json(res, 200, r);
    } catch {
      json(res, 400, { error: "ungültige Anfrage" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const permissions = [...pending.values()].map((p) => p.info);
    res.write(`data: ${JSON.stringify({ kind: "hello", sessions: snapshot(), history, settings, permissions })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === "GET") {
    // Statische Dateien aus public/ (ohne Ausbruch aus dem Ordner)
    const pub = path.join(ROOT, "public");
    let rel;
    try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"; }
    catch { res.writeHead(400).end(); return; }
    const file = path.resolve(pub, rel);
    if (file.startsWith(pub + path.sep)) {
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404).end(); return; }
        res.writeHead(200, {
          "content-type": MIME[path.extname(file)] || "application/octet-stream",
          "cache-control": "no-store",
        });
        fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
      });
      return;
    }
  }

  res.writeHead(404).end();
});

// Ändert sich etwas in public/, laden alle offenen Seiten neu (kein veralteter Code im Browser).
let reloadTimer = null;
fs.watch(path.join(ROOT, "public"), () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => broadcast({ kind: "reload" }), 300);
});

// Zustand der letzten Stunden aus dem Log wiederherstellen: ein Neustart lässt nichts mehr verschwinden.
(function restore() {
  const since = Date.now() - 6 * 3600_000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let n = 0;
  for (const e of readLog()) {
    if (!e._t || e._t < since || !UUID.test(String(e.session_id))) continue;
    const copy = { ...e };
    delete copy._t;
    history.push(ingest(copy, e._t));
    if (history.length > MAX_HISTORY) history.shift();
    n++;
  }
  if (n) console.log(`${n} Ereignisse der letzten 6 Stunden wiederhergestellt`);
})();

server.listen(PORT, HOST, () => {
  console.log(`Agent-Haus läuft auf http://${HOST}:${PORT}`);
});
