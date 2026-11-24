const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const MAX_PEERS = 10;

app.get("/config.js", (_req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-store").send(
    "window.NOVALINK_CONFIG = " + JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ""
    }) + ";"
  );
});
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, app: "NovaLink" }));

const rooms = new Map();
function roomMembers(roomId) {
  return [...(rooms.get(roomId) || [])];
}

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, name, role } = {}, reply = () => {}) => {
    roomId = String(roomId || "").trim().slice(0, 64);
    name = String(name || "Guest").trim().slice(0, 24) || "Guest";
    role = role === "host" ? "host" : "guest";
    if (!roomId) return reply({ ok: false, error: "ルームIDを入力してください。" });
    const members = roomMembers(roomId);
    if (role === "host" && members.length > 0) return reply({ ok: false, error: "このルームIDは既に使用されています。" });
    if (members.length >= MAX_PEERS) return reply({ ok: false, error: "このルームは満員です（最大10人）。" });
    if (socket.data.roomId) leaveRoom(socket);
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;
    socket.data.role = role;
    const peers = roomMembers(roomId).filter((id) => id !== socket.id).map((id) => ({
      id,
      name: io.sockets.sockets.get(id)?.data.name || "Guest",
      role: io.sockets.sockets.get(id)?.data.role || "guest"
    }));
    reply({ ok: true, roomId, peers, selfId: socket.id });
    socket.to(roomId).emit("peer:joined", { id: socket.id, name, role });
    io.to(roomId).emit("room:count", roomMembers(roomId).length);
  });

  socket.on("signal", ({ to, data } = {}) => {
    if (!to || !socket.data.roomId) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("chat:send", ({ text } = {}) => {
    const message = String(text || "").trim().slice(0, 1000);
    if (!message || !socket.data.roomId) return;
    io.to(socket.data.roomId).emit("chat:message", {
      id: socket.id, name: socket.data.name || "Guest", text: message, at: Date.now()
    });
  });

  socket.on("disconnect", () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const members = rooms.get(roomId);
  if (members) {
    members.delete(socket.id);
    if (members.size === 0) rooms.delete(roomId);
    else {
      socket.to(roomId).emit("peer:left", { id: socket.id });
      io.to(roomId).emit("room:count", members.size);
    }
  }
  socket.leave(roomId);
  socket.data.roomId = null;
}

server.listen(PORT, () => console.log(`NovaLink running on port ${PORT}`));
