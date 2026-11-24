// Agent-Haus: nimmt Hook-Ereignisse von Claude Code an und streamt sie per SSE an den Browser.
// Start: node server.mjs   ->   http://127.0.0.1:4317
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.AGENT_HAUS_PORT || 4317);
const HOST = "127.0.0.1";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(ROOT, "data", "events.jsonl");
const MAX_HISTORY = 500;

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
    default: return name;
  }
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
function ingest(e) {
  const s = getSession(e);
  const ev = e.hook_event_name;
  const now = Date.now();
  let a = getAgent(s, e);
  let text = "";

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
      break;
    case "PostToolUseFailure":
      text = `fehlgeschlagen: ${describeTool(e.tool_name, e.tool_input)}${e.error ? " – " + short(e.error, 80) : ""}`;
      a.activity = "denkt nach";
      break;
    case "SubagentStart": {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  if (req.method === "POST" && url.pathname === "/event") {
    try {
      const raw = await readBody(req);
      const e = JSON.parse(raw);
      if (!e.session_id || !e.hook_event_name) throw new Error("kein Hook-Ereignis");
      fs.appendFile(LOG_FILE, JSON.stringify(e) + "\n", () => {});
      const msg = ingest(e);
      history.push(msg);
      if (history.length > MAX_HISTORY) history.shift();
      broadcast({ kind: "event", ...msg });
      res.writeHead(204).end();
    } catch (err) {
      res.writeHead(400, { "content-type": "text/plain" }).end(String(err.message));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ kind: "hello", sessions: snapshot(), history })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(ROOT, "public", "index.html")).pipe(res);
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, HOST, () => {
  console.log(`Agent-Haus läuft auf http://${HOST}:${PORT}`);
});
