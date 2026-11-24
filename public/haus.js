// Sublet – pixel view.
// Every Claude Code session is a house: the boss floor (main agent) at the top,
// one room per subagent below, the lobby at the bottom. Houses of several sessions stand side by side in a street.
// Everything is drawn at a small resolution (game pixels) and scaled up sharply; texts go on top at full resolution.
"use strict";

// ---------------------------------------------------------------- Sizes (game pixels)
const COLS = 3, RW = 120, RH = 72, SLAB = 4, SW = 20;
const HX = 16, IX = HX + 4, RX0 = IX + SW;
const HW = 4 + SW + COLS * RW + 4;      // outer house width
const LW = HX + HW + 16;                // image width
const ROOF_TOP = 12, ATTIC_TOP = 50, LOBBY_H = 56;
const LADDER_X = IX + SW / 2;
const BOSS_SEAT_X = RX0 + 170;
const DOOR_X = RX0 + 180;
const CHIMNEY_X = HX + HW - 80;
const WALK = 90, CLIMB = 110;           // pixels per second

const OUTLINE = "#141826";
const CODE_COLORS = ["#6ee7a8", "#6ea8ff", "#ffd166", "#c792ea"];
const ACCS = ["none", "headphones", "shades", "sprout", "bow", "scarf"];

// ---------------------------------------------------------------- Helpers
let T = 0; // global time in seconds
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const basename = (p) => (p || "").split("/").filter(Boolean).pop() || "?";
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

/** Golden angle: consecutive rooms get clearly different colors (never the boss orange). */
function roomHue(idx) {
  let h = (200 + idx * 137.5) % 360;
  if (Math.abs(h - 28) < 24) h = (h + 50) % 360;
  return Math.round(h);
}
function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

let G = null; // current drawing context (game pixels)
function R(x, y, w, h, c) { G.fillStyle = c; G.fillRect(Math.round(x), Math.round(y), w, h); }
function P(x, y, c) { G.fillStyle = c; G.fillRect(Math.round(x), Math.round(y), 1, 1); }

// ---------------------------------------------------------------- Layout
function makeLayout(floors) {
  const levels = [{ top: ATTIC_TOP, floorY: ATTIC_TOP + RH }]; // 0 = boss floor
  for (let i = 1; i <= floors; i++) {
    const top = ATTIC_TOP + RH + SLAB + (i - 1) * (RH + SLAB);
    levels.push({ top, floorY: top + RH });
  }
  const lobbyTop = levels[levels.length - 1].floorY + SLAB;
  const lobby = { top: lobbyTop, floorY: lobbyTop + LOBBY_H };
  const groundY = lobby.floorY;
  return { floors, levels, lobby, groundY, H: groundY + 30 };
}
// level -1 = lobby
const floorY = (L, level) => (level === -1 ? L.lobby.floorY : L.levels[Math.min(level, L.levels.length - 1)].floorY);

function roomRect(L, idx) {
  if (idx < 0) return { x: RX0, y: ATTIC_TOP, w: COLS * RW, h: RH, level: 0 };
  const level = 1 + Math.floor(idx / COLS), col = idx % COLS;
  return { x: RX0 + col * RW, y: L.levels[level].top, w: RW, h: RH, level };
}

// ---------------------------------------------------------------- Character (sprite)
const BODY = [
  ".k........k.",
  ".kk......kk.",
  ".kbkkkkkkbk.",
  "kbhhbbbbbbbk",
  "kbhbbbbbbbbk",
  "kbbbbbbbbbbk",
  "kbbbbbbbbbbk",
  "kbbbbbbbbbbk",
  "kbcbbbbbbcbk",
  "ksbbbbbbbbsk",
  ".kssssssssk.",
];
const FEET = { stand: "..kk....kk..", a: ".kk......kk.", b: "...kk..kk...", none: null };
const ACC = {
  crown: { ox: 3, oy: -1, rows: ["y.yy.y", "yyyyyy", "dddddd"], pal: { y: "#ffd166", d: "#c9952e" } },
  sprout: { ox: 4, oy: -3, rows: [".gg", "gg.", ".g.", ".g.", ".g."], pal: { g: "#5fd38a" } },
  bow: { ox: 7, oy: -2, rows: ["pp.pp", ".pPp.", "pp.pp"], pal: { p: "#ff7eb6", P: "#c94f86" } },
  scarf: { ox: 1, oy: 9, rows: ["rrrrrrrrrr", "..RR......"], pal: { r: "#e85d5d", R: "#b83b3b" } },
  shades: { ox: 2, oy: 5, rows: ["SSSSSSSS", ".Sw..Sw."], pal: { S: OUTLINE, w: "#6ea8ff" }, front: true },
  headphones: {
    ox: -1, oy: 0,
    rows: ["....gggggg....", "...g......g...", "..g........g..", ".g..........g.",
           "GG..........GG", "GG..........GG", "GG..........GG"],
    pal: { g: "#c7cde0", G: "#6ea8ff" },
  },
};

/** Draws the character with its top left corner at (fx, fy) into the current context G. */
function drawSprite(fx, fy, o) {
  const pal = {
    k: OUTLINE,
    b: hsl(o.hue, 62, 62), s: hsl(o.hue, 50, 44), h: hsl(o.hue, 80, 80),
    c: o.eyes === "back" ? hsl(o.hue, 62, 62) : "#ff9fb5",
  };
  for (let r = 0; r < BODY.length; r++) {
    const row = BODY[r];
    for (let c = 0; c < 12; c++) if (row[c] !== ".") P(fx + c, fy + r, pal[row[c]]);
  }
  const feet = FEET[o.feet || "stand"];
  if (feet) for (let c = 0; c < 12; c++) if (feet[c] !== ".") P(fx + c, fy + 11, OUTLINE);

  const sh = o.shift || 0;
  if (o.eyes === "open") {
    for (const ex of [3, 7]) {
      P(fx + ex + sh, fy + 5, "#ffffff"); P(fx + ex + 1 + sh, fy + 5, OUTLINE);
      P(fx + ex + sh, fy + 6, OUTLINE); P(fx + ex + 1 + sh, fy + 6, OUTLINE);
    }
  } else if (o.eyes === "closed") {
    for (const ex of [3, 7]) { P(fx + ex + sh, fy + 6, OUTLINE); P(fx + ex + 1 + sh, fy + 6, OUTLINE); }
  }
  if (o.arm) { P(fx + 12, fy + o.arm, pal.b); P(fx + 13, fy + o.arm, pal.s); }

  const acc = ACC[o.acc];
  if (acc && !(acc.front && o.eyes === "back")) {
    acc.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] !== ".") P(fx + acc.ox + c, fy + acc.oy + r, acc.pal[row[c]]);
    });
  }
}

// ---------------------------------------------------------------- Character (behavior)
class Char {
  constructor(house, agent) {
    this.house = house;
    this.agent = agent;
    this.boss = agent.state.key === "main";
    this.hue = this.boss ? 28 : roomHue(agent.seq || 0);
    this.acc = this.boss ? "crown" : ACCS[((agent.seq || 0) + 1) % ACCS.length];
    this.x = 0; this.y = 0; this.level = 0;
    this.queue = [];
    this.pose = "stand";
    this.facing = 1;
    this.t = Math.random() * 10;
    this.say = null; this.sayT = 0;
    this.wanderT = 1 + Math.random() * 3;
    this.headX = 0; this.headY = 0;
    this.hidden = false;
    this.gone = false;    // moved out
    this.carry = false;   // carries a moving box
    this.leaving = false; // is moving out right now
    this.scratchT = 0;    // > 0: scratches its head (a tool failed)
  }

  get L() { return this.house.layout(); }
  get status() { return this.agent.state.status; }

  home() {
    if (this.agent.room < 0) return { x: BOSS_SEAT_X, level: 0 };
    const r = roomRect(this.L, this.agent.room);
    return { x: r.x + 48, level: r.level };
  }
  bounds() {
    const r = roomRect(this.L, this.agent.room);
    return [r.x + 10, r.x + r.w - 10];
  }
  setPos(x, level) { this.x = x; this.level = level; this.y = floorY(this.L, level); }
  placeAtHome() { const h = this.home(); this.setPos(h.x, h.level); this.pose = "sit"; this.queue = []; }
  sayFor(text, t) { this.say = text; this.sayT = t; }

  planPath(target) {
    const pts = [];
    if (target.level !== this.level) {
      pts.push({ x: LADDER_X, level: this.level });
      pts.push({ x: LADDER_X, level: target.level });
    }
    pts.push({ x: target.x, level: target.level });
    return pts;
  }
  goto(target) { this.queue.push({ type: "goto", target }); }

