/* ─────────────────────────────────────────────
   PLAYLISTPULL — app.js  (v2 — Invidious API)
───────────────────────────────────────────── */

// ── Invidious public instances (fallback chain) ──
const INVIDIOUS_INSTANCES = [
  "https://inv.riverside.rocks",
  "https://invidious.slipfox.xyz",
  "https://invidious.privacyredirect.com",
  "https://yt.cdaut.de",
  "https://invidious.nerdvpn.de",
  "https://invidious.protokolla.fi",
];

const COBALT_API = "https://api.cobalt.tools/";

// ── State ─────────────────────────────────────
let currentFormat  = "mp4";
let playlistVideos = [];
let selectedSet    = new Set();
let isCancelled    = false;
let zipBlob        = null;

// ── Init ──────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("urlInput");
  input.addEventListener("input",   onUrlInput);
  input.addEventListener("keydown", e => { if (e.key === "Enter") fetchPlaylist(); });
});

function onUrlInput() {
  const val = document.getElementById("urlInput").value;
  document.getElementById("clearBtn").classList.toggle("visible", val.length > 0);
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
  document.getElementById("errorMsg").textContent = msg;
  box.classList.add("visible");
}
function hideError() {
  document.getElementById("errorBox").classList.remove("visible");
}

// ── Step navigation ───────────────────────────
function showStep(id) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
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
  const raw = document.getElementById("urlInput").value.trim();
  if (!raw) { showError("Please paste a YouTube playlist URL first."); return; }

  const listId = extractListId(raw);
  if (!listId) {
    showError("No playlist ID found. Make sure the URL contains ?list=PL...");
    return;
  }

  hideError();
  setFetchLoading(true);

  try {
    const data = await fetchPlaylistFromInvidious(listId);
    if (!data.videos.length) throw new Error("Playlist appears to be empty or private.");
    playlistVideos = data.videos;
    selectedSet    = new Set(playlistVideos.map((_, i) => i));
    renderStep2(data);
    showStep("step-select");
  } catch (err) {
    showError("❌ " + (err.message || "Failed to load playlist. Check the URL and try again."));
  } finally {
    setFetchLoading(false);
  }
}

// Try each Invidious instance until one works
async function fetchPlaylistFromInvidious(listId) {
  let lastError = null;

  for (const base of INVIDIOUS_INSTANCES) {
    try {
      console.log(`Trying ${base}...`);
      const videos = [];
      let page = 1;
      let name = "";
      let author = "";

      while (true) {
        const url = `${base}/api/v1/playlists/${listId}?page=${page}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: { "Accept": "application/json" },
        });

        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const json = await res.json();
        if (json.error) throw new Error(json.error);

        name   = name   || json.title  || "Playlist";
        author = author || json.author || "";

        const page_videos = json.videos || [];
        if (!page_videos.length) break;

        for (const v of page_videos) {
          videos.push({
            id:        v.videoId || "",
            title:     v.title   || "Untitled",
            uploader:  v.author  || author,
            duration:  v.lengthSeconds || 0,
            thumbnail: `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`,
            url:       `https://www.youtube.com/watch?v=${v.videoId}`,
          });
        }

        if (page_videos.length < 100) break;
        page++;
      }

      console.log(`Got ${videos.length} videos from ${base}`);
      return { name, author, videos };

    } catch (err) {
      console.warn(`${base} failed:`, err.message);
      lastError = err;
    }
  }

  throw new Error(
    "Could not reach any playlist API. The playlist might be private, or all servers are busy. Please try again in a moment."
  );
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
      headers: {
        "Content-Type": "application/json",
        "Accept":       "application/json",
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Error(`Could not reach download service: ${e.message}`);
  }

  if (!cobaltRes.ok) {
    const txt = await cobaltRes.text().catch(() => "");
    throw new Error(`Download service error (${cobaltRes.status}): ${txt.slice(0, 100)}`);
  }

  const cobaltData = await cobaltRes.json();
  console.log("Cobalt response:", cobaltData);

  let mediaUrl = null;

  if (cobaltData.status === "error") {
    throw new Error(cobaltData.error?.code || cobaltData.text || "Download service refused this video");
  } else if (["stream", "redirect", "tunnel"].includes(cobaltData.status)) {
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
    throw new Error(`Failed to fetch media: ${e.message}`);
  }

  if (!mediaRes.ok) throw new Error(`Media download failed: HTTP ${mediaRes.status}`);
  return await mediaRes.blob();
}

function cancelDownload() {
  isCancelled = true;
}

// ── Progress UI ───────────────────────────────
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
  const icons = { downloading: "⬇", done: "✓", error: "✗" };
  row.querySelector(".vp-icon").textContent   = icons[state] || "○";
  row.querySelector(".vp-status").textContent = statusText;
  if (state === "downloading") row.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

// ── Done ──────────────────────────────────────
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
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}

function sanitizeFilename(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 200);
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
