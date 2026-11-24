const socket = io();
const $ = (id) => document.getElementById(id);
let localStream = null, screenStream = null, roomId = null, selfId = null;
const peers = new Map();
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let micOn = true, cameraOn = true;
let segmentation = null, backgroundMode = "none", backgroundImage = null;
let processedStream = null, processing = false, segmentationReady = false;
let sourceVideo = null, outputCanvas = null, outputCtx = null, frameBusy = false;

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2400);
}
function randomId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
$("randomRoom").onclick = () => $("roomId").value = randomId();

async function join(role = "guest") {
  const name = $("displayName").value.trim() || "Guest";
  roomId = role === "host" ? randomId() : $("roomId").value.trim();
  if (!roomId) { toast("参加するルームIDを入力してください。"); return; }
  $("roomId").value = roomId;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    toast("カメラ・マイクを利用できません。ブラウザの権限を確認してください。");
    return;
  }
  $("cameraSource").srcObject = localStream;
  await $("cameraSource").play().catch(() => {});
  $("localVideo").srcObject = localStream;
  socket.emit("room:join", { roomId, name, role }, async (result) => {
    if (!result?.ok) { localStream.getTracks().forEach(t => t.stop()); localStream = null; toast(result?.error || "参加できませんでした。"); return; }
    selfId = result.selfId;
    $("home").classList.add("hidden");
    $("meeting").classList.remove("hidden");
    $("meetingTitle").textContent = name + (role === "host" ? " のルーム" : " が参加中");
    $("roomLabel").textContent = "ROOM / " + roomId;
    $("memberCount").textContent = result.peers.length + 1;
    updateParticipants(name, result.peers);
    $("selfName").textContent = name + (role === "host" ? " · HOST" : " · GUEST");
    history.replaceState({}, "", "/?room=" + encodeURIComponent(roomId));
    for (const peer of result.peers) await makePeer(peer.id, peer.name, true);
  });
}
function outgoingStream() { return processedStream || localStream; }
async function makePeer(id, name, initiator) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(config);
  peers.set(id, { pc, name });
  const stream = outgoingStream();
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit("signal", { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = e => addVideo(id, name, e.streams[0]);
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
function addVideo(id, name, stream) {
  let tile = document.getElementById("tile-" + id);
  if (!tile) {
    tile = document.createElement("div"); tile.className = "video-tile"; tile.id = "tile-" + id;
    const video = document.createElement("video"); video.autoplay = true; video.playsInline = true; tile.append(video);
    const label = document.createElement("span"); label.className = "video-name"; label.textContent = name; tile.append(label);
    const expand = document.createElement("button"); expand.className = "tile-expand"; expand.textContent = "⛶"; expand.title = "全画面表示";
    expand.onclick = () => toggleFullscreen(tile); tile.append(expand);
    $("videoGrid").append(tile);
  }
  tile.querySelector("video").srcObject = stream;
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
    for (const { pc } of peers.values()) {
      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(track);
    }
    $("localVideo").srcObject = screenStream;
    $("stopShareBtn").classList.remove("hidden"); $("shareBtn").classList.add("active");
    track.onended = stopShare;
  } catch (e) { screenStream = null; toast("画面共有を開始できませんでした。"); }
};
$("stopShareBtn").onclick = stopShare;
async function stopShare() {
  if (!screenStream) return;
  const streamToStop = screenStream; screenStream = null;
  const stream = outgoingStream(); const cameraTrack = stream?.getVideoTracks()[0] || null;
  for (const { pc } of peers.values()) {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(cameraTrack);
  }
  streamToStop.getTracks().forEach(t => t.stop());
  $("localVideo").srcObject = processedStream || localStream;
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
  document.body.classList.toggle("light-theme");
  $("themeBtn").textContent = document.body.classList.contains("light-theme") ? "☾ ダーク" : "☀ ライト";
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
  location.href = "/";
};
$("hostBtn").onclick = () => join("host");\n$("joinBtn").onclick = () => join("guest");
$("roomId").value = new URLSearchParams(location.search).get("room") || "";

\n// Premium interface motion: pointer light and cinematic intro.
window.addEventListener("DOMContentLoaded", () => {
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
