// Agent-Haus server: receives Claude Code hook events and streams them to the browser via Server-Sent Events.
// Start: node server.mjs   ->   http://127.0.0.1:4317
//
// Texts sent to the browser are language-neutral messages: [key, params]. The browser translates them
// (public/i18n.js), so the same server works for every UI language.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.AGENT_HAUS_PORT || 4317);
const HOST = "127.0.0.1";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.AGENT_HAUS_DATA || path.join(os.homedir(), ".agent-haus");
const LOG_FILE = path.join(DATA_DIR, "events.jsonl");
const LOG_ON = process.env.AGENT_HAUS_LOG !== "0";
const KEEP_DAYS = Math.max(1, Number(process.env.AGENT_HAUS_KEEP_DAYS) || 7);
const MAX_HISTORY = 500;
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const RESTORE_WINDOW = 6 * HOUR;     // after a restart, sessions active in this window come back
const FORGET_ENDED = 1 * HOUR;       // ended sessions leave the house after this long
const FORGET_IDLE = 6 * HOUR;        // sessions without any event leave after this long
const FORGET_REPLAY = 10 * MIN;      // finished replays leave quickly
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

if (LOG_ON) fs.mkdirSync(DATA_DIR, { recursive: true });

/** State: sessionId -> { id, cwd, startedAt, lastAt, ended, agents: Map<agentKey, agent>, pendingTasks: [] } */
const sessions = new Map();
const history = [];
const clients = new Set();

function short(text, n = 120) {
  if (text == null) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---------------------------------------------------------------- What gets stored
// Hook payloads can contain whole files (tool_response, Write content, Edit strings). We keep only
// what the house shows, shortened, so the log never holds file contents or long outputs.
const KEEP_FIELDS = {
  session_id: 0, hook_event_name: 0, cwd: 0, agent_id: 0, agent_type: 0, tool_name: 0, source: 0, reason: 0,
  prompt: 300, message: 200, last_assistant_message: 400, error: 200,
};
const KEEP_INPUT = {
  description: 200, command: 300, file_path: 300, path: 300, pattern: 120, url: 200, query: 160,
  summary: 160, message: 200, to: 80, recipient: 80, subagent_type: 60, prompt: 100,
};
function clip(v, n) {
  if (typeof v !== "string") return v;
  return n && v.length > n ? v.slice(0, n - 1) + "…" : v;
}
function sanitize(e) {
  const o = {};
  for (const [k, n] of Object.entries(KEEP_FIELDS)) if (e[k] != null) o[k] = clip(e[k], n);
  const ti = e.tool_input;
  if (ti && typeof ti === "object") {
    o.tool_input = {};
    for (const [k, n] of Object.entries(KEEP_INPUT)) if (ti[k] != null && typeof ti[k] !== "object") o.tool_input[k] = clip(String(ti[k]), n);
  }
  // From the tool result we only need to know whether it failed (e.g. SendMessage not delivered).
  if (e.tool_response && typeof e.tool_response === "object" && e.tool_response.success === false) {
    o.tool_response = { success: false };
  }
  return o;
}

// ---------------------------------------------------------------- Agents and messages
/** The main agent writes "[Name] task" into the Agent tool's description (see the SessionStart hook). */
function parseTask(desc) {
  const s = short(desc, 80);
  const m = s.match(/^\[([^\]]{1,24})\]\s*(.*)$/);
  return m ? { name: m[1].trim(), task: m[2] || m[1].trim() } : { name: "", task: s };
}

/** A name as a message: the browser shows the given name, or a fallback like "Scout 2" in its language. */
const nameMsg = (a) => ["name", { name: a.name, type: a.type, n: a.num || 0, main: a.key === "main" }];

/** Turns a tool call into a short readable message. */
function describeTool(name, input = {}) {
  const file = (p) => (p ? path.basename(String(p)) : "");
  switch (name) {
    case "Bash": return ["tool.bash", { d: short(input.description || input.command, 80) }];
    case "Read": return ["tool.read", { f: file(input.file_path) }];
    case "Write": return ["tool.write", { f: file(input.file_path) }];
    case "Edit":
    case "MultiEdit": return ["tool.edit", { f: file(input.file_path) }];
    case "Grep": return ["tool.grep", { p: short(input.pattern, 40) }];
    case "Glob": return ["tool.glob", { p: short(input.pattern, 40) }];
    case "WebFetch": return ["tool.fetch", { u: short(input.url, 60) }];
    case "WebSearch": return ["tool.search", { q: short(input.query, 60) }];
    case "Agent":
    case "Task": {
      const { name: who, task } = parseTask(input.description || input.prompt);
      return ["tool.agent", { who, task }];
    }
    case "TodoWrite": return ["tool.todo", {}];
    case "SendMessage": return ["tool.send", { m: short(input.summary || input.message, 60) }];
    default: return ["tool.other", { n: String(name || "?") }];
  }
}

