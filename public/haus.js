// Agent-Haus – Pixel-Ansicht.
// Jede Claude-Code-Session ist ein Haus: oben die Chefetage (Haupt-Agent),
// darunter ein Raum pro Subagent, unten die Lobby. Gezeichnet wird in einer kleinen
// Auflösung (Spielpixel) und dann scharf hochskaliert; Texte kommen danach in voller Auflösung drauf.
"use strict";

// ---------------------------------------------------------------- Maße (Spielpixel)
const COLS = 3, RW = 120, RH = 72, SLAB = 4, SW = 20;
const HX = 16, IX = HX + 4, RX0 = IX + SW;
const HW = 4 + SW + COLS * RW + 4;      // Hausbreite außen
const LW = HX + HW + 16;                // Bildbreite
const ROOF_TOP = 12, ATTIC_TOP = 50, LOBBY_H = 56;
const LADDER_X = IX + SW / 2;
const BOSS_SEAT_X = RX0 + 170;
const DOOR_X = RX0 + 180;
const CHIMNEY_X = HX + HW - 80;
const WALK = 90, CLIMB = 110;           // Pixel pro Sekunde

const OUTLINE = "#141826";
const CODE_COLORS = ["#6ee7a8", "#6ea8ff", "#ffd166", "#c792ea"];
const ACCS = ["none", "headphones", "shades", "sprout", "bow", "scarf"];
const STATUS_LABEL = {
  working: "arbeitet", idle: "frei", waiting: "braucht dich", done: "fertig", gone: "Session vorbei",
};

// ---------------------------------------------------------------- Hilfen
let T = 0; // globale Zeit in Sekunden
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const basename = (p) => (p || "").split("/").filter(Boolean).pop() || "?";
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

/** Goldener Winkel: aufeinanderfolgende Räume bekommen deutlich verschiedene Farben (nie das Chef-Orange). */
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

let G = null; // aktueller Zeichenkontext (Spielpixel)
function R(x, y, w, h, c) { G.fillStyle = c; G.fillRect(Math.round(x), Math.round(y), w, h); }
function P(x, y, c) { G.fillStyle = c; G.fillRect(Math.round(x), Math.round(y), 1, 1); }

// ---------------------------------------------------------------- Layout
function makeLayout(floors) {
  const levels = [{ top: ATTIC_TOP, floorY: ATTIC_TOP + RH }]; // 0 = Chefetage
  for (let i = 1; i <= floors; i++) {
    const top = ATTIC_TOP + RH + SLAB + (i - 1) * (RH + SLAB);
    levels.push({ top, floorY: top + RH });
  }
  const lobbyTop = levels[levels.length - 1].floorY + SLAB;
  const lobby = { top: lobbyTop, floorY: lobbyTop + LOBBY_H };
  const groundY = lobby.floorY;
  return { floors, levels, lobby, groundY, H: groundY + 30 };
}
// level -1 = Lobby
const floorY = (L, level) => (level === -1 ? L.lobby.floorY : L.levels[Math.min(level, L.levels.length - 1)].floorY);

function roomRect(L, idx) {
  if (idx < 0) return { x: RX0, y: ATTIC_TOP, w: COLS * RW, h: RH, level: 0 };
  const level = 1 + Math.floor(idx / COLS), col = idx % COLS;
  return { x: RX0 + col * RW, y: L.levels[level].top, w: RW, h: RH, level };
}

// ---------------------------------------------------------------- Figur (Sprite)
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

/** Zeichnet die Figur mit linker oberer Ecke (fx, fy) in den aktuellen Kontext G. */
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

