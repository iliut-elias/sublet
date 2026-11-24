#!/usr/bin/env node
// Sublet launcher.
//   node bin/sublet.mjs open     start the server in the background if needed, then open the browser (default)
//   node bin/sublet.mjs start    only start the server in the background
//   node bin/sublet.mjs stop     stop a server started by this launcher
//   node bin/sublet.mjs status   is it running?
// For a server in the foreground (with its output in your terminal) use: node server.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.SUBLET_PORT || 4317);
const URL_ = `http://127.0.0.1:${PORT}/`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.SUBLET_DATA || path.join(os.homedir(), ".sublet");
const PID_FILE = path.join(DATA_DIR, "server.pid");
const OUT_FILE = path.join(DATA_DIR, "server.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function running() {
  try { return (await fetch(`${URL_}api/settings`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}

async function start() {
  if (await running()) return false;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = fs.openSync(OUT_FILE, "a");
  const child = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    detached: true, stdio: ["ignore", out, out], windowsHide: true, env: process.env,
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  for (let i = 0; i < 40; i++) { if (await running()) return true; await sleep(150); }
  throw new Error(`the server did not start, see ${OUT_FILE}`);
}

function openBrowser() {
  const [cmd, args] = process.platform === "darwin" ? ["open", [URL_]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", URL_]]
    : ["xdg-open", [URL_]];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref(); } catch { /* the link is printed anyway */ }
}

async function stop() {
  let pid = 0;
  try { pid = Number(fs.readFileSync(PID_FILE, "utf8")); } catch { /* no pid file */ }
  if (!pid) return (await running()) ? "not started by this launcher, stop it where it runs" : "not running";
  try { process.kill(pid); } catch { /* already gone */ }
  fs.rmSync(PID_FILE, { force: true });
  for (let i = 0; i < 20 && (await running()); i++) await sleep(100);
  return "stopped";
}

const cmd = process.argv[2] || "open";
try {
  if (cmd === "open" || cmd === "start") {
    const started = await start();
    if (cmd === "open" && process.env.SUBLET_NO_BROWSER !== "1") openBrowser();
    console.log(`Sublet ${started ? "started" : "is already running"}: ${URL_}`);
  } else if (cmd === "stop") {
    console.log(`Sublet: ${await stop()}`);
  } else if (cmd === "status") {
    console.log(`Sublet: ${(await running()) ? `running at ${URL_}` : "not running"}`);
  } else {
    console.log("Usage: node bin/sublet.mjs [open|start|stop|status]");
    process.exitCode = 2;
  }
} catch (err) {
  console.log(`Sublet: ${err.message}`);
  process.exitCode = 1;
}
