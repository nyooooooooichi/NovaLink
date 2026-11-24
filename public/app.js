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
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun1.l.google.com:19302" }
  ],
  iceCandidatePoolSize: 8
};
let micOn = true, cameraOn = true;
let segmentation = null, backgroundMode = "none", backgroundImage = null;
let processedStream = null, processing = false, segmentationReady = false;
let sourceVideo = null, outputCanvas = null, outputCtx = null, frameBusy = false;
let selectedRoomId = null;
let roomRole = null;
let lifeGameState = null;

// Site-wide lobby notifications use Web Push so they can arrive while NovaLink is closed.
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
  const avatar = document.createElement("span");
  avatar.className = "lobby-message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = Array.from((message.name || "G").trim())[0] || "G";
  const top = document.createElement("div");
  top.className = "lobby-message-meta";
  const name = document.createElement("strong");
  name.textContent = message.name || "Guest";
  const time = document.createElement("time");
  time.dateTime = new Date(message.at).toISOString();
  time.textContent = formatLobbyTime(message.at);
  const body = document.createElement("p");
  body.textContent = message.text || "";
  top.append(name, time); row.append(avatar, top, body); box.append(row);
  while (box.children.length > 60) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
}
function updateLobbyNotifyButton() {
  const button = $("lobbyNotifyBtn"), hint = $("lobbyNotifyHint");
  if (!button || !hint) return;
  button.textContent = lobbyNotificationsEnabled ? "プッシュ通知：ON" : "プッシュ通知：OFF";
  button.classList.toggle("enabled", lobbyNotificationsEnabled);
  button.setAttribute("aria-pressed", String(lobbyNotificationsEnabled));
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) hint.textContent = "このブラウザはWeb Push通知に対応していません。";
  else if (lobbyNotificationsEnabled && Notification.permission === "granted") hint.textContent = "通知ON：NovaLinkを閉じていても新着通知を受け取れます。";
  else if (Notification.permission === "denied") hint.textContent = "通知がブロックされています。ブラウザまたは端末の設定で許可してください。";
  else hint.textContent = "通知をONにすると、サイトを閉じていてもホームチャットや通話ルームの通知が届きます。";
}
function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
function registerPushSubscription(subscription) {
  if (!subscription) return;
  socket.emit("push:subscribe", { subscription: subscription.toJSON() }, result => {
    if (!result?.ok) console.warn("Push registration failed:", result?.error);
  });
}
async function restorePushSubscription() {
  if (!lobbyNotificationsEnabled || !("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) registerPushSubscription(subscription);
  } catch (error) { console.warn("Push restore failed:", error); }
}
async function toggleLobbyNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return toast("このブラウザはプッシュ通知に対応していません。");
  if (lobbyNotificationsEnabled) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        socket.emit("push:unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      lobbyNotificationsEnabled = false;
      localStorage.setItem(lobbyNotifyKey, "off");
      updateLobbyNotifyButton();
      toast("プッシュ通知をOFFにしました。");
    } catch (_) { toast("通知を停止できませんでした。"); }
    return;
  }
  if (Notification.permission === "denied") return toast("端末またはブラウザの設定でNovaLinkの通知を許可してください。");
  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return toast("通知は許可されませんでした。");
    const response = await fetch("/api/push/public-key");
    const config = await response.json();
    if (!response.ok || !config.publicKey) throw new Error(config.error || "通知サーバーの設定が未完了です。");
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(config.publicKey) });
    await new Promise((resolve, reject) => socket.emit("push:subscribe", { subscription: subscription.toJSON() }, result => result?.ok ? resolve() : reject(new Error(result?.error || "通知登録に失敗しました。"))));
    lobbyNotificationsEnabled = true;
    localStorage.setItem(lobbyNotifyKey, "on");
    updateLobbyNotifyButton();
    toast("プッシュ通知を有効にしました。");
  } catch (error) {
    console.error("Push setup failed:", error);
    toast(error.message || "プッシュ通知の設定に失敗しました。");
    updateLobbyNotifyButton();
  }
}
socket.on("connect", restorePushSubscription);
function renderMeetingLobbyMessage(message) {
  const box = $("meetingLobbyMessages");
  if (!box || !message) return;
  box.querySelector(".system-message")?.remove();
  const row = document.createElement("article");
  row.className = "lobby-message";
  const avatar = document.createElement("span");
  avatar.className = "lobby-message-avatar";
  avatar.textContent = Array.from((message.name || "G").trim())[0] || "G";
  const meta = document.createElement("div");
  meta.className = "lobby-message-meta";
  const name = document.createElement("strong"); name.textContent = message.name || "Guest";
  const time = document.createElement("time"); time.textContent = formatLobbyTime(message.at || Date.now());
  const body = document.createElement("p"); body.textContent = message.text || "";
  meta.append(name, time); row.append(avatar, meta, body); box.append(row);
  while (box.children.length > 60) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
}
function setMeetingChatTab(tab) {
  const isRoom = tab === "room";
  $("roomChatTab").classList.toggle("active", isRoom);
  $("homeChatTab").classList.toggle("active", !isRoom);
  $("roomChatTab").setAttribute("aria-selected", String(isRoom));
  $("homeChatTab").setAttribute("aria-selected", String(!isRoom));
  $("meetingChatHeading").innerHTML = isRoom ? 'ROOM CHAT <span>● LIVE</span>' : 'HOME CHAT <span>● COMMUNITY</span>';
  $("chatMessages").classList.toggle("hidden", !isRoom);
  $("meetingLobbyMessages").classList.toggle("hidden", isRoom);
  $("roomEmojiBar").classList.toggle("hidden", !isRoom);
  $("chatForm").classList.toggle("hidden", !isRoom);
  $("meetingLobbyForm").classList.toggle("hidden", isRoom);
  if (isRoom) $("chatInput").focus({ preventScroll: true });
  else $("meetingLobbyInput").focus({ preventScroll: true });
}
$("roomChatTab").addEventListener("click", () => setMeetingChatTab("room"));
$("homeChatTab").addEventListener("click", () => setMeetingChatTab("home"));
$("meetingLobbyForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("meetingLobbyInput");
  const message = input.value.trim();
  if (!message) return;
  socket.emit("lobby:send", { text: message, name: lobbyDisplayName() });
  input.value = "";
  input.focus();
});
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
  const meetingBox = $("meetingLobbyMessages");
  if (meetingBox) {
    meetingBox.innerHTML = "";
    if (!messages?.length) {
      const empty = document.createElement("div"); empty.className = "system-message";
      empty.textContent = "まだメッセージはありません。最初のメッセージを送りましょう。"; meetingBox.append(empty);
    } else messages.forEach(renderMeetingLobbyMessage);
  }
});
socket.on("lobby:message", message => {
  renderLobbyMessage(message);
  renderMeetingLobbyMessage(message);
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

function setMainPage(page) {
  const callHome = $("home");
  const community = $("communityPage");
  const browser = $("roomBrowser");
  if (browser) browser.classList.add("hidden");
  if (page === "community") {
    callHome?.classList.add("hidden");
    community?.classList.remove("hidden");
  } else {
    community?.classList.add("hidden");
    callHome?.classList.remove("hidden");
  }
  $("callHomeNav")?.classList.toggle("active", page !== "community");
  $("communityNav")?.classList.toggle("active", page === "community");
}
$("callHomeNav")?.addEventListener("click", () => setMainPage("call"));
$("communityNav")?.addEventListener("click", () => setMainPage("community"));
document.querySelectorAll(".password-toggle").forEach(button => {
  button.addEventListener("click", () => {
    const input = $(button.dataset.passwordTarget);
    if (!input) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.textContent = reveal ? "隠す" : "表示";
    button.setAttribute("aria-label", reveal ? "パスワードを隠す" : "パスワードを表示");
  });
});

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
  $("communityPage")?.classList.add("hidden");
  $("callHomeNav")?.classList.remove("active");
  $("communityNav")?.classList.remove("active");
  browser.classList.remove("hidden");
  loadRooms();
}
function showHome() {
  const home = $("home") || document.querySelector(".hero");
  const browser = $("roomBrowser");
  const joinPanel = $("roomJoinPanel");
  if (browser) browser.classList.add("hidden");
  if (home) home.classList.remove("hidden");
  $("communityPage")?.classList.add("hidden");
  $("callHomeNav")?.classList.add("active");
  $("communityNav")?.classList.remove("active");
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

let mediaAcquisitionPromise = null;
async function acquireMedia() {
  if (localStream?.getTracks().some(track => track.readyState === "live")) return true;
  if (mediaAcquisitionPromise) return mediaAcquisitionPromise;
  mediaAcquisitionPromise = (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではカメラ機能を利用できません。");
      }
      // iPhoneでは前面カメラを優先し、画面内再生に必要な属性も明示する。
      const videoConstraints = { facingMode: { ideal: "user" } };
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
      } catch (combinedError) {
        console.warn("Camera + microphone request failed; retrying camera only:", combinedError);
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        } catch (idealCameraError) {
          console.warn("Ideal front camera request failed; retrying generic camera:", idealCameraError);
          localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        toast("カメラは接続しました。マイクの許可を確認してください。");
      }
      const source = $("cameraSource");
      const preview = $("localVideo");
      source.muted = true;
      source.autoplay = true;
      source.playsInline = true;
      preview.muted = true;
      preview.autoplay = true;
      preview.playsInline = true;
      source.srcObject = localStream;
      preview.srcObject = localStream;
      await source.play().catch(error => console.debug("Camera source autoplay deferred:", error));
      return true;
    } catch (e) {
      console.warn("NovaLink camera initialization failed:", e);
      localStream?.getTracks().forEach(track => track.stop());
      localStream = null;
      const message = e?.name === "NotAllowedError"
        ? "カメラ・マイクの許可が必要です。iPhoneの設定とブラウザのサイト設定を確認してください。"
        : e?.name === "NotFoundError"
          ? "利用できるカメラまたはマイクが見つかりません。"
          : e?.name === "NotReadableError"
            ? "カメラが他のアプリで使用中の可能性があります。"
            : e?.message || "カメラ・マイクを利用できません。";
      toast(message);
      return false;
    } finally {
      mediaAcquisitionPromise = null;
    }
  })();
  return mediaAcquisitionPromise;
}
function enterMeeting(result, name, role) {
  selfId = result.selfId;
  roomId = result.roomId;
  roomRole = role;
  socket.emit("push:context", { roomId: result.roomId });
  lifeGameState = null;
  $("roomBrowser").classList.add("hidden");
  $("home").classList.add("hidden");
  $("meeting").classList.remove("hidden");
  document.querySelector(".topbar")?.classList.add("is-in-meeting");
  const localPreview = $("localVideo");
  if (localStream) {
    localPreview.muted = true;
    localPreview.autoplay = true;
    localPreview.playsInline = true;
    localPreview.srcObject = localStream;
    // iOS Safari may suspend playback while its parent was display:none.
    requestAnimationFrame(() => {
      localPreview.play().catch(error => {
        console.warn("Local camera preview playback was blocked:", error);
      });
    });
  }
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
let roomCreationInProgress = false;
async function createRoom() {
  if (roomCreationInProgress) return;
  const roomName = $("createRoomName").value.trim();
  const password = $("createRoomPassword").value;
  const name = $("displayName").value.trim() || "Host";
  if (password.length < 4 || password.length > 64) return toast("パスワードは4〜64文字で設定してください。");

  const button = $("hostBtn");
  const originalLabel = button.innerHTML;
  roomCreationInProgress = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "カメラを準備中…";
  try {
    if (!await acquireMedia()) return;
    button.textContent = "ルームを作成中…";
    const response = await new Promise(resolve => {
      socket.timeout(20000).emit("room:create", { roomName, password, name }, (error, result) => {
        if (error) return resolve({ ok: false, error: "サーバーから応答がありません。通信状態を確認して、もう一度お試しください。" });
        resolve(result || { ok: false, error: "部屋を作成できませんでした。" });
      });
    });
    if (!response?.ok) {
      localStream?.getTracks().forEach(track => track.stop());
      localStream = null;
      $("cameraSource").srcObject = null;
      $("localVideo").srcObject = null;
      return toast(response?.error || "部屋を作成できませんでした。");
    }
    $("createRoomPassword").value = "";
    enterMeeting(response, name, "host");
  } catch (error) {
    console.error("Room creation failed:", error);
    localStream?.getTracks().forEach(track => track.stop());
    localStream = null;
    $("cameraSource").srcObject = null;
    $("localVideo").srcObject = null;
    toast("部屋の作成中にエラーが発生しました。通信状態を確認してください。");
  } finally {
    roomCreationInProgress = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = originalLabel;
  }
}
let roomJoinInProgress = false;
async function joinSelectedRoom() {
  if (roomJoinInProgress) return;
  if (!selectedRoomId) return toast("参加する部屋を選択してください。");
  const password = $("roomPassword").value;
  if (!password) return toast("パスワードを入力してください。");
  const name = $("displayName").value.trim() || "Guest";
  const button = $("selectedRoomJoinBtn");
  const originalLabel = button.textContent;
  roomJoinInProgress = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "カメラを準備中…";
  try {
    if (!await acquireMedia()) return;
    button.textContent = "部屋に接続中…";
    const result = await new Promise(resolve => {
      socket.timeout(15000).emit("room:join", { roomId: selectedRoomId, password, name }, (error, response) => {
        if (error) return resolve({ ok: false, error: "接続に時間がかかっています。通信状態を確認して、もう一度お試しください。" });
        resolve(response || { ok: false, error: "参加できませんでした。もう一度お試しください。" });
      });
    });
    if (!result?.ok) {
      localStream?.getTracks().forEach(track => track.stop());
      localStream = null;
      $("cameraSource").srcObject = null;
      $("localVideo").srcObject = null;
      return toast(result?.error || "参加できませんでした。");
    }
    $("roomPassword").value = "";
    enterMeeting(result, name, "guest");
  } catch (error) {
    console.error("Room join failed:", error);
    toast("参加中にエラーが発生しました。通信状態を確認してください。");
  } finally {
    roomJoinInProgress = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = originalLabel;
  }
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
  peers.set(id, { pc, name, pendingCandidates: [] });
  const stream = outgoingStream();
  const cameraTrack = stream?.getVideoTracks()[0];
  const audioTracks = stream?.getAudioTracks() || [];
  // Send camera and microphone in the same MediaStream. This keeps the
  // stream association stable on iOS WebKit and avoids one track replacing another.
  if (cameraTrack) pc.addTrack(cameraTrack, stream);
  audioTracks.forEach(track => pc.addTrack(track, stream));
  const screenMediaStream = new MediaStream();
  const screenTransceiver = pc.addTransceiver("video", { direction: "sendrecv", streams: [screenMediaStream] });
  peers.get(id).screenSender = screenTransceiver.sender;
  if (screenStream?.getVideoTracks()[0]) await screenTransceiver.sender.replaceTrack(screenStream.getVideoTracks()[0]);

  // Reserve a separate audio sender for captured tab/system audio. This avoids
  // renegotiating the peer connection after the user starts sharing.
  const screenAudioMediaStream = new MediaStream();
  const screenAudioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv", streams: [screenAudioMediaStream] });
  peers.get(id).screenAudioSender = screenAudioTransceiver.sender;
  const existingScreenAudio = screenStream?.getAudioTracks?.()[0];
  if (existingScreenAudio) await screenAudioTransceiver.sender.replaceTrack(existingScreenAudio);
  pc.onicecandidate = e => { if (e.candidate) socket.emit("signal", { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = e => {
    const track = e.track;
    const incomingStream = e.streams?.[0] || new MediaStream([track]);

    // Audio and video are sent as separate streams. Never let an audio-only
    // stream replace the camera video element (especially on iOS Safari).
    if (track.kind === "audio") {
      const peer = peers.get(id);
      if (!peer) return;
      if (!peer.audio) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("autoplay", "");
        audio.setAttribute("playsinline", "");
        audio.style.display = "none";
        document.body.append(audio);
        peer.audio = audio;
      }
      peer.audio.srcObject = incomingStream;
      peer.audio.play().catch(error => {
        console.warn("Remote audio playback needs user interaction:", error);
      });
      return;
    }

    if (track.kind === "video") {
      const isScreen = e.transceiver === screenTransceiver;
      addVideo(id, name, incomingStream, isScreen);
      // WebKit can deliver the track before its first frame is available.
      // Retry playback when the remote track becomes unmuted.
      track.addEventListener("unmute", () => {
        const tile = document.getElementById("tile-" + id);
        const target = tile?.querySelector(isScreen ? ".screen-feed" : ".camera-feed");
        if (target && target.srcObject) target.play().catch(error => {
          console.warn("Remote video playback is still waiting:", error);
        });
      });
    }
  };
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
    const camera = document.createElement("video");
    camera.className = "camera-feed";
    camera.autoplay = true;
    camera.muted = true;
    camera.playsInline = true;
    camera.setAttribute("autoplay", "");
    camera.setAttribute("muted", "");
    camera.setAttribute("playsinline", "");
    const screen = document.createElement("video");
    screen.className = "screen-feed";
    screen.autoplay = true;
    screen.muted = true;
    screen.playsInline = true;
    screen.setAttribute("autoplay", "");
    screen.setAttribute("muted", "");
    screen.setAttribute("playsinline", "");
    tile.append(camera, screen);
    const label = document.createElement("span"); label.className = "video-name"; label.textContent = name; tile.append(label);
    const expand = document.createElement("button"); expand.className = "tile-expand"; expand.textContent = "⛶"; expand.title = "全画面表示";
    expand.onclick = () => toggleFullscreen(tile); tile.append(expand);
    $("videoGrid").append(tile);
  }
  const video = tile.querySelector(isScreen ? ".screen-feed" : ".camera-feed");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("autoplay", "");
  video.setAttribute("playsinline", "");
  video.srcObject = stream;
  const startPlayback = () => {
    if (!video.srcObject) return;
    video.play().catch(error => {
      console.warn("Remote video playback deferred:", error);
    });
  };
  // Try immediately and again at the media readiness milestones used by iOS.
  startPlayback();
  ["loadedmetadata", "loadeddata", "canplay"].forEach(eventName => {
    video.addEventListener(eventName, startPlayback, { once: true });
  });
  video.srcObject.getVideoTracks?.().forEach(track => {
    if (track.readyState === "live" && !track.muted) startPlayback();
    track.addEventListener("unmute", startPlayback, { once: true });
  });
  if (isScreen) tile.classList.add("has-screen");
}
function toggleFullscreen(element) {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else element.requestFullscreen?.().catch(() => toast("全画面表示を開始できませんでした。"));
}
$("selfFullscreen").onclick = () => toggleFullscreen($("selfTile"));
function removePeer(id) {
  const peer = peers.get(id);
  if (peer) {
    peer.pc.close();
    if (peer.audio) {
      peer.audio.pause();
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
  }
  peers.delete(id);
  document.getElementById("tile-" + id)?.remove();
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
let lifeLastRollAt = 0;
let lifeMoveAnimation = null;
const lifeDiceFaces = ["⚀","⚁","⚂","⚃","⚄","⚅"];
function animateLifeDice(value, playerName) {
  const stage = $("lifeDiceStage"), face = $("lifeDice"), caption = $("lifeDiceCaption");
  if (!stage || !face) return;
  if (stage._diceTimer) clearInterval(stage._diceTimer);
  if (stage._diceEnd) clearTimeout(stage._diceEnd);
  stage.classList.remove("rolling"); void stage.offsetWidth; stage.classList.add("rolling");
  stage._diceTimer = setInterval(() => { face.textContent = lifeDiceFaces[Math.floor(Math.random()*6)]; }, 65);
  stage._diceEnd = setTimeout(() => {
    clearInterval(stage._diceTimer); stage._diceTimer = null;
    face.textContent = lifeDiceFaces[Math.max(1,Math.min(6,value))-1];
    caption.textContent = playerName + " · " + value + " マス";
    stage.classList.remove("rolling");
  }, 720);
}
function animateLifePlayerMove(game) {
  const move = game && game.lastRoll;
  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to) || move.to <= move.from) return;
  const board = $("lifeBoard"), player = game.players.find(p=>p.id===move.playerId);
  const startCell = board && board.querySelector('[data-life-tile="' + move.from + '"]');
  const endCell = board && board.querySelector('[data-life-tile="' + move.to + '"]');
  const target = endCell && endCell.querySelector('[data-life-player="' + CSS.escape(move.playerId) + '"]');
  if (!startCell || !endCell || !target) return;
  if (lifeMoveAnimation) { lifeMoveAnimation.cancel(); lifeMoveAnimation = null; }
  const startRect = startCell.getBoundingClientRect();
  const startX = startRect.left + startRect.width/2 - 17, startY = startRect.top + startRect.height/2 - 17;
  const ghost = document.createElement("div");
  ghost.className = "life-moving-token " + target.className;
  ghost.textContent = (player && player.name || "?").slice(0,1);
  ghost.style.left = startX + "px"; ghost.style.top = startY + "px";
  document.body.append(ghost); target.style.visibility = "hidden";
  const frames = [], distance = move.to - move.from;
  for (let step=1; step<=distance; step++) {
    const cell = board.querySelector('[data-life-tile="' + (move.from+step) + '"]');
    if (!cell) continue;
    const rect = cell.getBoundingClientRect();
    const x = rect.left + rect.width/2 - 17 - startX, y = rect.top + rect.height/2 - 17 - startY;
    frames.push({ transform: "translate3d(" + x + "px," + y + "px,0) scale(" + (step===distance?1.12:1.04) + ")", offset: step/distance });
  }
  if (!frames.length) { ghost.remove(); target.style.visibility=""; return; }
  lifeMoveAnimation = ghost.animate([{transform:"translate3d(0,0,0) scale(.8)"},...frames], {duration:Math.max(500,distance*230),easing:"cubic-bezier(.22,.75,.25,1)",fill:"forwards"});
  lifeMoveAnimation.onfinish = () => { ghost.remove(); target.style.visibility=""; lifeMoveAnimation=null; };
  lifeMoveAnimation.oncancel = () => { ghost.remove(); target.style.visibility=""; };
}
function renderLifeGame() {
  const game = lifeGameState;
  const create = $("lifeCreateBtn"), join = $("lifeJoinBtn"), ready = $("lifeReadyBtn");
  const start = $("lifeStartBtn"), roll = $("lifeRollBtn");
  const board = $("lifeBoard"), playersBox = $("lifePlayers");
  const nowTitle = $("lifeNowTitle"), nowText = $("lifeNowText"), nowIcon = $("lifeNowIcon");
  const diceStage = $("lifeDiceStage"), dice = $("lifeDice");
  if (!game) {
    $("lifeStatus").textContent = "ゲーム未作成";
    $("lifeTurnLabel").textContent = "ホストがゲームを作成してください";
    nowTitle.textContent = "ゲームを始めよう";
    nowText.textContent = roomRole === "host" ? "「ゲームを作成」→ CPUや友達を追加 → 全員が準備OKで開始。" : "ホストがゲームを作成すると参加できます。";
    nowIcon.textContent = "✦";
    dice.textContent = "⚄"; $("lifeDiceCaption").textContent = "DICE";
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
  const humanCount = game.players.filter(player => !player.isCpu).length;
  const cpuCount = game.players.filter(player => player.isCpu).length;
  $("lifeStatus").textContent = game.status === "lobby" ? "参加者募集中" : game.status === "playing" ? "ゲーム進行中" : "ゲーム終了";
  $("lifeTurnLabel").textContent = game.status === "lobby" ? "人間 " + humanCount + "人 · CPU " + cpuCount + "人" :
    game.status === "playing" ? "第" + game.turnNumber + "ターン" : "最終結果が確定しました";
  create.hidden = true;
  join.hidden = !(game.status === "lobby" && !me);
  ready.hidden = !(game.status === "lobby" && !!me);
  ready.textContent = me?.ready ? "準備を解除" : "準備OK";
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
  if (game.status === "lobby") {
    nowTitle.textContent = "参加者を待っています";
    nowText.textContent = "プレイヤーは「準備OK」を押してください。CPUは自動で参加し、ホストが「ゲーム開始」を押すとスタートします。";
    nowIcon.textContent = "👥";
  } else if (game.status === "finished") {
    const ranking = [...game.players].sort((a,b)=>b.cash-a.cash);
    nowTitle.textContent = "人生ゲーム終了！ " + (ranking[0]?.name || "—") + " が資産トップ";
    nowText.textContent = "最終資産 " + lifeMoney(ranking[0]?.cash || 0) + "。プレイヤー一覧で全員の結果を確認できます。";
    nowIcon.textContent = "🏆";
  } else if (game.currentEvent) {
    const eventPlayer = game.players.find(p=>p.id===game.currentEvent.playerId);
    nowTitle.textContent = (eventPlayer?.name || "プレイヤー") + " にイベント発生！";
    nowText.textContent = game.currentEvent.title + "。下のイベント欄から選択すると、結果が反映されて次の人へ進みます。";
    nowIcon.textContent = "❗";
  } else if (active) {
    nowTitle.textContent = active.id === selfId ? "あなたの番です！" : active.name + " の番です";
    nowText.textContent = active.id === selfId ? "「サイコロを振る」を押してください。出た目の数だけ進み、止まったマスの効果が発生します。" : (active.isCpu ? "CPUがサイコロを振って行動しています。少し待つと結果が表示されます。" : "相手がサイコロを振るのを待っています。");
    nowIcon.textContent = "🎲";
  }
  if (game.lastRoll) {
    dice.textContent = ["⚀","⚁","⚂","⚃","⚄","⚅"][Math.max(1,Math.min(6,game.lastRoll.value))-1];
    $("lifeDiceCaption").textContent = game.lastRoll.playerName + " · " + game.lastRoll.value + " マス";
    if (game.lastRoll.at !== lifeLastRollAt) {
      lifeLastRollAt = game.lastRoll.at;
      animateLifeDice(game.lastRoll.value, game.lastRoll.playerName);
    }
  } else {
    dice.textContent = "⚄"; $("lifeDiceCaption").textContent = "DICE";
  }
  board.innerHTML = "";
  const boardColumns = window.matchMedia("(max-width: 620px)").matches ? 4 : 8;
  const tileLabels = {start:"START",finish:"GOAL",salary:"給料",event:"イベント",bonus:"ボーナス",expense:"出費",choice:"選択",career:"仕事",investment:"投資"};
  game.board.forEach(tile => {
    const cell = document.createElement("div");
    const row = Math.floor(tile.id / boardColumns), column = tile.id % boardColumns;
    cell.style.gridRow = String(row + 1);
    cell.style.gridColumn = String(row % 2 === 0 ? column + 1 : boardColumns - column);
    cell.dataset.lifeTile = String(tile.id);
    cell.className = "life-tile life-tile-" + tile.type + (game.players.some(p=>p.position===tile.id && p.id===active?.id) ? " is-current-tile" : "");
    const number = document.createElement("small"); number.textContent = tile.id === 0 ? "START" : tile.id === game.board.length - 1 ? "GOAL" : String(tile.id).padStart(2,"0") + " · " + (tileLabels[tile.type] || "マス");
    const title = document.createElement("strong"); title.textContent = tile.title;
    cell.append(number, title);
    const occupants = game.players.filter(player => player.position === tile.id);
    if (occupants.length) {
      const tokens = document.createElement("div"); tokens.className = "life-tokens";
      occupants.forEach(player => {
        const token = document.createElement("span"); token.className = "life-token life-token-" + (game.players.indexOf(player) % 10);
        token.title = player.name; token.dataset.lifePlayer = player.id; token.textContent = (player.name || "?").slice(0,1);
        tokens.append(token);
      });
      cell.append(tokens);
    }
    board.append(cell);
  });
  playersBox.innerHTML = "";
  game.players.forEach((player, index) => {
    const card = document.createElement("article");
    card.className = "life-player-card" + (active?.id === player.id && game.status === "playing" ? " is-active" : "") + (player.finished ? " is-finished" : "");
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
      const waiting = document.createElement("p"); waiting.className = "life-muted"; waiting.textContent = (game.players.find(p => p.id === event.playerId)?.name || "プレイヤー") + " が選択中です。選択が終わると自動で次の人に進みます。"; choices.append(waiting);
    }
  }
}
socket.on("life:state", game => {
  const previousRollAt = lifeGameState?.lastRoll?.at;
  lifeGameState = game || null;
  renderLifeGame();
  if (game?.lastRoll?.at && game.lastRoll.at !== previousRollAt) requestAnimationFrame(() => animateLifePlayerMove(game));
});
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
      // ICE candidates may arrive before the offer/answer on slower mobile
      // networks. Apply queued candidates only after the remote description.
      const queued = peer.pendingCandidates || [];
      peer.pendingCandidates = [];
      for (const candidate of queued) {
        try { await pc.addIceCandidate(candidate); }
        catch (candidateError) { console.warn("Queued ICE candidate rejected:", candidateError); }
      }
      if (data.description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription?.type) {
        await pc.addIceCandidate(data.candidate);
      } else {
        peer.pendingCandidates ||= [];
        peer.pendingCandidates.push(data.candidate);
      }
    }
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
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast("このブラウザでは画面共有に対応していません。");
    return;
  }
  const button = $("shareBtn");
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.querySelector("span").textContent = "共有を準備中…";
  try {
    await stopBackgroundProcessing();
    backgroundMode = "none";
    updateBackgroundUI();

    // Request a crisp desktop capture without lowering the source resolution.
    // Browsers may choose the actual capture mode based on the selected source.
    const capturedStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: true
    });
    const track = capturedStream.getVideoTracks()[0];
    if (!track) {
      capturedStream.getTracks().forEach(item => item.stop());
      throw new Error("画面映像を取得できませんでした。");
    }
    track.contentHint = "detail";
    screenStream = capturedStream;

    const screenAudioTrack = capturedStream.getAudioTracks()[0] || null;
    await Promise.all([...peers.values()].map(async peer => {
      if (peer.screenSender) await peer.screenSender.replaceTrack(track);
      if (peer.screenAudioSender) await peer.screenAudioSender.replaceTrack(screenAudioTrack);
    }));

    let preview = $("selfTile").querySelector(".self-screen-preview");
    if (!preview) {
      preview = document.createElement("video"); preview.className = "self-screen-preview";
      preview.autoplay = true; preview.playsInline = true; preview.muted = true;
      preview.setAttribute("autoplay", "");
      preview.setAttribute("playsinline", "");
      preview.muted = true;
      $("selfTile").append(preview);
    }
    preview.srcObject = capturedStream;
    preview.play().catch(() => {});
    $("selfTile").classList.add("sharing-screen");
    $("stopShareBtn").classList.remove("hidden");
    button.classList.add("active");
    button.querySelector("span").textContent = "共有中";
    track.onended = stopShare;
    toast(screenAudioTrack ? "高画質画面共有・共有音声を開始しました。" : "高画質画面共有を開始しました。");
  } catch (e) {
    console.warn("Screen share failed:", e);
    screenStream?.getTracks().forEach(track => track.stop());
    screenStream = null;
    if (e?.name === "NotAllowedError") toast("画面共有がキャンセルされました。");
    else toast(e?.message || "画面共有を開始できませんでした。");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (!screenStream) button.innerHTML = originalLabel;
  }
};
$("stopShareBtn").onclick = stopShare;
async function stopShare() {
  if (!screenStream) return;
  const streamToStop = screenStream; screenStream = null;
  await Promise.all([...peers.values()].map(async peer => {
    try {
      if (peer.screenSender) await peer.screenSender.replaceTrack(null);
      if (peer.screenAudioSender) await peer.screenAudioSender.replaceTrack(null);
    } catch (error) {
      console.warn("Could not detach a screen-share track:", error);
    }
  }));
  streamToStop.getTracks().forEach(t => t.stop());
  const preview = $("selfTile").querySelector(".self-screen-preview");
  if (preview) { preview.srcObject = null; preview.remove(); }
  $("selfTile").classList.remove("sharing-screen");
  $("stopShareBtn").classList.add("hidden");
  $("shareBtn").classList.remove("active");
  $("shareBtn").querySelector("span").textContent = "画面共有";
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
async function cleanupMeetingAndReturnHome() {
  await stopBackgroundProcessing();
  peers.forEach(({ pc, audio }) => {
    pc.close();
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
  });
  peers.clear();
  localStream?.getTracks().forEach(track => track.stop());
  localStream = null;
  if (screenStream) screenStream.getTracks().forEach(track => track.stop());
  screenStream = null;
  $("cameraSource").srcObject = null;
  $("localVideo").pause();
  $("localVideo").srcObject = null;
  document.querySelectorAll("#videoGrid .video-tile:not(#selfTile)").forEach(tile => tile.remove());
  $("selfTile").classList.remove("sharing-screen");
  $("stopShareBtn").classList.add("hidden");
  $("shareBtn").classList.remove("active");
  $("meeting").classList.add("hidden");
  document.querySelector(".topbar")?.classList.remove("is-in-meeting");
  $("lifeGamePanel").classList.add("hidden");
  roomId = null; selfId = null; roomRole = null; lifeGameState = null;
  showHome();
}
$("leaveBtn").onclick = () => {
  $("leaveBtn").disabled = true;
  socket.timeout(5000).emit("room:leave", {}, async () => {
    await cleanupMeetingAndReturnHome();
    $("leaveBtn").disabled = false;
    toast("通話を退出しました。");
  });
};
socket.on("room:closed", async ({ message } = {}) => {
  await cleanupMeetingAndReturnHome();
  toast(message || "部屋が終了しました。");
});


// NovaLink cinematic boot: visuals always start; audio gracefully follows browser policy.
const runNovaBoot = () => {
  const boot = $("bootScreen");
  if (!boot || boot.dataset.bootStarted === "1") return;
  try { initAuth(); } catch (error) { console.error("NovaLink auth initialization:", error); }
  let audioContext = null, masterGain = null, reverb = null, audioStarted = false, bootStartedAt = 0;
  const updateBoot = (message, value, activeStep) => {
    const status=$("bootStatus"), percent=$("bootPercent"), fill=$("bootProgressFill");
    const steps=boot.querySelectorAll(".boot-progress-steps span");
    if(status)status.textContent=message;if(percent)percent.textContent=String(value).padStart(2,"0")+"%";
    if(fill)fill.style.width=value+"%";steps.forEach((step,index)=>step.classList.toggle("active",index<=activeStep));
  };
  const createAudioGraph = () => {
    const AudioCtor=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtor)return false;
    if(audioContext)return true;
    audioContext=new AudioCtor();
    masterGain=audioContext.createGain();masterGain.gain.value=.72;
    const compressor=audioContext.createDynamicsCompressor();
    compressor.threshold.value=-18;compressor.knee.value=16;compressor.ratio.value=4;
    compressor.attack.value=.006;compressor.release.value=.22;
    reverb=audioContext.createConvolver();
    const len=Math.floor(audioContext.sampleRate*1.25);
    const impulse=audioContext.createBuffer(2,len,audioContext.sampleRate);
    for(let ch=0;ch<2;ch++){
      const data=impulse.getChannelData(ch);
      for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.5)*.24;
    }
    reverb.buffer=impulse;
    const wet=audioContext.createGain();wet.gain.value=.16;
    reverb.connect(wet);wet.connect(compressor);
    masterGain.connect(compressor);compressor.connect(audioContext.destination);
    return true;
  };
  const tone=(f,at,duration,volume,type="sine",endFrequency=null,wet=true)=>{
    if(!audioContext||!masterGain)return;
    const osc=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
    osc.type=type;osc.frequency.setValueAtTime(Math.max(20,f),now+at);
    if(endFrequency)osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),now+at+duration);
    gain.gain.setValueAtTime(.0001,now+at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),now+at+Math.min(.045,duration*.2));
    gain.gain.exponentialRampToValueAtTime(.0001,now+at+duration);
    osc.connect(gain);gain.connect(masterGain);if(wet&&reverb)gain.connect(reverb);
    osc.start(now+at);osc.stop(now+at+duration+.03);
  };
  const sweep=(at,duration,volume,low,high)=>{
    if(!audioContext||!masterGain)return;
    const len=Math.max(1,Math.floor(audioContext.sampleRate*duration));
    const buffer=audioContext.createBuffer(1,len,audioContext.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);
    const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain(),now=audioContext.currentTime;
    source.buffer=buffer;filter.type="lowpass";filter.frequency.setValueAtTime(low,now+at);
    filter.frequency.exponentialRampToValueAtTime(high,now+at+duration);filter.Q.value=.7;
    gain.gain.setValueAtTime(.0001,now+at);gain.gain.linearRampToValueAtTime(volume,now+at+duration*.22);
    gain.gain.exponentialRampToValueAtTime(.0001,now+at+duration);
    source.connect(filter);filter.connect(gain);gain.connect(masterGain);if(reverb)gain.connect(reverb);
    source.start(now+at);
  };
  const playBootSound=()=>{
    if(audioStarted||!audioContext)return;
    audioStarted=true;
    // Original layered sci-fi startup score: reactor pulse, harmonic scan,
    // encrypted handshake, then a clean launch signature.
    const t=(f,at,duration,volume,type="sine",endFrequency=null,wet=true)=>tone(f,at,duration,volume,type,endFrequency,wet);
    const s=(at,duration,volume,low,high)=>sweep(at,duration,volume,low,high);
    // Reactor ignition: immediate low-frequency impact and an opening engine bed.
    t(34,0,2.1,.42,"sine",27,false);
    t(68,.015,1.65,.18,"triangle",42,false);
    t(102,.08,1.3,.085,"sawtooth",58);
    s(.025,1.55,.13,90,1700);
    t(55,.22,2.7,.11,"sine",49,false);
    // Core wakes up: glassy harmonic ladder and a subtle shimmer.
    [130.81,196,261.63,392,523.25,783.99].forEach((f,i)=>{
      t(f,.72+i*.13,1.25,.072-i*.006,"sine");
      t(f*2,.78+i*.13,.82,.018,"triangle",null,true);
    });
    [0,.16,.32,.48,.64].forEach((v,i)=>{
      t(740+i*145,1.48+v,.19,.035,"sine",980+i*175,false);
      t(92+i*13,1.5+v,.23,.055,"triangle",null,false);
    });
    s(1.55,1.05,.075,280,6800);
    // Security handshake: three precise digital pings and a resolved chord.
    [0,.22,.44].forEach((v,i)=>{
      t(1174.66-i*130,2.55+v,.16,.052,"sine",null,false);
      t(587.33-i*65,2.57+v,.24,.045,"triangle",null,true);
    });
    t(261.63,3.02,1.35,.105,"sine");
    t(329.63,3.08,1.42,.095,"sine");
    t(392,3.14,1.48,.09,"sine");
    t(523.25,3.2,1.35,.055,"triangle");
    t(49,3.0,1.55,.2,"sine",32,false);
    // Launch: rising air sweep, sub impact, then a short signature chime.
    s(4.02,1.02,.22,160,10500);
    t(73.42,4.05,1.0,.34,"sine",29,false);
    t(146.83,4.08,.9,.14,"triangle",58,false);
    t(987.77,4.22,.72,.065,"sine");
    t(1318.51,4.3,.8,.045,"sine");
    t(1760,4.42,.62,.025,"sine");
  };
  const startButton = $("bootStartButton");
  const startBoot = () => {
    if (boot.dataset.bootStarted === "1") return;
    boot.dataset.bootStarted = "1";
    if (startButton) startButton.disabled = true;
    // The click/tap is the browser-approved audio gesture. Start sound and visuals in this same event.
    bootStartedAt = performance.now();
    try {
      if (createAudioGraph()) {
        const resumed = audioContext.resume();
        playBootSound();
        Promise.resolve(resumed).catch(error => console.warn("NovaLink audio resume failed:", error));
      }
    } catch (error) {
      console.warn("NovaLink audio could not start:", error);
    }
    boot.classList.remove("done");
    boot.classList.add("sequence-start");
    updateBoot("POWERING NOVA CORE",12,0);
    window.setTimeout(()=>updateBoot("SYNCHRONIZING NETWORK",34,1),1150);
    window.setTimeout(()=>{boot.classList.add("sequence-lock");updateBoot("AUTHENTICATING SECURE CHANNEL",68,2);},2650);
    window.setTimeout(()=>updateBoot("ALL SYSTEMS NOMINAL",88,2),3650);
    window.setTimeout(()=>{boot.classList.add("sequence-launch");updateBoot("WELCOME TO NOVALINK",100,2);},4100);
    window.setTimeout(()=>{boot.classList.add("done");},5150);
  };
  if (startButton) startButton.addEventListener("click", startBoot);

};
const setupNovaPointerGlow = () => {
  const glow = $("pointerGlow");
  if (glow && matchMedia("(pointer:fine)").matches) {
    document.addEventListener("pointermove", event => {
      glow.style.left = event.clientX + "px";
      glow.style.top = event.clientY + "px";
      glow.style.opacity = "1";
    }, { passive: true });
    document.addEventListener("pointerleave", () => glow.style.opacity = "0");
  }
};
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", runNovaBoot, { once: true });
  window.addEventListener("DOMContentLoaded", setupNovaPointerGlow, { once: true });
} else {
  runNovaBoot();
  setupNovaPointerGlow();
}
