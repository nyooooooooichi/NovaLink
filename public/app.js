const socket = io();
const $ = (id) => document.getElementById(id);

let authClient = null, authUser = null, pendingAvatarBlob = null, pendingAvatarPreview = null;
function authMessage(message, isError = false) {
  const node = $("authMessage");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", isError);
}
function openAuthModal() {
  $("authModal").classList.remove("hidden");
  $("authModal").setAttribute("aria-hidden", "false");
  authMessage("");
}
function closeAuthModal() {
  $("authModal").classList.add("hidden");
  $("authModal").setAttribute("aria-hidden", "true");
}
function currentProfileName() {
  return authUser?.user_metadata?.username || authUser?.user_metadata?.full_name ||
    authUser?.user_metadata?.name || authUser?.email?.split("@")[0] || "NovaLink User";
}
function setEmailAuthMode(mode) {
  const signup = mode === "signup";
  $("emailLoginForm").classList.toggle("hidden", signup);
  $("emailSignupForm").classList.toggle("hidden", !signup);
  $("emailLoginTab").classList.toggle("selected", !signup);
  $("emailSignupTab").classList.toggle("selected", signup);
  $("emailLoginTab").setAttribute("aria-selected", String(!signup));
  $("emailSignupTab").setAttribute("aria-selected", String(signup));
  authMessage("");
}
function paintAuthState() {
  const signedIn = !!authUser;
  $("authSignedOut").classList.toggle("hidden", signedIn);
  $("authSignedIn").classList.toggle("hidden", !signedIn);
  $("accountBtn").textContent = signedIn ? "マイアカウント" : "ログイン / 登録";
  $("accountIdentity").classList.toggle("hidden", !signedIn);
  if (signedIn) {
    const name = currentProfileName();
    $("accountIdentity").textContent = name;
    $("profileUsername").value = name;
    $("profileAvatarPreview").src = authUser.user_metadata?.avatar_url || makeAvatarFallback(name);
    if (!$("displayName").value.trim() || $("displayName").value === "Guest") $("displayName").value = name;
  }
}
function makeAvatarFallback(name) {
  const letter = (name || "N").trim().charAt(0).toUpperCase() || "N";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="64" fill="#263b59"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="58" fill="#dcecff">' + letter.replace(/[<>&"]/g, "") + '</text></svg>';
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
async function initAuth() {
  const config = window.NOVALINK_CONFIG || {};
  if (!window.supabase?.createClient || !config.supabaseUrl || !config.supabaseAnonKey) {
    $("accountBtn").title = "認証設定がまだ完了していません";
    $("accountBtn").addEventListener("click", () => { openAuthModal(); authMessage("Supabaseの接続設定がまだありません。管理者による設定が必要です。", true); });
    return;
  }
  authClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const { data, error } = await authClient.auth.getSession();
  if (error) console.error("Auth session error", error);
  authUser = data?.session?.user || null;
  paintAuthState();
  authClient.auth.onAuthStateChange((_event, session) => {
    authUser = session?.user || null;
    paintAuthState();
    if (authUser) authMessage("ログインしました。");
  });
}
$("accountBtn").onclick = openAuthModal;
$("authClose").onclick = closeAuthModal;
document.querySelectorAll("[data-auth-close]").forEach(el => el.addEventListener("click", closeAuthModal));
document.querySelectorAll("[data-provider]").forEach(button => button.addEventListener("click", async () => {
  if (!authClient) return authMessage("認証設定がまだ完了していません。", true);
  button.disabled = true;
  const { error } = await authClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin }
  });
  button.disabled = false;
  if (error) authMessage(error.message, true);
}));

$("emailLoginTab").onclick = () => setEmailAuthMode("login");
$("emailSignupTab").onclick = () => setEmailAuthMode("signup");
$("emailLoginForm").onsubmit = async event => {
  event.preventDefault();
  if (!authClient) return authMessage("認証設定がまだ完了していません。", true);
  const email = $("emailLoginAddress").value.trim();
  const password = $("emailLoginPassword").value;
  const submit = $("emailLoginSubmit");
  submit.disabled = true;
  try {
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    authUser = data.user;
    paintAuthState();
    authMessage("ログインしました。");
  } catch (error) {
    authMessage(error.message || "ログインできませんでした。メールアドレスとパスワードを確認してください。", true);
  } finally { submit.disabled = false; }
};
$("emailSignupForm").onsubmit = async event => {
  event.preventDefault();
  if (!authClient) return authMessage("認証設定がまだ完了していません。", true);
  const email = $("emailSignupAddress").value.trim();
  const password = $("emailSignupPassword").value;
  const confirmation = $("emailSignupPasswordConfirm").value;
  if (password.length < 8) return authMessage("パスワードは8文字以上で設定してください。", true);
  if (password !== confirmation) return authMessage("確認用パスワードが一致しません。", true);
  const submit = $("emailSignupSubmit");
  submit.disabled = true;
  try {
    const { data, error } = await authClient.auth.signUp({ email, password });
    if (error) throw error;
    if (data.session && data.user) {
      authUser = data.user;
      paintAuthState();
      authMessage("アカウントを作成しました。");
    } else {
      authMessage("登録処理は完了しましたが、メール確認が有効になっています。管理者がSupabaseのメール確認をOFFにする必要があります。", true);
    }
  } catch (error) {
    authMessage(error.message || "アカウントを作成できませんでした。", true);
  } finally { submit.disabled = false; }
};
setEmailAuthMode("login");

