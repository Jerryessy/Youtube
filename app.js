/* ─────────────────────────────────────────────
   PLAYLISTPULL — app.js
   Flow:
     1. Fetch playlist info via Piped API (open YouTube proxy)
     2. User selects videos
     3. For each video, fetch via cobalt.tools API → get direct URL
     4. Download each file as blob → JSZip → save
───────────────────────────────────────────── */

// ── Config ───────────────────────────────────
const PIPED_API   = "https://pipedapi.kavin.rocks";
const COBALT_API  = "https://api.cobalt.tools/";

// Piped mirror fallbacks if main fails
const PIPED_MIRRORS = [
  "https://pipedapi.kavin.rocks",
  "https://piped-api.garudalinux.org",
  "https://api.piped.yt",
];

// ── State ─────────────────────────────────────
let currentFormat   = "mp4";
let playlistVideos  = [];
let selectedSet     = new Set();
let isCancelled     = false;
let zipBlob         = null;

// ── Init ──────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("urlInput");
  input.addEventListener("input",  onUrlInput);
  input.addEventListener("keydown", e => { if (e.key === "Enter") fetchPlaylist(); });
});

function onUrlInput() {
  const val = document.getElementById("urlInput").value;
  const clearBtn = document.getElementById("clearBtn");
  clearBtn.classList.toggle("visible", val.length > 0);
}

function clearInput() {
  document.getElementById("urlInput").value = "";
  document.getElementById("clearBtn").classList.remove("visible");
  hideError();
}

// ── Format ────────────────────────────────────
function setFormat(fmt) {
  currentFormat = fmt;
  document.getElementById("fmtMp4").classList.toggle("active", fmt === "mp4");
  document.getElementById("fmtMp3").classList.toggle("active", fmt === "mp3");
  updateStartInfo();
}

// ── Error ─────────────────────────────────────
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
  // re-trigger animation
  el.style.animation = "none";
  el.offsetHeight; // reflow
  el.style.animation = "";
}

function resetToStep1() {
  isCancelled = true;
  zipBlob = null;
  playlistVideos = [];
  selectedSet.clear();
  showStep("step-input");
  hideError();
}

// ── STEP 1: Fetch playlist ────────────────────
async function fetchPlaylist() {
  const raw = document.getElementById("urlInput").value.trim();
  if (!raw) { showError("Please paste a YouTube playlist URL."); return; }

  const listId = extractListId(raw);
  if (!listId) { showError("Couldn't find a playlist ID in that URL. Make sure it contains ?list=..."); return; }

  hideError();
  setFetchLoading(true);

  try {
    const data = await fetchWithMirrors(listId);
    playlistVideos = data.videos;
    selectedSet    = new Set(playlistVideos.map((_, i) => i));
    renderStep2(data);
    showStep("step-select");
  } catch (err) {
    showError(err.message || "Failed to fetch playlist. Check the URL and try again.");
  } finally {
    setFetchLoading(false);
  }
}

