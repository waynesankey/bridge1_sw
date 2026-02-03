const statusEl = document.getElementById("status");
const volumeEl = document.getElementById("volume");
const volumeValueEl = document.getElementById("volumeValue");
const balanceEl = document.getElementById("balance");
const balanceValueEl = document.getElementById("balanceValue");
const brightnessEl = document.getElementById("brightness");
const brightnessValueEl = document.getElementById("brightnessValue");
const inputSelectEl = document.getElementById("inputSelect");
const muteEl = document.getElementById("mute");
const refreshEl = document.getElementById("refresh");
const stateLineEl = document.getElementById("stateLine");

let ws = null;
let reconnectTimer = null;
let pendingSend = {};
let labels = {};

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.classList.toggle("ok", !!ok);
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
    return;
  }
  ws.send(line);
}

function updateInputOptions() {
  const current = Number(inputSelectEl.value || 1);
  inputSelectEl.innerHTML = "";

  const keys = Object.keys(labels);
  if (keys.length === 0) {
    for (let i = 1; i <= 4; i += 1) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Input ${i}`;
      inputSelectEl.appendChild(opt);
    }
  } else {
    keys.sort((a, b) => Number(a) - Number(b));
    for (const key of keys) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = labels[key] || `Input ${key}`;
      inputSelectEl.appendChild(opt);
    }
  }

  inputSelectEl.value = String(current);
}

function handleStateLine(line) {
  stateLineEl.textContent = line;
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
    inputSelectEl.value = state.INP;
  }
  if (state.MUTE !== undefined) {
    const isMuted = String(state.MUTE) === "1";
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
  const wsUrl = `ws://${window.location.host}/ws`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    setStatus("Connected", true);
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

inputSelectEl.addEventListener("change", (event) => {
  const value = event.target.value;
  sendLine(`SET INP ${value}`);
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