  update(dt) {
    if (this.gone) return;
    this.t += dt;
    if (this.sayT > 0) { this.sayT -= dt; if (this.sayT <= 0) this.say = null; }
    if (this.scratchT > 0) this.scratchT -= dt;

    const a = this.queue[0];
    if (a) {
      switch (a.type) {
        case "goto": {
          if (!a.pts) a.pts = this.planPath(a.target === "home" ? this.home() : a.target);
          const p = a.pts[0];
          const ty = floorY(this.L, p.level);
          const dx = p.x - this.x, dy = ty - this.y;
          if (Math.abs(dy) > 0.5) {
            this.pose = "climb";
            this.y += Math.sign(dy) * Math.min(Math.abs(dy), CLIMB * dt);
            if (Math.abs(dx) > 0.5) this.x += Math.sign(dx) * Math.min(Math.abs(dx), WALK * dt);
          } else if (Math.abs(dx) > 0.5) {
            this.pose = "walk";
            this.facing = Math.sign(dx);
            this.y = ty;
            this.x += Math.sign(dx) * Math.min(Math.abs(dx), WALK * dt);
          } else {
            this.x = p.x; this.y = ty; this.level = p.level;
            a.pts.shift();
            if (!a.pts.length) { this.queue.shift(); this.pose = "stand"; }
          }
          return;
        }
        case "wait": a.t -= dt; if (a.t <= 0) this.queue.shift(); this.pose = "stand"; return;
        case "say": this.sayFor(a.text, a.t); this.queue.shift(); return;
        case "sit": this.pose = "sit"; this.facing = 1; this.queue.shift(); return;
        case "face": this.facing = a.dir; this.queue.shift(); return;
        case "poof": this.house.poof(this.x, this.y - 6); this.queue.shift(); return;
        case "call": a.fn(); this.queue.shift(); return;
        case "carry": this.carry = a.on; this.queue.shift(); return;
        case "exit":
          this.house.doorT = 1.1; play("door", this.house);
          this.gone = this.hidden = true; this.carry = this.leaving = false; this.queue = [];
          freeRoom(this.house, this.agent);
          return;
        case "enter": this.hidden = false; this.house.doorT = 1.1; play("door", this.house); this.queue.shift(); return;
      }
    }
    this.idle(dt);
  }

  /** Default behavior when the queue is empty. */
  idle(dt) {
    const home = this.home();
    const atHome = this.level === home.level && Math.abs(this.x - home.x) < 0.5;
    if (this.status !== "idle") {
      if (!atHome) { this.goto("home"); this.queue.push({ type: "sit" }); return; }
      this.pose = "sit"; this.facing = 1;
      return;
    }
    // idle: stroll around the own room
    if (this.level !== home.level) { this.goto("home"); return; }
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      const [a, b] = this.bounds();
      this.goto({ x: Math.round(a + Math.random() * (b - a)), level: home.level });
      this.wanderT = 2.5 + Math.random() * 4;
      return;
    }
    if (this.pose !== "sit") this.pose = "stand";
  }

  draw() {
    if (this.hidden || this.gone) return;
    const st = this.status;
    let fx = Math.round(this.x) - 6, fy = Math.round(this.y) - 12;
    const o = { hue: this.hue, acc: this.acc, eyes: "open", shift: 0, feet: "stand" };
    if (this.pose === "walk") {
      const f = Math.floor(this.t * 8) % 2;
      o.feet = f ? "a" : "b"; if (!f) fy -= 1;
      o.shift = this.facing;
    } else if (this.pose === "climb") {
      o.feet = Math.floor(this.t * 6) % 2 ? "a" : "b";
      o.eyes = "back";
    } else if (this.pose === "sit") {
      fy = Math.round(this.y) - 16; o.feet = "none"; o.shift = 1;
      if (st === "done" || st === "gone") {
        o.eyes = "closed"; o.shift = 0;
        if (Math.floor(this.t * 1.2) % 2) fy += 1;
      } else if (st === "working") {
        o.arm = Math.floor(this.t * 7) % 2 ? 6 : 7;
      }
    } else if (this.queue.length) {
      o.shift = this.facing;
    }
    if (this.scratchT > 0 && this.pose !== "climb" && this.pose !== "walk") {
      o.arm = Math.floor(this.t * 10) % 2 ? 1 : 2; // hand at the head, scratching
      o.eyes = "open"; o.shift = 0;
    }
    if (o.eyes === "open" && this.t % 3.7 < 0.12) o.eyes = "closed";
    drawSprite(fx, fy, o);
    if (this.carry) {
      // moving box in front of the belly, little arms left and right
      const bx = fx + 2 + (this.facing > 0 ? 1 : -1);
      R(bx, fy + 5, 10, 7, "#b98a52");
      R(bx, fy + 5, 10, 1, "#d4a86a");
      R(bx + 4, fy + 5, 2, 7, "#e8d9b0");
      R(bx, fy + 11, 10, 1, "#8a6236");
      P(bx - 1, fy + 7, hsl(this.hue, 62, 62)); P(bx + 10, fy + 7, hsl(this.hue, 62, 62));
    }
    this.headX = fx + 6; this.headY = fy;
  }

  get sleeping() { return this.pose === "sit" && (this.status === "done" || this.status === "gone") && !this.queue.length; }
}

// ---------------------------------------------------------------- House
class House {
  constructor(id, cwd) {
    this.id = id; this.cwd = cwd || "";
    this.agents = new Map();   // key -> { state, log, room, char }
    this.rooms = [];           // room index -> subagent key (null = free)
    this.seq = 0;              // move-in number, for colors
    this.parts = [];
    this.smokeT = 0;
    this.doorT = 0;          // > 0: door is open
    this.nextDoorAt = 0;     // so several agents enter one after another
    this.lastAt = 0;
    this._L = null;
    this.bg = null; this.bgKey = "";
  }
  get floors() { return Math.max(1, Math.ceil(this.rooms.length / COLS)); }
  layout() {
    if (!this._L || this._L.floors !== this.floors) {
      const old = this._L;
      this._L = makeLayout(this.floors);
      // Whoever stands in the lobby stays on the floor when the house grows or shrinks
      if (old) for (const a of this.agents.values()) {
        const c = a.char;
        if (c && c.level === -1 && c.pose !== "climb") c.y = this._L.lobby.floorY;
      }
    }
    return this._L;
  }
  get boss() { return this.agents.get("main"); }
  poof(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, v = 18 + Math.random() * 26;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, max: 0.5, color: "#e8ecff", size: 1 });
    }
  }
  update(dt) {
    this.doorT = Math.max(0, this.doorT - dt);
    for (const a of this.agents.values()) a.char.update(dt);
    const boss = this.boss;
    if (boss && boss.state.status === "working") {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.parts.push({ x: CHIMNEY_X + 4 + Math.random() * 4, y: ROOF_TOP - 2, vx: 3 + Math.random() * 4,
          vy: -7 - Math.random() * 4, life: 2.6, max: 2.6, color: "#8a93ab", size: 2 });
        this.smokeT = 0.3;
      }
    }
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.parts = this.parts.filter((p) => p.life > 0);
  }
}

// ---------------------------------------------------------------- Time of day
const PHASES = {
  night: {
    sky: ["#060914", "#080c1a", "#0a1020", "#0c1326", "#0f172d", "#121b34", "#151f3a"],
    stars: 1, body: "moon", hillFar: "#0a1128", hillNear: "#0d1631",
    ground: "#241d30", speck: "#2f2640", grass: "#4f9a5a", grass2: "#5fb36a", glass: "#16224a", clouds: null,
  },
  morning: {
    sky: ["#1d2b5a", "#3b3f78", "#6a4a86", "#a45c7e", "#e07a6a", "#f4a261", "#f7c98b"],
    stars: 0.2, body: "sunLow", sun: "#ffb15c", hillFar: "#3a3060", hillNear: "#2f2a4e",
    ground: "#2e2433", speck: "#3a2e40", grass: "#5a9a5a", grass2: "#6cb36a", glass: "#e89a7a", clouds: "#ffd2c4",
  },
  day: {
    sky: ["#3f8fd8", "#4d9be0", "#5ea8e6", "#70b4ea", "#84c0ee", "#98ccf2", "#acd6f4"],
    stars: 0, body: "sun", sun: "#ffe27a", hillFar: "#7fbf7a", hillNear: "#5fa85f",
    ground: "#5a4636", speck: "#6e5642", grass: "#6cc068", grass2: "#86d47e", glass: "#9fd3ff", clouds: "#ffffff",
  },
  evening: {
    sky: ["#1a1f4a", "#2e2a63", "#55357a", "#8a3f7a", "#c4506a", "#e8735a", "#f4a05a"],
    stars: 0.3, body: "sunLow", sun: "#ff8a4c", hillFar: "#2a2450", hillNear: "#221d40",
    ground: "#251c2e", speck: "#33283f", grass: "#4f8a50", grass2: "#5fa060", glass: "#e88a6a", clouds: "#f6b8a8",
  },
};
/** Phase from the real clock; for testing, force it with ?time=night|morning|day|evening. */
const PHASE_ALIASES = { nacht: "night", morgen: "morning", tag: "day", abend: "evening" };
function currentPhase() {
  const q = new URLSearchParams(location.search);
  const forced = q.get("time") || q.get("zeit");
  if (forced && PHASES[PHASE_ALIASES[forced] || forced]) return PHASE_ALIASES[forced] || forced;
  const d = new Date(), hr = d.getHours() + d.getMinutes() / 60;
  if (hr >= 21 || hr < 5) return "night";
  if (hr < 8) return "morning";
  if (hr < 17) return "day";
  return "evening";
}
let phaseName = currentPhase();
setInterval(() => { phaseName = currentPhase(); }, 30000);
const PH = () => PHASES[phaseName];