async function fetchWithMirrors(listId) {
  let lastErr;
  for (const mirror of PIPED_MIRRORS) {
    try {
      const videos = [];
      let url = `${mirror}/playlists/${listId}`;
      let name = "", uploader = "";

      // Paginate through all pages
      while (url) {
        const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        name     = name     || data.name     || "Playlist";
        uploader = uploader || data.uploader || "";

        for (const v of (data.relatedStreams || [])) {
          if (v && v.url) {
            videos.push({
              id:        extractVideoId(v.url),
              title:     v.title     || "Unknown Title",
              uploader:  v.uploaderName || uploader,
              duration:  v.duration  || 0,
              thumbnail: v.thumbnail || "",
              url:       v.url,
            });
          }
        }

        // Next page
        url = data.nextpage
          ? `${mirror}/nextpage/playlists/${listId}?nextpage=${encodeURIComponent(data.nextpage)}`
          : null;
      }

      if (!videos.length) throw new Error("No videos found in this playlist.");
      return { name, uploader, videos };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(lastErr?.message || "All API mirrors failed.");
}

function setFetchLoading(loading) {
  const btn = document.getElementById("fetchBtn");
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Fetching...`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `<span class="btn-text">FETCH PLAYLIST</span><span class="btn-icon">→</span>`;
  }
}

// ── STEP 2: Render video list ─────────────────
function renderStep2({ name, uploader, videos }) {
  document.getElementById("playlistName").textContent = name;
  document.getElementById("playlistMeta").textContent =
    `${videos.length} videos${uploader ? " · " + uploader : ""}`;

  const list = document.getElementById("videoList");
  list.innerHTML = "";

  videos.forEach((v, i) => {
    const item = document.createElement("div");
    item.className = "vi selected";
    item.id = `vi-${i}`;
    item.onclick = () => toggleVideo(i);

    const thumbHtml = v.thumbnail
      ? `<img class="vi-thumb" src="${escHtml(v.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="vi-thumb"></div>`;

    item.innerHTML = `
      <div class="vi-check"></div>
      ${thumbHtml}
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
  const el = document.getElementById(`vi-${i}`);
  el.classList.toggle("selected", selectedSet.has(i));
  updateSelCount();
  updateStartInfo();
}

function selectAll() {
  playlistVideos.forEach((_, i) => {
    selectedSet.add(i);
    document.getElementById(`vi-${i}`)?.classList.add("selected");
  });
  updateSelCount();
  updateStartInfo();
}

function selectNone() {
  playlistVideos.forEach((_, i) => {
    selectedSet.delete(i);
    document.getElementById(`vi-${i}`)?.classList.remove("selected");
  });
  updateSelCount();
  updateStartInfo();
}

function updateSelCount() {
  document.getElementById("selCount").textContent = `${selectedSet.size} selected`;
}

function updateStartInfo() {
  const fmt = currentFormat.toUpperCase();
  document.getElementById("startInfo").textContent = `${selectedSet.size} video${selectedSet.size !== 1 ? "s" : ""} · ${fmt}`;
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
  let done     = 0;
  const errors = [];

  for (let i = 0; i < videos.length; i++) {
    if (isCancelled) break;

    const v = videos[i];
    updateProgress(i + 1, videos.length, v.title);
    setVideoProgressState(i, "downloading", "↓ Downloading...");

    try {
      const blob = await downloadVideo(v);
      const ext  = currentFormat === "mp3" ? "mp3" : "mp4";
      const filename = sanitizeFilename(`${String(i + 1).padStart(2, "0")} - ${v.title}.${ext}`);
      zip.file(filename, blob);
      done++;
      setVideoProgressState(i, "done", "✓ Done");
    } catch (err) {
      errors.push({ title: v.title, msg: err.message });
      setVideoProgressState(i, "error", "✗ Failed");
    }
  }

  if (isCancelled) {
    resetToStep1();
    return;
  }

  // Finalize ZIP
  updateOverallLabel("Creating ZIP archive...");
  const zipContent = await zip.generateAsync({ type: "blob" });
  zipBlob = zipContent;

  showDoneScreen(done, videos.length, errors);
}

async function downloadVideo(v) {
  // Build full YouTube URL from video id or url
  const videoUrl = v.url.startsWith("http")
    ? v.url
    : `https://www.youtube.com/watch?v=${v.id}`;

  const body = {
    url: videoUrl,
    videoQuality: "720",
    filenameStyle: "basic",
    downloadMode: currentFormat === "mp3" ? "audio" : "auto",
  };

  const cobaltRes = await fetch(COBALT_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!cobaltRes.ok) {
    const txt = await cobaltRes.text().catch(() => "");
    throw new Error(`Cobalt API error ${cobaltRes.status}: ${txt.slice(0, 80)}`);
  }

  const cobaltData = await cobaltRes.json();

  // cobalt returns { status: "stream"|"redirect"|"picker"|"error", url, picker }
  let downloadUrl = null;

  if (cobaltData.status === "error") {
    throw new Error(cobaltData.error?.code || "Cobalt returned an error");
  } else if (cobaltData.status === "stream" || cobaltData.status === "redirect") {
    downloadUrl = cobaltData.url;
  } else if (cobaltData.status === "picker" && cobaltData.picker?.length) {
    // If picker, grab first item (usually best quality)
    downloadUrl = cobaltData.picker[0].url;
  } else if (cobaltData.url) {
    downloadUrl = cobaltData.url;
  } else {
    throw new Error("No download URL returned by Cobalt.");
  }

  // Fetch the actual media file
  const mediaRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });
  if (!mediaRes.ok) throw new Error(`Media fetch failed: HTTP ${mediaRes.status}`);
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

function setVideoProgressState(i, state, statusText) {
  const row = document.getElementById(`vp-${i}`);
  if (!row) return;
  row.className = `vp ${state}`;
  const icons = { downloading: "⬇", done: "✓", error: "✗", skipped: "–" };
  row.querySelector(".vp-icon").textContent   = icons[state] || "○";
  row.querySelector(".vp-status").textContent = statusText;

  // Auto-scroll to current
  if (state === "downloading") row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateProgress(current, total, title) {
  const pct = Math.round((current - 1) / total * 100);
  document.getElementById("progFill").style.width    = pct + "%";
  document.getElementById("progFraction").textContent = `${current - 1} / ${total}`;
  document.getElementById("progLabel").textContent    = `Downloading: ${title}`;
}

function updateOverallLabel(txt) {
  document.getElementById("progLabel").textContent = txt;
  document.getElementById("progFill").style.width  = "99%";
}

// ── Done screen ───────────────────────────────
function showDoneScreen(done, total, errors) {
  document.getElementById("doneMeta").textContent =
    `${done} of ${total} file${total !== 1 ? "s" : ""} downloaded · ${currentFormat.toUpperCase()} · ${fmtFileSize(zipBlob?.size || 0)}`;

  if (errors.length) {
    const errBox = document.getElementById("doneErrors");
    errBox.innerHTML = `<strong>⚠ ${errors.length} error${errors.length > 1 ? "s" : ""}:</strong><br>` +
      errors.map(e => `· ${escHtml(e.title)}: ${escHtml(e.msg)}`).join("<br>");
  }

  document.getElementById("zipBtn").onclick = triggerZipDownload;
  showStep("step-done");
}

function triggerZipDownload() {
  if (!zipBlob) return;
  const a   = document.createElement("a");
  a.href    = URL.createObjectURL(zipBlob);
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
  const m = url.match(/[?&]list=([^&\s#]+)/);
  return m ? m[1] : null;
}

function extractVideoId(url) {
  try {
    const u = new URL("https://youtube.com" + url);
    return u.searchParams.get("v") || "";
  } catch { return ""; }
}

function fmtDuration(s) {
  if (!s || s < 0) return "";
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

function pad(n) { return String(n).padStart(2, "0"); }

function fmtFileSize(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}

function sanitizeFilename(s) {
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 200);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