// ---------------------------------------------------------------- Figur (Verhalten)
class Char {
  constructor(house, agent) {
    this.house = house;
    this.agent = agent;
    this.boss = agent.state.key === "main";
    this.hue = this.boss ? 28 : roomHue(agent.room);
    this.acc = this.boss ? "crown" : ACCS[(agent.room + 1) % ACCS.length];
    this.x = 0; this.y = 0; this.level = 0;
    this.queue = [];
    this.pose = "stand";
    this.facing = 1;
    this.t = Math.random() * 10;
    this.say = null; this.sayT = 0;
    this.wanderT = 1 + Math.random() * 3;
    this.headX = 0; this.headY = 0;
    this.hidden = false;
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
    this.t += dt;
    if (this.sayT > 0) { this.sayT -= dt; if (this.sayT <= 0) this.say = null; }

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
        case "enter": this.hidden = false; this.house.doorT = 1.1; this.queue.shift(); return;
      }
    }
    this.idle(dt);
  }

  /** Standardverhalten, wenn nichts in der Warteschlange ist. */
  idle(dt) {
    const home = this.home();
    const atHome = this.level === home.level && Math.abs(this.x - home.x) < 0.5;
    if (this.status !== "idle") {
      if (!atHome) { this.goto("home"); this.queue.push({ type: "sit" }); return; }
      this.pose = "sit"; this.facing = 1;
      return;
    }
    // frei: im eigenen Raum herumschlendern
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
    if (this.hidden) return;
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
    if (o.eyes === "open" && this.t % 3.7 < 0.12) o.eyes = "closed";
    drawSprite(fx, fy, o);
    this.headX = fx + 6; this.headY = fy;
  }

  get sleeping() { return this.pose === "sit" && (this.status === "done" || this.status === "gone") && !this.queue.length; }
}