// ---------------------------------------------------------------- Sky + ground (whole screen)
/** Draws sky, moon, hills and ground across the whole world. groundY in world coordinates. */
function drawSky(WW, WH, groundY, bodyX, bodyY) {
  const ph = PH();
  const band = Math.ceil(groundY / ph.sky.length);
  for (let i = 0; i < ph.sky.length; i++) R(0, i * band, WW, band + 1, ph.sky[i]);
  const rnd = rng32(7);
  const n = Math.round(((WW * groundY) / 1100) * ph.stars);
  for (let i = 0; i < n; i++) P(rnd() * WW, rnd() * (groundY - 24) * (ph.stars < 1 ? 0.35 : 1), rnd() < 0.2 ? "#ffffff" : "#8f9cc8");
  if (ph.body === "moon") {
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      if (dx * dx + dy * dy <= 64) P(bodyX + dx, bodyY + dy, dx * dx + dy * dy > 49 ? "#d8cfae" : "#f3ecd2");
    }
    P(bodyX - 3, bodyY - 2, "#d8cfae"); P(bodyX + 2, bodyY + 3, "#d8cfae"); P(bodyX + 3, bodyY + 2, "#d8cfae");
  } else {
    // sun with glow
    G.globalAlpha = 0.18;
    for (let dy = -15; dy <= 15; dy++) for (let dx = -15; dx <= 15; dx++) {
      if (dx * dx + dy * dy <= 225) P(bodyX + dx, bodyY + dy, ph.sun);
    }
    G.globalAlpha = 1;
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      if (dx * dx + dy * dy <= 81) P(bodyX + dx, bodyY + dy, dx * dx + dy * dy > 64 ? ph.sun : "#fff6c8");
    }
  }
  // hills (two rows)
  for (let x = 0; x < WW; x++) {
    const far = Math.round(22 + 9 * Math.sin(x / 53) + 5 * Math.sin(x / 19 + 2));
    R(x, groundY - far, 1, far, ph.hillFar);
    const near = Math.round(11 + 6 * Math.sin(x / 37) + 4 * Math.sin(x / 13 + 1));
    R(x, groundY - near, 1, near, ph.hillNear);
  }
  // ground
  R(0, groundY, WW, WH - groundY, ph.ground);
  R(0, groundY, WW, 2, ph.grass);
  for (let i = 0; i < WW / 8; i++) {
    const x = rnd() * WW;
    P(x, groundY - 1, ph.grass);
    if (rnd() < 0.4) P(x + 1, groundY - 2, ph.grass2);
  }
  for (let i = 0; i < (WW * (WH - groundY)) / 90; i++) P(rnd() * WW, groundY + 4 + rnd() * (WH - groundY - 4), ph.speck);
}

/** Drifting clouds (day, morning and evening only). */
function drawClouds(WW, groundY) {
  const c = PH().clouds;
  if (!c) return;
  const rnd = rng32(31);
  const n = Math.max(3, Math.round(WW / 110));
  for (let i = 0; i < n; i++) {
    const speed = 2 + rnd() * 3, span = WW + 80;
    const x = (((rnd() * span + T * speed) % span) + span) % span - 40;
    const y = 14 + rnd() * groundY * 0.3;
    const w = 16 + Math.floor(rnd() * 14);
    G.globalAlpha = 0.85;
    R(x, y, w, 4, c);
    R(x + 3, y - 3, Math.floor(w * 0.45), 3, c);
    R(x + Math.floor(w * 0.4), y - 5, Math.floor(w * 0.35), 5, c);
    G.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- Static house (transparent around it)
function drawStatic(h, L) {
  const gy = L.groundY;

  // chimney (behind the roof)
  R(CHIMNEY_X, ROOF_TOP + 2, 12, 26, "#6b3a3a");
  for (let y = ROOF_TOP + 5; y < ROOF_TOP + 28; y += 4) R(CHIMNEY_X, y, 12, 1, "#562e30");
  R(CHIMNEY_X - 1, ROOF_TOP, 14, 3, "#4a2a2a");

  // house body
  R(HX, ATTIC_TOP - 2, HW, gy - ATTIC_TOP + 2, "#2c2438");
  // shaft with ladder
  R(IX, ATTIC_TOP, SW, gy - ATTIC_TOP, "#11172a");

  // boss floor
  drawBossRoom(L);
  // floors
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) {
      const idx = (lvl - 1) * COLS + col;
      const r = roomRect(L, idx);
      const key = h.rooms[idx];
      if (key) drawRoom(r, h.agents.get(key).char.hue, h.agents.get(key).state.type); else drawEmptyRoom(r);
    }
  }
  drawLobby(L);

  // inner walls with door openings
  const wall = (x, top, fl) => {
    R(x - 1, top, 2, fl - 17 - top, "#2c2438");
    R(x - 2, fl - 18, 4, 1, "#5a4636");
  };
  wall(RX0, ATTIC_TOP, L.levels[0].floorY);
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) wall(RX0 + col * RW, L.levels[lvl].top, L.levels[lvl].floorY);
  }
  wall(RX0, L.lobby.top, L.lobby.floorY);

  // ceilings/floors (with a hatch in the shaft)
  R(IX, ATTIC_TOP - 2, HW - 8, 2, "#3b3150");
  for (const lv of L.levels) {
    R(IX, lv.floorY, HW - 8, SLAB, "#5a4636");
    R(IX, lv.floorY, HW - 8, 1, "#6e5642");
    for (let x = IX + 12; x < IX + HW - 8; x += 16) R(x, lv.floorY + 1, 1, SLAB - 1, "#4a3a2e");
    R(IX + 3, lv.floorY, SW - 6, SLAB, "#11172a");
  }
  // ladder
  const lt = ATTIC_TOP + 6, lb = L.lobby.floorY;
  R(LADDER_X - 5, lt, 1, lb - lt, "#7a5c3e");
  R(LADDER_X + 4, lt, 1, lb - lt, "#7a5c3e");
  for (let y = lt + 2; y < lb; y += 5) R(LADDER_X - 4, y, 8, 1, "#8e6c4a");

  // outer walls + foundation
  R(HX, ATTIC_TOP - 2, 4, gy - ATTIC_TOP + 2, "#3b3150");
  R(HX + HW - 4, ATTIC_TOP - 2, 4, gy - ATTIC_TOP + 2, "#3b3150");
  R(HX - 3, gy, HW + 6, 4, "#4a4058");
  for (let x = HX; x < HX + HW; x += 9) R(x, gy + 1, 1, 3, "#3a3248");

  // roof
  const cx = HX + HW / 2, maxHalf = HW / 2 + 10, rows = ATTIC_TOP - 2 - ROOF_TOP;
  for (let i = 0; i < rows; i++) {
    const y = ROOF_TOP + i, half = Math.round(((i + 1) / rows) * maxHalf);
    R(cx - half, y, half * 2, 1, i % 4 === 3 ? "#52222c" : "#6b2f3a");
    const off = Math.floor(i / 4) % 2 ? 4 : 0;
    if (i % 4 !== 3) for (let x = cx - half + off; x < cx + half; x += 8) if (i % 4 === 1) P(x, y, "#52222c");
    P(cx - half, y, "#8a4450"); P(cx + half - 1, y, "#8a4450");
  }
  R(HX - 10, ATTIC_TOP - 3, HW + 20, 2, "#3e1a22");
  // dormer window
  R(cx - 7, ROOF_TOP + 14, 14, 11, "#3e1a22");
  R(cx - 5, ROOF_TOP + 16, 10, 8, "#ffd98a");
  R(cx - 1, ROOF_TOP + 16, 1, 8, "#3e1a22");
}

