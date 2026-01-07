const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

// ================= FINAL PHYSICS (UNCHANGED)
const GRAVITY = 0.02;
const RECOIL_FORCE = 4;
const BULLET_SPEED = 9;
const WALL_RESTITUTION = 0.85;
const ANGULAR_TRANSFER = 0.015;
const ROTATION_DAMPING = 0.992;
const LINEAR_DAMPING = 0.998;

// 🔫 Bullet reload only
const BULLET_RELOAD_TIME = 1000; // 1 second

const WIDTH = 420;
const HEIGHT = 640;

// ================= GAME CLASSES
class Gun {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.av = 0;
    this.radius = 20;

    this.lastBulletTime = 0; // ⏱️ bullet-only cooldown
  }

  applyRecoil() {
    const a = this.angle;
    this.vx -= Math.cos(a) * RECOIL_FORCE;
    this.vy -= Math.sin(a) * RECOIL_FORCE;
    this.av -= (Math.random() - 0.5) * 0.06;
  }

  canFireBullet() {
    return Date.now() - this.lastBulletTime >= BULLET_RELOAD_TIME;
  }

  fireBullet(bullets) {
    this.lastBulletTime = Date.now();
    const a = this.angle;

    bullets.push({
      x: this.x + Math.cos(a) * 32,
      y: this.y + Math.sin(a) * 32,
      vx: Math.cos(a) * BULLET_SPEED,
      vy: Math.sin(a) * BULLET_SPEED,
      owner: this
    });
  }

  applyWallCollision(nx, ny) {
    const dot = this.vx * nx + this.vy * ny;
    if (dot < 0) {
      this.vx -= 2 * dot * nx;
      this.vy -= 2 * dot * ny;
      this.vx *= WALL_RESTITUTION;
      this.vy *= WALL_RESTITUTION;
      this.av += dot * ANGULAR_TRANSFER;
    }
  }

  update() {
    this.vy += GRAVITY;

    this.x += this.vx;
    this.y += this.vy;
    this.angle += this.av;

    this.vx *= LINEAR_DAMPING;
    this.vy *= LINEAR_DAMPING;
    this.av *= ROTATION_DAMPING;

    if (this.x - this.radius < 0) {
      this.x = this.radius;
      this.applyWallCollision(1, 0);
    }
    if (this.x + this.radius > WIDTH) {
      this.x = WIDTH - this.radius;
      this.applyWallCollision(-1, 0);
    }
    if (this.y - this.radius < 0) {
      this.y = this.radius;
      this.applyWallCollision(0, 1);
    }
    if (this.y + this.radius > HEIGHT) {
      this.y = HEIGHT - this.radius;
      this.applyWallCollision(0, -1);
    }
  }
}

// ================= ROOMS
const rooms = {};

function createRoom() {
  return {
    players: {
      blue: new Gun(90, HEIGHT - 120),
      white: new Gun(WIDTH - 90, HEIGHT - 120)
    },
    bullets: [],
    clients: {},
    gameOver: false,
    winner: null,
    rematchReady: { blue: false, white: false }
  };
}

function resetRoom(room) {
  room.players.blue = new Gun(90, HEIGHT - 120);
  room.players.white = new Gun(WIDTH - 90, HEIGHT - 120);
  room.bullets = [];
  room.gameOver = false;
  room.winner = null;
  room.rematchReady.blue = false;
  room.rematchReady.white = false;
}

// ================= HIT CHECK
function hit(b, g) {
  return (
    Math.abs(b.x - g.x) < 20 &&
    Math.abs(b.y - g.y) < 20
  );
}

// ================= WEBSOCKETS
wss.on("connection", ws => {
  ws.on("message", msg => {
    const data = JSON.parse(msg);

    if (data.type === "join") {
      if (!rooms[data.room]) rooms[data.room] = createRoom();
      const room = rooms[data.room];

      if (Object.keys(room.clients).length >= 2) return;

      ws.room = data.room;
      ws.player = room.clients.blue ? "white" : "blue";
      room.clients[ws.player] = ws;

      ws.send(JSON.stringify({
        type: "joined",
        player: ws.player
      }));
    }

    if (data.type === "shoot") {
      const room = rooms[ws.room];
      if (!room || room.gameOver) return;

      const gun = room.players[ws.player];

      // ✅ ALWAYS apply recoil
      gun.applyRecoil();

      // 🔫 bullet only if reloaded
      if (gun.canFireBullet()) {
        gun.fireBullet(room.bullets);
      }
    }

    if (data.type === "rematch") {
      const room = rooms[ws.room];
      if (!room || !room.gameOver) return;

      room.rematchReady[ws.player] = true;

      if (room.rematchReady.blue && room.rematchReady.white) {
        resetRoom(room);
      }
    }
  });
});

// ================= MAIN LOOP
setInterval(() => {
  Object.values(rooms).forEach(room => {
    if (!room.gameOver) {
      room.players.blue.update();
      room.players.white.update();

      room.bullets.forEach((b, i) => {
        b.x += b.vx;
        b.y += b.vy;

        if (b.owner !== room.players.blue && hit(b, room.players.blue)) {
          room.gameOver = true;
          room.winner = "white";
        }

        if (b.owner !== room.players.white && hit(b, room.players.white)) {
          room.gameOver = true;
          room.winner = "blue";
        }

        if (
          b.x < 0 || b.x > WIDTH ||
          b.y < 0 || b.y > HEIGHT
        ) {
          room.bullets.splice(i, 1);
        }
      });
    }

    const state = {
      players: room.players,
      bullets: room.bullets,
      gameOver: room.gameOver,
      winner: room.winner,
      rematchReady: room.rematchReady
    };

    Object.values(room.clients).forEach(ws => {
      ws.send(JSON.stringify({ type: "state", state }));
    });
  });
}, 1000 / 60);

// ================= START
server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
