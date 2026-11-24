// Plays a made-up Claude Code session into a running Agent-Haus, so you can see the house without Claude.
// Usage: node server.mjs   (in one terminal)
//        node tools/demo.mjs [--loop]
// Demo sessions are not written to the log and do not show up in Replay.
const PORT = Number(process.env.AGENT_HAUS_PORT || 4317);
const LOOP = process.argv.includes("--loop");
const URL_EVENT = `http://127.0.0.1:${PORT}/event`;

function script(id) {
  const cwd = "/home/you/projects/my-app";
  const main = (e) => ({ session_id: id, cwd, ...e });
  const sub = (agent_id, agent_type, e) => ({ session_id: id, cwd, agent_id, agent_type, ...e });
  const tool = (who, tool_name, tool_input, ms = 900) => [
    [0, who({ hook_event_name: "PreToolUse", tool_name, tool_input })],
    [ms, who({ hook_event_name: "PostToolUse", tool_name, tool_input })],
  ];
  const A = (e) => sub("demo-scout", "Explore", e);
  const B = (e) => sub("demo-planner", "Plan", e);
  const C = (e) => sub("demo-tester", "general-purpose", e);
  return [
    [0, main({ hook_event_name: "SessionStart", source: "startup" })],
    [2200, main({ hook_event_name: "UserPromptSubmit", prompt: "Add a dark mode to the settings page and make sure the tests pass" })],
    ...tool(main, "Read", { file_path: `${cwd}/src/settings.tsx` }, 1400),
    [600, main({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { description: "[Pixel] find the theme code", subagent_type: "Explore" } })],
    [150, main({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { description: "[Mortar] plan the dark mode", subagent_type: "Plan" } })],
    [150, main({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { description: "[Sparks] run the test suite", subagent_type: "general-purpose" } })],
    [300, A({ hook_event_name: "SubagentStart" })],
    [200, B({ hook_event_name: "SubagentStart" })],
    [200, C({ hook_event_name: "SubagentStart" })],
    [4200, A({ hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { pattern: "theme|colors" } })],
    [300, C({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { description: "Install dependencies", command: "npm ci" } })],
    [900, A({ hook_event_name: "PostToolUse", tool_name: "Grep", tool_input: { pattern: "theme|colors" } })],
    ...tool(B, "Read", { file_path: `${cwd}/src/App.tsx` }, 1600),
    ...tool(A, "Read", { file_path: `${cwd}/src/theme.ts` }, 1500),
    [200, C({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { description: "Install dependencies" } })],
    ...tool(C, "Bash", { description: "Run the tests", command: "npm test" }, 1800),
    ...tool(B, "TodoWrite", {}, 1200),
    [300, C({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { description: "Run the e2e tests", command: "npm run e2e" } })],
    [1600, C({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { description: "Run the e2e tests" }, error: "exit code 1" })],
    ...tool(A, "Glob", { pattern: "src/**/*.css" }, 1200),
    [300, B({ hook_event_name: "PreToolUse", tool_name: "SendMessage", tool_input: { to: "demo-scout", summary: "Where are the colors?" } })],
    [400, B({ hook_event_name: "PostToolUse", tool_name: "SendMessage", tool_input: { to: "demo-scout", summary: "Where are the colors?" }, tool_response: { success: true } })],
    ...tool(C, "Bash", { description: "Run the e2e tests again", command: "npm run e2e" }, 2000),
    [5200, A({ hook_event_name: "SubagentStop", last_assistant_message: "The colors live in src/theme.ts. Three components hard-code #fff." })],
    ...tool(B, "Write", { file_path: `${cwd}/PLAN.md` }, 1400),
    [2200, B({ hook_event_name: "SubagentStop", last_assistant_message: "Plan: CSS variables in theme.ts, a toggle in settings, store the choice in localStorage." })],
    ...tool(main, "Edit", { file_path: `${cwd}/src/theme.ts` }, 1500),
    ...tool(main, "Edit", { file_path: `${cwd}/src/settings.tsx` }, 1500),
    [1500, C({ hook_event_name: "SubagentStop", last_assistant_message: "All 48 tests pass, the e2e run is green on the second try." })],
    [6500, main({ hook_event_name: "Stop", last_assistant_message: "Dark mode is in: a toggle on the settings page, colors as CSS variables, all tests green." })],
    [9000, main({ hook_event_name: "SessionEnd", reason: "other" })],
  ];
}

async function send(e) {
  const r = await fetch(URL_EVENT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e) });
  if (!r.ok) throw new Error(`server answered ${r.status}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  do {
    const id = `demo-${Date.now().toString(36)}`;
    console.log(`Demo session ${id} → http://127.0.0.1:${PORT}`);
    for (const [wait, e] of script(id)) {
      await sleep(wait);
      await send(e);
    }
    if (LOOP) await sleep(3000);
  } while (LOOP);
}

run().catch((err) => {
  console.error(`Could not reach the Agent-Haus on port ${PORT} (${err.message}). Start it first: node server.mjs`);
  process.exit(1);
});
