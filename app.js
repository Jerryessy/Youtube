/* ─────────────────────────────────────────────
   PLAYLISTPULL — app.js  (v3 — YouTube Data API)
───────────────────────────────────────────── */

const COBALT_API = "https://api.cobalt.tools/";
const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

// ── State ─────────────────────────────────────
let currentFormat  = "mp4";
let playlistVideos = [];
let selectedSet    = new Set();
let isCancelled    = false;
let zipBlob        = null;
let apiKey         = "";

// ── Init ──────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Load saved API key
  const saved = localStorage.getItem("yt_api_key");
  if (saved) {
    apiKey = saved;
    document.getElementById("apiKeyInput").value = saved;
    showStep("step-input");
  } else {
    showStep("step-apikey");
  }

  document.getElementById("urlInput").addEventListener("input", onUrlInput);
  document.getElementById("urlInput").addEventListener("keydown", e => {
    if (e.key === "Enter") fetchPlaylist();
  });
  document.getElementById("apiKeyInput").addEventListener("keydown", e => {
    if (e.key === "Enter") saveApiKey();
  });
});

// ── API Key setup ─────────────────────────────
function saveApiKey() {
  const key = document.getElementById("apiKeyInput").value.trim();
  if (!key) {
    showApiKeyError("Please paste your API key first.");
    return;
  }
  apiKey = key;
  localStorage.setItem("yt_api_key", key);
  hideApiKeyError();
  showStep("step-input");
}

function changeApiKey() {
  showStep("step-apikey");
}

function showApiKeyError(msg) {
  const el = document.getElementById("apiKeyError");
  el.textContent = "⚠ " + msg;
  el.classList.add("visible");
}
function hideApiKeyError() {
  document.getElementById("apiKeyError").classList.remove("visible");
}

// ── URL Input helpers ─────────────────────────
function onUrlInput() {
  const val = document.getElementById("urlInput").value;
  document.getElementById("clearBtn").classList.toggle("visible", val.length > 0);
  hideError();
}
function clearInput() {
  document.getElementById("urlInput").value = "";
  document.getElementById("clearBtn").classList.remove("visible");
  hideError();
}

// ── Format toggle ─────────────────────────────
function setFormat(fmt) {
  currentFormat = fmt;
  document.getElementById("fmtMp4").classList.toggle("active", fmt === "mp4");
  document.getElementById("fmtMp3").classList.toggle("active", fmt === "mp3");
  updateStartInfo();
}

// ── Error display ─────────────────────────────
function showError(msg) {
  const box = document.getElementById("errorBox");
  document.getElementById("errorMsg").innerHTML = msg;
  box.classList.add("visible");
}
function hideError() {
  document.getElementById("errorBox").classList.remove("visible");
}

// ── Step navigation ───────────────────────────
function showStep(id) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("active");
  el.style.animation = "none";
  el.offsetHeight;
  el.style.animation = "";
}

function resetToStep1() {
  isCancelled    = true;
  zipBlob        = null;
  playlistVideos = [];
  selectedSet.clear();
  showStep("step-input");
  hideError();
}

// ── STEP 1: Fetch playlist ────────────────────
async function fetchPlaylist() {
  if (!apiKey) { changeApiKey(); return; }

  const raw = document.getElementById("urlInput").value.trim();
  if (!raw) { showError("Please paste a YouTube playlist URL first."); return; }

  const listId = extractListId(raw);
  if (!listId) {
    showError("No playlist ID found. Make sure the URL contains <code>?list=PL...</code>");
    return;
  }

  hideError();
  setFetchLoading(true);

  try {
    const data = await fetchPlaylistYouTubeAPI(listId);
    if (!data.videos.length) throw new Error("Playlist is empty or all videos are private.");
    playlistVideos = data.videos;
    selectedSet    = new Set(playlistVideos.map((_, i) => i));
    renderStep2(data);
    showStep("step-select");
  } catch (err) {
    let msg = err.message || "Failed to load playlist.";
    if (msg.includes("API key")) {
      msg += ` <a href="#" onclick="changeApiKey()" style="color:#ff8080;text-decoration:underline">Update API key →</a>`;
    }
    showError("❌ " + msg);
  } finally {
    setFetchLoading(false);
  }
}

