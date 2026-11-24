const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { promisify } = require("util");
const { Server } = require("socket.io");
const webpush = require("web-push");

const scrypt = promisify(crypto.scrypt);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const MAX_PEERS = 10;
const LIFE_BOARD_LENGTH = 48;
const LIFE_START_CASH = 1000000;
const LIFE_TILE_TYPES = ["salary","event","bonus","expense","choice","career","event","bonus","salary","investment","event","expense"];
function makeLifeBoard() {
  const names = {
    salary: ["給料日","ボーナス査定","臨時収入"],
    event: ["思いがけない出来事","人生の転機","休日のイベント"],
    bonus: ["ラッキー！","臨時ボーナス","幸運到来"],
    expense: ["突然の出費","税金","修理費"],
    choice: ["人生の選択","大きな決断","チャンス到来"],
    career: ["キャリアアップ","転職の機会","スキル取得"],
    investment: ["投資チャンス","資産運用"]
  };
  return Array.from({ length: LIFE_BOARD_LENGTH }, (_, index) => {
    if (index === 0) return { id: index, type: "start", title: "人生のスタート", description: "ここからあなたの人生が始まる。" };
    if (index === LIFE_BOARD_LENGTH - 1) return { id: index, type: "finish", title: "人生のゴール", description: "人生の最終地点。総資産を集計します。" };
    const type = LIFE_TILE_TYPES[(index - 1) % LIFE_TILE_TYPES.length];
    const options = names[type];
    return { id: index, type, title: options[(index - 1) % options.length], description: "" };
  });
}
function lifeSnapshot(game) {
  if (!game) return null;
  return JSON.parse(JSON.stringify(game));
}
function broadcastLifeState(room) {
  if (room?.lifeGame) io.to(room.id).emit("life:state", lifeSnapshot(room.lifeGame));
}
function applyLifeChoice(game, player, choice) {
  if (choice.investment) {
    if (player.cash < 500000) lifeLog(game, player.name + " は資金不足で投資を見送りました。");
    else {
      player.cash -= 500000;
      const success = crypto.randomInt(0, 100) < 65;
      const change = success ? 850000 : 150000;
      player.cash += change;
      lifeLog(game, player.name + " の投資は" + (success ? "成功！" : "失敗……") + "（受取 " + change.toLocaleString("ja-JP") + "円）");
    }
  } else {
    if (Number.isFinite(choice.cashDelta)) player.cash = Math.max(0, player.cash + choice.cashDelta);
    if (Number.isFinite(choice.salary)) player.salary += choice.salary;
    if (choice.career) player.career = choice.career;
    lifeLog(game, player.name + " は「" + choice.label + "」を選択しました。");
  }
}
function chooseCpuLifeOption(game, player, event) {
  if (event.choices.some(choice => choice.investment) && player.cash >= 900000) return event.choices.find(choice => choice.investment);
  const affordable = event.choices.filter(choice => !Number.isFinite(choice.cashDelta) || player.cash + choice.cashDelta >= 0);
  const options = affordable.length ? affordable : event.choices;
  return [...options].sort((a,b) => {
    const score = choice => (choice.salary || 0) * 3 + (choice.career ? 100000 : 0) +
      (choice.investment ? (player.cash >= 900000 ? 150000 : -100000) : 0) +
      (Number.isFinite(choice.cashDelta) ? choice.cashDelta : 0);
    return score(b) - score(a);
  })[0];
}
function scheduleCpuLifeTurn(room, delay = 1100) {
  if (room.lifeCpuTimer) clearTimeout(room.lifeCpuTimer);
  room.lifeCpuTimer = null;
  const game = room.lifeGame;
  if (!game || game.status !== "playing") return;
  const player = game.players[game.turnIndex];
  if (!player?.isCpu || player.finished) return;
  room.lifeCpuTimer = setTimeout(() => {
    room.lifeCpuTimer = null;
    const current = room.lifeGame;
    if (!current || current.status !== "playing") return;
    const cpu = current.players[current.turnIndex];
    if (!cpu?.isCpu || cpu.id !== player.id) return;
    if (current.currentEvent) {
      const choice = chooseCpuLifeOption(current, cpu, current.currentEvent);
      if (choice) {
        applyLifeChoice(current, cpu, choice);
        current.currentEvent = null;
        nextLifeTurn(current);
      }
    } else {
      const roll = crypto.randomInt(1, 7);
      const from = cpu.position;
      cpu.position = Math.min(current.board.length - 1, cpu.position + roll);
      current.lastRoll = { playerId: cpu.id, playerName: cpu.name, value: roll, from, to: cpu.position, at: Date.now() };
      const tile = current.board[cpu.position];
      lifeLog(current, cpu.name + " が " + roll + " を出して「" + tile.title + "」に到着。");
      resolveLifeTile(current, cpu, tile);
      if (!current.currentEvent && current.status === "playing") nextLifeTurn(current);
    }
    broadcastLifeState(room);
    scheduleCpuLifeTurn(room, 900);
  }, delay);
}
function lifeLog(game, message) {
  game.log.unshift({ id: crypto.randomUUID(), message, at: Date.now() });
  game.log = game.log.slice(0, 40);
}
function nextLifeTurn(game) {
  if (!game.players.length) return;
  const total = game.players.length;
  for (let step = 1; step <= total; step++) {
    const index = (game.turnIndex + step) % total;
    if (!game.players[index].finished) {
      game.turnIndex = index;
      game.turnNumber += 1;
      return;
    }
  }
  game.status = "finished";
  game.currentEvent = null;
}
function finishLifePlayer(game, player) {
  player.finished = true;
  player.finishOrder = game.players.filter(p => p.finished).length;
  lifeLog(game, player.name + " がゴールしました！");
  if (game.players.every(p => p.finished)) {
    game.status = "finished";
    game.currentEvent = null;
    game.winnerId = [...game.players].sort((a,b) => b.cash - a.cash)[0]?.id || null;
    lifeLog(game, "全員ゴール！最終資産ランキングが確定しました。");
  }
}
function resolveLifeTile(game, player, tile) {
  game.currentEvent = null;
  if (tile.type === "salary") {
    const amount = Math.max(50000, player.salary || 100000);
    player.cash += amount;
    lifeLog(game, player.name + " は給料日で " + amount.toLocaleString("ja-JP") + "円を受け取りました。");
  } else if (tile.type === "bonus") {
    const amount = 50000 + crypto.randomInt(0, 6) * 25000;
    player.cash += amount;
    lifeLog(game, player.name + " は臨時収入 " + amount.toLocaleString("ja-JP") + "円を獲得！");
  } else if (tile.type === "expense") {
    const amount = Math.min(player.cash, 30000 + crypto.randomInt(0, 5) * 15000);
    player.cash -= amount;
    lifeLog(game, player.name + " に " + amount.toLocaleString("ja-JP") + "円の出費が発生。");
  } else if (tile.type === "career") {
    game.currentEvent = {
      playerId: player.id, title: "キャリアアップ", description: "今後の給料が変わる選択です。",
      choices: [
        { id: "stable", label: "安定した仕事", detail: "給料 +50,000円", salary: 50000, career: "会社員" },
        { id: "challenge", label: "挑戦する仕事", detail: "給料 +100,000円", salary: 100000, career: "専門職" }
      ]
    };
  } else if (tile.type === "investment") {
    game.currentEvent = {
      playerId: player.id, title: "投資チャンス", description: "資金を投じるか、安全策を取るか。",
      choices: [
        { id: "invest", label: "50万円を投資", detail: "成功すれば大きな利益。失敗の可能性も。", investment: true },
        { id: "save", label: "今回は見送る", detail: "お金は減りません。", cashDelta: 0 }
      ]
    };
  } else if (tile.type === "choice") {
    game.currentEvent = {
      playerId: player.id, title: "人生の選択", description: "あなたならどうする？",
      choices: [
        { id: "study", label: "学びに投資する", detail: "20万円を支払い、給料が上がる", cashDelta: -200000, salary: 50000 },
        { id: "travel", label: "旅行に出かける", detail: "10万円を使って気分転換", cashDelta: -100000 },
        { id: "work", label: "今は貯金する", detail: "お金を使わない", cashDelta: 0 }
      ]
    };
  } else if (tile.type === "event") {
    const events = [
      { message: "友人からお祝いをもらった！", delta: 80000 },
      { message: "家電が故障してしまった……", delta: -60000 },
      { message: "副業がうまくいった！", delta: 120000 },
      { message: "思いがけないプレゼント！", delta: 40000 },
      { message: "急な出費が発生した。", delta: -90000 }
    ];
    const event = events[crypto.randomInt(0, events.length)];
    const delta = event.delta < 0 ? -Math.min(player.cash, Math.abs(event.delta)) : event.delta;
    player.cash += delta;
    lifeLog(game, player.name + "：" + event.message + "（" + (delta >= 0 ? "+" : "") + delta.toLocaleString("ja-JP") + "円）");
  }
  if (tile.type === "finish") finishLifePlayer(game, player);
  if (game.currentEvent) game.currentEvent.playerId = player.id;
}
function removeLifePlayer(room, playerId) {
  const game = room?.lifeGame;
  if (!game || game.status === "finished") return;
  const index = game.players.findIndex(player => player.id === playerId);
  if (index < 0) return;
  const [removed] = game.players.splice(index, 1);
  lifeLog(game, removed.name + " がゲームから退出しました。");
  if (game.currentEvent?.playerId === playerId) game.currentEvent = null;
  const removedCurrentPlayer = index === game.turnIndex;
  if (index < game.turnIndex) game.turnIndex -= 1;
  else if (removedCurrentPlayer) game.turnIndex -= 1;
  if (!game.players.length) { room.lifeGame = null; return; }
  if (game.status === "playing" && removedCurrentPlayer) nextLifeTurn(game);
  broadcastLifeState(room);
  scheduleCpuLifeTurn(room);
}

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
app.get("/api/push/public-key", (_req, res) => {
  if (!vapidPublicKey || !vapidPrivateKey) return res.status(503).json({ ok: false, error: "Push notifications are not configured." });
  res.json({ ok: true, publicKey: vapidPublicKey });
});