// ---------------------------------------------------------------- Haus
class House {
  constructor(id, cwd) {
    this.id = id; this.cwd = cwd || "";
    this.agents = new Map();   // key -> { state, log, room, char }
    this.order = [];           // Subagent-Keys in Einzugsreihenfolge
    this.parts = [];
    this.smokeT = 0;
    this.doorT = 0;          // > 0: Tür steht offen
    this.nextDoorAt = 0;     // damit mehrere Agents nacheinander eintreten
    this.lastAt = 0;
    this._L = null;
    this.bg = null; this.bgKey = "";
  }
  get floors() { return Math.max(1, Math.ceil(this.order.length / COLS)); }
  layout() {
    if (!this._L || this._L.floors !== this.floors) this._L = makeLayout(this.floors);
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

// ---------------------------------------------------------------- Himmel + Boden (ganzer Bildschirm)
/** Zeichnet Himmel, Mond, Hügel und Boden über die ganze Welt. groundY in Weltkoordinaten. */
function drawSky(WW, WH, groundY, moonX, moonY) {
  const sky = ["#060914", "#080c1a", "#0a1020", "#0c1326", "#0f172d", "#121b34", "#151f3a"];
  const band = Math.ceil(groundY / sky.length);
  for (let i = 0; i < sky.length; i++) R(0, i * band, WW, band + 1, sky[i]);
  const rnd = rng32(7);
  const n = Math.round((WW * groundY) / 1100);
  for (let i = 0; i < n; i++) P(rnd() * WW, rnd() * (groundY - 24), rnd() < 0.2 ? "#ffffff" : "#8f9cc8");
  // Mond
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    if (dx * dx + dy * dy <= 64) P(moonX + dx, moonY + dy, dx * dx + dy * dy > 49 ? "#d8cfae" : "#f3ecd2");
  }
  P(moonX - 3, moonY - 2, "#d8cfae"); P(moonX + 2, moonY + 3, "#d8cfae"); P(moonX + 3, moonY + 2, "#d8cfae");
  // Hügel (zwei Reihen)
  for (let x = 0; x < WW; x++) {
    const far = Math.round(22 + 9 * Math.sin(x / 53) + 5 * Math.sin(x / 19 + 2));
    R(x, groundY - far, 1, far, "#0a1128");
    const near = Math.round(11 + 6 * Math.sin(x / 37) + 4 * Math.sin(x / 13 + 1));
    R(x, groundY - near, 1, near, "#0d1631");
  }
  // Boden
  R(0, groundY, WW, WH - groundY, "#241d30");
  R(0, groundY, WW, 2, "#4f9a5a");
  for (let i = 0; i < WW / 8; i++) {
    const x = rnd() * WW;
    P(x, groundY - 1, "#4f9a5a");
    if (rnd() < 0.4) P(x + 1, groundY - 2, "#5fb36a");
  }
  for (let i = 0; i < (WW * (WH - groundY)) / 90; i++) P(rnd() * WW, groundY + 4 + rnd() * (WH - groundY - 4), "#2f2640");
}

// ---------------------------------------------------------------- Statisches Haus (transparent drumherum)
function drawStatic(h, L) {
  const gy = L.groundY;

  // Schornstein (hinter dem Dach)
  R(CHIMNEY_X, ROOF_TOP + 2, 12, 26, "#6b3a3a");
  for (let y = ROOF_TOP + 5; y < ROOF_TOP + 28; y += 4) R(CHIMNEY_X, y, 12, 1, "#562e30");
  R(CHIMNEY_X - 1, ROOF_TOP, 14, 3, "#4a2a2a");

  // Hauskörper
  R(HX, ATTIC_TOP - 2, HW, gy - ATTIC_TOP + 2, "#2c2438");
  // Schacht mit Leiter
  R(IX, ATTIC_TOP, SW, gy - ATTIC_TOP, "#11172a");

  // Chefetage
  drawBossRoom(L);
  // Stockwerke
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) {
      const idx = (lvl - 1) * COLS + col;
      const r = roomRect(L, idx);
      const key = h.order[idx];
      if (key) drawRoom(r, roomHue(idx)); else drawEmptyRoom(r);
    }
  }
  drawLobby(L);

  // Innenwände mit Türöffnung
  const wall = (x, top, fl) => {
    R(x - 1, top, 2, fl - 17 - top, "#2c2438");
    R(x - 2, fl - 18, 4, 1, "#5a4636");
  };
  wall(RX0, ATTIC_TOP, L.levels[0].floorY);
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) wall(RX0 + col * RW, L.levels[lvl].top, L.levels[lvl].floorY);
  }
  wall(RX0, L.lobby.top, L.lobby.floorY);

  // Decken/Böden (mit Luke im Schacht)
  R(IX, ATTIC_TOP - 2, HW - 8, 2, "#3b3150");
  for (const lv of L.levels) {
    R(IX, lv.floorY, HW - 8, SLAB, "#5a4636");
    R(IX, lv.floorY, HW - 8, 1, "#6e5642");
    for (let x = IX + 12; x < IX + HW - 8; x += 16) R(x, lv.floorY + 1, 1, SLAB - 1, "#4a3a2e");
    R(IX + 3, lv.floorY, SW - 6, SLAB, "#11172a");
  }
  // Leiter
  const lt = ATTIC_TOP + 6, lb = L.lobby.floorY;
  R(LADDER_X - 5, lt, 1, lb - lt, "#7a5c3e");
  R(LADDER_X + 4, lt, 1, lb - lt, "#7a5c3e");
  for (let y = lt + 2; y < lb; y += 5) R(LADDER_X - 4, y, 8, 1, "#8e6c4a");

  // Außenwände + Fundament
  R(HX, ATTIC_TOP - 2, 4, gy - ATTIC_TOP + 2, "#3b3150");
  R(HX + HW - 4, ATTIC_TOP - 2, 4, gy - ATTIC_TOP + 2, "#3b3150");
  R(HX - 3, gy, HW + 6, 4, "#4a4058");
  for (let x = HX; x < HX + HW; x += 9) R(x, gy + 1, 1, 3, "#3a3248");

  // Dach
  const cx = HX + HW / 2, maxHalf = HW / 2 + 10, rows = ATTIC_TOP - 2 - ROOF_TOP;
  for (let i = 0; i < rows; i++) {
    const y = ROOF_TOP + i, half = Math.round(((i + 1) / rows) * maxHalf);
    R(cx - half, y, half * 2, 1, i % 4 === 3 ? "#52222c" : "#6b2f3a");
    const off = Math.floor(i / 4) % 2 ? 4 : 0;
    if (i % 4 !== 3) for (let x = cx - half + off; x < cx + half; x += 8) if (i % 4 === 1) P(x, y, "#52222c");
    P(cx - half, y, "#8a4450"); P(cx + half - 1, y, "#8a4450");
  }
  R(HX - 10, ATTIC_TOP - 3, HW + 20, 2, "#3e1a22");
  // Dachfenster
  R(cx - 7, ROOF_TOP + 14, 14, 11, "#3e1a22");
  R(cx - 5, ROOF_TOP + 16, 10, 8, "#ffd98a");
  R(cx - 1, ROOF_TOP + 16, 1, 8, "#3e1a22");
}