function drawWindow(x, y) {
  R(x, y, 22, 18, "#6e5642");
  R(x + 2, y + 2, 18, 14, PH().glass);
  if (phaseName === "night") { P(x + 5, y + 5, "#cfd8ff"); P(x + 15, y + 11, "#8f9cc8"); }
  else if (phaseName === "day") { R(x + 4, y + 4, 5, 2, "#ffffff"); }
  R(x + 10, y + 2, 2, 14, "#6e5642");
  R(x + 2, y + 8, 18, 2, "#6e5642");
  R(x - 1, y + 18, 24, 2, "#8a6a4a");
}
function drawLampStatic(x, top) {
  R(x, top, 1, 6, "#2a2a38");
  R(x - 4, top + 6, 9, 3, "#3c4566");
}
function drawDesk(S, fl, monitors = 1) {
  // chair (backrest on the left, the character sits in front of it facing right)
  R(S - 8, fl - 17, 2, 12, "#46506e");
  R(S - 7, fl - 5, 12, 2, "#46506e");
  R(S - 2, fl - 3, 2, 2, "#2e3550");
  R(S - 5, fl - 1, 8, 1, "#2e3550");
  // desk
  const w = monitors > 1 ? 52 : 34;
  R(S + 8, fl - 11, w, 2, "#9a7650");
  R(S + 9, fl - 9, 2, 9, "#7e603f");
  R(S + 6 + w, fl - 9, 2, 9, "#7e603f");
  R(S + w - 4, fl - 9, 8, 6, "#7e603f");
  R(S + w - 1, fl - 7, 2, 1, "#c9a26a");
  R(S + 8, fl - 12, 6, 1, "#3a4058"); // keyboard
  for (let m = 0; m < monitors; m++) {
    const mx = S + 14 + m * 18;
    R(mx, fl - 23, 16, 10, "#1b1f2e");
    R(mx + 7, fl - 13, 2, 1, "#2a3044");
    R(mx + 4, fl - 12, 8, 1, "#2a3044");
  }
  // mug
  const cx = S + 8 + w - 6;
  R(cx, fl - 15, 3, 3, "#e8e8f0");
  P(cx + 3, fl - 14, "#e8e8f0");
}
function drawShelf(x, y) {
  R(x, y + 8, 18, 2, "#8a6a4a");
  const books = [["#e85d5d", 7], ["#6ea8ff", 8], ["#ffd166", 6], ["#5fd38a", 7], ["#c792ea", 8]];
  let bx = x + 1;
  for (const [c, hgt] of books) { R(bx, y + 8 - hgt, 3, hgt, c); bx += 3; }
}
function drawPlant(x, fl, big = false) {
  R(x, fl - 7, 8, 7, "#a0583a");
  R(x - 1, fl - 8, 10, 2, "#b8693f");
  const leaves = big
    ? [[3, -10], [4, -12], [2, -14], [5, -15], [1, -17], [4, -18], [6, -11], [0, -12], [3, -20], [6, -16]]
    : [[3, -9], [4, -11], [2, -12], [5, -13], [1, -14], [4, -15]];
  for (const [dx, dy] of leaves) { R(x + dx, fl + dy, 2, 2, "#3fa86a"); P(x + dx, fl + dy, "#5fd38a"); }
  R(x + 4, fl - 10, 1, 3, "#2e8050");
}
function drawWallpaper(r, base, stripe, wains, line) {
  R(r.x, r.y, r.w, r.h, base);
  for (let x = r.x + 4; x < r.x + r.w; x += 8) R(x, r.y, 2, r.h, stripe);
  const fl = r.y + r.h;
  R(r.x, fl - 12, r.w, 12, wains);
  R(r.x, fl - 13, r.w, 1, line);
}
/** Wall decoration by agent type: Explore = map, Plan = whiteboard, others = a picture. */
function drawWallThing(x, y, type) {
  if (type === "Explore") {
    R(x, y, 22, 15, "#8a6a4a");
    R(x + 1, y + 1, 20, 13, "#e8d9b0");
    R(x + 3, y + 3, 6, 4, "#9cc59a"); R(x + 12, y + 7, 7, 5, "#9cc59a"); R(x + 2, y + 9, 4, 3, "#8ab7d8");
    for (let i = 0; i < 12; i += 2) P(x + 5 + i, y + 8 - (i >> 2), "#c0392b");   // dashed route
    P(x + 17, y + 4, "#c0392b"); P(x + 16, y + 3, "#c0392b"); P(x + 18, y + 3, "#c0392b");
    P(x + 16, y + 5, "#c0392b"); P(x + 18, y + 5, "#c0392b");                      // target X
  } else if (type === "Plan") {
    R(x, y, 24, 16, "#8a93ab");
    R(x + 1, y + 1, 22, 14, "#eef1f6");
    for (let i = 0; i < 3; i++) {
      R(x + 3, y + 3 + i * 4, 2, 2, i < 2 ? "#5fd38a" : "#c7cde0");                // check boxes
      R(x + 7, y + 3 + i * 4, 10 - i * 2, 1, "#6ea8ff");
    }
    R(x + 1, y + 16, 22, 1, "#6e7690");
  } else {
    R(x, y, 20, 14, "#c9a26a");
    R(x + 1, y + 1, 18, 12, "#9fd3ff");
    R(x + 1, y + 8, 18, 5, "#5fb36a");
    R(x + 4, y + 5, 6, 3, "#4f9a5a"); R(x + 10, y + 6, 7, 2, "#4f9a5a");
    R(x + 14, y + 3, 2, 2, "#ffe27a");
  }
}
function drawRoom(r, hue, type) {
  drawWallpaper(r, hsl(hue, 24, 23), hsl(hue, 24, 25.5), hsl(hue, 22, 17), hsl(hue, 22, 30));
  const fl = r.y + r.h;
  drawWindow(r.x + 10, r.y + 12);
  drawWallThing(r.x + 68, r.y + 13, type);
  drawShelf(r.x + 96, r.y + 12);
  drawPlant(r.x + 100, fl);
  drawDesk(r.x + 48, fl, 1);
  drawLampStatic(r.x + 60, r.y);
}
function drawEmptyRoom(r) {
  drawWallpaper(r, "#151a2c", "#171d31", "#11152400", "#1d2338");
  const fl = r.y + r.h;
  R(r.x + 40, fl - 10, 14, 10, "#5a4636"); R(r.x + 40, fl - 6, 14, 1, "#c9a26a");
  R(r.x + 56, fl - 7, 10, 7, "#4e3c2e"); R(r.x + 60, fl - 7, 2, 7, "#c9a26a");
  // cobweb
  for (let i = 0; i < 6; i++) { P(r.x + r.w - 3 - i, r.y + 1 + i, "#3a4058"); }
  R(r.x + r.w - 8, r.y + 1, 6, 1, "#3a4058");
  R(r.x + r.w - 2, r.y + 1, 1, 6, "#3a4058");
}
function drawBossRoom(L) {
  const r = roomRect(L, -1), fl = r.y + r.h;
  drawWallpaper(r, hsl(28, 22, 21), hsl(28, 22, 23.5), hsl(28, 22, 15), hsl(28, 30, 30));
  drawWindow(r.x + 16, r.y + 12);
  // whiteboard with a plan
  R(r.x + 52, r.y + 10, 44, 26, "#8a93ab");
  R(r.x + 54, r.y + 12, 40, 22, "#d8dde8");
  R(r.x + 58, r.y + 16, 14, 1, "#6ea8ff"); R(r.x + 58, r.y + 20, 22, 1, "#e85d5d");
  R(r.x + 58, r.y + 24, 10, 1, "#5fd38a"); R(r.x + 74, r.y + 24, 8, 1, "#6ea8ff");
  R(r.x + 82, r.y + 15, 6, 6, "#ffd166");
  R(r.x + 58, r.y + 28, 26, 1, "#8a93ab");
  // rug for the reports
  R(r.x + 96, fl - 1, 58, 1, "#7a3b5a");
  R(r.x + 98, fl - 1, 2, 1, "#a85580"); R(r.x + 150, fl - 1, 2, 1, "#a85580");
  drawDesk(BOSS_SEAT_X, fl, 2);
  // bookshelf
  R(r.x + 252, r.y + 14, 30, fl - r.y - 14, "#5a4636");
  for (let y = r.y + 24; y < fl - 4; y += 12) {
    R(r.x + 254, y, 26, 2, "#8a6a4a");
    let bx = r.x + 255;
    for (const c of ["#e85d5d", "#6ea8ff", "#ffd166", "#5fd38a", "#c792ea", "#e8ecff", "#ff7eb6"]) {
      const hh = 6 + ((bx * 7 + y) % 4);
      R(bx, y - hh, 3, hh, c); bx += 3.5;
    }
  }
  drawWindow(r.x + 298, r.y + 12);
  drawPlant(r.x + 334, fl, true);
  drawLampStatic(r.x + 120, r.y);
  drawLampStatic(r.x + 240, r.y);
}
function drawLobby(L) {
  const r = { x: RX0, y: L.lobby.top, w: COLS * RW, h: LOBBY_H }, fl = L.lobby.floorY;
  R(IX, r.y, SW, r.h, "#11172a");
  drawWallpaper(r, "#262338", "#29253c", "#3d3028", "#5a4636");
  // door
  R(DOOR_X - 14, fl - 34, 28, 34, "#5a4636");
  R(DOOR_X - 11, fl - 31, 22, 31, "#7a4a32");
  R(DOOR_X - 8, fl - 27, 7, 10, "#6a3f2a"); R(DOOR_X + 1, fl - 27, 7, 10, "#6a3f2a");
  R(DOOR_X - 8, fl - 14, 16, 10, "#6a3f2a");
  P(DOOR_X + 7, fl - 16, "#ffd166");
  R(DOOR_X - 16, fl - 1, 32, 1, "#8a3b3b");
  // bench
  R(r.x + 50, fl - 9, 34, 2, "#8a6a4a"); R(r.x + 52, fl - 7, 2, 7, "#6e5242"); R(r.x + 80, fl - 7, 2, 7, "#6e5242");
  // coat rack
  R(r.x + 260, fl - 32, 2, 32, "#6e5642"); R(r.x + 255, fl - 1, 12, 1, "#6e5642");
  R(r.x + 256, fl - 30, 10, 1, "#6e5642");
  R(r.x + 256, fl - 29, 4, 9, "#6ea8ff"); R(r.x + 262, fl - 29, 4, 7, "#e85d5d");
  drawPlant(r.x + 320, fl, true);
  drawLampStatic(r.x + 120, r.y);
  drawLampStatic(r.x + 240, r.y);
}

// ---------------------------------------------------------------- Dynamic drawing
function drawScreen(x, y, w, h, status, seed) {
  if (status === "working") {
    R(x, y, w, h, "#0f2338");
    const r = rng32(seed * 131 + Math.floor(T * 5));
    for (let i = 0; i < h - 1; i += 2) {
      const ind = Math.floor(r() * 3);
      R(x + 1 + ind, y + 1 + i, 2 + Math.floor(r() * (w - 5 - ind)), 1, CODE_COLORS[Math.floor(r() * 4)]);
    }
  } else if (status === "waiting") {
    R(x, y, w, h, Math.floor(T * 2) % 2 ? "#3a2f10" : "#1a1608");
    R(x + (w >> 1), y + 1, 1, h - 4, "#ffd166"); P(x + (w >> 1), y + h - 2, "#ffd166");
  } else if (status === "idle") {
    R(x, y, w, h, "#0c1626");
    P(x + 1 + (Math.floor(T * 3) % (w - 2)), y + (h >> 1), "#6ea8ff");
  } else {
    R(x, y, w, h, "#05070d");
  }
}
/** Second screen with a terminal (for agents that use the terminal a lot). */
function drawTerminal(x, fl, status) {
  R(x, fl - 23, 14, 10, "#1b1f2e");
  R(x + 6, fl - 13, 2, 1, "#2a3044");
  R(x + 3, fl - 12, 8, 1, "#2a3044");
  R(x + 1, fl - 22, 12, 8, "#020403");
  if (status === "done" || status === "gone") return;
  const lines = Math.floor(T * 2) % 4;
  for (let i = 0; i < lines; i++) { P(x + 2, fl - 21 + i * 2, "#5fd38a"); R(x + 4, fl - 21 + i * 2, 3 + ((i * 5) % 6), 1, "#3a8f5a"); }
  if (Math.floor(T * 3) % 2) R(x + 2, fl - 21 + lines * 2, 2, 1, "#5fd38a");
}
function lit(status) { return status === "working" || status === "waiting" || status === "idle"; }
function drawBulb(x, top, on) {
  R(x - 1, top + 9, 3, 1, on ? "#ffe9a8" : "#3a3a48");
  if (!on) return;
  // soft cone of light downwards
  for (let i = 0; i < 16; i++) {
    G.fillStyle = `rgba(255,226,150,${0.09 * (1 - i / 16)})`;
    G.fillRect(Math.round(x - 2 - i * 0.9), top + 10 + i, Math.round(5 + i * 1.8), 1);
  }
}
function roomOverlay(r, status) {
  let c = null;
  if (status === "working") c = "rgba(255,214,150,0.05)";
  else if (status === "waiting") c = `rgba(255,209,102,${0.05 + 0.04 * Math.sin(T * 4)})`;
  else if (status === "idle") c = null;
  else c = "rgba(4,6,16,0.5)";
  if (c) { G.fillStyle = c; G.fillRect(r.x, r.y, r.w, r.h); }
}