// Room passwords are salted and hashed on the server; plaintext passwords are never stored.
const rooms = new Map();
const pushSubscriptions = new Map();
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://novalink-tnfy.onrender.com/", vapidPublicKey, vapidPrivateKey);
}
async function sendPushNotification(record, payload) {
  if (!vapidPublicKey || !vapidPrivateKey) return;
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload));
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) pushSubscriptions.delete(record.subscription.endpoint);
    else console.warn("Web Push delivery failed:", error.statusCode || error.message);
  }
}
function notifyPush(payload, predicate = () => true, excludeSocketId = null) {
  if (!vapidPublicKey || !vapidPrivateKey) return;
  for (const record of pushSubscriptions.values()) {
    if (record.socketId !== excludeSocketId && predicate(record)) sendPushNotification(record, payload);
  }
}
const lobbyMessages = [];
const LOBBY_HISTORY_LIMIT = 60;
const lastLobbyMessageAt = new Map();
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
  for (const record of pushSubscriptions.values()) if (record.socketId === socket.id) record.roomId = roomId;
  const peers = roomMembers(roomId).filter(id => id !== socket.id).map(id => ({
    id, name: io.sockets.sockets.get(id)?.data.name || "Guest",
    role: io.sockets.sockets.get(id)?.data.role || "guest"
  }));
  reply({ ok: true, roomId, roomName: room.name, peers, selfId: socket.id });
  if (room.lifeGame) socket.emit("life:state", lifeSnapshot(room.lifeGame));
  socket.to(roomId).emit("peer:joined", { id: socket.id, name, role });
  notifyPush({ title: "NovaLink｜参加者が入室", body: name + " が通話ルームに参加しました。", url: "/" }, record => record.roomId === roomId, socket.id);
  io.to(roomId).emit("room:count", room.members.size);
  broadcastRoomList();
}
function closeRoom(roomId, reason = "ホストが退出したため、部屋が終了しました。") {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.lifeCpuTimer) clearTimeout(room.lifeCpuTimer);
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
  removeLifePlayer(room, socket.id);
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
  socket.emit("lobby:history", lobbyMessages);
  socket.on("lobby:send", ({ text, name } = {}) => {
    const message = String(text || "").trim().slice(0, 500);
    const displayName = String(name || "Guest").trim().slice(0, 24) || "Guest";
    if (!message) return;
    const now = Date.now();
    const previous = lastLobbyMessageAt.get(socket.id) || 0;
    if (now - previous < 650) return;
    lastLobbyMessageAt.set(socket.id, now);
    const item = {
      id: crypto.randomUUID(),
      senderId: socket.id,
      name: displayName,
      text: message,
      at: now
    };
    lobbyMessages.push(item);
    if (lobbyMessages.length > LOBBY_HISTORY_LIMIT) lobbyMessages.shift();
    io.emit("lobby:message", item);
    notifyPush({ title: "NovaLink｜" + displayName, body: message, url: "/" }, record => !record.roomId, socket.id);
  });

  socket.on("push:subscribe", ({ subscription } = {}, reply = () => {}) => {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return reply({ ok: false, error: "通知登録情報が正しくありません。" });
    if (!vapidPublicKey || !vapidPrivateKey) return reply({ ok: false, error: "サーバーの通知設定がまだ完了していません。" });
    pushSubscriptions.set(subscription.endpoint, { subscription, socketId: socket.id, roomId: socket.data.roomId || null });
    socket.data.pushEndpoint = subscription.endpoint;
    reply({ ok: true });
  });
  socket.on("push:context", ({ roomId: targetRoomId } = {}) => {
    const record = socket.data.pushEndpoint ? pushSubscriptions.get(socket.data.pushEndpoint) : null;
    if (record) record.roomId = targetRoomId && rooms.has(targetRoomId) ? targetRoomId : null;
  });
  socket.on("push:unsubscribe", ({ endpoint } = {}, reply = () => {}) => {
    const target = endpoint || socket.data.pushEndpoint;
    if (target) pushSubscriptions.delete(target);
    socket.data.pushEndpoint = null;
    reply({ ok: true });
  });
  socket.on("room:list", (_data, reply = () => {}) => reply({ ok: true, rooms: publicRoomList() }));

  socket.on("room:create", async ({ roomName, password, name } = {}, reply = () => {}) => {
    roomName = String(roomName || "").trim().slice(0, 40);
    password = String(password || "");
    name = String(name || "Host").trim().slice(0, 24) || "Host";
    if (password.length < 4 || password.length > 64) return reply({ ok: false, error: "パスワードは4〜64文字で設定してください。" });
    if (socket.data.roomId) leaveRoom(socket);
    let roomId;
    do { roomId = crypto.randomBytes(5).toString("hex").toUpperCase(); } while (rooms.has(roomId));
    try {
      const credentials = await hashPassword(password);
      let finalRoomName = roomName;
      if (!finalRoomName) {
        const occupiedNames = new Set([...rooms.values()].map(room => room.name));
        let number = 1;
        while (occupiedNames.has("NOVA会議" + number)) number += 1;
        finalRoomName = "NOVA会議" + number;
      }
      rooms.set(roomId, {
        id: roomId, name: finalRoomName, members: new Set(), createdAt: Date.now(),
        passwordSalt: credentials.salt, passwordHash: credentials.hash, lifeGame: null, lifeCpuTimer: null
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

  socket.on("life:sync", (_data, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return reply({ ok: false, error: "通話ルームに参加していません。" });
    reply({ ok: true, game: lifeSnapshot(room.lifeGame) });
  });

  socket.on("life:create", (_data, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || socket.data.role !== "host") return reply({ ok: false, error: "ゲームを作成できるのはホストだけです。" });
    if (room.lifeGame) return reply({ ok: false, error: "この通話には既に人生ゲームがあります。" });
    const player = { id: socket.id, name: socket.data.name || "Host", position: 0, cash: LIFE_START_CASH, salary: 100000, career: "未就職", ready: true, finished: false };
    room.lifeGame = {
      version: 1, status: "lobby", hostId: socket.id, players: [player],
      board: makeLifeBoard(), turnIndex: 0, turnNumber: 1, currentEvent: null,
      lastRoll: null, winnerId: null, log: [{ id: crypto.randomUUID(), message: "NOVALINK LIFE が作成されました。参加者を待っています。", at: Date.now() }]
    };
    broadcastLifeState(room);
    reply({ ok: true });
  });

  socket.on("life:join", (_data, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId);
    const game = room?.lifeGame;
    if (!game || game.status !== "lobby") return reply({ ok: false, error: "参加できるゲームがありません。" });
    if (game.players.some(player => player.id === socket.id)) return reply({ ok: true });
    if (game.players.filter(player => !player.isCpu).length >= MAX_PEERS) return reply({ ok: false, error: "人間プレイヤーは最大10人です。" });
    game.players.push({ id: socket.id, name: socket.data.name || "Guest", position: 0, cash: LIFE_START_CASH, salary: 100000, career: "未就職", ready: false, finished: false });
    lifeLog(game, (socket.data.name || "Guest") + " がゲームに参加しました。");
    broadcastLifeState(room);
    reply({ ok: true });
  });

  socket.on("life:cpu:add", (_data, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId), game = room?.lifeGame;
    if (!game || socket.data.role !== "host" || game.hostId !== socket.id || game.status !== "lobby") return reply({ ok: false, error: "CPUを追加できるのは待機中のホストだけです。" });
    const count = game.players.filter(player => player.isCpu).length;
    if (count >= 4) return reply({ ok: false, error: "CPUは最大4人までです。" });
    const cpuNumber = count + 1;
    game.players.push({ id: "cpu-" + crypto.randomUUID(), name: "CPU " + String(cpuNumber).padStart(2,"0"), isCpu: true, position: 0, cash: LIFE_START_CASH, salary: 100000, career: "未就職", ready: true, finished: false });
    lifeLog(game, "CPU " + String(cpuNumber).padStart(2,"0") + " が参加しました。");
    broadcastLifeState(room);
    reply({ ok: true });
  });

  socket.on("life:cpu:remove", (_data, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId), game = room?.lifeGame;
    if (!game || socket.data.role !== "host" || game.hostId !== socket.id || game.status !== "lobby") return reply({ ok: false, error: "CPUを削除できるのは待機中のホストだけです。" });
    const index = game.players.map((player, i) => player.isCpu ? i : -1).filter(i => i >= 0).pop();
    if (index === undefined) return reply({ ok: false, error: "削除できるCPUがいません。" });
    const [removed] = game.players.splice(index, 1);
    lifeLog(game, removed.name + " が退出しました。");
    broadcastLifeState(room);
    reply({ ok: true });
  });

  socket.on("life:ready", ({ ready } = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId), game = room?.lifeGame;
    const player = game?.players.find(item => item.id === socket.id);
    if (!player || game.status !== "lobby") return reply({ ok: false, error: "準備状態を変更できません。" });
    player.ready = !!ready;
    broadcastLifeState(room);
    reply({ ok: true });
  });

  socket.on("life:start", (_data, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId), game = room?.lifeGame;
    if (!game || socket.data.role !== "host" || game.hostId !== socket.id) return reply({ ok: false, error: "開始できるのはホストだけです。" });
    if (game.status !== "lobby") return reply({ ok: false, error: "ゲームは既に開始されています。" });
    if (game.players.length < 2) return reply({ ok: false, error: "人間またはCPUを合わせて2人以上必要です。" });
    if (!game.players.every(player => player.isCpu || player.ready)) return reply({ ok: false, error: "人間プレイヤー全員の準備が完了していません。" });
    game.status = "playing";
    game.turnIndex = 0;
    game.turnNumber = 1;
    lifeLog(game, "人生ゲーム開始！ " + game.players[0].name + " の番です。");
    broadcastLifeState(room);
    scheduleCpuLifeTurn(room);
    reply({ ok: true });
  });

  socket.on("life:roll", (_data, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId), game = room?.lifeGame;
    if (!game || game.status !== "playing" || game.currentEvent) return reply({ ok: false, error: "現在サイコロを振れません。" });
    const player = game.players[game.turnIndex];
    if (!player || player.id !== socket.id || player.finished) return reply({ ok: false, error: "あなたのターンではありません。" });
    const roll = crypto.randomInt(1, 7);
    const from = player.position;
    player.position = Math.min(game.board.length - 1, player.position + roll);
    game.lastRoll = { playerId: player.id, playerName: player.name, value: roll, from, to: player.position, at: Date.now() };
    const tile = game.board[player.position];
    lifeLog(game, player.name + " が " + roll + " を出して「" + tile.title + "」に到着。");
    resolveLifeTile(game, player, tile);
    if (!game.currentEvent && game.status === "playing") nextLifeTurn(game);
    broadcastLifeState(room);
    scheduleCpuLifeTurn(room);
    reply({ ok: true });
  });

  socket.on("life:choose", ({ choiceId } = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomId), game = room?.lifeGame;
    const event = game?.currentEvent;
    const player = game?.players[game.turnIndex];
    if (!event || !player || player.id !== socket.id || event.playerId !== socket.id) return reply({ ok: false, error: "選択できるイベントがありません。" });
    const choice = event.choices.find(item => item.id === String(choiceId || ""));
    if (!choice) return reply({ ok: false, error: "無効な選択です。" });
    applyLifeChoice(game, player, choice);
    game.currentEvent = null;
    nextLifeTurn(game);
    broadcastLifeState(room);
    scheduleCpuLifeTurn(room);
    reply({ ok: true });
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
    notifyPush({ title: "NovaLink｜" + (socket.data.name || "Guest"), body: message, url: "/" }, record => record.roomId === socket.data.roomId, socket.id);
  });
  socket.on("disconnect", () => { lastLobbyMessageAt.delete(socket.id); leaveRoom(socket); });
});

server.listen(PORT, () => console.log(`NovaLink running on port ${PORT}`));