// Fetch all pages from YouTube Data API v3
async function fetchPlaylistYouTubeAPI(listId) {
  const videos = [];
  let pageToken = "";
  let playlistTitle = "Playlist";
  let channelTitle  = "";

  do {
    const params = new URLSearchParams({
      part:       "snippet",
      playlistId: listId,
      maxResults: "50",
      key:        apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${YT_API_BASE}/playlistItems?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    const json = await res.json();

    // Handle API errors
    if (json.error) {
      const code = json.error.code;
      const msg  = json.error.message || "";
      if (code === 400 || code === 403) {
        if (msg.toLowerCase().includes("api key")) throw new Error("Invalid API key. " + msg);
        throw new Error("API error: " + msg);
      }
      if (code === 404) throw new Error("Playlist not found. It may be private or deleted.");
      throw new Error("YouTube API error: " + msg);
    }

    // Grab playlist name from first item
    if (!channelTitle && json.items?.length) {
      channelTitle  = json.items[0].snippet?.channelTitle || "";
      playlistTitle = json.items[0].snippet?.playlistId   || playlistTitle;
    }

    for (const item of (json.items || [])) {
      const snip = item.snippet || {};
      const vid  = snip.resourceId?.videoId;
      // Skip deleted/private videos
      if (!vid || snip.title === "Deleted video" || snip.title === "Private video") continue;

      videos.push({
        id:        vid,
        title:     snip.title     || "Untitled",
        uploader:  snip.videoOwnerChannelTitle || channelTitle,
        thumbnail: snip.thumbnails?.medium?.url
                || snip.thumbnails?.default?.url
                || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
        url:       `https://www.youtube.com/watch?v=${vid}`,
        duration:  0, // Playlist API doesn't return duration; we skip fetching it for speed
      });
    }

    pageToken = json.nextPageToken || "";
  } while (pageToken);

  // Get playlist title separately
  try {
    const pRes = await fetch(
      `${YT_API_BASE}/playlists?part=snippet&id=${listId}&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const pJson = await pRes.json();
    if (pJson.items?.length) {
      playlistTitle = pJson.items[0].snippet?.title || playlistTitle;
      channelTitle  = pJson.items[0].snippet?.channelTitle || channelTitle;
    }
  } catch {}

  return { name: playlistTitle, author: channelTitle, videos };
}

function setFetchLoading(on) {
  const btn = document.getElementById("fetchBtn");
  btn.disabled = on;
  btn.innerHTML = on
    ? `<span class="spinner"></span> Fetching...`
    : `<span class="btn-text">FETCH PLAYLIST</span><span class="btn-icon">→</span>`;
}

// ── STEP 2: Render video list ─────────────────
function renderStep2({ name, author, videos }) {
  document.getElementById("playlistName").textContent = name;
  document.getElementById("playlistMeta").textContent =
    `${videos.length} video${videos.length !== 1 ? "s" : ""}${author ? " · " + author : ""}`;

  const list = document.getElementById("videoList");
  list.innerHTML = "";

  videos.forEach((v, i) => {
    const item = document.createElement("div");
    item.className = "vi selected";
    item.id = `vi-${i}`;
    item.onclick = () => toggleVideo(i);
    item.innerHTML = `
      <div class="vi-check"></div>
      <img class="vi-thumb" src="${escHtml(v.thumbnail)}" alt=""
           loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="vi-num">${i + 1}</span>
      <div class="vi-info">
        <div class="vi-title" title="${escHtml(v.title)}">${escHtml(v.title)}</div>
        <div class="vi-uploader">${escHtml(v.uploader)}</div>
      </div>
      <span class="vi-dur">${fmtDuration(v.duration)}</span>
    `;
    list.appendChild(item);
  });

  updateSelCount();
  updateStartInfo();
}

function toggleVideo(i) {
  if (selectedSet.has(i)) selectedSet.delete(i);
  else selectedSet.add(i);
  document.getElementById(`vi-${i}`).classList.toggle("selected", selectedSet.has(i));
  updateSelCount();
  updateStartInfo();
}

function selectAll() {
  playlistVideos.forEach((_, i) => {
    selectedSet.add(i);
    document.getElementById(`vi-${i}`)?.classList.add("selected");
  });
  updateSelCount(); updateStartInfo();
}

function selectNone() {
  playlistVideos.forEach((_, i) => {
    selectedSet.delete(i);
    document.getElementById(`vi-${i}`)?.classList.remove("selected");
  });
  updateSelCount(); updateStartInfo();
}

function updateSelCount() {
  document.getElementById("selCount").textContent = `${selectedSet.size} selected`;
}

function updateStartInfo() {
  document.getElementById("startInfo").textContent =
    `${selectedSet.size} video${selectedSet.size !== 1 ? "s" : ""} · ${currentFormat.toUpperCase()}`;
  document.getElementById("startBtn").disabled = selectedSet.size === 0;
}

// ── STEP 3: Download ──────────────────────────
async function startDownload() {
  const indices = [...selectedSet].sort((a, b) => a - b);
  const videos  = indices.map(i => playlistVideos[i]);
  if (!videos.length) return;

  isCancelled = false;
  showStep("step-progress");
  buildProgressList(videos);

  const zip    = new JSZip();
  let   done   = 0;
  const errors = [];

  for (let i = 0; i < videos.length; i++) {
    if (isCancelled) break;

    const v = videos[i];
    updateProgress(i, videos.length, v.title);
    setVP(i, "downloading", "↓ Downloading...");

    try {
      const blob = await downloadOneVideo(v);
      const ext  = currentFormat === "mp3" ? "mp3" : "mp4";
      const name = sanitizeFilename(`${String(i + 1).padStart(2, "0")} - ${v.title}.${ext}`);
      zip.file(name, blob);
      done++;
      setVP(i, "done", "✓ Done");
    } catch (err) {
      console.error(`Failed: ${v.title}`, err);
      errors.push({ title: v.title, msg: err.message });
      setVP(i, "error", "✗ Failed");
    }
  }

  if (isCancelled) { resetToStep1(); return; }

  updateOverallLabel("Creating ZIP archive...");
  const zipContent = await zip.generateAsync({ type: "blob" });
  zipBlob = zipContent;
  showDoneScreen(done, videos.length, errors);
}

async function downloadOneVideo(v) {
  const payload = {
    url:          v.url,
    videoQuality: "720",
    filenameStyle:"basic",
    downloadMode: currentFormat === "mp3" ? "audio" : "auto",
  };

  let cobaltRes;
  try {
    cobaltRes = await fetch(COBALT_API, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Error("Could not reach download service: " + e.message);
  }

  if (!cobaltRes.ok) {
    const txt = await cobaltRes.text().catch(() => "");
    throw new Error(`Download service error (${cobaltRes.status}): ${txt.slice(0, 80)}`);
  }

  const cobaltData = await cobaltRes.json();

  let mediaUrl = null;
  if (cobaltData.status === "error") {
    throw new Error(cobaltData.error?.code || cobaltData.text || "Download service refused this video");
  } else if (["stream","redirect","tunnel"].includes(cobaltData.status)) {
    mediaUrl = cobaltData.url;
  } else if (cobaltData.status === "picker" && cobaltData.picker?.length) {
    mediaUrl = cobaltData.picker[0].url;
  } else if (cobaltData.url) {
    mediaUrl = cobaltData.url;
  }

  if (!mediaUrl) throw new Error("No download URL returned. This video may be restricted.");

  let mediaRes;
  try {
    mediaRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(180000) });
  } catch (e) {
    throw new Error("Failed to fetch media: " + e.message);
  }

  if (!mediaRes.ok) throw new Error(`Media download failed: HTTP ${mediaRes.status}`);
  return await mediaRes.blob();
}

function cancelDownload() { isCancelled = true; }

// ── Progress helpers ──────────────────────────
function buildProgressList(videos) {
  const list = document.getElementById("videoProgressList");
  list.innerHTML = "";
  videos.forEach((v, i) => {
    const row = document.createElement("div");
    row.className = "vp";
    row.id = `vp-${i}`;
    row.innerHTML = `
      <span class="vp-icon">○</span>
      <span class="vp-title" title="${escHtml(v.title)}">${escHtml(v.title)}</span>
      <span class="vp-status">Queued</span>
    `;
    list.appendChild(row);
  });
}

function setVP(i, state, statusText) {
  const row = document.getElementById(`vp-${i}`);
  if (!row) return;
  row.className = `vp ${state}`;
  const icons = { downloading:"⬇", done:"✓", error:"✗" };
  row.querySelector(".vp-icon").textContent   = icons[state] || "○";
  row.querySelector(".vp-status").textContent = statusText;
  if (state === "downloading") row.scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function updateProgress(current, total, title) {
  const pct = Math.round(current / total * 100);
  document.getElementById("progFill").style.width     = pct + "%";
  document.getElementById("progFraction").textContent = `${current} / ${total}`;
  document.getElementById("progLabel").textContent    = title;
}

function updateOverallLabel(txt) {
  document.getElementById("progLabel").textContent = txt;
  document.getElementById("progFill").style.width  = "99%";
}

// ── Done screen ───────────────────────────────
function showDoneScreen(done, total, errors) {
  document.getElementById("doneMeta").textContent =
    `${done} of ${total} downloaded · ${currentFormat.toUpperCase()} · ${fmtFileSize(zipBlob?.size || 0)}`;

  if (errors.length) {
    const box = document.getElementById("doneErrors");
    box.innerHTML = `<strong>⚠ ${errors.length} video${errors.length > 1 ? "s" : ""} failed:</strong><br>` +
      errors.map(e => `· ${escHtml(e.title)} — ${escHtml(e.msg)}`).join("<br>");
  }

  document.getElementById("zipBtn").onclick = triggerZipDownload;
  showStep("step-done");
}

function triggerZipDownload() {
  if (!zipBlob) return;
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(zipBlob);
  a.download = "playlist.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ── Utilities ─────────────────────────────────
function extractListId(url) {
  try {
    const u = new URL(url);
    const l = u.searchParams.get("list");
    if (l) return l;
  } catch {}
  const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function fmtDuration(s) {
  if (!s || s <= 0) return "";
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function pad(n) { return String(n).padStart(2, "0"); }

function fmtFileSize(bytes) {
  if (!bytes) return "0 B";
  const sizes = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}

function sanitizeFilename(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 200);
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
