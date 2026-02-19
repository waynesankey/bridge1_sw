const statusEl = document.getElementById("status");
const statusDotEl = document.getElementById("statusDot");
const volumeEl = document.getElementById("volume");
const volumeValueEl = document.getElementById("volumeValue");
const balanceEl = document.getElementById("balance");
const balanceValueEl = document.getElementById("balanceValue");
const brightnessEl = document.getElementById("brightness");
const brightnessValueEl = document.getElementById("brightnessValue");
const inputGroupEl = document.getElementById("inputGroup");
const muteEl = document.getElementById("mute");
const refreshEl = document.getElementById("refresh");
const themeToggleEl = document.getElementById("themeToggle");

let ws = null;
let reconnectTimer = null;
let pollTimer = null;
let pendingSend = {};
let labels = {};
let queuedLines = [];
let syncCooldownUntilMs = 0;
let pendingSyncTimer = null;
let startupPollTimer = null;
let wsHealthTimer = null;
let wsLastMessageMs = 0;
let lastReconnectKickMs = 0;
let pollInFlight = false;
let labelsPollCountdown = 0;
let pendingStatePollTimer = null;
let fallbackStartTimer = null;
let suspendCloseInProgress = false;

const MAX_QUEUED_LINES = 48;
const UI_DEBOUNCE_VOL_MS = 25;
const UI_DEBOUNCE_BAL_MS = 25;
const UI_DEBOUNCE_BRI_MS = 40;
const SYNC_COOLDOWN_FULL_MS = 120;
const SYNC_COOLDOWN_STATE_MS = 80;
const HTTP_FALLBACK_STATE_POLL_DELAY_MS = 60;
const HTTP_FALLBACK_RETRY_BACKOFF_MS = 60;
const HTTP_FALLBACK_POLL_INTERVAL_MS = 1200;
const HTTP_FALLBACK_LABELS_POLL_EVERY = 12;
const WS_RECONNECT_DELAY_MS = 700;
const WS_FALLBACK_GRACE_MS = 2200;
const RECONNECT_KICK_MIN_INTERVAL_MS = 2000;

const THEME_STORAGE_KEY = "bridge_theme_mode";
const THEME_CYCLE = ["light", "dark"];
const systemDarkMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let themeMode = "light";

function isPageVisible() {
  return !document.hidden && document.visibilityState === "visible";
}

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", !!ok);
  if (statusDotEl) {
    statusDotEl.classList.toggle("ok", !!ok);
  }
}

function normalizeThemeMode(mode) {
  if (mode === "dark") {
    return "dark";
  }
  if (mode === "auto") {
    return systemDarkMedia && systemDarkMedia.matches ? "dark" : "light";
  }
  return "light";
}

function getEffectiveTheme(mode) {
  return mode;
}

function updateThemeToggleText() {
  if (!themeToggleEl) {
    return;
  }
  const label = themeMode === "dark" ? "Dark" : "Light";
  themeToggleEl.dataset.mode = themeMode;
  themeToggleEl.setAttribute("aria-label", "Theme: " + label);
}

function setThemeMode(mode, persist = true) {
  themeMode = normalizeThemeMode(mode);
  const effectiveTheme = getEffectiveTheme(themeMode);
  document.documentElement.setAttribute("data-theme", effectiveTheme);
  updateThemeToggleText();
  if (!persist) {
    return;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  } catch (err) {
  }
}

function cycleThemeMode() {
  const idx = THEME_CYCLE.indexOf(themeMode);
  const nextMode = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  setThemeMode(nextMode, true);
}

function initTheme() {
  let storedMode = "light";
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      storedMode = raw;
    }
  } catch (err) {
  }

  setThemeMode(storedMode, false);

  if (themeToggleEl) {
    themeToggleEl.addEventListener("click", cycleThemeMode);
  }
}

function clearPollTimer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearFallbackStartTimer() {
  if (fallbackStartTimer) {
    clearTimeout(fallbackStartTimer);
    fallbackStartTimer = null;
  }
}