function drawDynamic(h, L, hits) {
  const boss = h.boss;
  const bossStatus = boss ? boss.state.status : "gone";
  // boss floor
  const br = roomRect(L, -1);
  drawScreen(BOSS_SEAT_X + 15, br.y + br.h - 22, 14, 8, bossStatus, 1);
  drawScreen(BOSS_SEAT_X + 33, br.y + br.h - 22, 14, 8, bossStatus === "working" ? "working" : bossStatus, 2);
  drawBulb(br.x + 120, br.y, lit(bossStatus));
  drawBulb(br.x + 240, br.y, lit(bossStatus));
  if (boss) hits.push({ ...br, key: "main" });

  // rooms
  const rooms = [];
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) {
      const idx = (lvl - 1) * COLS + col;
      const r = roomRect(L, idx);
      const key = h.rooms[idx];
      const st = key ? h.agents.get(key).state.status : "empty";
      rooms.push({ r, st });
      if (key) {
        drawScreen(r.x + 63, r.y + r.h - 22, 14, 8, st, idx + 3);
        if ((h.agents.get(key).bash || 0) >= 3) drawTerminal(r.x + 79, r.y + r.h, st);
        drawBulb(r.x + 60, r.y, lit(st));
        hits.push({ ...r, key });
      }
    }
  }
  if (h.doorT > 0) {
    const fl = L.lobby.floorY;
    R(DOOR_X - 11, fl - 31, 22, 31, PH().sky[4]);
    P(DOOR_X - 6, fl - 26, "#cfd8ff"); P(DOOR_X + 3, fl - 20, "#8f9cc8");
    R(DOOR_X - 11, fl - 3, 22, 3, "#2f5a3a");
    R(DOOR_X + 9, fl - 31, 3, 31, "#7a4a32");
    R(DOOR_X + 9, fl - 31, 1, 31, "#5a3626");
  }
  const lobbyOn = !h.ended;
  drawBulb(RX0 + 120, L.lobby.top, lobbyOn);
  drawBulb(RX0 + 240, L.lobby.top, lobbyOn);

  // characters
  for (const a of h.agents.values()) a.char.draw();

  // particles
  for (const p of h.parts) {
    G.globalAlpha = clamp(p.life / p.max, 0, 1);
    R(p.x, p.y, p.size, p.size, p.color);
  }
  G.globalAlpha = 1;

  // light/dark per room
  roomOverlay(br, boss ? bossStatus : "gone");
  for (const { r, st } of rooms) roomOverlay(r, st);
  if (h.ended) { G.fillStyle = "rgba(4,6,16,0.4)"; G.fillRect(RX0, L.lobby.top, COLS * RW, LOBBY_H); }

  // selection
  const sel = panelOpen && h.id === currentId ? hits.find((x) => x.key === selected) : null;
  if (sel) {
    const c = "#6ea8ff";
    R(sel.x, sel.y, sel.w, 1, c); R(sel.x, sel.y + sel.h - 1, sel.w, 1, c);
    R(sel.x, sel.y, 1, sel.h, c); R(sel.x + sel.w - 1, sel.y, 1, sel.h, c);
  }
}

// ---------------------------------------------------------------- Texts (HTML on top of the canvas)
// Text as real HTML elements on whole pixels: the browser renders it sharply.
const overlay = document.getElementById("overlay");
const labels = new Map(); // key -> { el, cls, text, w, h, left, top, op, tx, seen }
let frameNo = 0;

function label(key, cls, text) {
  let l = labels.get(key);
  if (!l) {
    const el = document.createElement("div");
    overlay.append(el);
    l = { el, cls: null, text: null, w: 0, h: 0, left: null, top: null, op: null, tx: null };
    labels.set(key, l);
  }
  if (l.cls !== cls) { l.el.className = "lbl " + cls; l.cls = cls; l.text = null; }
  if (l.text !== text) { l.el.textContent = text; l.text = text; l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
  l.seen = frameNo;
  return l;
}
function place(l, left, top, op = 1) {
  if (l.left !== left) { l.el.style.left = `${left}px`; l.left = left; }
  if (l.top !== top) { l.el.style.top = `${top}px`; l.top = top; }
  if (l.op !== op) { l.el.style.opacity = op; l.op = op; }
}
// Once the pixel fonts are loaded, measure all sizes again (labels measured with the fallback font are too wide
// and would push speech bubbles on top of each other). fonts.ready alone is not enough: it can resolve before
// the first label even asks for a font.
if (document.fonts) {
  const remeasure = () => { for (const l of labels.values()) l.text = null; };
  document.fonts.addEventListener("loadingdone", remeasure);
  Promise.all([document.fonts.load("16px VT323"), document.fonts.load("8px Silkscreen")]).then(remeasure, () => {});
}

/** Signs and speech bubbles of the current house, plus a name sign above each neighbor house. */
function updateOverlay(h, L, S, ox, oy, W, neighbors) {
  frameNo++;
  const sz = S >= 3 ? "l" : S >= 2 ? "m" : "s";
  const X = (g) => Math.round((g + ox) * S), Y = (g) => Math.round((g + oy) * S);

  // signs
  const br = roomRect(L, -1);
  const bossSign = h.boss ? t("plaque.boss", { dir: basename(h.cwd) }) : t("plaque.bossEmpty");
  place(label("p:boss", `plaque gold sz-${sz}`, bossSign), X(br.x + 3), Y(br.y + 3));
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) {
      const idx = (lvl - 1) * COLS + col;
      const r = roomRect(L, idx);
      const key = h.rooms[idx];
      const name = key ? agentName(h.agents.get(key).state) : t("plaque.free");
      place(label(`p:${idx}`, `plaque sz-${sz}`, name), X(r.x + 3), Y(r.y + 3));
    }
  }
  const sign = label("p:lobby", `plaque gold sz-${sz}`, t("sign"));
  place(sign, Math.round(X(DOOR_X) - sign.w / 2), Y(L.lobby.top + 6));

  const placed = []; // bubbles already placed, so none covers another
  for (const a of h.agents.values()) {
    const c = a.char, st = a.state.status, key = a.state.key;
    if (c.hidden) continue;
    // sleeping: Zzz
    if (c.sleeping) {
      for (let i = 0; i < 3; i++) {
        const ph = (T * 0.5 + i / 3) % 1;
        const z = label(`z:${key}:${i}`, `zzz sz-${sz}`, "z");
        place(z, X(c.headX + 5 + ph * 7), Y(c.headY - 6 - ph * 12), Math.round((1 - ph) * 10) / 10);
      }
    }
    // speech bubble
    let text = null, kind = "";
    if (c.say) { text = c.say; kind = "say"; }
    else if (st === "working" && c.pose === "sit") text = tr(a.state.activity);
    else if (st === "waiting") { text = "! " + (tr(a.state.activity) || t("say.waiting")); kind = "waiting"; }
    if (!text) continue;
    const b = label(`b:${key}`, `bubble ${kind} sz-${sz}`, trunc(text, 34));
    const ax = X(c.headX);
    const left = clamp(Math.round(ax - b.w / 2), 2, W - b.w - 2);
    let top = Y(c.headY - 2) - b.h - 8;
    for (let n = 0; n < 6; n++) {
      const hit = placed.find((q) => left < q.l + q.w + 4 && left + b.w + 4 > q.l && top < q.t + q.h + 2 && top + b.h + 2 > q.t);
      if (!hit) break;
      top = hit.t - b.h - 6; // stack above the other bubble
    }
    placed.push({ l: left, t: top, w: b.w, h: b.h });
    place(b, left, top);
    const tx = clamp(ax - left - 3, 4, b.w - 10);
    if (b.tx !== tx) { b.el.style.setProperty("--tx", `${tx}px`); b.tx = tx; }
  }

  // neighbors: folder name above the roof, with "!" while their boss waits for you
  for (const p of neighbors) {
    const nh = p.h, replay = nh.id.startsWith("replay-");
    const waiting = nh.boss && nh.boss.state.status === "waiting";
    const text = `${waiting ? "! " : replay ? "▶ " : ""}${basename(nh.cwd)}`;
    const l = label(`n:${nh.id}`, `plaque ${waiting ? "gold" : ""} sz-${sz}`, text);
    // centered over the visible part of the house, so it stays on screen when the house is cut off
    const a = Math.max(0, (p.x + HX) * S), b = Math.min(W, (p.x + HX + HW) * S);
    const left = clamp(Math.round((a + b) / 2 - l.w / 2), 4, W - l.w - 4);
    place(l, left, Math.round((p.y + ROOF_TOP) * S) - l.h - 6);
  }

  for (const [k, l] of labels) if (l.seen !== frameNo) { l.el.remove(); labels.delete(k); }
}

// ---------------------------------------------------------------- Sounds (WebAudio, can be turned off)
let soundOn = false;
try { soundOn = localStorage.getItem("sublet-sound") === "an"; } catch { /* no storage: stays off */ }
let actx = null;
function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") actx.resume();
  return actx;
}
function tone(freq, start, dur, type = "sine", vol = 0.06, freqEnd = 0) {
  const a = audio(), t0 = a.currentTime + start;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.03);
}
function click(start, vol = 0.05) {
  const a = audio(), t0 = a.currentTime + start, len = Math.floor(a.sampleRate * 0.018);
  const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = "highpass"; f.frequency.value = 1800; g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}
