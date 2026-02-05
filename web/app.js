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

let ws = null;
let reconnectTimer = null;
let pendingSend = {};
let labels = {};
let pollTimer = null;

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", !!ok);
  if (statusDotEl) {
    statusDotEl.classList.toggle("ok", !!ok);
  }
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

function sendLine(line) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    postCommand(line);
    return;
  }
  ws.send(line);
}

async function postCommand(line) {
  try {
    const res = await fetch("/api/cmd", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: line,
    });
    if (res.ok) {
      // In HTTP fallback mode, pull fresh state after command ACK/STATE settles.
      setTimeout(pollState, 180);
    }
  } catch (err) {
    // keep UI responsive; status already reflects disconnect
  }
}

async function pollState() {
  try {
    const [stateRes, labelsRes] = await Promise.all([
      fetch("/api/state"),
      fetch("/api/labels"),
    ]);
    const stateLine = (await stateRes.text()).trim();
    const labelsLine = (await labelsRes.text()).trim();
    if (stateLine.startsWith("STATE ")) {
      handleStateLine(stateLine);
    }
    if (labelsLine.startsWith("SELECTOR_LABELS")) {
      handleLabelsLine(labelsLine);
    }
  } catch (err) {
    // best-effort polling fallback
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
    const [key, value] = parts[i].split("=");
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
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    setStatus("Connected", true);
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    sendLine("GET STATE");
    sendLine("GET SELECTOR_LABELS");
  });

  ws.addEventListener("message", (event) => {
    const line = String(event.data || "").trim();
    if (!line) return;
    if (line.startsWith("STATE ")) {
      handleStateLine(line);
    } else if (line.startsWith("SELECTOR_LABELS")) {
      handleLabelsLine(line);
    }
  });

  ws.addEventListener("close", () => {
    setStatus("Disconnected", false);
    if (!pollTimer) {
      pollTimer = setInterval(pollState, 1000);
    }
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2000);
    }
  });

  ws.addEventListener("error", () => {
    setStatus("Error", false);
  });
}

function forceReconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
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
  scheduleSend("vol", `SET VOL ${value}`, 100);
});

balanceEl.addEventListener("input", (event) => {
  const value = event.target.value;
  balanceValueEl.textContent = value;
  scheduleSend("bal", `SET BAL ${value}`, 100);
});

brightnessEl.addEventListener("input", (event) => {
  const value = event.target.value;
  brightnessValueEl.textContent = value;
  scheduleSend("bri", `SET BRI ${value}`, 150);
});

muteEl.addEventListener("click", () => {
  const isMuted = muteEl.classList.contains("on");
  const next = isMuted ? 0 : 1;
  sendLine(`SET MUTE ${next}`);
});

refreshEl.addEventListener("click", () => {
  sendLine("GET STATE");
  sendLine("GET SELECTOR_LABELS");
});

updateInputOptions();
connectWebSocket();
pollState();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    forceReconnectWebSocket();
    pollState();
  }
});

window.addEventListener("focus", () => {
  forceReconnectWebSocket();
  pollState();
});

window.addEventListener("pageshow", () => {
  forceReconnectWebSocket();
  pollState();
});