$("profileAvatarFile").onchange = event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return authMessage("PNG・JPEG・WebP画像を選択してください。", true);
  if (file.size > 5 * 1024 * 1024) return authMessage("画像は5MB以下にしてください。", true);
  const image = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(256 / image.width, 256 / image.height);
      const width = image.width * scale, height = image.height * scale;
      ctx.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
      canvas.toBlob(blob => {
        if (!blob) return authMessage("画像を変換できませんでした。", true);
        pendingAvatarBlob = blob;
        if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
        pendingAvatarPreview = URL.createObjectURL(blob);
        $("profileAvatarPreview").src = pendingAvatarPreview;
        authMessage("アイコン画像を読み込みました。保存すると反映されます。");
      }, "image/jpeg", 0.78);
    };
    image.onerror = () => authMessage("画像を読み込めませんでした。", true);
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
};
$("profileSave").onclick = async () => {
  if (!authClient || !authUser) return;
  const username = $("profileUsername").value.trim();
  if (!username) return authMessage("ユーザー名を入力してください。", true);
  if (username.length > 24) return authMessage("ユーザー名は24文字以内にしてください。", true);
  $("profileSave").disabled = true;
  try {
    const updates = { username };
    if (pendingAvatarBlob) {
      const { error: uploadError } = await authClient.storage.from("avatars").upload(
        authUser.id + "/avatar.jpg", pendingAvatarBlob,
        { upsert: true, contentType: "image/jpeg", cacheControl: "3600" }
      );
      if (uploadError) throw uploadError;
      const { data: publicData } = authClient.storage.from("avatars").getPublicUrl(authUser.id + "/avatar.jpg");
      updates.avatar_url = publicData.publicUrl + "?v=" + Date.now();
    }
    const { data, error } = await authClient.auth.updateUser({ data: updates });
    if (error) throw error;
    authUser = data.user;
    pendingAvatarBlob = null;
    if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
    pendingAvatarPreview = null;
    paintAuthState();
    authMessage("プロフィールを保存しました。");
  } catch (error) { authMessage(error.message || "保存できませんでした。", true); }
  finally { $("profileSave").disabled = false; }
};
$("authSignOut").onclick = async () => {
  if (!authClient) return;
  const { error } = await authClient.auth.signOut();
  if (error) authMessage(error.message, true);
  else { authUser = null; pendingAvatarBlob = null; if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview); pendingAvatarPreview = null; paintAuthState(); authMessage("ログアウトしました。"); }
};

let localStream = null, screenStream = null, roomId = null, selfId = null;
const peers = new Map();
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let micOn = true, cameraOn = true;
let segmentation = null, backgroundMode = "none", backgroundImage = null;
let processedStream = null, processing = false, segmentationReady = false;
let sourceVideo = null, outputCanvas = null, outputCtx = null, frameBusy = false;
let selectedRoomId = null;
let roomRole = null;
let lifeGameState = null;