function clearPendingStatePollTimer() {
  if (pendingStatePollTimer) {
    clearTimeout(pendingStatePollTimer);
    pendingStatePollTimer = null;
  }
}

function schedulePollState(delayMs = HTTP_FALLBACK_STATE_POLL_DELAY_MS) {
  clearPendingStatePollTimer();
  pendingStatePollTimer = setTimeout(() => {
    pendingStatePollTimer = null;
    pollState();
  }, delayMs);
}

function scheduleFallbackStart() {
  if (fallbackStartTimer) {
    return;
  }
  fallbackStartTimer = setTimeout(() => {
    fallbackStartTimer = null;
    if (ws) {
      return;
    }
    if (!isPageVisible()) {
      return;
    }
    if (!pollTimer) {
      pollTimer = setInterval(pollState, HTTP_FALLBACK_POLL_INTERVAL_MS);
    }
  }, WS_FALLBACK_GRACE_MS);
}

function scheduleSend(key, line, delayMs) {
  if (pendingSend[key]) {
    clearTimeout(pendingSend[key]);
  }
  pendingSend[key] = setTimeout(() => {
    sendLine(line);
    delete pendingSend[key];
  }, delayMs);
}

function requestFullSync(delayMs = 0) {
  const run = () => {
    const now = Date.now();
    if (now < syncCooldownUntilMs) {
      pendingSyncTimer = setTimeout(run, syncCooldownUntilMs - now);
      return;
    }
    syncCooldownUntilMs = Date.now() + SYNC_COOLDOWN_FULL_MS;
    sendLine("GET STATE");
    sendLine("GET SELECTOR_LABELS");
  };

  if (pendingSyncTimer) {
    clearTimeout(pendingSyncTimer);
    pendingSyncTimer = null;
  }
  if (delayMs > 0) {
    pendingSyncTimer = setTimeout(run, delayMs);
    return;
  }
  run();
}

function requestStateOnly() {
  const now = Date.now();
  if (now < syncCooldownUntilMs) {
    return;
  }
  syncCooldownUntilMs = Date.now() + SYNC_COOLDOWN_STATE_MS;
  sendLine("GET STATE");
}

function syncOnResume() {
  if (!isPageVisible()) {
    return;
  }
  const now = Date.now();
  if (now - lastReconnectKickMs < RECONNECT_KICK_MIN_INTERVAL_MS) {
    return;
  }
  lastReconnectKickMs = now;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    forceReconnectWebSocket();
    return;
  }
  connectWebSocket();
}

function startWsHealthTimer() {
  if (wsHealthTimer) {
    clearInterval(wsHealthTimer);
  }
  wsHealthTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const now = Date.now();
    if (!wsLastMessageMs) {
      wsLastMessageMs = now;
    }
    const idleMs = now - wsLastMessageMs;
    if (idleMs > 20000) {
      requestStateOnly();
    }
    if (idleMs > 45000) {
      forceReconnectWebSocket();
    }
  }, 5000);
}

function stopWsHealthTimer() {
  if (wsHealthTimer) {
    clearInterval(wsHealthTimer);
    wsHealthTimer = null;
  }
}

function queueLine(line) {
  const text = String(line || "").trim();
  if (!text) return;

  const m = text.match(/^SET\s+([A-Z_]+)\s+/i);
  if (m) {
    const key = `SET ${String(m[1]).toUpperCase()}`;
    for (let i = queuedLines.length - 1; i >= 0; i -= 1) {
      const existing = queuedLines[i];
      if (existing.toUpperCase().startsWith(`${key} `)) {
        queuedLines.splice(i, 1);
      }
    }
  }

  if (queuedLines.length >= MAX_QUEUED_LINES) {
    queuedLines.shift();
  }
  queuedLines.push(text);
}