function drawWindow(x, y) {
  R(x, y, 22, 18, "#6e5642");
  R(x + 2, y + 2, 18, 14, "#16224a");
  P(x + 5, y + 5, "#cfd8ff"); P(x + 15, y + 11, "#8f9cc8");
  R(x + 10, y + 2, 2, 14, "#6e5642");
  R(x + 2, y + 8, 18, 2, "#6e5642");
  R(x - 1, y + 18, 24, 2, "#8a6a4a");
}
function drawLampStatic(x, top) {
  R(x, top, 1, 6, "#2a2a38");
  R(x - 4, top + 6, 9, 3, "#3c4566");
}
function drawDesk(S, fl, monitors = 1) {
  // Stuhl (Lehne links, die Figur sitzt davor und schaut nach rechts)
  R(S - 8, fl - 17, 2, 12, "#46506e");
  R(S - 7, fl - 5, 12, 2, "#46506e");
  R(S - 2, fl - 3, 2, 2, "#2e3550");
  R(S - 5, fl - 1, 8, 1, "#2e3550");
  // Tisch
  const w = monitors > 1 ? 52 : 34;
  R(S + 8, fl - 11, w, 2, "#9a7650");
  R(S + 9, fl - 9, 2, 9, "#7e603f");
  R(S + 6 + w, fl - 9, 2, 9, "#7e603f");
  R(S + w - 4, fl - 9, 8, 6, "#7e603f");
  R(S + w - 1, fl - 7, 2, 1, "#c9a26a");
  R(S + 8, fl - 12, 6, 1, "#3a4058"); // Tastatur
  for (let m = 0; m < monitors; m++) {
    const mx = S + 14 + m * 18;
    R(mx, fl - 23, 16, 10, "#1b1f2e");
    R(mx + 7, fl - 13, 2, 1, "#2a3044");
    R(mx + 4, fl - 12, 8, 1, "#2a3044");
  }
  // Tasse
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
function drawRoom(r, hue) {
  drawWallpaper(r, hsl(hue, 24, 23), hsl(hue, 24, 25.5), hsl(hue, 22, 17), hsl(hue, 22, 30));
  const fl = r.y + r.h;
  drawWindow(r.x + 10, r.y + 12);
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
  // Spinnennetz
  for (let i = 0; i < 6; i++) { P(r.x + r.w - 3 - i, r.y + 1 + i, "#3a4058"); }
  R(r.x + r.w - 8, r.y + 1, 6, 1, "#3a4058");
  R(r.x + r.w - 2, r.y + 1, 1, 6, "#3a4058");
}
function drawBossRoom(L) {
  const r = roomRect(L, -1), fl = r.y + r.h;
  drawWallpaper(r, hsl(28, 22, 21), hsl(28, 22, 23.5), hsl(28, 22, 15), hsl(28, 30, 30));
  drawWindow(r.x + 16, r.y + 12);
  // Whiteboard mit Plan
  R(r.x + 52, r.y + 10, 44, 26, "#8a93ab");
  R(r.x + 54, r.y + 12, 40, 22, "#d8dde8");
  R(r.x + 58, r.y + 16, 14, 1, "#6ea8ff"); R(r.x + 58, r.y + 20, 22, 1, "#e85d5d");
  R(r.x + 58, r.y + 24, 10, 1, "#5fd38a"); R(r.x + 74, r.y + 24, 8, 1, "#6ea8ff");
  R(r.x + 82, r.y + 15, 6, 6, "#ffd166");
  R(r.x + 58, r.y + 28, 26, 1, "#8a93ab");
  // Teppich für die Berichte
  R(r.x + 96, fl - 1, 58, 1, "#7a3b5a");
  R(r.x + 98, fl - 1, 2, 1, "#a85580"); R(r.x + 150, fl - 1, 2, 1, "#a85580");
  drawDesk(BOSS_SEAT_X, fl, 2);
  // Bücherregal
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
  // Tür
  R(DOOR_X - 14, fl - 34, 28, 34, "#5a4636");
  R(DOOR_X - 11, fl - 31, 22, 31, "#7a4a32");
  R(DOOR_X - 8, fl - 27, 7, 10, "#6a3f2a"); R(DOOR_X + 1, fl - 27, 7, 10, "#6a3f2a");
  R(DOOR_X - 8, fl - 14, 16, 10, "#6a3f2a");
  P(DOOR_X + 7, fl - 16, "#ffd166");
  R(DOOR_X - 16, fl - 1, 32, 1, "#8a3b3b");
  // Bank
  R(r.x + 50, fl - 9, 34, 2, "#8a6a4a"); R(r.x + 52, fl - 7, 2, 7, "#6e5242"); R(r.x + 80, fl - 7, 2, 7, "#6e5242");
  // Garderobe
  R(r.x + 260, fl - 32, 2, 32, "#6e5642"); R(r.x + 255, fl - 1, 12, 1, "#6e5642");
  R(r.x + 256, fl - 30, 10, 1, "#6e5642");
  R(r.x + 256, fl - 29, 4, 9, "#6ea8ff"); R(r.x + 262, fl - 29, 4, 7, "#e85d5d");
  drawPlant(r.x + 320, fl, true);
  drawLampStatic(r.x + 120, r.y);
  drawLampStatic(r.x + 240, r.y);
}

// ---------------------------------------------------------------- Dynamisches Zeichnen
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
function lit(status) { return status === "working" || status === "waiting" || status === "idle"; }
function drawBulb(x, top, on) {
  R(x - 1, top + 9, 3, 1, on ? "#ffe9a8" : "#3a3a48");
  if (!on) return;
  // weicher Lichtkegel nach unten
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
  // Chefetage
  const br = roomRect(L, -1);
  drawScreen(BOSS_SEAT_X + 15, br.y + br.h - 22, 14, 8, bossStatus, 1);
  drawScreen(BOSS_SEAT_X + 33, br.y + br.h - 22, 14, 8, bossStatus === "working" ? "working" : bossStatus, 2);
  drawBulb(br.x + 120, br.y, lit(bossStatus));
  drawBulb(br.x + 240, br.y, lit(bossStatus));
  if (boss) hits.push({ ...br, key: "main" });

  // Räume
  const rooms = [];
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) {
      const idx = (lvl - 1) * COLS + col;
      const r = roomRect(L, idx);
      const key = h.order[idx];
      const st = key ? h.agents.get(key).state.status : "empty";
      rooms.push({ r, st });
      if (key) {
        drawScreen(r.x + 63, r.y + r.h - 22, 14, 8, st, idx + 3);
        drawBulb(r.x + 60, r.y, lit(st));
        hits.push({ ...r, key });
      }
    }
  }
  if (h.doorT > 0) {
    const fl = L.lobby.floorY;
    R(DOOR_X - 11, fl - 31, 22, 31, "#0b1226");
    P(DOOR_X - 6, fl - 26, "#cfd8ff"); P(DOOR_X + 3, fl - 20, "#8f9cc8");
    R(DOOR_X - 11, fl - 3, 22, 3, "#2f5a3a");
    R(DOOR_X + 9, fl - 31, 3, 31, "#7a4a32");
    R(DOOR_X + 9, fl - 31, 1, 31, "#5a3626");
  }
  const lobbyOn = !h.ended;
  drawBulb(RX0 + 120, L.lobby.top, lobbyOn);
  drawBulb(RX0 + 240, L.lobby.top, lobbyOn);

  // Figuren
  for (const a of h.agents.values()) a.char.draw();

  // Partikel
  for (const p of h.parts) {
    G.globalAlpha = clamp(p.life / p.max, 0, 1);
    R(p.x, p.y, p.size, p.size, p.color);
  }
  G.globalAlpha = 1;

  // Licht/Dunkel je Raum
  roomOverlay(br, boss ? bossStatus : "gone");
  for (const { r, st } of rooms) roomOverlay(r, st);
  if (h.ended) { G.fillStyle = "rgba(4,6,16,0.4)"; G.fillRect(RX0, L.lobby.top, COLS * RW, LOBBY_H); }

  // Auswahl
  const sel = panelOpen && h.id === currentId ? hits.find((x) => x.key === selected) : null;
  if (sel) {
    const c = "#6ea8ff";
    R(sel.x, sel.y, sel.w, 1, c); R(sel.x, sel.y + sel.h - 1, sel.w, 1, c);
    R(sel.x, sel.y, 1, sel.h, c); R(sel.x + sel.w - 1, sel.y, 1, sel.h, c);
  }
}