const SOUNDS = {
  door: () => { tone(659, 0, 0.4); tone(523, 0.3, 0.6); },
  type: () => { for (let i = 0; i < 3; i++) click(i * 0.075 + Math.random() * 0.03); },
  report: () => { tone(523, 0, 0.14, "triangle", 0.05); tone(784, 0.11, 0.22, "triangle", 0.05); },
  knock: () => { tone(150, 0, 0.09, "square", 0.035, 90); tone(150, 0.2, 0.09, "square", 0.035, 90); },
  sleep: () => { tone(240, 0, 0.8, "sine", 0.035, 130); },
  alert: () => { tone(880, 0, 0.13); tone(880, 0.2, 0.13); },
};
let lastType = 0;
function play(name, house) {
  if (!soundOn || (house && house.id !== currentId)) return;
  if (name === "type") { if (performance.now() - lastType < 250) return; lastType = performance.now(); }
  try { SOUNDS[name](); } catch { /* audio not available */ }
}
const soundBtn = document.getElementById("sound");
function renderSoundBtn() { soundBtn.textContent = t("btn.sound", { on: soundOn }); soundBtn.setAttribute("aria-pressed", String(soundOn)); }
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  try { localStorage.setItem("sublet-sound", soundOn ? "an" : "aus"); } catch { /* never mind */ }
  renderSoundBtn();
  if (soundOn) play("report");
});
renderSoundBtn();

// ---------------------------------------------------------------- State + events
const houses = new Map(); // in order of arrival = order in the street
let currentId = null;
let selected = "main";
let follow = true;
let panelOpen = false;
function openPanel() { panelOpen = true; panelEl.classList.add("open"); renderPanel(); }
function closePanel() { panelOpen = false; panelEl.classList.remove("open"); }

function getHouse(id, cwd) {
  let h = houses.get(id);
  if (!h) { h = new House(id, cwd); houses.set(id, h); }
  if (cwd) h.cwd = cwd;
  return h;
}
/** Gives the agent the first free room (or a new one). */
function assignRoom(h, a) {
  let idx = h.rooms.indexOf(null);
  if (idx < 0) { idx = h.rooms.length; h.rooms.push(a.state.key); } else h.rooms[idx] = a.state.key;
  a.room = idx;
  a.departed = false;
}
/** The agent moved out: the room is free again, empty rooms at the end disappear. */
function freeRoom(h, a) {
  if (a.room >= 0 && h.rooms[a.room] === a.state.key) h.rooms[a.room] = null;
  while (h.rooms.length && !h.rooms[h.rooms.length - 1]) h.rooms.pop();
  a.room = -2;
  a.departed = true;
  if (h.id === currentId) renderPanel();
}
function ensureAgent(h, state, opts = {}) {
  let a = h.agents.get(state.key);
  const isNew = !a;
  if (isNew) {
    a = { state, log: [], room: -1, seq: 0, departed: false };
    if (state.key !== "main") {
      a.seq = h.seq++;
      if (opts.departed) { a.room = -2; a.departed = true; } else assignRoom(h, a);
    }
    h.agents.set(state.key, a);
    a.char = new Char(h, a);
    if (a.departed) a.char.gone = a.char.hidden = true;
  } else {
    a.state = state;
  }
  return { a, isNew };
}
function addLog(a, m) {
  if (m.event === "PreToolUse" && Array.isArray(m.text) && m.text[0] === "tool.bash") a.bash = (a.bash || 0) + 1;
  a.log.push({ t: m.t, text: m.text });
  if (a.log.length > 200) a.log.shift();
}

/** The character comes in through the door at the bottom and goes to its room. Several enter one after another. */
function enterThroughDoor(h, a, text) {
  const c = a.char;
  c.setPos(DOOR_X, -1);
  c.pose = "stand";
  c.facing = -1;
  c.hidden = true;
  h.nextDoorAt = Math.max(T, h.nextDoorAt) + 1.3;
  c.queue.push({ type: "wait", t: h.nextDoorAt - 1.3 - T });
  c.queue.push({ type: "enter" });
  c.queue.push({ type: "say", text, t: 1.5 });
  c.queue.push({ type: "wait", t: 0.7 });
  c.goto("home");
  c.queue.push({ type: "sit" });
}
function reportToBoss(h, a) {
  const c = a.char;
  const slot = a.room % 5;
  c.goto({ x: BOSS_SEAT_X - 24 - slot * 11, level: 0 });
  c.queue.push({ type: "face", dir: 1 });
  c.queue.push({ type: "call", fn: () => play("report", h) });
  c.queue.push({ type: "say", text: t("say.report"), t: 1.8 });
  c.queue.push({ type: "call", fn: () => h.boss && h.boss.char.sayFor(t("say.thanks", { name: agentName(a.state) }), 1.6) });
  c.queue.push({ type: "wait", t: 1.9 });
  moveOut(h, a);
}
/** Back to the room, pack a box, out through the door with it. */
function moveOut(h, a) {
  const c = a.char;
  c.queue.push({ type: "call", fn: () => { c.leaving = true; } });
  c.goto("home");
  c.queue.push({ type: "say", text: t("say.pack"), t: 1.4 });
  c.queue.push({ type: "wait", t: 1.0 });
  c.queue.push({ type: "carry", on: true });
  c.queue.push({ type: "wait", t: 0.4 });
  c.goto({ x: DOOR_X, level: -1 });
  c.queue.push({ type: "say", text: t("say.bye"), t: 1.0 });
  c.queue.push({ type: "wait", t: 0.6 });
  c.queue.push({ type: "exit" });
}

/** An agent walks into another one's room, says its message and goes back. */
function visit(h, fromA, toA, text, ok = true) {
  const c = fromA.char, home = toA.char.home();
  const x = toA.room < 0 ? BOSS_SEAT_X - 24 : home.x - 18;
  c.goto({ x, level: home.level });
  c.queue.push({ type: "face", dir: 1 });
  c.queue.push({ type: "call", fn: () => play("knock", h) });
  c.queue.push({ type: "say", text: text || t("say.question"), t: 3.2 });
  c.queue.push({ type: "wait", t: 1.2 });
  if (ok) {
    c.queue.push({ type: "call", fn: () => toA.char.sayFor(toA.room < 0 ? t("say.lookAt") : t("say.onIt"), 2.4) });
    c.queue.push({ type: "wait", t: 2.6 });
  } else {
    c.queue.push({ type: "say", text: t("say.unreachable"), t: 2.0 });
    c.queue.push({ type: "wait", t: 2.2 });
  }
  c.goto("home");
  c.queue.push({ type: "sit" });
}

function onEvent(m) {
  const h = getHouse(m.session, m.cwd);
  const { a, isNew } = ensureAgent(h, m.state);
  addLog(a, m);
  h.lastAt = m.t;
  if (isNew) {
    if (m.event === "SubagentStart") enterThroughDoor(h, a, t("say.task", { task: a.state.task }));
    else if (m.state.key === "main" && m.event === "SessionStart") enterThroughDoor(h, a, t("say.newSession"));
    else a.char.placeAtHome();
  }
  if (m.event === "PreToolUse" && !m.visit) play("type", h);
  if (m.event === "Notification") play("alert", h);
  if (m.event === "PostToolUseFailure" && !a.char.hidden && !a.char.leaving) {
    a.char.scratchT = 1.8;
    a.char.sayFor(t("say.hmm"), 1.6);
  }
  if (m.event === "SubagentStart" && !isNew) {
    if (a.departed) {
      assignRoom(h, a);
      a.char.gone = false;
      enterThroughDoor(h, a, t("say.back"));
    } else if (a.char.leaving) {
      const c = a.char;
      c.queue = []; c.carry = false; c.leaving = false;
      c.goto("home"); c.queue.push({ type: "sit" });
    }
  }
  if (m.event === "SubagentStop") reportToBoss(h, a);
  if (m.event === "SessionEnd") {
    for (const o of h.agents.values()) if (o.state.key !== "main" && !o.departed && !o.char.leaving) moveOut(h, o);
  }
  if (m.visit) {
    const toA = h.agents.get(m.visit.to);
    if (toA && toA !== a) {
      const name = agentName(toA.state);
      if (toA.departed || toA.char.leaving) a.char.sayFor(m.visit.ok !== false ? t("say.comeBack", { name }) : t("say.movedOut", { name }), 2.6);
      else visit(h, a, toA, m.visit.text, m.visit.ok !== false);
    }
  }
  if (m.event === "SessionEnd") h.ended = true;
  if (m.event === "SessionStart") h.ended = false;

  if (attentionFor(m)) callForAttention(m);
  else if (attention && attention.session === m.session && (m.event === "UserPromptSubmit" || m.event === "PreToolUse")) attention = null;

  if (pendingSelect === h.id) { pendingSelect = null; select(h.id, "main"); }
  else if (!currentId || (follow && currentId !== h.id && (m.event === "SessionStart" || m.event === "UserPromptSubmit"))) {
    select(h.id, "main");
  }
  renderTabs();
  if (h.id === currentId) renderPanel();
}

function newestHouse() { return [...houses.values()].sort((x, y) => y.lastAt - x.lastAt)[0] || null; }

