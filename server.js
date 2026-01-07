const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// serve client files
app.use(express.static("public"));

const rooms = {};

function createGameState() {
  return {
    players: {
      blue: { x: 90, y: 500, vx: 0, vy: 0, angle: 0 },
      white:{ x: 330, y: 500, vx: 0, vy: 0, angle: 0 }
    },
    bullets: []
  };
}

wss.on("connection", ws => {
  ws.on("message", msg => {
    const data = JSON.parse(msg);

    if (data.type === "join") {
      const room = data.room;
      if (!rooms[room]) {
        rooms[room] = { clients: [], state: createGameState() };
      }

      if (rooms[room].clients.length >= 2) return;

      ws.room = room;
      ws.player = rooms[room].clients.length === 0 ? "blue" : "white";
      rooms[room].clients.push(ws);

      ws.send(JSON.stringify({ type: "joined", player: ws.player }));
    }

    if (data.type === "shoot") {
      const state = rooms[ws.room].state;
      const p = state.players[ws.player];

      state.bullets.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(p.angle) * 9,
        vy: Math.sin(p.angle) * 9,
        owner: ws.player
      });

      p.vx -= Math.cos(p.angle) * 4;
      p.vy -= Math.sin(p.angle) * 4;
    }
  });
});

// physics loop
setInterval(() => {
  Object.values(rooms).forEach(room => {
    const s = room.state;

    Object.values(s.players).forEach(p => {
      p.vy += 0.2; // gravity (your chosen value)
      p.x += p.vx;
      p.y += p.vy;

      if (p.y > 600) {
        p.y = 600;
        p.vy *= -0.6;
      }
    });

    s.bullets.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
    });

    room.clients.forEach(c => {
      c.send(JSON.stringify({ type: "state", state: s }));
    });
  });
}, 33);

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