// ---------------------------------------------------------------- Texte (HTML über dem Canvas)
// Text als echte HTML-Elemente auf ganzen Pixeln: der Browser rendert ihn scharf.
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
// Sobald die Pixel-Schriften geladen sind, alle Größen neu messen.
document.fonts && document.fonts.ready.then(() => { for (const l of labels.values()) l.text = null; });

function updateOverlay(h, L, S, ox, oy, W) {
  frameNo++;
  const sz = S >= 3 ? "l" : S >= 2 ? "m" : "s";
  const X = (g) => Math.round((g + ox) * S), Y = (g) => Math.round((g + oy) * S);

  // Schilder
  const br = roomRect(L, -1);
  place(label("p:boss", `plaque gold sz-${sz}`, h.boss ? `Chef · ${basename(h.cwd)}` : "Chefetage"), X(br.x + 3), Y(br.y + 3));
  for (let lvl = 1; lvl <= L.floors; lvl++) {
    for (let col = 0; col < COLS; col++) {
      const idx = (lvl - 1) * COLS + col;
      const r = roomRect(L, idx);
      const key = h.order[idx];
      const name = key ? h.agents.get(key).state.name || "Agent" : "frei";
      place(label(`p:${idx}`, `plaque sz-${sz}`, name), X(r.x + 3), Y(r.y + 3));
    }
  }
  const sign = label("p:lobby", `plaque gold sz-${sz}`, "AGENT-HAUS");
  place(sign, Math.round(X(DOOR_X) - sign.w / 2), Y(L.lobby.top + 6));

  const placed = []; // schon gesetzte Sprechblasen, damit sich keine überdecken
  for (const a of h.agents.values()) {
    const c = a.char, st = a.state.status, key = a.state.key;
    if (c.hidden) continue;
    // Schlafende: Zzz
    if (c.sleeping) {
      for (let i = 0; i < 3; i++) {
        const ph = (T * 0.5 + i / 3) % 1;
        const z = label(`z:${key}:${i}`, `zzz sz-${sz}`, "z");
        place(z, X(c.headX + 5 + ph * 7), Y(c.headY - 6 - ph * 12), Math.round((1 - ph) * 10) / 10);
      }
    }
    // Sprechblase
    let text = null, kind = "";
    if (c.say) { text = c.say; kind = "say"; }
    else if (st === "working" && c.pose === "sit") text = a.state.activity;
    else if (st === "waiting") { text = "! " + (a.state.activity || "wartet auf dich"); kind = "waiting"; }
    if (!text) continue;
    const b = label(`b:${key}`, `bubble ${kind} sz-${sz}`, trunc(text, 34));
    const ax = X(c.headX);
    const left = clamp(Math.round(ax - b.w / 2), 2, W - b.w - 2);
    let top = Y(c.headY - 2) - b.h - 8;
    for (let n = 0; n < 6; n++) {
      const hit = placed.find((q) => left < q.l + q.w + 4 && left + b.w + 4 > q.l && top < q.t + q.h + 2 && top + b.h + 2 > q.t);
      if (!hit) break;
      top = hit.t - b.h - 6; // über die andere Blase stapeln
    }
    placed.push({ l: left, t: top, w: b.w, h: b.h });
    place(b, left, top);
    const tx = clamp(ax - left - 3, 4, b.w - 10);
    if (b.tx !== tx) { b.el.style.setProperty("--tx", `${tx}px`); b.tx = tx; }
  }

  for (const [k, l] of labels) if (l.seen !== frameNo) { l.el.remove(); labels.delete(k); }
}