function onHello(m) {
  houses.clear();
  for (const s of m.sessions) {
    const h = getHouse(s.id, s.cwd);
    for (const st of s.agents) {
      const finished = st.key !== "main" && (st.status === "done" || st.status === "gone");
      // Just finished: still pack up visibly and leave, instead of simply missing after a reload
      const recent = finished && Date.now() - (st.lastAt || 0) < 90_000;
      const { a } = ensureAgent(h, st, { departed: finished && !recent });
      if (!finished || recent) a.char.placeAtHome();
      if (recent) moveOut(h, a);
      h.lastAt = Math.max(h.lastAt, st.lastAt || 0);
    }
    h.ended = s.ended ?? (s.agents.length > 0 && s.agents.every((st) => st.status === "gone"));
  }
  for (const ev of m.history) {
    const a = houses.get(ev.session)?.agents.get(ev.agent);
    if (a) addLog(a, ev);
  }
  if (!currentId || !houses.has(currentId)) currentId = newestHouse()?.id ?? null;
  renderTabs();
  renderPanel();
}

/** The server forgot an old session: its house leaves the street. */
function onForget(id) {
  if (!houses.delete(id)) return;
  if (attention && attention.session === id) attention = null;
  if (currentId === id) { currentId = newestHouse()?.id ?? null; selected = "main"; }
  renderTabs();
  renderPanel();
}

// ---------------------------------------------------------------- Attention: blinking tab title + desktop notifications
const BASE_TITLE = document.title;
let attention = null; // { session, dir } while Claude waits for you and this tab is in the background
let blinkOn = false;
const canNotify = "Notification" in window;
let notifyOn = false;
try { notifyOn = canNotify && Notification.permission === "granted" && localStorage.getItem("sublet-notify") === "on"; } catch { /* stays off */ }
const notifyBtn = document.getElementById("notifyBtn");
function renderNotifyBtn() { notifyBtn.textContent = t("btn.notify", { on: notifyOn }); notifyBtn.setAttribute("aria-pressed", String(notifyOn)); }
notifyBtn.hidden = !canNotify;
notifyBtn.addEventListener("click", async () => {
  if (notifyOn) notifyOn = false;
  else {
    let perm = Notification.permission;
    if (perm === "default") { try { perm = await Notification.requestPermission(); } catch { perm = "denied"; } }
    notifyOn = perm === "granted";
    notifyBtn.title = notifyOn ? t("btn.notify.title") : t("btn.notify.denied");
  }
  try { localStorage.setItem("sublet-notify", notifyOn ? "on" : "off"); } catch { /* never mind */ }
  renderNotifyBtn();
});
renderNotifyBtn();

/** Claude finished its answer or needs a decision. */
function attentionFor(m) {
  if (m.session.startsWith("replay-")) return false;
  if (m.event === "Notification" || m.event === "PermissionRequest") return true;
  return m.event === "Stop" && m.agent === "main";
}
function callForAttention(m) {
  if (!document.hidden) return;
  const dir = basename(m.cwd);
  attention = { session: m.session, dir };
  if (!notifyOn) return;
  try {
    const n = new Notification(t("title.waiting", { dir }), { body: tr(m.text), tag: m.session });
    n.onclick = () => { window.focus(); if (houses.has(m.session)) select(m.session, "main"); n.close(); };
  } catch { /* not allowed here */ }
}
setInterval(() => {
  if (attention && document.hidden) {
    blinkOn = !blinkOn;
    document.title = blinkOn ? t("title.waiting", { dir: attention.dir }) : BASE_TITLE;
  } else if (document.title !== BASE_TITLE) document.title = BASE_TITLE;
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { attention = null; document.title = BASE_TITLE; }
});

// ---------------------------------------------------------------- DOM: tabs + panel
const tabsEl = document.getElementById("tabs");
const panelEl = document.getElementById("panel");

function select(id, key) {
  currentId = id;
  selected = key || "main";
  renderTabs();
  renderPanel();
}

function renderTabs() {
  const list = [...houses.values()].sort((x, y) => y.lastAt - x.lastAt).slice(0, 5);
  // folder name only; the short session id is added when two tabs share a folder
  const dirs = new Map();
  for (const h of list) dirs.set(basename(h.cwd), (dirs.get(basename(h.cwd)) || 0) + 1);
  if (!list.length) {
    tabsEl.replaceChildren(el("span", { className: "hint" }, t("hint.noSession")));
    return;
  }
  tabsEl.replaceChildren(...list.map((h, i) => {
    const b = document.createElement("button");
    if (h.id === currentId) b.className = "on";
    const dot = document.createElement("span");
    dot.className = "dot " + (h.ended ? "gone" : h.boss ? h.boss.state.status : "");
    const replay = h.id.startsWith("replay-");
    const dir = basename(h.cwd);
    const suffix = replay ? ` · ${t("replay.tab")}` : dirs.get(dir) > 1 ? ` · ${h.id.slice(0, 4)}` : "";
    b.append(dot, `${replay ? "▶ " : ""}${dir}${suffix}`);
    b.title = h.cwd || "";
    b.onclick = () => { follow = i === 0; select(h.id, "main"); };
    return b;
  }));
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e[k] = v;
  e.append(...kids.filter((k) => k != null));
  return e;
}

/** In the boss panel: who has moved out already (a click shows their report and log). */
function departedList(h, a) {
  if (a.state.key !== "main") return [];
  const gone = [...h.agents.values()].filter((o) => o.departed);
  if (!gone.length) return [];
  return [el("h3", {}, t("panel.departed")), el("div", { className: "gone-list" },
    ...gone.map((o) => el("button", { className: "gone", type: "button",
      onclick: () => { selected = o.state.key; renderPanel(); } }, agentName(o.state))))];
}
function renderPanel() {
  const h = houses.get(currentId);
  const a = h && h.agents.get(selected);
  if (!a) {
    panelEl.replaceChildren(el("p", { className: "hint" }, h ? t("hint.clickRoom") : t("hint.noSession")));
    return;
  }
  const st = a.state;
  const av = el("canvas", { id: "avatar", width: 16, height: 16 });
  const prev = G; G = av.getContext("2d");
  drawSprite(2, 3, { hue: a.char.hue, acc: a.char.acc, eyes: "open", feet: "stand" });
  G = prev;

  const dl = el("dl", {},
    el("dt", {}, t("panel.type")), el("dd", {}, st.key === "main" ? t("type.main") : st.type),
    st.key !== "main" ? el("dt", {}, t("panel.task")) : null, st.key !== "main" ? el("dd", {}, st.task || "–") : null,
    el("dt", {}, t("panel.now")), el("dd", {}, tr(st.activity) || "–"),
    el("dt", {}, t("panel.tools")), el("dd", {}, String(st.tools || 0)),
  );
  const log = el("ul", { id: "p-log" }, ...a.log.slice(-80).map((l) =>
    el("li", {}, el("time", {}, fmtTime(l.t)), tr(l.text))));
  panelEl.replaceChildren(...[
    el("button", { className: "close", title: t("panel.close"), onclick: closePanel }, "×"),
    el("div", { className: "p-head" }, av,
      el("div", {},
        el("h2", { id: "p-name" }, agentName(st)),
        el("div", { id: "p-meta" }, el("span", { className: "dot " + st.status }),
          a.departed ? t("status.departed") : t(`status.${st.status}`)))),
    dl,
    st.result ? el("h3", {}, t("panel.lastAnswer")) : null,
    st.result ? el("p", { id: "p-result" }, st.result) : null,
    ...departedList(h, a),
    el("h3", {}, t("panel.log")),
    log,
  ].filter(Boolean));
  panelEl.scrollTop = panelEl.scrollHeight;
}

// ---------------------------------------------------------------- Rendering
// All houses stand side by side in a street. The camera zooms onto the current house and pans to the next one.
const view = document.getElementById("view");
const vctx = view.getContext("2d");
const low = makeCanvas(LW, 100);
const lctx = low.getContext("2d");
const placeholder = new House("none", "");
// room for the header (CSS pixels); it can wrap onto two lines on narrow screens
let TOP = 52;
const headerEl = document.querySelector("header");
new ResizeObserver(() => { TOP = Math.max(52, headerEl.offsetHeight + 2); }).observe(headerEl);
const STREET_GAP = 40;     // game pixels between two houses
const STRIDE = LW + STREET_GAP;
let hits = [];             // clickable areas in screen game pixels
let cam = { S: 1 };
let camS = 0, camX = 0, camH = 0, camWX = 0; // smoothed camera: zoom, screen center (CSS px), house height, street position
let skyCache = null, skyKey = "";