/** Finds the recipient of a SendMessage: by agent ID, by name, or the main agent. */
function resolveAgent(s, to) {
  if (!to) return null;
  const t = String(to).toLowerCase();
  for (const a of s.agents.values()) {
    if (a.key.toLowerCase() === t || (a.name && a.name.toLowerCase() === t)) return a;
  }
  if (["main", "lead", "team-lead", "leader", "boss"].includes(t)) return s.agents.get("main") || null;
  return null;
}

function getSession(e, now) {
  let s = sessions.get(e.session_id);
  if (!s) {
    s = { id: e.session_id, cwd: e.cwd, startedAt: now, lastAt: now, ended: false, agents: new Map(), pendingTasks: [], typeCounts: {} };
    sessions.set(e.session_id, s);
  }
  if (e.cwd) s.cwd = e.cwd;
  return s;
}

function getAgent(s, e, now) {
  const key = e.agent_id || "main";
  let a = s.agents.get(key);
  if (!a) {
    a = {
      key,
      type: e.agent_id ? e.agent_type || "subagent" : "main",
      name: "",
      num: 0,
      task: "",
      status: "idle",
      activity: "",
      startedAt: now,
      lastAt: now,
      tools: 0,
    };
    s.agents.set(key, a);
  }
  return a;
}

/** Applies a raw (sanitized) event to the state and returns a compact message for the browser. */
function ingest(e, now = Date.now()) {
  const s = getSession(e, now);
  const ev = e.hook_event_name;
  const existed = s.agents.has(e.agent_id || "main");
  const a = getAgent(s, e, now);
  let text = "";
  let visit = null;

  switch (ev) {
    case "SessionStart":
      a.status = "idle";
      s.ended = false;
      text = ["ev.start", { src: e.source || "?" }];
      break;
    case "UserPromptSubmit":
      a.status = "working";
      a.activity = ["act.readsPrompt", {}];
      text = ["ev.prompt", { p: short(e.prompt, 160) }];
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
      text = ["ev.toolDone", { x: describeTool(e.tool_name, e.tool_input) }];
      a.activity = ["act.thinking", {}];
      if (e.tool_name === "SendMessage") {
        // Only now do we know whether the message arrived, so the visit starts here.
        const ti = e.tool_input || {};
        const target = resolveAgent(s, ti.to || ti.recipient);
        const ok = !(e.tool_response && e.tool_response.success === false);
        const what = short(ti.summary || ti.message, 60);
        if (target && target !== a) {
          visit = { to: target.key, text: what, ok };
          text = ok ? ["ev.visit", { who: nameMsg(target), m: what }] : ["ev.visitFail", { who: nameMsg(target) }];
        }
      }
      break;
    case "PostToolUseFailure":
      text = ["ev.toolFail", { x: describeTool(e.tool_name, e.tool_input), err: short(e.error, 80) }];
      a.activity = ["act.thinking", {}];
      break;
    case "SubagentStart": {
      if (existed && (a.name || a.num)) {
        // The same agent continues (e.g. after a SendMessage): name and task stay.
        a.status = "working";
        a.activity = ["act.continues", {}];
        text = ["ev.continues", { who: nameMsg(a) }];
        break;
      }
      // The event has no tool_use_id: match the task by the order of the Agent calls.
      const p = s.pendingTasks.shift();
      a.task = p?.task || a.type;
      a.name = p?.name || "";
      if (!a.name) { s.typeCounts[a.type] = (s.typeCounts[a.type] || 0) + 1; a.num = s.typeCounts[a.type]; }
      a.status = "working";
      a.activity = ["act.movingIn", {}];
      text = ["ev.movesIn", { who: nameMsg(a), type: a.type, task: a.task }];
      break;
    }
    case "SubagentStop":
      a.status = "done";
      a.activity = ["act.done", {}];
      a.result = short(e.last_assistant_message, 400);
      text = ["ev.finished", { who: nameMsg(a), r: short(e.last_assistant_message, 160) }];
      break;
    case "PermissionRequest":
      a.status = "waiting";
      a.activity = ["act.asks", { x: describeTool(e.tool_name, e.tool_input) }];
      text = ["ev.wants", { x: describeTool(e.tool_name, e.tool_input) }];
      break;
    case "Notification":
      a.status = "waiting";
      a.activity = e.message ? short(e.message, 80) : ["act.waitsForYou", {}];
      text = ["ev.note", { m: short(e.message, 160) }];
      break;
    case "Stop":
      a.status = "idle";
      a.activity = ["act.waits", {}];
      a.result = short(e.last_assistant_message, 400);
      text = ["ev.answer", { r: short(e.last_assistant_message, 160) }];
      break;
    case "SessionEnd":
      for (const ag of s.agents.values()) ag.status = "gone";
      s.ended = true;
      text = ["ev.end", { why: e.reason || "?" }];
      break;
    default:
      text = ["ev.other", { n: String(ev || "?") }];
  }
  a.lastAt = now;
  s.lastAt = now;

  return { t: now, session: s.id, cwd: s.cwd, agent: a.key, event: ev, text, visit, state: { ...a } };
}