// ---------------------------------------------------------------- Zustand + Ereignisse
const houses = new Map();
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
function ensureAgent(h, state) {
  let a = h.agents.get(state.key);
  const isNew = !a;
  if (isNew) {
    a = { state, log: [], room: -1 };
    if (state.key !== "main") { a.room = h.order.length; h.order.push(state.key); }
    h.agents.set(state.key, a);
    a.char = new Char(h, a);
  } else {
    a.state = state;
  }
  return { a, isNew };
}
function addLog(a, m) {
  a.log.push({ t: m.t, text: m.text });
  if (a.log.length > 200) a.log.shift();
}

/** Figur kommt unten durch die Tür und geht in ihren Raum. Mehrere treten nacheinander ein. */
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
  c.queue.push({ type: "say", text: "Bericht ist fertig!", t: 1.8 });
  c.queue.push({ type: "call", fn: () => h.boss && h.boss.char.sayFor(`Danke, ${a.state.name || "du"}!`, 1.6) });
  c.queue.push({ type: "wait", t: 1.9 });
  c.goto("home");
  c.queue.push({ type: "sit" });
}

function onEvent(m) {
  const h = getHouse(m.session, m.cwd);
  const { a, isNew } = ensureAgent(h, m.state);
  addLog(a, m);
  h.lastAt = m.t;
  if (isNew) {
    if (m.event === "SubagentStart") enterThroughDoor(h, a, `Auftrag: ${a.state.task || "?"}`);
    else if (m.state.key === "main" && m.event === "SessionStart") enterThroughDoor(h, a, "Neue Session!");
    else a.char.placeAtHome();
  }
  if (m.event === "SubagentStop") reportToBoss(h, a);
  if (m.event === "SessionEnd") h.ended = true;
  if (m.event === "SessionStart") h.ended = false;

  if (!currentId || (follow && currentId !== h.id && (m.event === "SessionStart" || m.event === "UserPromptSubmit"))) {
    select(h.id, "main");
  }
  renderTabs();
  if (h.id === currentId) renderPanel();
}

