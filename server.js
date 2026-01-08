const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

// ================= MAPS
const MAPS = {
  zeroG: { name: "Zero-G Arena", gravity: 0, background: "space" },
  moon:  { name: "Moon Base", gravity: 0.02, background: "moon" },
  heavy: { name: "Heavy Factory", gravity: 0.05, background: "factory" }
};

// ================= PHYSICS
const RECOIL_FORCE = 3.2;
const BULLET_SPEED = 9;
const WALL_RESTITUTION = 0.85;
const ANGULAR_TRANSFER = 0.015;
const ROTATION_DAMPING = 0.992;
const LINEAR_DAMPING = 0.998;

// ================= HEAT (LOCKED)
const HEAT_PER_SHOT = 1;
const MAX_HEAT = 6;
const COOL_RATE = 0.04;
const OVERHEAT_COOLDOWN = 10000;

// ================= WORLD
const WIDTH = 420;
const HEIGHT = 800;

// ================= GUN
class Gun {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.av = 0;
    this.radius = 20;
    this.heat = 0;
    this.overheated = false;
    this.overheatUntil = 0;
  }

  canShoot() {
    if (!this.overheated) return true;
    if (Date.now() >= this.overheatUntil) {
      this.overheated = false;
      this.heat = MAX_HEAT * 0.4;
      return true;
    }
    return false;
  }

  shoot(bullets, owner) {
    if (!this.canShoot()) return;
    const a = this.angle;

    bullets.push({
      x: this.x + Math.cos(a) * 32,
      y: this.y + Math.sin(a) * 32,
      vx: Math.cos(a) * BULLET_SPEED,
      vy: Math.sin(a) * BULLET_SPEED,
      owner
    });

    this.vx -= Math.cos(a) * RECOIL_FORCE;
    this.vy -= Math.sin(a) * RECOIL_FORCE;
    this.av -= (Math.random() - 0.5) * 0.06;

    this.heat += HEAT_PER_SHOT;
    if (this.heat >= MAX_HEAT) {
      this.overheated = true;
      this.overheatUntil = Date.now() + OVERHEAT_COOLDOWN;
    }
  }

  applyWall(nx, ny) {
    const d = this.vx * nx + this.vy * ny;
    if (d < 0) {
      this.vx -= 2 * d * nx;
      this.vy -= 2 * d * ny;
      this.vx *= WALL_RESTITUTION;
      this.vy *= WALL_RESTITUTION;
      this.av += d * ANGULAR_TRANSFER;
    }
  }

  update(g) {
    this.vy += g;
    this.x += this.vx;
    this.y += this.vy;
    this.angle += this.av;

    this.vx *= LINEAR_DAMPING;
    this.vy *= LINEAR_DAMPING;
    this.av *= ROTATION_DAMPING;

    if (!this.overheated && this.heat > 0) {
      this.heat = Math.max(0, this.heat - COOL_RATE);
    }

    if (this.x - this.radius < 0) { this.x = this.radius; this.applyWall(1,0); }
    if (this.x + this.radius > WIDTH) { this.x = WIDTH - this.radius; this.applyWall(-1,0); }
    if (this.y - this.radius < 0) { this.y = this.radius; this.applyWall(0,1); }
    if (this.y + this.radius > HEIGHT) { this.y = HEIGHT - this.radius; this.applyWall(0,-1); }
  }
}

// ================= ROOMS
const rooms = {};

function createRoom(mapKey) {
  return {
    map: MAPS[mapKey],
    players: {
      blue: new Gun(90, HEIGHT - 160),
      white: new Gun(WIDTH - 90, HEIGHT - 160)
    },
    bullets: [],
    clients: {},
    started: false,
    startAt: 0
  };
}

function hit(b, g) {
  return Math.abs(b.x - g.x) < 20 && Math.abs(b.y - g.y) < 20;
}

// ================= WS
wss.on("connection", ws => {
  ws.on("message", msg => {
    const d = JSON.parse(msg);

    if (d.type === "create") {
      rooms[d.room] = createRoom(d.map);
      ws.room = d.room;
      ws.player = "blue";
      rooms[d.room].clients.blue = ws;
      ws.send(JSON.stringify({ type: "joined", player: "blue" }));
    }

    if (d.type === "join") {
      const r = rooms[d.room];
      if (!r || r.clients.white) return;
      ws.room = d.room;
      ws.player = "white";
      r.clients.white = ws;

      // start countdown
      r.started = false;
      r.startAt = Date.now() + 3000;

      ws.send(JSON.stringify({ type: "joined", player: "white" }));
    }

    if (d.type === "shoot") {
      const r = rooms[ws.room];
      if (!r || !r.started) return;
      r.players[ws.player].shoot(r.bullets, ws.player);
    }
  });
});

// ================= LOOP
setInterval(() => {
  Object.values(rooms).forEach(r => {
    if (!r.started && r.startAt && Date.now() >= r.startAt) {
      r.started = true;
    }

    if (r.started) {
      r.players.blue.update(r.map.gravity);
      r.players.white.update(r.map.gravity);

      r.bullets.forEach((b, i) => {
        b.x += b.vx;
        b.y += b.vy;

        if (b.owner !== "blue" && hit(b, r.players.blue)) r.started = false;
        if (b.owner !== "white" && hit(b, r.players.white)) r.started = false;

        if (b.x < 0 || b.x > WIDTH || b.y < 0 || b.y > HEIGHT)
          r.bullets.splice(i, 1);
      });
    }

    const state = {
      players: r.players,
      bullets: r.bullets,
      map: r.map,
      started: r.started,
      startAt: r.startAt
    };

    Object.values(r.clients).forEach(ws =>
      ws.send(JSON.stringify({ type: "state", state }))
    );
  });
}, 1000 / 60);

server.listen(PORT, () => console.log("Server running"));