function flushQueuedLines() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !queuedLines.length) {
    return;
  }
  const pending = queuedLines.slice();
  queuedLines = [];
  pending.forEach((line) => {
    try {
      ws.send(line);
    } catch (err) {
      queueLine(line);
    }
  });
}

async function postCommand(line, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch("/api/cmd", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: line,
      });
      if (res.ok) {
        schedulePollState(HTTP_FALLBACK_STATE_POLL_DELAY_MS);
        return true;
      }
    } catch (err) {
      // retry below
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, HTTP_FALLBACK_RETRY_BACKOFF_MS));
    }
  }
  return false;
}

function sendLine(line) {
  const text = String(line || "").trim();
  if (!text) {
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(text);
    return;
  }
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    queueLine(text);
    return;
  }
  postCommand(text).then((ok) => {
    if (!ok) {
      queueLine(text);
      connectWebSocket();
    }
  });
}

async function pollState() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  if (!isPageVisible()) {
    return;
  }
  if (pollInFlight) {
    return;
  }

  pollInFlight = true;
  try {
    const fetchLabels = labelsPollCountdown <= 0;
    if (fetchLabels) {
      labelsPollCountdown = HTTP_FALLBACK_LABELS_POLL_EVERY;
    } else {
      labelsPollCountdown -= 1;
    }

    const stateRes = await fetch("/api/state");
    const stateLine = (await stateRes.text()).trim();
    if (stateLine.startsWith("STATE ")) {
      handleStateLine(stateLine);
    }

    if (fetchLabels) {
      const labelsRes = await fetch("/api/labels");
      const labelsLine = (await labelsRes.text()).trim();
      if (labelsLine.startsWith("SELECTOR_LABELS")) {
        handleLabelsLine(labelsLine);
      }
    }
  } catch (err) {
    // best-effort polling fallback
  } finally {
    pollInFlight = false;
  }
}

function setActiveInput(value) {
  const buttons = inputGroupEl.querySelectorAll("button[data-input]");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.input === String(value));
  });
}

function updateInputOptions() {
  const current = inputGroupEl.dataset.current || "1";
  inputGroupEl.innerHTML = "";

  const keys = Object.keys(labels);
  const inputs = keys.length
    ? keys.sort((a, b) => Number(a) - Number(b))
    : ["1", "2", "3", "4"];

  inputs.forEach((key) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "input-btn";
    btn.dataset.input = key;
    btn.textContent = labels[key] || `Input ${key}`;
    btn.addEventListener("click", () => {
      setActiveInput(key);
      sendLine(`SET INP ${key}`);
    });
    inputGroupEl.appendChild(btn);
  });

  inputGroupEl.dataset.current = String(current);
  setActiveInput(current);
}

function handleStateLine(line) {
  const parts = line.split(/\s+/);
  const state = {};
  for (let i = 1; i < parts.length; i += 1) {
    const kv = parts[i].split("=");
    const key = kv[0];
    const value = kv[1];
    if (key && value !== undefined) {
      state[key] = value;
    }
  }

  if (state.VOL !== undefined) {
    volumeEl.value = state.VOL;
    volumeValueEl.textContent = state.VOL;
  }
  if (state.BAL !== undefined) {
    balanceEl.value = state.BAL;
    balanceValueEl.textContent = state.BAL;
  }
  if (state.BRI !== undefined) {
    brightnessEl.value = state.BRI;
    brightnessValueEl.textContent = state.BRI;
  }
  if (state.INP !== undefined) {
    inputGroupEl.dataset.current = String(state.INP);
    setActiveInput(state.INP);
  }
  if (state.MUTE !== undefined) {
    const isMuted = Number(state.MUTE) === 1;
    muteEl.textContent = isMuted ? "On" : "Off";
    muteEl.classList.toggle("on", isMuted);
  }
}