function render(dt = 0) {
  const h = houses.get(currentId) || placeholder;
  const street = houses.has(h.id) ? [...houses.values()] : [placeholder];
  const ci = Math.max(0, street.indexOf(h));
  const L = h.layout();
  const vw = window.innerWidth, vh = window.innerHeight;

  // Fit the house as large as possible: header at the top, room for the open panel on the right
  const side = panelOpen && vw > 900 ? 372 : 0;
  const tS = Math.max(0.5, Math.min((vw - side - 24) / LW, (vh - TOP - 12) / L.H));
  const tX = (vw - side) / 2;
  const tWX = ci * STRIDE + LW / 2;
  const first = camS === 0;
  const k = first ? 1 : 1 - Math.exp(-dt * 9);
  const kPan = first ? 1 : 1 - Math.exp(-dt * 5);
  camS += (tS - camS) * k; camX += (tX - camX) * k; camH += (L.H - camH) * k; camWX += (tWX - camWX) * kPan;
  if (Math.abs(tS - camS) < 0.002) camS = tS;
  if (Math.abs(tX - camX) < 0.5) camX = tX;
  if (Math.abs(L.H - camH) < 0.2) camH = L.H;
  if (Math.abs(tWX - camWX) < 0.3) camWX = tWX;
  const S = camS;
  cam = { S };
  const WW = Math.ceil(vw / S), WH = Math.ceil(vh / S);
  // All houses share one ground line: the current house sits centered below the header.
  const groundY = Math.round(TOP / S + ((vh - TOP) / S - camH) / 2 + camH - 30);
  const x0 = Math.floor(camX / S - camWX); // where the street starts on screen

  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(vw * dpr), ch = Math.round(vh * dpr);
  if (view.width !== cw || view.height !== ch) {
    view.width = cw; view.height = ch;
    view.style.width = `${vw}px`; view.style.height = `${vh}px`;
  }
  if (low.width !== WW || low.height !== WH) { low.width = WW; low.height = WH; }

  // sky (cached as long as size and position stay the same)
  const cx = Math.round(camX / S);
  let moonX = Math.min(WW - 24 - Math.ceil(side / S), cx + LW / 2 + 46), moonY = Math.max(groundY - L.H + 48, Math.round(TOP / S) + 14);
  if (PH().body === "sunLow") {
    moonY = groundY - 38;
    if (phaseName === "morning") moonX = Math.max(24, cx - LW / 2 - 46);
  }
  const sk = `${WW}x${WH}:${groundY}:${moonX}:${moonY}:${phaseName}`;
  if (skyKey !== sk) {
    skyCache = makeCanvas(WW, WH);
    G = skyCache.getContext("2d");
    drawSky(WW, WH, groundY, moonX, moonY);
    skyKey = sk;
  }

  G = lctx;
  G.drawImage(skyCache, 0, 0);
  drawClouds(WW, groundY);
  // twinkling stars (night only)
  const rnd = rng32(99);
  for (let i = 0; i < (phaseName === "night" ? WW / 25 : 0); i++) {
    const x = rnd() * WW, y = rnd() * (groundY * 0.55), ph = rnd() * 6;
    if (Math.sin(T * 2 + ph) > 0.6) P(x, y, "#ffffff");
  }

  hits = [];
  const neighbors = [];
  let ox = 0, oy = 0;
  street.forEach((sh, i) => {
    const Ls = sh.layout();
    const x = x0 + i * STRIDE, y = groundY - Ls.groundY;
    if (x > WW || x + LW < 0) return; // off screen
    // house (cached per floor count and room assignment)
    const key = `${Ls.floors}:${sh.rooms.map((r) => r || "-").join(",")}:${phaseName}`;
    if (!sh.bg || sh.bgKey !== key) {
      sh.bg = makeCanvas(LW, Ls.H);
      G = sh.bg.getContext("2d");
      drawStatic(sh, Ls);
      sh.bgKey = key;
      G = lctx;
    }
    G.save();
    G.translate(x, y);
    G.drawImage(sh.bg, 0, 0);
    const local = [];
    drawDynamic(sh, Ls, local);
    G.restore();
    if (sh === h) {
      ox = x; oy = y;
      for (const r of local) hits.push({ ...r, x: r.x + x, y: r.y + y });
    } else {
      hits.push({ x: x + HX, y: y + ROOF_TOP, w: HW, h: Ls.groundY - ROOF_TOP, house: sh.id });
      neighbors.push({ h: sh, x, y });
    }
  });

  vctx.imageSmoothingEnabled = false;
  vctx.drawImage(low, 0, 0, WW, WH, 0, 0, Math.round(WW * S * dpr), Math.round(WH * S * dpr));
  updateOverlay(h, L, S, ox, oy, vw, neighbors);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  T += dt;
  for (const h of houses.values()) h.update(dt);
  render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function hitAt(ev) {
  const x = ev.clientX / cam.S, y = ev.clientY / cam.S;
  return hits.find((hh) => x >= hh.x && x < hh.x + hh.w && y >= hh.y && y < hh.y + hh.h);
}
view.addEventListener("click", (ev) => {
  const hit = hitAt(ev);
  if (!hit) return;
  if (hit.house) { follow = false; select(hit.house, "main"); return; }
  selected = hit.key;
  openPanel();
});
view.addEventListener("mousemove", (ev) => { view.style.cursor = hitAt(ev) ? "pointer" : "default"; });
window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closePanel(); replayMenu.hidden = true; } });

// ---------------------------------------------------------------- Replay
const replayBtn = document.getElementById("replayBtn");
const replayMenu = document.getElementById("replayMenu");
let replaySpeed = 4;
let pendingSelect = null;
const fmtDate = (ts) => new Date(ts).toLocaleString(LANG === "de" ? "de-AT" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDur = (ms) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`);

async function openReplayMenu() {
  replayMenu.hidden = false;
  replayMenu.replaceChildren(el("p", { className: "hint" }, t("replay.loading")));
  let data = { logging: true, sessions: [] };
  try { data = await (await fetch("/api/sessions")).json(); } catch { /* server gone */ }
  const speed = el("select", { title: t("replay.speed"), onchange: (e) => { replaySpeed = Number(e.target.value); } },
    ...[2, 4, 10].map((v) => el("option", { value: String(v), selected: v === replaySpeed }, `${v}×`)));
  const items = (data.sessions || []).map((s) => el("button", { className: "item", type: "button", onclick: () => runReplay(s.id) },
    el("div", {}, `${basename(s.cwd)} · ${s.id.slice(0, 4)}`),
    el("div", { className: "sub" }, [
      s.first ? fmtDate(s.first) : t("replay.noTime"),
      t("replay.subagents", { n: s.agents }),
      s.first && s.last ? fmtDur(s.last - s.first) : t("replay.events", { n: s.events }),
    ].join(" · "))));
  const empty = el("p", { className: "hint" }, data.logging === false ? t("replay.off") : t("replay.none"));
  replayMenu.replaceChildren(el("h4", {}, t("replay.title"), speed), ...(items.length ? items : [empty]));
}
async function runReplay(id) {
  replayMenu.hidden = true;
  try {
    const r = await fetch("/api/replay", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: id, speed: replaySpeed }) });
    if (r.ok) { pendingSelect = (await r.json()).id; follow = true; }
  } catch { /* server gone */ }
}
replayBtn.addEventListener("click", () => { if (replayMenu.hidden) openReplayMenu(); else replayMenu.hidden = true; });
document.addEventListener("click", (ev) => {
  if (!replayMenu.hidden && !replayMenu.contains(ev.target) && ev.target !== replayBtn) replayMenu.hidden = true;
});

// ---------------------------------------------------------------- Answering permission requests in the house
const permBtn = document.getElementById("permBtn");
const permsEl = document.getElementById("perms");
let answerInHouse = false;
const permCards = new Map(); // id -> { el, info, left }

function renderPermBtn() {
  permBtn.textContent = t("btn.perm", { on: answerInHouse });
  permBtn.setAttribute("aria-pressed", String(answerInHouse));
}
permBtn.addEventListener("click", async () => {
  try {
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answerInHouse: !answerInHouse }) });
    if (r.ok) { answerInHouse = (await r.json()).answerInHouse; renderPermBtn(); }
  } catch { /* server gone */ }
});

function addPermCard(info) {
  if (permCards.has(info.id)) return;
  const left = el("span", { className: "left" });
  const decide = async (decision) => {
    allow.disabled = deny.disabled = true;
    try {
      await fetch("/api/permission", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: info.id, decision }) });
    } catch { allow.disabled = deny.disabled = false; }
  };
  const allow = el("button", { className: "allow", type: "button", onclick: () => decide("allow") }, t("perm.allow"));
  const deny = el("button", { className: "deny", type: "button", onclick: () => decide("deny") }, t("perm.deny"));
  const card = el("div", { className: "perm", role: "alertdialog" },
    el("div", { className: "perm-title", title: t("perm.jump"),
      onclick: () => { if (houses.has(info.session)) { select(info.session, info.agent); openPanel(); } } },
      el("b", {}, tr(info.who)), t("perm.wants", { x: info.tool })),
    el("code", {}, info.detail),
    el("div", { className: "perm-where" }, basename(info.cwd)),
    el("div", { className: "perm-actions" }, allow, deny, left));
  permsEl.append(card);
  permCards.set(info.id, { el: card, info, left });
  tickPermCards();
  play("alert");
}
function removePermCard(id) {
  const c = permCards.get(id);
  if (c) { c.el.remove(); permCards.delete(id); }
}
function tickPermCards() {
  for (const c of permCards.values()) {
    const s = Math.max(0, Math.round((c.info.expiresAt - Date.now()) / 1000));
    c.left.textContent = s > 0 ? t("perm.left", { s }) : t("perm.expiring");
  }
}
setInterval(tickPermCards, 1000);
renderPermBtn();

// ---------------------------------------------------------------- Static texts + tab icon
applyStaticTexts();
(function favicon() {
  try {
    const c = makeCanvas(16, 16), prev = G;
    G = c.getContext("2d");
    drawSprite(2, 3, { hue: 28, acc: "crown", eyes: "open", feet: "stand" });
    G = prev;
    const link = document.createElement("link");
    link.rel = "icon"; link.href = c.toDataURL();
    document.head.append(link);
  } catch { /* no icon then */ }
})();

// ---------------------------------------------------------------- Connection
const conn = document.getElementById("conn");
const es = new EventSource("/stream");
es.onopen = () => { conn.textContent = t("conn.live"); conn.className = "on"; };
es.onerror = () => { conn.textContent = t("conn.lost"); conn.className = ""; };
es.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.kind === "reload") { location.reload(); return; }
  if (m.kind === "hello") {
    onHello(m);
    answerInHouse = !!(m.settings && m.settings.answerInHouse);
    renderPermBtn();
    for (const id of [...permCards.keys()]) removePermCard(id);
    for (const p of m.permissions || []) addPermCard(p);
  }
  else if (m.kind === "settings") { answerInHouse = !!m.settings.answerInHouse; renderPermBtn(); }
  else if (m.kind === "permission") addPermCard(m);
  else if (m.kind === "permission-done") removePermCard(m.id);
  else if (m.kind === "forget") onForget(m.session);
  else if (m.kind === "event") onEvent(m);
};