// Site-wide home lobby chat. Messages are kept in server memory (latest 60).
const lobbyNotifyKey = "novalink-lobby-notifications";
let lobbyNotificationsEnabled = localStorage.getItem(lobbyNotifyKey) === "on";
let lobbySeenInitialHistory = false;
function lobbyDisplayName() {
  return ($("displayName")?.value || (authUser ? currentProfileName() : "") || "Guest").trim().slice(0, 24) || "Guest";
}
function formatLobbyTime(timestamp) {
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
function renderLobbyMessage(message) {
  const box = $("lobbyMessages");
  if (!box || !message) return;
  const empty = box.querySelector(".lobby-empty");
  if (empty) empty.remove();
  const row = document.createElement("article");
  row.className = "lobby-message";
  const top = document.createElement("div");
  top.className = "lobby-message-meta";
  const name = document.createElement("strong");
  name.textContent = message.name || "Guest";
  const time = document.createElement("time");
  time.dateTime = new Date(message.at).toISOString();
  time.textContent = formatLobbyTime(message.at);
  const body = document.createElement("p");
  body.textContent = message.text || "";
  top.append(name, time);
  row.append(top, body);
  box.append(row);
  while (box.children.length > 60) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
}
function updateLobbyNotifyButton() {
  const button = $("lobbyNotifyBtn");
  const hint = $("lobbyNotifyHint");
  if (!button || !hint) return;
  button.textContent = lobbyNotificationsEnabled ? "通知：ON" : "通知：OFF";
  button.classList.toggle("enabled", lobbyNotificationsEnabled);
  button.setAttribute("aria-pressed", String(lobbyNotificationsEnabled));
  if (!("Notification" in window)) {
    hint.textContent = "このブラウザはデスクトップ通知に対応していません。";
  } else if (lobbyNotificationsEnabled && Notification.permission === "granted") {
    hint.textContent = "通知ON：このサイトを開いていて、別タブ・別ウィンドウにいる間に新着をお知らせします。";
  } else if (lobbyNotificationsEnabled && Notification.permission === "denied") {
    hint.textContent = "ブラウザ側で通知がブロックされています。サイトの通知許可をブラウザ設定で変更してください。";
  } else {
    hint.textContent = "通知をONにすると、このサイトを別タブで開いている間の新着メッセージをお知らせします。";
  }
}
async function toggleLobbyNotifications() {
  if (!lobbyNotificationsEnabled) {
    if (!("Notification" in window)) {
      toast("このブラウザは通知に対応していません。");
      return;
    }
    if (Notification.permission === "denied") {
      toast("ブラウザ設定でNovaLinkの通知を許可してください。");
      updateLobbyNotifyButton();
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      toast("通知は許可されませんでした。");
      updateLobbyNotifyButton();
      return;
    }
    lobbyNotificationsEnabled = true;
  } else {
    lobbyNotificationsEnabled = false;
  }
  localStorage.setItem(lobbyNotifyKey, lobbyNotificationsEnabled ? "on" : "off");
  updateLobbyNotifyButton();
}
function showLobbyNotification(message) {
  if (!lobbyNotificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const notification = new Notification("NovaLink｜" + (message.name || "Guest"), {
      body: message.text,
      tag: "novalink-lobby-" + message.id,
      icon: "/favicon.ico"
    });
    notification.onclick = () => { window.focus(); notification.close(); };
  } catch (error) { console.warn("Lobby notification unavailable", error); }
}
socket.on("lobby:history", messages => {
  const box = $("lobbyMessages");
  if (!box) return;
  box.innerHTML = "";
  if (!messages?.length) {
    const empty = document.createElement("div");
    empty.className = "lobby-empty";
    empty.textContent = "まだメッセージはありません。最初のメッセージを送りましょう。";
    box.append(empty);
  } else {
    messages.forEach(renderLobbyMessage);
  }
  lobbySeenInitialHistory = true;
});
socket.on("lobby:message", message => {
  renderLobbyMessage(message);
  if (message.senderId !== socket.id) showLobbyNotification(message);
});
$("lobbyForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("lobbyInput");
  const message = input.value.trim();
  if (!message) return;
  socket.emit("lobby:send", { text: message, name: lobbyDisplayName() });
  input.value = "";
  input.focus();
});
$("lobbyNotifyBtn").addEventListener("click", toggleLobbyNotifications);
updateLobbyNotifyButton();

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function showRoomBrowser() {
  const home = $("home") || document.querySelector(".hero");
  const browser = $("roomBrowser");
  if (!home || !browser) {
    console.error("NovaLink: room browser elements are missing.", { home, browser });
    toast("画面の読み込みに失敗しました。ページを再読み込みしてください。");
    return;
  }
  home.classList.add("hidden");
  browser.classList.remove("hidden");
  loadRooms();
}
function showHome() {
  const home = $("home") || document.querySelector(".hero");
  const browser = $("roomBrowser");
  const joinPanel = $("roomJoinPanel");
  if (browser) browser.classList.add("hidden");
  if (home) home.classList.remove("hidden");
  if (joinPanel) joinPanel.classList.add("hidden");
  selectedRoomId = null;
}
function loadRooms() {
  $("roomList").innerHTML = '<div class="room-list-empty">部屋を読み込んでいます...</div>';
  socket.emit("room:list", {}, result => {
    if (!result?.ok) return $("roomList").innerHTML = '<div class="room-list-empty">部屋一覧を取得できませんでした。</div>';
    renderRoomList(result.rooms || []);
  });
}
function renderRoomList(rooms) {
  const list = $("roomList");
  list.innerHTML = "";
  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "room-list-empty";
    empty.textContent = "現在、公開中の部屋はありません。";
    list.append(empty);
    return;
  }
  rooms.forEach(room => {
    const card = document.createElement("article");
    card.className = "room-list-card";
    const info = document.createElement("div");
    info.className = "room-list-info";
    const title = document.createElement("h3");
    title.textContent = room.name;
    const meta = document.createElement("p");
    meta.textContent = "🔒 パスワード必須  ·  " + room.count + " / " + room.max + " 人";
    info.append(title, meta);
    const button = document.createElement("button");
    button.className = "room-select-btn";
    const full = room.count >= room.max;
    button.disabled = full;
    button.textContent = full ? "満員" : "参加する →";
    button.addEventListener("click", () => {
      selectedRoomId = room.id;
      $("selectedRoomTitle").textContent = room.name;
      $("roomPassword").value = "";
      $("roomJoinPanel").classList.remove("hidden");
      $("roomPassword").focus();
    });
    card.append(info, button);
    list.append(card);
  });
}
socket.on("room:list:update", rooms => {
  if (!$("roomBrowser").classList.contains("hidden")) renderRoomList(rooms || []);
});