function handleLabelsLine(line) {
  labels = {};
  const re = /INP(\d+)="([^"]*)"/g;
  let match = re.exec(line);
  while (match) {
    labels[match[1]] = match[2];
    match = re.exec(line);
  }
  updateInputOptions();
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const wsUrl = `ws://${window.location.host}/ws`;
  const socket = new WebSocket(wsUrl);
  ws = socket;

  socket.addEventListener("open", () => {
    if (ws !== socket) {
      return;
    }
    setStatus("Connected", true);
    wsLastMessageMs = Date.now();
    suspendCloseInProgress = false;
    labelsPollCountdown = 0;
    clearFallbackStartTimer();
    startWsHealthTimer();
    clearPollTimer();
    clearPendingStatePollTimer();
    if (startupPollTimer) {
      clearTimeout(startupPollTimer);
      startupPollTimer = null;
    }
    flushQueuedLines();
    requestFullSync(0);
  });

  socket.addEventListener("message", (event) => {
    if (ws !== socket) {
      return;
    }
    const line = String(event.data || "").trim();
    if (!line) return;
    wsLastMessageMs = Date.now();
    if (line.startsWith("STATE ")) {
      handleStateLine(line);
    } else if (line.startsWith("SELECTOR_LABELS")) {
      handleLabelsLine(line);
    }
  });

  socket.addEventListener("close", (event) => {
    if (ws !== socket) {
      return;
    }
    ws = null;
    setStatus("Disconnected", false);
    stopWsHealthTimer();

    const code = Number((event && event.code) || 0);
    const intentional = suspendCloseInProgress || !isPageVisible();
    const wsOnlyReconnect = code === 1001;

    if (!intentional && !wsOnlyReconnect) {
      scheduleFallbackStart();
    }
    if (!intentional && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, WS_RECONNECT_DELAY_MS);
    }
    suspendCloseInProgress = false;
  });

  socket.addEventListener("error", () => {
    if (ws !== socket) {
      return;
    }
    setStatus("Error", false);
    stopWsHealthTimer();
  });
}

function forceReconnectWebSocket() {
  clearReconnectTimer();
  clearFallbackStartTimer();
  try {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  } catch (err) {
    // ignore close errors
  }
  ws = null;
  connectWebSocket();
}

volumeEl.addEventListener("input", (event) => {
  const value = event.target.value;
  volumeValueEl.textContent = value;
  scheduleSend("vol", `SET VOL ${value}`, UI_DEBOUNCE_VOL_MS);
});

balanceEl.addEventListener("input", (event) => {
  const value = event.target.value;
  balanceValueEl.textContent = value;
  scheduleSend("bal", `SET BAL ${value}`, UI_DEBOUNCE_BAL_MS);
});

brightnessEl.addEventListener("input", (event) => {
  const value = event.target.value;
  brightnessValueEl.textContent = value;
  scheduleSend("bri", `SET BRI ${value}`, UI_DEBOUNCE_BRI_MS);
});

muteEl.addEventListener("click", () => {
  const isMuted = muteEl.classList.contains("on");
  const next = isMuted ? 0 : 1;
  sendLine(`SET MUTE ${next}`);
});

refreshEl.addEventListener("click", () => {
  requestFullSync(0);
});

initTheme();
updateInputOptions();
connectWebSocket();
startupPollTimer = setTimeout(() => {
  startupPollTimer = null;
  if (isPageVisible() && (!ws || ws.readyState !== WebSocket.OPEN)) {
    pollState();
  }
}, 1200);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    suspendCloseInProgress = false;
    syncOnResume();
    return;
  }
  clearPollTimer();
  clearReconnectTimer();
  clearFallbackStartTimer();
});

window.addEventListener("focus", () => {
  syncOnResume();
});

window.addEventListener("pageshow", () => {
  suspendCloseInProgress = false;
  syncOnResume();
});

window.addEventListener("pagehide", () => {
  suspendCloseInProgress = true;
  clearPollTimer();
  clearReconnectTimer();
  clearFallbackStartTimer();
  try {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  } catch (err) {
    // ignore close errors on backgrounding
  }
});