function snapshot() {
  return [...sessions.values()].map((s) => ({
    id: s.id, cwd: s.cwd, startedAt: s.startedAt, ended: s.ended, agents: [...s.agents.values()],
  }));
}

function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

function pushHistory(msg) {
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
}

// ---------------------------------------------------------------- Event log (for restarts and replay)
/** Index of the stored sessions, so the replay menu does not have to read the whole file. */
const logIndex = new Map();
function indexEvent(e) {
  if (!UUID.test(String(e.session_id))) return; // only real Claude sessions, no replays or tests
  let s = logIndex.get(e.session_id);
  if (!s) { s = { id: e.session_id, cwd: e.cwd || "", first: e._t, last: e._t, events: 0, agents: new Set() }; logIndex.set(e.session_id, s); }
  s.events++;
  if (e.cwd) s.cwd = e.cwd;
  s.last = e._t;
  if (e.agent_id) s.agents.add(e.agent_id);
}
function readLog() {
  if (!LOG_ON) return [];
  let raw = "";
  try { raw = fs.readFileSync(LOG_FILE, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip broken line */ }
  }
  return out;
}
/** Keeps only sessions active in the last KEEP_DAYS days and slims every entry. Returns the kept events. */
function compactLog() {
  if (!LOG_ON) return [];
  const events = readLog().filter((e) => e && e._t && UUID.test(String(e.session_id)));
  const last = new Map();
  for (const e of events) last.set(e.session_id, Math.max(last.get(e.session_id) || 0, e._t));
  const cutoff = Date.now() - KEEP_DAYS * DAY;
  const kept = events.filter((e) => last.get(e.session_id) >= cutoff).map((e) => ({ ...sanitize(e), _t: e._t }));
  const tmp = LOG_FILE + ".tmp";
  fs.writeFileSync(tmp, kept.map((e) => JSON.stringify(e) + "\n").join(""));
  fs.renameSync(tmp, LOG_FILE);
  logIndex.clear();
  for (const e of kept) indexEvent(e);
  return kept;
}
function appendLog(e) {
  if (!LOG_ON || !UUID.test(String(e.session_id))) return; // demo and test sessions are not stored
  const entry = { ...e, _t: Date.now() };
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n"); indexEvent(entry); }
  catch (err) { console.error(`Could not write ${LOG_FILE}: ${err.message}`); }
}
function listSessions() {
  return [...logIndex.values()]
    .filter((s) => s.events >= 3)
    .sort((a, b) => b.last - a.last)
    .slice(0, 30)
    .map((s) => ({ ...s, agents: s.agents.size }));
}

/** Handles one hook event: update state, send to all browsers, optionally store it. */
function handleEvent(raw, { log }) {
  const e = sanitize(raw);
  if (log) appendLog(e);
  const msg = ingest(e);
  pushHistory(msg);
  broadcast({ kind: "event", ...msg });
  return msg;
}

// ---------------------------------------------------------------- Forget old sessions
function pruneSessions(now = Date.now()) {
  for (const s of [...sessions.values()]) {
    const idle = now - s.lastAt;
    const replay = s.id.startsWith("replay-");
    if (idle > FORGET_IDLE || (s.ended && idle > FORGET_ENDED) || (replay && idle > FORGET_REPLAY)) {
      sessions.delete(s.id);
      for (let i = history.length - 1; i >= 0; i--) if (history[i].session === s.id) history.splice(i, 1);
      broadcast({ kind: "forget", session: s.id });
    }
  }
}

// ---------------------------------------------------------------- HTTP helpers
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

