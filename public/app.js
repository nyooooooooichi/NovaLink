const socket = io();
const $ = (id) => document.getElementById(id);
let localStream = null, screenStream = null, roomId = null, selfId = null;
const peers = new Map();
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let micOn = true, cameraOn = true;

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2400);
}
function randomId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
$("randomRoom").onclick = () => $("roomId").value = randomId();

async function join() {
  const name = $("displayName").value.trim() || "Guest";
  roomId = $("roomId").value.trim() || randomId();
  $("roomId").value = roomId;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    toast("カメラ・マイクを利用できません。ブラウザの権限を確認してください。");
    return;
  }
  $("localVideo").srcObject = localStream;
  socket.emit("room:join", { roomId, name }, async (result) => {
    if (!result?.ok) { localStream.getTracks().forEach(t => t.stop()); localStream = null; toast(result?.error || "参加できませんでした。"); return; }
    selfId = result.selfId;
    $("home").classList.add("hidden");
    $("meeting").classList.remove("hidden");
    $("meetingTitle").textContent = name + " のミーティング";
    $("roomLabel").textContent = "ROOM / " + roomId;
    $("memberCount").textContent = result.peers.length + 1;
    history.replaceState({}, "", "/?room=" + encodeURIComponent(roomId));
    for (const peer of result.peers) await makePeer(peer.id, peer.name, true);
  });
}
async function makePeer(id, name, initiator) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(config);
  peers.set(id, { pc, name });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit("signal", { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = e => addVideo(id, name, e.streams[0]);
  pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) removePeer(id); };
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
    $("videoGrid").append(tile);
  }
  tile.querySelector("video").srcObject = stream;
}
function removePeer(id) {
  const peer = peers.get(id); if (peer) peer.pc.close();
  peers.delete(id); document.getElementById("tile-" + id)?.remove();
}
socket.on("peer:joined", async ({ id, name }) => { await makePeer(id, name, false); toast(name + " が参加しました"); });
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
function addChat(name, text, mine) {
  const box = $("chatMessages");
  if (box.querySelector(".system-message")) box.innerHTML = "";
  const item = document.createElement("div"); item.className = "chat-item";
  const who = document.createElement("b"); who.textContent = mine ? name + " · YOU" : name;
  const body = document.createElement("span"); body.textContent = text;
  item.append(who, body); box.append(item); box.scrollTop = box.scrollHeight;
}
socket.on("chat:message", msg => addChat(msg.name, msg.text, msg.id === selfId));
$("chatForm").onsubmit = e => { e.preventDefault(); const text = $("chatInput").value.trim(); if (!text) return; socket.emit("chat:send", { text }); $("chatInput").value = ""; };
$("micBtn").onclick = () => { micOn = !micOn; localStream?.getAudioTracks().forEach(t => t.enabled = micOn); $("micBtn").classList.toggle("active", micOn); };
$("cameraBtn").onclick = () => { cameraOn = !cameraOn; localStream?.getVideoTracks().forEach(t => t.enabled = cameraOn); $("cameraBtn").classList.toggle("active", cameraOn); };
$("shareBtn").onclick = async () => {
  if (screenStream) return;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = screenStream.getVideoTracks()[0];
    for (const { pc } of peers.values()) {
      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(track);
    }
    $("localVideo").srcObject = screenStream;
    $("stopShareBtn").classList.remove("hidden");
    $("shareBtn").classList.add("active");
    track.onended = stopShare;
  } catch (e) {
    screenStream = null;
    toast("画面共有を開始できませんでした。");
  }
};
$("stopShareBtn").onclick = stopShare;
async function stopShare() {
  if (!screenStream) return;
  const streamToStop = screenStream;
  screenStream = null;
  const cameraTrack = localStream?.getVideoTracks()[0] || null;
  for (const { pc } of peers.values()) {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(cameraTrack);
  }
  streamToStop.getTracks().forEach(t => t.stop());
  $("localVideo").srcObject = localStream;
  $("stopShareBtn").classList.add("hidden");
  $("shareBtn").classList.remove("active");
  toast("画面共有を終了しました。");
}
$("copyBtn").onclick = async () => { const url = location.origin + "/?room=" + encodeURIComponent(roomId); try { await navigator.clipboard.writeText(url); toast("招待リンクをコピーしました"); } catch { toast(url); } };
$("leaveBtn").onclick = () => { peers.forEach(({pc}) => pc.close()); peers.clear(); localStream?.getTracks().forEach(t => t.stop()); if (screenStream) screenStream.getTracks().forEach(t => t.stop()); location.href = "/"; };
$("joinBtn").onclick = join;
$("roomId").value = new URLSearchParams(location.search).get("room") || "";