async function acquireMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $("cameraSource").srcObject = localStream;
    await $("cameraSource").play().catch(() => {});
    $("localVideo").srcObject = localStream;
    return true;
  } catch (e) {
    toast("カメラ・マイクを利用できません。ブラウザの権限を確認してください。");
    return false;
  }
}
function enterMeeting(result, name, role) {
  selfId = result.selfId;
  roomId = result.roomId;
  roomRole = role;
  lifeGameState = null;
  $("roomBrowser").classList.add("hidden");
  $("home").classList.add("hidden");
  $("meeting").classList.remove("hidden");
  $("meetingTitle").textContent = result.roomName || "ミーティング";
  $("roomLabel").textContent = "ROOM / " + result.roomId;
  $("memberCount").textContent = result.peers.length + 1;
  updateParticipants(name, result.peers);
  $("selfName").textContent = name + (role === "host" ? " · HOST" : " · GUEST");
  history.replaceState({}, "", "/");
  for (const peer of result.peers) makePeer(peer.id, peer.name, true);
  socket.emit("life:sync", {}, result => {
    if (result?.ok) {
      lifeGameState = result.game || null;
      renderLifeGame();
    }
  });
}
async function createRoom() {
  const roomName = $("createRoomName").value.trim();
  const password = $("createRoomPassword").value;
  const name = $("displayName").value.trim() || "Host";
  if (!roomName) return toast("部屋名を入力してください。");
  if (password.length < 4 || password.length > 64) return toast("パスワードは4〜64文字で設定してください。");
  if (!await acquireMedia()) return;
  $("hostBtn").disabled = true;
  socket.emit("room:create", { roomName, password, name }, result => {
    $("hostBtn").disabled = false;
    if (!result?.ok) {
      localStream?.getTracks().forEach(track => track.stop()); localStream = null;
      return toast(result?.error || "部屋を作成できませんでした。");
    }
    $("createRoomPassword").value = "";
    enterMeeting(result, name, "host");
  });
}
async function joinSelectedRoom() {
  if (!selectedRoomId) return toast("参加する部屋を選択してください。");
  const password = $("roomPassword").value;
  if (!password) return toast("パスワードを入力してください。");
  const name = $("displayName").value.trim() || "Guest";
  if (!await acquireMedia()) return;
  $("selectedRoomJoinBtn").disabled = true;
  socket.emit("room:join", { roomId: selectedRoomId, password, name }, result => {
    $("selectedRoomJoinBtn").disabled = false;
    if (!result?.ok) {
      localStream?.getTracks().forEach(track => track.stop()); localStream = null;
      $("cameraSource").srcObject = null; $("localVideo").srcObject = null;
      return toast(result?.error || "参加できませんでした。");
    }
    $("roomPassword").value = "";
    enterMeeting(result, name, "guest");
  });
}
$("hostBtn").onclick = createRoom;
$("browseRoomsBtn").onclick = showRoomBrowser;
$("refreshRoomsBtn").onclick = loadRooms;
$("backHomeBtn").onclick = showHome;
$("cancelRoomJoinBtn").onclick = () => $("roomJoinPanel").classList.add("hidden");
$("selectedRoomJoinBtn").onclick = joinSelectedRoom;
$("roomPassword").addEventListener("keydown", event => { if (event.key === "Enter") joinSelectedRoom(); });

function outgoingStream() { return processedStream || localStream; }
async function makePeer(id, name, initiator) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(config);
  peers.set(id, { pc, name });
  const stream = outgoingStream();
  const cameraTrack = stream?.getVideoTracks()[0];
  const audioTracks = stream?.getAudioTracks() || [];
  if (cameraTrack) pc.addTrack(cameraTrack, new MediaStream([cameraTrack]));
  audioTracks.forEach(track => pc.addTrack(track, new MediaStream([track])));
  const screenMediaStream = new MediaStream();
  const screenTransceiver = pc.addTransceiver("video", { direction: "sendrecv", streams: [screenMediaStream] });
  peers.get(id).screenSender = screenTransceiver.sender;
  if (screenStream?.getVideoTracks()[0]) await screenTransceiver.sender.replaceTrack(screenStream.getVideoTracks()[0]);
  pc.onicecandidate = e => { if (e.candidate) socket.emit("signal", { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = e => addVideo(id, name, e.streams[0], e.transceiver === screenTransceiver);
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (["failed", "closed"].includes(state)) removePeer(id);
    updateConnectionState();
  };
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: id, data: { description: pc.localDescription } });
  }
  return peers.get(id);
}
function addVideo(id, name, stream, isScreen = false) {
  let tile = document.getElementById("tile-" + id);
  if (!tile) {
    tile = document.createElement("div"); tile.className = "video-tile"; tile.id = "tile-" + id;
    const camera = document.createElement("video"); camera.className = "camera-feed"; camera.autoplay = true; camera.playsInline = true;
    const screen = document.createElement("video"); screen.className = "screen-feed"; screen.autoplay = true; screen.playsInline = true;
    tile.append(camera, screen);
    const label = document.createElement("span"); label.className = "video-name"; label.textContent = name; tile.append(label);
    const expand = document.createElement("button"); expand.className = "tile-expand"; expand.textContent = "⛶"; expand.title = "全画面表示";
    expand.onclick = () => toggleFullscreen(tile); tile.append(expand);
    $("videoGrid").append(tile);
  }
  tile.querySelector(isScreen ? ".screen-feed" : ".camera-feed").srcObject = stream;
  if (isScreen) tile.classList.add("has-screen");
}
function toggleFullscreen(element) {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else element.requestFullscreen?.().catch(() => toast("全画面表示を開始できませんでした。"));
}
$("selfFullscreen").onclick = () => toggleFullscreen($("selfTile"));
function removePeer(id) {
  const peer = peers.get(id); if (peer) peer.pc.close();
  peers.delete(id); document.getElementById("tile-" + id)?.remove();
  renderParticipants();
}
function updateParticipants(selfName, list) {
  $("selfName").textContent = selfName;
  $("participantList").dataset.self = selfName;
  $("participantList").dataset.peers = JSON.stringify(list.map(p => p.name));
  renderParticipants();
}
function renderParticipants() {
  const box = $("participantList"); box.innerHTML = "";
  const names = [box.dataset.self || "あなた", ...[...peers.values()].map(p => p.name)];
  names.forEach((name, i) => {
    const item = document.createElement("span"); item.className = "participant-chip";
    item.textContent = (i === 0 ? "● " : "○ ") + name; box.append(item);
  });
}
function updateConnectionState() {
  const states = [...peers.values()].map(p => p.pc.connectionState);
  $("connectionStatus").textContent = !states.length ? "自分のみ" : states.every(s => s === "connected") ? "接続良好" : "接続中";
  $("connectionStatus").classList.toggle("is-good", states.length > 0 && states.every(s => s === "connected"));
}
socket.on("peer:joined", async ({ id, name }) => {
  await makePeer(id, name, false); renderParticipants(); toast(name + " が参加しました");
});
socket.on("peer:left", ({ id }) => { removePeer(id); toast("参加者が退出しました"); });
socket.on("room:count", count => $("memberCount").textContent = count);