// Only requests addressed to our own host (against DNS rebinding) and none from other websites (against CSRF).
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function hostOk(req) { return OWN_HOSTS.has(req.headers.host); }
function originOk(req, required) {
  const o = req.headers.origin;
  if (!o) return !required; // curl from the hooks sends no Origin
  try { const u = new URL(o); return u.protocol === "http:" && OWN_HOSTS.has(u.host); } catch { return false; }
}
function json(res, code, data) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------- Answering permission requests in the house
// Off by default and off again after every restart. Without an open house the hook gets an empty answer
// right away, and Claude Code asks in the terminal as usual.
const PERMISSION_WAIT = 60_000;
const settings = { answerInHouse: false };
const pending = new Map(); // id -> { res, timer, info, label }

function finishPermission(id, decision) {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  clearTimeout(p.timer);
  if (!p.res.writableEnded) {
    if (decision) {
      const d = decision === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "Denied in the Agent-Haus." };
      p.res.writeHead(200, { "content-type": "application/json" });
      p.res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } }));
    } else {
      p.res.writeHead(204).end();
    }
  }
  console.log(`Permission request from ${p.label}: ${decision || "no answer, continues in the terminal"}`);
  broadcast({ kind: "permission-done", id, result: decision || "timeout" });
  return true;
}

// ---------------------------------------------------------------- Replay
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

// ---------------------------------------------------------------- Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (!hostOk(req)) { res.writeHead(403).end(); return; }

  if (req.method === "POST" && url.pathname === "/event") {
    if (!originOk(req, false)) { res.writeHead(403).end(); return; }
    try {
      const e = JSON.parse(await readBody(req));
      if (!e.session_id || !e.hook_event_name) throw new Error("not a hook event");
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
    // The card shows the full request (not the shortened log version): you should see what you allow.
    const detail = ti.command ?? ti.file_path ?? ti.url ?? ti.pattern ?? JSON.stringify(ti);
    const info = {
      id, session: msg.session, cwd: msg.cwd, agent: msg.agent, who: nameMsg(msg.state),
      tool: describeTool(e.tool_name, ti),
      detail: String(detail).slice(0, 4000),
      expiresAt: Date.now() + PERMISSION_WAIT,
    };
    const label = `${msg.state.name || msg.state.type} (${e.tool_name || "?"})`;
    pending.set(id, { res, info, label, timer: setTimeout(() => finishPermission(id, null), PERMISSION_WAIT) });
    res.on("close", () => { if (pending.has(id)) finishPermission(id, null); }); // Claude gave up
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
      json(res, 400, { error: "bad request" });
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
      } catch { json(res, 400, { error: "bad request" }); return; }
    }
    json(res, 200, settings);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    json(res, 200, { logging: LOG_ON, sessions: listSessions() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/replay") {
    if (!originOk(req, true)) { res.writeHead(403).end(); return; }
    try {
      const { session, speed } = JSON.parse(await readBody(req, 10_000));
      const r = startReplay(String(session), clampSpeed(speed));
      if (!r) { json(res, 404, { error: "session not found" }); return; }
      json(res, 200, r);
    } catch {
      json(res, 400, { error: "bad request" });
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
    // Static files from public/ (no escaping the folder)
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

// When something in public/ changes, all open pages reload (no stale code in the browser).
let reloadTimer = null;
try {
  fs.watch(path.join(ROOT, "public"), { recursive: true }, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => broadcast({ kind: "reload" }), 300);
  });
} catch { /* watching is a convenience for development */ }

// Slim the log, then bring back the sessions of the last hours: a restart makes nothing disappear.
(function restore() {
  let kept = [];
  try { kept = compactLog(); } catch (err) { console.error(`Could not read ${LOG_FILE}: ${err.message}`); }
  const since = Date.now() - RESTORE_WINDOW;
  let n = 0;
  for (const e of kept) {
    if (e._t < since || !UUID.test(String(e.session_id))) continue;
    const copy = { ...e };
    delete copy._t;
    pushHistory(ingest(copy, e._t));
    n++;
  }
  pruneSessions();
  if (n) console.log(`Restored ${n} events from the last ${RESTORE_WINDOW / HOUR} hours`);
})();
setInterval(pruneSessions, 5 * MIN).unref();
setInterval(() => { try { compactLog(); } catch { /* try again next time */ } }, 6 * HOUR).unref();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Is the Agent-Haus already running? Otherwise set AGENT_HAUS_PORT.`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Agent-Haus is running at http://${HOST}:${PORT}`);
  console.log(LOG_ON ? `Log: ${LOG_FILE} (kept for ${KEEP_DAYS} days)` : "Log: off (AGENT_HAUS_LOG=0)");
});
