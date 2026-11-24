const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { promisify } = require("util");
const { Server } = require("socket.io");

const scrypt = promisify(crypto.scrypt);
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
app.use(express.static(require("path").join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, app: "NovaLink" }));

// Room passwords are salted and hashed on the server; plaintext passwords are never stored.
const rooms = new Map();
function roomMembers(roomId) {
  return [...(rooms.get(roomId)?.members || [])];
}
function publicRoomList() {
  return [...rooms.entries()].map(([id, room]) => ({
    id, name: room.name, count: room.members.size, max: MAX_PEERS,
    createdAt: room.createdAt
  })).sort((a, b) => a.createdAt - b.createdAt);
}
function broadcastRoomList() {
  io.emit("room:list:update", publicRoomList());
}
async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString("hex") };
}
async function verifyPassword(password, room) {
  const candidate = await scrypt(password, room.passwordSalt, 64);
  const stored = Buffer.from(room.passwordHash, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}
function enterRoom(socket, roomId, name, role, reply) {
  const room = rooms.get(roomId);
  if (!room) return reply({ ok: false, error: "この部屋はすでに終了しています。" });
  if (room.members.size >= MAX_PEERS) return reply({ ok: false, error: "この部屋は満員です（最大10人）。" });
  if (socket.data.roomId) leaveRoom(socket);
  room.members.add(socket.id);
  socket.join(roomId);
  socket.data.roomId = roomId;
  socket.data.name = name;
  socket.data.role = role;
  const peers = roomMembers(roomId).filter(id => id !== socket.id).map(id => ({
    id, name: io.sockets.sockets.get(id)?.data.name || "Guest",
    role: io.sockets.sockets.get(id)?.data.role || "guest"
  }));
  reply({ ok: true, roomId, roomName: room.name, peers, selfId: socket.id });
  socket.to(roomId).emit("peer:joined", { id: socket.id, name, role });
  io.to(roomId).emit("room:count", room.members.size);
  broadcastRoomList();
}
function closeRoom(roomId, reason = "ホストが退出したため、部屋が終了しました。") {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const id of [...room.members]) {
    const member = io.sockets.sockets.get(id);
    if (!member) continue;
    member.emit("room:closed", { message: reason });
    member.leave(roomId);
    member.data.roomId = null;
    member.data.role = null;
  }
  rooms.delete(roomId);
  broadcastRoomList();
}
function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) { socket.data.roomId = null; return; }
  if (socket.data.role === "host") {
    closeRoom(roomId);
    return;
  }
  room.members.delete(socket.id);
  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.role = null;
  if (room.members.size === 0) rooms.delete(roomId);
  else {
    socket.to(roomId).emit("peer:left", { id: socket.id });
    io.to(roomId).emit("room:count", room.members.size);
  }
  broadcastRoomList();
}

io.on("connection", socket => {
  socket.on("room:list", (_data, reply = () => {}) => reply({ ok: true, rooms: publicRoomList() }));

  socket.on("room:create", async ({ roomName, password, name } = {}, reply = () => {}) => {
    roomName = String(roomName || "").trim().slice(0, 40);
    password = String(password || "");
    name = String(name || "Host").trim().slice(0, 24) || "Host";
    if (!roomName) return reply({ ok: false, error: "部屋名を入力してください。" });
    if (password.length < 4 || password.length > 64) return reply({ ok: false, error: "パスワードは4〜64文字で設定してください。" });
    if (socket.data.roomId) leaveRoom(socket);
    let roomId;
    do { roomId = crypto.randomBytes(5).toString("hex").toUpperCase(); } while (rooms.has(roomId));
    try {
      const credentials = await hashPassword(password);
      rooms.set(roomId, {
        name: roomName, members: new Set(), createdAt: Date.now(),
        passwordSalt: credentials.salt, passwordHash: credentials.hash
      });
      enterRoom(socket, roomId, name, "host", reply);
    } catch (error) {
      console.error("Room creation failed", error);
      reply({ ok: false, error: "部屋を作成できませんでした。もう一度お試しください。" });
    }
  });

  socket.on("room:join", async ({ roomId, password, name } = {}, reply = () => {}) => {
    roomId = String(roomId || "").trim().slice(0, 64);
    password = String(password || "");
    name = String(name || "Guest").trim().slice(0, 24) || "Guest";
    const room = rooms.get(roomId);
    if (!room) return reply({ ok: false, error: "この部屋は終了したか、見つかりません。" });
    if (room.members.size >= MAX_PEERS) return reply({ ok: false, error: "この部屋は満員です（最大10人）。" });
    try {
      if (!await verifyPassword(password, room)) return reply({ ok: false, error: "パスワードが違います。" });
      enterRoom(socket, roomId, name, "guest", reply);
    } catch (error) {
      console.error("Room password verification failed", error);
      reply({ ok: false, error: "パスワードを確認できませんでした。" });
    }
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

server.listen(PORT, () => console.log(`NovaLink running on port ${PORT}`));