// NOVALINK LIFE — all state changes are validated and broadcast by the server.
function lifeRequest(event, payload = {}) {
  socket.emit(event, payload, result => {
    if (!result?.ok) toast(result?.error || "人生ゲームの操作に失敗しました。");
  });
}
function openLifeGame() {
  $("lifeGamePanel").classList.remove("hidden");
  socket.emit("life:sync", {}, result => {
    if (!result?.ok) return toast(result?.error || "ゲーム情報を取得できませんでした。");
    lifeGameState = result.game || null;
    renderLifeGame();
  });
}
function lifeMoney(value) {
  return new Intl.NumberFormat("ja-JP").format(value || 0) + "円";
}
function renderLifeGame() {
  const game = lifeGameState;
  const create = $("lifeCreateBtn"), join = $("lifeJoinBtn"), ready = $("lifeReadyBtn");
  const start = $("lifeStartBtn"), roll = $("lifeRollBtn");
  const board = $("lifeBoard"), playersBox = $("lifePlayers");
  if (!game) {
    $("lifeStatus").textContent = "ゲーム未作成";
    $("lifeTurnLabel").textContent = "ホストがゲームを作成してください";
    create.hidden = roomRole !== "host";
    join.hidden = ready.hidden = start.hidden = roll.hidden = true;
    $("lifeCpuAddBtn").hidden = $("lifeCpuRemoveBtn").hidden = $("lifeCpuCount").hidden = true;
    board.innerHTML = '<div class="life-board-empty">ホストがゲームを作成すると、人生の盤面が表示されます。</div>';
    playersBox.innerHTML = '<p class="life-muted">まだゲームに参加していません。</p>';
    $("lifeLog").innerHTML = '<p class="life-muted">ゲームの出来事がここに表示されます。</p>';
    $("lifeEventCard").classList.add("hidden");
    return;
  }
  const me = game.players.find(player => player.id === selfId);
  const active = game.players[game.turnIndex];
  const isHost = game.hostId === selfId;
  $("lifeStatus").textContent = game.status === "lobby" ? "参加者募集中" : game.status === "playing" ? "ゲーム進行中" : "ゲーム終了";
  $("lifeTurnLabel").textContent = game.status === "lobby" ? game.players.length + " / 10 人参加中" :
    game.status === "playing" ? "第" + game.turnNumber + "ターン · " + (active?.name || "—") + " の番" : "最終結果が確定しました";
  create.hidden = true;
  join.hidden = !(game.status === "lobby" && !me);
  ready.hidden = !(game.status === "lobby" && !!me);
  ready.textContent = me?.ready ? "準備を解除" : "準備OK";
  const cpuCount = game.players.filter(player => player.isCpu).length;
  const canManageCpu = game.status === "lobby" && isHost;
  $("lifeCpuAddBtn").hidden = !canManageCpu;
  $("lifeCpuRemoveBtn").hidden = !canManageCpu;
  $("lifeCpuCount").hidden = !canManageCpu;
  $("lifeCpuAddBtn").disabled = cpuCount >= 4;
  $("lifeCpuRemoveBtn").disabled = cpuCount === 0;
  $("lifeCpuCount").textContent = "CPU " + cpuCount + " / 4";
  start.hidden = !canManageCpu;
  start.disabled = game.players.length < 2 || !game.players.every(player => player.isCpu || player.ready);
  roll.hidden = !(game.status === "playing" && me && active?.id === selfId && !game.currentEvent);
  board.innerHTML = "";
  const boardColumns = window.matchMedia("(max-width: 620px)").matches ? 4 : 8;
  game.board.forEach(tile => {
    const cell = document.createElement("div");
    const row = Math.floor(tile.id / boardColumns), column = tile.id % boardColumns;
    cell.style.gridRow = String(row + 1);
    cell.style.gridColumn = String(row % 2 === 0 ? column + 1 : boardColumns - column);
    cell.className = "life-tile life-tile-" + tile.type;
    const number = document.createElement("small"); number.textContent = tile.id === 0 ? "START" : tile.id === game.board.length - 1 ? "GOAL" : String(tile.id).padStart(2,"0");
    const title = document.createElement("strong"); title.textContent = tile.title;
    cell.append(number, title);
    const occupants = game.players.filter(player => player.position === tile.id);
    if (occupants.length) {
      const tokens = document.createElement("div"); tokens.className = "life-tokens";
      occupants.forEach((player, index) => {
        const token = document.createElement("span"); token.className = "life-token life-token-" + (game.players.indexOf(player) % 10);
        token.title = player.name; token.textContent = (player.name || "?").slice(0,1);
        tokens.append(token);
      });
      cell.append(tokens);
    }
    board.append(cell);
  });
  playersBox.innerHTML = "";
  game.players.forEach((player, index) => {
    const card = document.createElement("article");
    card.className = "life-player-card" + (active?.id === player.id && game.status === "playing" ? " is-active" : "");
    const avatar = document.createElement("span"); avatar.className = "life-player-avatar life-token-" + (index % 10); avatar.textContent = player.name.slice(0,1);
    const info = document.createElement("div"); info.className = "life-player-info";
    const name = document.createElement("strong"); name.textContent = player.name + (player.id === game.hostId ? " · HOST" : player.isCpu ? " · CPU" : "");
    const meta = document.createElement("small"); meta.textContent = player.career + " · " + (game.status === "lobby" ? (player.isCpu ? "自動プレイヤー" : player.ready ? "準備完了" : "準備中") : "マス " + player.position + (player.finished ? " · GOAL" : ""));
    info.append(name,meta);
    const cash = document.createElement("b"); cash.className = "life-cash"; cash.textContent = lifeMoney(player.cash);
    card.append(avatar,info,cash); playersBox.append(card);
  });
  $("lifeLog").innerHTML = "";
  (game.log || []).slice(0,18).forEach(entry => {
    const item = document.createElement("p"); item.textContent = entry.message; $("lifeLog").append(item);
  });
  const event = game.currentEvent;
  const eventCard = $("lifeEventCard");
  eventCard.classList.toggle("hidden", !event);
  if (event) {
    $("lifeEventTitle").textContent = event.title;
    $("lifeEventDescription").textContent = event.description;
    const choices = $("lifeEventChoices"); choices.innerHTML = "";
    if (event.playerId === selfId) {
      event.choices.forEach(choice => {
        const button = document.createElement("button"); button.type = "button"; button.className = "life-choice-btn";
        const label = document.createElement("strong"); label.textContent = choice.label;
        const detail = document.createElement("small"); detail.textContent = choice.detail;
        button.append(label,detail); button.onclick = () => lifeRequest("life:choose", { choiceId: choice.id }); choices.append(button);
      });
    } else {
      const waiting = document.createElement("p"); waiting.className = "life-muted"; waiting.textContent = (game.players.find(p => p.id === event.playerId)?.name || "プレイヤー") + " が選択中です。"; choices.append(waiting);
    }
  }
}
socket.on("life:state", game => { lifeGameState = game || null; renderLifeGame(); });
window.addEventListener("resize", () => { if (lifeGameState) renderLifeGame(); });
$("lifeGameBtn").onclick = openLifeGame;
$("lifeCloseBtn").onclick = () => $("lifeGamePanel").classList.add("hidden");
$("lifeCreateBtn").onclick = () => lifeRequest("life:create");
$("lifeJoinBtn").onclick = () => lifeRequest("life:join");
$("lifeReadyBtn").onclick = () => {
  const me = lifeGameState?.players.find(player => player.id === selfId);
  lifeRequest("life:ready", { ready: !me?.ready });
};
$("lifeCpuAddBtn").onclick = () => lifeRequest("life:cpu:add");
$("lifeCpuRemoveBtn").onclick = () => lifeRequest("life:cpu:remove");
$("lifeStartBtn").onclick = () => lifeRequest("life:start");
$("lifeRollBtn").onclick = () => lifeRequest("life:roll");
socket.on("signal", async ({ from, data }) => {
  let peer = peers.get(from);
  if (!peer) peer = await makePeer(from, "Guest", false);
  const pc = peer.pc;
  try {
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        socket.emit("signal", { to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) await pc.addIceCandidate(data.candidate);
  } catch (e) { console.error("WebRTC signaling error", e); }
});
function addChat(name, message, mine, at = Date.now()) {
  const box = $("chatMessages");
  if (box.querySelector(".system-message")) box.innerHTML = "";
  const item = document.createElement("div"); item.className = "chat-item";
  const who = document.createElement("b"); who.textContent = mine ? name + " · YOU" : name;
  const body = document.createElement("span"); body.textContent = message;
  const time = document.createElement("time"); time.textContent = new Date(at).toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit"});
  item.append(who, body, time); box.append(item); box.scrollTop = box.scrollHeight;
}
socket.on("chat:message", msg => addChat(msg.name, msg.text, msg.id === selfId, msg.at));
$("chatForm").onsubmit = e => {
  e.preventDefault(); const message = $("chatInput").value.trim();
  if (!message) return; socket.emit("chat:send", { text: message }); $("chatInput").value = "";
};
document.querySelectorAll("[data-emoji]").forEach(btn => btn.onclick = () => {
  $("chatInput").value += btn.dataset.emoji; $("chatInput").focus();
});
$("micBtn").onclick = () => {
  micOn = !micOn; localStream?.getAudioTracks().forEach(t => t.enabled = micOn);
  $("micBtn").classList.toggle("active", micOn); $("micBtn").querySelector("span").textContent = micOn ? "マイク" : "ミュート";
};
$("cameraBtn").onclick = () => {
  cameraOn = !cameraOn; localStream?.getVideoTracks().forEach(t => t.enabled = cameraOn);
  $("cameraBtn").classList.toggle("active", cameraOn); $("cameraBtn").querySelector("span").textContent = cameraOn ? "カメラ" : "カメラOFF";
};

$("shareBtn").onclick = async () => {
  if (screenStream) return;
  try {
    await stopBackgroundProcessing();
    backgroundMode = "none";
    updateBackgroundUI();
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = screenStream.getVideoTracks()[0];
    for (const peer of peers.values()) {
      if (peer.screenSender) await peer.screenSender.replaceTrack(track);
    }
    let preview = $("selfTile").querySelector(".self-screen-preview");
    if (!preview) {
      preview = document.createElement("video"); preview.className = "self-screen-preview";
      preview.autoplay = true; preview.playsInline = true; preview.muted = true;
      $("selfTile").append(preview);
    }
    preview.srcObject = screenStream;
    $("selfTile").classList.add("sharing-screen");
    $("stopShareBtn").classList.remove("hidden"); $("shareBtn").classList.add("active");
    track.onended = stopShare;
  } catch (e) { screenStream = null; toast("画面共有を開始できませんでした。"); }
};
$("stopShareBtn").onclick = stopShare;
async function stopShare() {
  if (!screenStream) return;
  const streamToStop = screenStream; screenStream = null;
  for (const peer of peers.values()) {
    if (peer.screenSender) await peer.screenSender.replaceTrack(null);
  }
  streamToStop.getTracks().forEach(t => t.stop());
  const preview = $("selfTile").querySelector(".self-screen-preview");
  if (preview) { preview.srcObject = null; preview.remove(); }
  $("selfTile").classList.remove("sharing-screen");
  $("stopShareBtn").classList.add("hidden"); $("shareBtn").classList.remove("active");
  toast("画面共有を終了しました。");
}

// Virtual background: MediaPipe Selfie Segmentation runs locally in the browser.
function loadBackgroundLibrary() {
  return new Promise((resolve, reject) => {
    if (window.SelfieSegmentation) return resolve();
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js";
    script.onload = resolve; script.onerror = () => reject(new Error("背景処理ライブラリを読み込めません"));
    document.head.append(script);
  });
}
async function ensureBackgroundEngine() {
  if (segmentationReady) return;
  await loadBackgroundLibrary();
  segmentation = new SelfieSegmentation({ locateFile: file => "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/" + file });
  segmentation.setOptions({ modelSelection: 1 });
  segmentation.onResults(drawBackground);
  sourceVideo = $("cameraSource");
  outputCanvas = document.createElement("canvas");
  outputCanvas.width = sourceVideo.videoWidth || 1280;
  outputCanvas.height = sourceVideo.videoHeight || 720;
  outputCtx = outputCanvas.getContext("2d");
  processedStream = outputCanvas.captureStream(24);
  const audio = localStream.getAudioTracks()[0];
  if (audio) processedStream.addTrack(audio);
  for (const { pc } of peers.values()) {
    const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
    if (videoSender) await videoSender.replaceTrack(processedStream.getVideoTracks()[0]);
  }
  $("localVideo").srcObject = processedStream;
  segmentationReady = true;
}
function paintVirtualBackground(ctx, width, height) {
  if (backgroundMode === "upload" && backgroundImage) {
    const scale = Math.max(width / backgroundImage.width, height / backgroundImage.height);
    const w = backgroundImage.width * scale, h = backgroundImage.height * scale;
    ctx.drawImage(backgroundImage, (width-w)/2, (height-h)/2, w, h); return;
  }
  const presets = {
    aurora: ["#071b36","#146b78","#9b6bd0"],
    sunset: ["#301b4c","#bd5965","#f4b36c"],
    studio: ["#182536","#40556a","#a2b2bd"],
    forest: ["#102c28","#39735a","#a2a66b"]
  };
  const colors = presets[backgroundMode] || presets.aurora;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors[0]); gradient.addColorStop(.55, colors[1]); gradient.addColorStop(1, colors[2]);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = .18;
  for (let i=0;i<7;i++) {
    ctx.beginPath(); ctx.arc(width*(.12+i*.15), height*(.2+(i%3)*.24), 90+i*13, 0, Math.PI*2);
    ctx.fillStyle = i%2 ? "#ffffff" : "#8de7ef"; ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawBackground(results) {
  if (!outputCtx || backgroundMode === "none") return;
  const ctx = outputCtx, w = outputCanvas.width, h = outputCanvas.height;
  ctx.save();
  if (!cameraOn) {
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#080d19";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.clearRect(0, 0, w, h);
  // Isolate the person, then place the chosen background behind them.
  ctx.drawImage(results.image, 0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(results.segmentationMask, 0, 0, w, h);
  ctx.globalCompositeOperation = "destination-over";
  if (backgroundMode === "blur") {
    ctx.filter = "blur(18px)";
    ctx.drawImage(results.image, -22, -22, w + 44, h + 44);
    ctx.filter = "none";
  } else {
    paintVirtualBackground(ctx, w, h);
  }
  ctx.restore();
}
let backgroundLoopTimer = null;
async function startBackgroundProcessing(mode) {
  if (screenStream) { toast("画面共有中は背景を変更できません。先に共有を終了してください。"); return; }
  if (mode === "none") { await stopBackgroundProcessing(); backgroundMode = "none"; updateBackgroundUI(); return; }
  try {
    backgroundMode = mode;
    await ensureBackgroundEngine();
    if (!processing) {
      processing = true;
      const processFrame = async () => {
        if (!processing || !segmentation || !sourceVideo || sourceVideo.readyState < 2) {
          if (processing) backgroundLoopTimer = requestAnimationFrame(processFrame);
          return;
        }
        if (!frameBusy) {
          frameBusy = true;
          try { await segmentation.send({ image: sourceVideo }); } catch (e) { console.error(e); }
          frameBusy = false;
        }
        if (processing) backgroundLoopTimer = requestAnimationFrame(processFrame);
      };
      processFrame();
    }
    updateBackgroundUI(); toast("バーチャル背景を適用しました。");
  } catch (e) { backgroundMode = "none"; updateBackgroundUI(); toast("背景機能を読み込めませんでした。ネットワークを確認してください。"); }
}
async function stopBackgroundProcessing() {
  processing = false;
  if (backgroundLoopTimer) cancelAnimationFrame(backgroundLoopTimer);
  if (segmentation) { try { await segmentation.close(); } catch {} segmentation = null; }
  segmentationReady = false;
  if (processedStream) {
    processedStream.getVideoTracks().forEach(t => t.stop());
    processedStream = null;
  }
  const cameraTrack = localStream?.getVideoTracks()[0] || null;
  for (const { pc } of peers.values()) {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
  }
  if (!screenStream && localStream) $("localVideo").srcObject = localStream;
}
function updateBackgroundUI() {
  document.querySelectorAll("[data-bg]").forEach(btn => btn.classList.toggle("selected", btn.dataset.bg === backgroundMode));
  $("backgroundStatus").textContent = backgroundMode === "none" ? "オフ" : backgroundMode === "blur" ? "背景ぼかし" : backgroundMode === "upload" ? "画像背景" : "プリセット背景";
}
$("backgroundToggle").onclick = () => $("backgroundPanel").classList.toggle("hidden");
document.querySelectorAll("[data-bg]").forEach(btn => btn.onclick = () => startBackgroundProcessing(btn.dataset.bg));
$("uploadBackgroundBtn").onclick = () => $("backgroundUpload").click();
$("backgroundUpload").onchange = e => {
  const file = e.target.files?.[0]; if (!file) return;
  if (!file.type.startsWith("image/")) { toast("画像ファイルを選択してください。"); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { if (backgroundImage) URL.revokeObjectURL(backgroundImage.src); backgroundImage = img; startBackgroundProcessing("upload"); };
  img.onerror = () => toast("画像を読み込めませんでした。");
  img.src = url;
};
$("themeBtn").onclick = () => {
  document.body.classList.toggle("cinema-mode");
  $("themeBtn").textContent = document.body.classList.contains("cinema-mode") ? "✧ 演出: ON" : "✧ 演出: OFF";
};
$("copyBtn").onclick = async () => {
  const url = location.origin + "/?room=" + encodeURIComponent(roomId);
  try { await navigator.clipboard.writeText(url); toast("招待リンクをコピーしました"); } catch { toast(url); }
};
$("leaveBtn").onclick = async () => {
  await stopBackgroundProcessing();
  peers.forEach(({pc}) => pc.close()); peers.clear();
  localStream?.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  socket.disconnect();
  location.href = "/";
};
socket.on("room:closed", ({ message } = {}) => {
  peers.forEach(({pc}) => pc.close()); peers.clear();
  localStream?.getTracks().forEach(track => track.stop()); localStream = null;
  if (screenStream) screenStream.getTracks().forEach(track => track.stop());
  roomId = null; selfId = null;
  $("meeting").classList.add("hidden");
  showHome();
  toast(message || "部屋が終了しました。");
});


// Premium interface motion: pointer light and cinematic intro.
window.addEventListener("DOMContentLoaded", () => {
  initAuth();
  const boot = $("bootScreen");
  if (boot) window.setTimeout(() => boot.classList.add("done"), 1050);
  const glow = $("pointerGlow");
  if (glow && matchMedia("(pointer:fine)").matches) {
    document.addEventListener("pointermove", event => {
      glow.style.left = event.clientX + "px";
      glow.style.top = event.clientY + "px";
      glow.style.opacity = "1";
    }, { passive: true });
    document.addEventListener("pointerleave", () => glow.style.opacity = "0");
  }
});