function onHello(m) {
  houses.clear();
  for (const s of m.sessions) {
    const h = getHouse(s.id, s.cwd);
    for (const st of s.agents) {
      const { a } = ensureAgent(h, st);
      a.char.placeAtHome();
      h.lastAt = Math.max(h.lastAt, st.lastAt || 0);
    }
    h.ended = s.agents.length > 0 && s.agents.every((st) => st.status === "gone");
  }
  for (const ev of m.history) {
    const a = houses.get(ev.session)?.agents.get(ev.agent);
    if (a) addLog(a, ev);
  }
  const newest = [...houses.values()].sort((x, y) => y.lastAt - x.lastAt)[0];
  if (!currentId || !houses.has(currentId)) currentId = newest ? newest.id : null;
  renderTabs();
  renderPanel();
}

// ---------------------------------------------------------------- DOM: Tabs + Panel
const tabsEl = document.getElementById("tabs");
const panelEl = document.getElementById("panel");

function select(id, key) {
  currentId = id;
  selected = key || "main";
  renderTabs();
  renderPanel();
}

function renderTabs() {
  const list = [...houses.values()].sort((x, y) => y.lastAt - x.lastAt).slice(0, 6);
  if (!list.length) {
    tabsEl.replaceChildren(el("span", { className: "hint" }, "Noch keine Session: starte claude im Ordner ~/agent-haus"));
    return;
  }
  tabsEl.replaceChildren(...list.map((h, i) => {
    const b = document.createElement("button");
    if (h.id === currentId) b.className = "on";
    const dot = document.createElement("span");
    dot.className = "dot " + (h.ended ? "gone" : h.boss ? h.boss.state.status : "");
    b.append(dot, `${basename(h.cwd)} · ${h.id.slice(0, 4)}`);
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
const fmtTime = (t) => new Date(t).toLocaleTimeString("de-AT", { hour12: false });

function renderPanel() {
  const h = houses.get(currentId);
  const a = h && h.agents.get(selected);
  if (!a) {
    panelEl.replaceChildren(el("p", { className: "hint" },
      h ? "Klick auf einen Raum, um zu sehen, was der Agent macht." : "Noch keine Session. Starte claude im Ordner ~/agent-haus."));
    return;
  }
  const st = a.state;
  const av = el("canvas", { id: "avatar", width: 16, height: 16 });
  const prev = G; G = av.getContext("2d");
  drawSprite(2, 3, { hue: a.char.hue, acc: a.char.acc, eyes: "open", feet: "stand" });
  G = prev;

  const dl = el("dl", {},
    el("dt", {}, "Typ"), el("dd", {}, st.key === "main" ? "Haupt-Agent" : st.type),
    st.key !== "main" ? el("dt", {}, "Aufgabe") : null, st.key !== "main" ? el("dd", {}, st.task || "–") : null,
    el("dt", {}, "Gerade"), el("dd", {}, st.activity || "–"),
    el("dt", {}, "Tools"), el("dd", {}, String(st.tools || 0)),
  );
  const log = el("ul", { id: "p-log" }, ...a.log.slice(-80).map((l) =>
    el("li", {}, el("time", {}, fmtTime(l.t)), l.text)));
  panelEl.replaceChildren(...[
    el("button", { className: "close", title: "Schließen (Esc)", onclick: closePanel }, "×"),
    el("div", { className: "p-head" }, av,
      el("div", {},
        el("h2", { id: "p-name" }, st.name || "Agent"),
        el("div", { id: "p-meta" }, el("span", { className: "dot " + st.status }), STATUS_LABEL[st.status] || st.status))),
    dl,
    st.result ? el("h3", {}, "Letzte Antwort") : null,
    st.result ? el("p", { id: "p-result" }, st.result) : null,
    el("h3", {}, "Verlauf"),
    log,
  ].filter(Boolean));
  panelEl.scrollTop = panelEl.scrollHeight;
}

// ---------------------------------------------------------------- Rendern
const view = document.getElementById("view");
const vctx = view.getContext("2d");
const low = makeCanvas(LW, 100);
const lctx = low.getContext("2d");
const placeholder = new House("none", "");
const TOP = 52; // Platz für die Kopfzeile (CSS-Pixel)
let hits = [];
let cam = { S: 1, ox: 0, oy: 0 };
let camS = 0, camX = 0; // geglättete Kamera (Zoom + Mitte in CSS-Pixeln)
let skyCache = null, skyKey = "";

function render(dt = 0) {
  const h = houses.get(currentId) || placeholder;
  const L = h.layout();
  const vw = window.innerWidth, vh = window.innerHeight;

  // Haus so groß wie möglich einpassen: oben die Kopfzeile, rechts ggf. das offene Panel frei lassen
  const side = panelOpen && vw > 900 ? 372 : 0;
  const tS = Math.max(0.5, Math.min((vw - side - 24) / LW, (vh - TOP - 12) / L.H));
  const tX = (vw - side) / 2;
  const k = camS === 0 ? 1 : 1 - Math.exp(-dt * 9);
  camS += (tS - camS) * k; camX += (tX - camX) * k;
  if (Math.abs(tS - camS) < 0.002) camS = tS;
  if (Math.abs(tX - camX) < 0.5) camX = tX;
  const S = camS;
  const WW = Math.ceil(vw / S), WH = Math.ceil(vh / S);
  const ox = Math.floor(camX / S - LW / 2);
  const oy = Math.floor(TOP / S + ((vh - TOP) / S - L.H) / 2);
  cam = { S, ox, oy };

  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(vw * dpr), ch = Math.round(vh * dpr);
  if (view.width !== cw || view.height !== ch) {
    view.width = cw; view.height = ch;
    view.style.width = `${vw}px`; view.style.height = `${vh}px`;
  }
  if (low.width !== WW || low.height !== WH) { low.width = WW; low.height = WH; }

  // Himmel (gecacht, solange sich Größe und Lage nicht ändern)
  const groundY = oy + L.groundY;
  const moonX = Math.min(WW - 24 - Math.ceil(side / S), ox + LW + 46), moonY = Math.max(oy + 18, Math.round(TOP / S) + 14);
  const sk = `${WW}x${WH}:${groundY}:${moonX}:${moonY}`;
  if (skyKey !== sk) {
    skyCache = makeCanvas(WW, WH);
    G = skyCache.getContext("2d");
    drawSky(WW, WH, groundY, moonX, moonY);
    skyKey = sk;
  }
  // Haus (gecacht pro Stockwerkszahl)
  const key = `${L.floors}:${h.order.length}`;
  if (!h.bg || h.bgKey !== key) {
    h.bg = makeCanvas(LW, L.H);
    G = h.bg.getContext("2d");
    drawStatic(h, L);
    h.bgKey = key;
  }

  G = lctx;
  G.drawImage(skyCache, 0, 0);
  // funkelnde Sterne
  const rnd = rng32(99);
  for (let i = 0; i < WW / 25; i++) {
    const x = rnd() * WW, y = rnd() * (groundY * 0.55), ph = rnd() * 6;
    if (Math.sin(T * 2 + ph) > 0.6) P(x, y, "#ffffff");
  }
  G.save();
  G.translate(ox, oy);
  G.drawImage(h.bg, 0, 0);
  hits = [];
  drawDynamic(h, L, hits);
  G.restore();

  vctx.imageSmoothingEnabled = false;
  vctx.drawImage(low, 0, 0, WW, WH, 0, 0, Math.round(WW * S * dpr), Math.round(WH * S * dpr));
  updateOverlay(h, L, S, ox, oy, vw);
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
  const x = ev.clientX / cam.S - cam.ox, y = ev.clientY / cam.S - cam.oy;
  return hits.find((hh) => x >= hh.x && x < hh.x + hh.w && y >= hh.y && y < hh.y + hh.h);
}
view.addEventListener("click", (ev) => {
  const hit = hitAt(ev);
  if (hit) { selected = hit.key; openPanel(); }
});
view.addEventListener("mousemove", (ev) => { view.style.cursor = hitAt(ev) ? "pointer" : "default"; });
window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closePanel(); });

// ---------------------------------------------------------------- Verbindung
const conn = document.getElementById("conn");
const es = new EventSource("/stream");
es.onopen = () => { conn.textContent = "live"; conn.className = "on"; };
es.onerror = () => { conn.textContent = "Verbindung weg, versuche neu …"; conn.className = ""; };
es.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.kind === "hello") onHello(m);
  else if (m.kind === "event") onEvent(m);
};
