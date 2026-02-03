import time
import uasyncio as asyncio
import network
import ubinascii
import uhashlib
import json
import machine
import socket
from machine import UART, Pin

from config import (
    WIFI_MODE,
    WIFI_SSID,
    WIFI_PASSWORD,
    WIFI_AP_SSID,
    WIFI_AP_PASSWORD,
    WIFI_HOSTNAME,
    WIFI_CONFIG_FILE,
    WIFI_CONNECT_TIMEOUT_MS,
    MDNS_ENABLED,
    MDNS_HOSTNAME,
    HTTP_HOST,
    HTTP_PORT,
    UART_ID,
    UART_BAUD,
    UART_BITS,
    UART_PARITY,
    UART_STOP,
    UART_TX_PIN,
    UART_RX_PIN,
    UART_POLL_MS,
    UART_STARTUP_SYNC_DELAY_MS,
)

WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MDNS_ADDR = "224.0.0.251"
MDNS_PORT = 5353

clients = set()
last_state_line = None
last_labels_line = None
ap_setup_mode = False
ap_page_ssid = ""

AP_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preamp Bridge Setup</title>
    <style>
      body { font-family: Arial, sans-serif; background:#f6f1ea; margin:0; padding:24px; color:#2b241f; }
      .card { max-width:480px; margin:0 auto; background:#fffaf2; border:1px solid #e0d6c9; border-radius:16px; padding:20px; }
      h1 { margin:0 0 12px; }
      label { display:block; margin:14px 0 6px; font-weight:600; }
      input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid #d8cbbb; font-size:1rem; }
      button { margin-top:16px; padding:10px 14px; border-radius:10px; border:none; background:#1a7a6f; color:#fff; font-weight:600; }
      .note { margin-top:12px; color:#6b5f55; font-size:0.9rem; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Wi-Fi Setup</h1>
      <form method="post" action="/save">
        <label for="ssid">SSID</label>
        <input id="ssid" name="ssid" value="{ssid}" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" />
        <button type="submit">Update & Reboot</button>
      </form>
      <form method="post" action="/retry">
        <button type="submit">Try Existing Credentials</button>
      </form>
      <form method="post" action="/clear" onsubmit="return confirm('Clear saved Wi-Fi credentials?');">
        <button type="submit">Clear Credentials</button>
      </form>
      <div class="note">After saving, the bridge will reboot and join your Wi‑Fi.</div>
    </div>
  </body>
</html>
"""


def log(*args):
    print("[bridge]", *args)


def load_wifi_config():
    try:
        with open(WIFI_CONFIG_FILE, "r") as f:
            data = json.load(f)
        ssid = data.get("ssid")
        password = data.get("password")
        if ssid and password is not None:
            return {"ssid": ssid, "password": password}
    except (OSError, ValueError):
        return None
    return None


def save_wifi_config(ssid, password):
    data = {"ssid": ssid, "password": password}
    with open(WIFI_CONFIG_FILE, "w") as f:
        json.dump(data, f)


def start_ap():
    wlan = network.WLAN(network.AP_IF)
    wlan.active(True)
    wlan.config(essid=WIFI_AP_SSID, password=WIFI_AP_PASSWORD)
    time.sleep_ms(200)
    ip = wlan.ifconfig()[0]
    log("AP mode up:", WIFI_AP_SSID, "IP:", ip)
    return wlan


def wifi_connect(creds, force_ap):
    if force_ap or WIFI_MODE == "ap":
        return start_ap(), "ap", False

    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    try:
        network.hostname(WIFI_HOSTNAME)
    except Exception:
        pass

    if not wlan.isconnected():
        ssid = creds["ssid"]
        password = creds["password"]
        log("Connecting to Wi-Fi:", ssid)
        wlan.connect(ssid, password)
        t0 = time.ticks_ms()
        while not wlan.isconnected():
            if time.ticks_diff(time.ticks_ms(), t0) > WIFI_CONNECT_TIMEOUT_MS:
                log("Wi-Fi connect timeout")
                break
            time.sleep_ms(250)

    if wlan.isconnected():
        ip = wlan.ifconfig()[0]
        log("Connected, IP:", ip)
        return wlan, "sta", True

    log("Wi-Fi not connected; check credentials")
    return wlan, "sta", False


def uart_init():
    uart = UART(
        UART_ID,
        baudrate=UART_BAUD,
        bits=UART_BITS,
        parity=UART_PARITY,
        stop=UART_STOP,
        tx=Pin(UART_TX_PIN),
        rx=Pin(UART_RX_PIN),
    )
    return uart


def uart_send(uart, line):
    try:
        uart.write((line + "\n").encode("utf-8"))
        log("UART ->", line)
    except Exception as exc:
        log("UART write error:", exc)


def ws_accept_key(key):
    raw = (key + WS_MAGIC).encode("utf-8")
    digest = uhashlib.sha1(raw).digest()
    return ubinascii.b2a_base64(digest).strip().decode("utf-8")


def parse_request_line(line):
    try:
        parts = line.decode().strip().split()
        if len(parts) < 2:
            return None, None
        return parts[0], parts[1]
    except Exception:
        return None, None


async def read_exactly(reader, n):
    data = b""
    while len(data) < n:
        chunk = await reader.read(n - len(data))
        if not chunk:
            raise OSError("socket closed")
        data += chunk
    return data


class WebSocket:
    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.closed = False

    async def recv(self):
        try:
            header = await read_exactly(self.reader, 2)
        except Exception:
            return None

        b1 = header[0]
        b2 = header[1]
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        length = b2 & 0x7F

        if length == 126:
            ext = await read_exactly(self.reader, 2)
            length = (ext[0] << 8) | ext[1]
        elif length == 127:
            ext = await read_exactly(self.reader, 8)
            length = 0
            for b in ext:
                length = (length << 8) | b

        mask = b""
        if masked:
            mask = await read_exactly(self.reader, 4)

        payload = await read_exactly(self.reader, length) if length else b""
        if masked and payload:
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))

        if opcode == 8:
            return None
        if opcode == 9:
            await self._send_frame(payload, opcode=10)
            return ""
        if opcode != 1:
            return ""

        try:
            return payload.decode("utf-8")
        except Exception:
            return ""

    async def _send_frame(self, payload, opcode=1):
        if self.closed:
            return
        header = bytearray()
        header.append(0x80 | (opcode & 0x0F))
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header.extend(bytearray([(length >> 8) & 0xFF, length & 0xFF]))
        else:
            header.append(127)
            for shift in (56, 48, 40, 32, 24, 16, 8, 0):
                header.append((length >> shift) & 0xFF)

        try:
            self.writer.write(header)
            if payload:
                self.writer.write(payload)
            await self.writer.drain()
        except Exception:
            self.closed = True

    async def send_text(self, text):
        await self._send_frame(text.encode("utf-8"), opcode=1)

    async def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            await self._send_frame(b"", opcode=8)
        except Exception:
            pass
        try:
            await self.writer.wait_closed()
        except Exception:
            pass


async def broadcast(line):
    if not clients:
        return
    dead = []
    for ws in clients:
        try:
            await ws.send_text(line)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def normalize_client_command(line):
    raw = line.strip()
    if not raw:
        return None

    upper = raw.upper()
    if upper.startswith("GET ") or upper.startswith("SET "):
        return raw

    parts = raw.split()
    if len(parts) == 2:
        key = parts[0].upper()
        value = parts[1]
        if key in ("VOL", "BAL", "INP", "MUTE", "BRI"):
            return "SET %s %s" % (key, value)

    return None


def handle_uart_line(line):
    global last_state_line, last_labels_line

    if line.startswith("STATE "):
        last_state_line = line
        return "state"
    if line.startswith("SELECTOR_LABELS"):
        last_labels_line = line
        return "labels"
    return "other"


async def uart_reader_task(uart):
    while True:
        if uart.any():
            raw = uart.readline()
            if raw:
                try:
                    if isinstance(raw, str):
                        line = raw.strip()
                    else:
                        line = bytes(raw).decode("utf-8").strip()
                except Exception:
                    line = "ERR BAD_VALUE"

                if line:
                    kind = handle_uart_line(line)
                    log("UART <-", line)
                    await broadcast(line)
        await asyncio.sleep_ms(UART_POLL_MS)


async def uart_startup_sync(uart):
    await asyncio.sleep_ms(UART_STARTUP_SYNC_DELAY_MS)
    uart_send(uart, "GET STATE")
    uart_send(uart, "GET SELECTOR_LABELS")


async def ws_session(ws, uart):
    clients.add(ws)
    try:
        if last_labels_line:
            await ws.send_text(last_labels_line)
        if last_state_line:
            await ws.send_text(last_state_line)

        while True:
            msg = await ws.recv()
            if msg is None:
                break
            msg = msg.strip()
            if not msg:
                continue

            cmd = normalize_client_command(msg)
            if cmd:
                uart_send(uart, cmd)
            elif msg.upper().startswith("GET "):
                uart_send(uart, msg)
    finally:
        clients.discard(ws)
        await ws.close()


async def handle_http(reader, writer, uart):
    request_line = await reader.readline()
    if not request_line:
        await writer.wait_closed()
        return

    method, path = parse_request_line(request_line)
    headers = {}
    while True:
        line = await reader.readline()
        if not line or line in (b"\r\n", b"\n"):
            break
        try:
            key, value = line.decode().split(":", 1)
            headers[key.strip().lower()] = value.strip()
        except Exception:
            continue

    if headers.get("upgrade", "").lower() == "websocket":
        if ap_setup_mode:
            await send_response(writer, 403, "text/plain", "Setup mode")
            return
        key = headers.get("sec-websocket-key")
        if not key:
            await writer.wait_closed()
            return
        accept = ws_accept_key(key)
        resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: %s\r\n\r\n"
        ) % accept
        writer.write(resp.encode("utf-8"))
        await writer.drain()
        ws = WebSocket(reader, writer)
        await ws_session(ws, uart)
        return

    if method == "POST" and path == "/save":
        length = int(headers.get("content-length", "0") or "0")
        body = b""
        if length:
            body = await read_exactly(reader, length)
        data = parse_form(body)
        ssid = data.get("ssid", "")
        password = data.get("password", "")
        if ssid:
            save_wifi_config(ssid, password)
            await send_response(
                writer,
                200,
                "text/html",
                "<html><body><h3>Saved. Rebooting...</h3></body></html>",
            )
            await asyncio.sleep(0.2)
            machine.reset()
            return
        await send_response(writer, 400, "text/plain", "Missing SSID")
        return
    if method == "POST" and path == "/retry":
        await send_response(
            writer,
            200,
            "text/html",
            "<html><body><h3>Retrying. Rebooting...</h3></body></html>",
        )
        await asyncio.sleep(0.2)
        machine.reset()
        return
    if method == "POST" and path == "/clear":
        try:
            with open(WIFI_CONFIG_FILE, "r"):
                pass
            try:
                import os
                os.remove(WIFI_CONFIG_FILE)
            except Exception:
                pass
        except Exception:
            pass
        await send_response(
            writer,
            200,
            "text/html",
            "<html><body><h3>Cleared. Rebooting...</h3></body></html>",
        )
        await asyncio.sleep(0.2)
        machine.reset()
        return

    if method != "GET":
        await send_response(writer, 405, "text/plain", "Method Not Allowed")
        return

    if path == "/" or path == "/index.html":
        if ap_setup_mode:
            await send_response(
                writer, 200, "text/html", AP_PAGE.format(ssid=ap_page_ssid)
            )
        else:
            await send_file(writer, "web/index.html", "text/html")
        return
    if path == "/app.js":
        await send_file(writer, "web/app.js", "application/javascript")
        return
    if path == "/style.css":
        await send_file(writer, "web/style.css", "text/css")
        return

    await send_response(writer, 404, "text/plain", "Not Found")


async def send_response(writer, status_code, content_type, body):
    status_text = {
        200: "OK",
        400: "Bad Request",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
    }.get(status_code, "OK")

    data = body.encode("utf-8")
    header = (
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n\r\n"
    ) % (status_code, status_text, content_type, len(data))

    writer.write(header.encode("utf-8"))
    writer.write(data)
    await writer.drain()
    await writer.wait_closed()


async def send_file(writer, path, content_type):
    try:
        with open(path, "r") as f:
            body = f.read()
        await send_response(writer, 200, content_type, body)
    except OSError:
        await send_response(writer, 404, "text/plain", "Not Found")


def parse_form(body):
    result = {}
    if not body:
        return result
    try:
        text = body.decode("utf-8")
    except Exception:
        return result
    for part in text.split("&"):
        if "=" in part:
            key, value = part.split("=", 1)
            result[url_decode(key)] = url_decode(value)
    return result


def url_decode(value):
    value = value.replace("+", " ")
    out = ""
    i = 0
    while i < len(value):
        ch = value[i]
        if ch == "%" and i + 2 < len(value):
            try:
                out += chr(int(value[i + 1 : i + 3], 16))
                i += 3
                continue
            except Exception:
                pass
        out += ch
        i += 1
    return out


def decode_dns_name(data, offset):
    labels = []
    jumped = False
    jump_offset = 0
    while True:
        if offset >= len(data):
            return "", offset
        length = data[offset]
        if length == 0:
            offset += 1
            break
        if length & 0xC0:
            if offset + 1 >= len(data):
                return "", offset + 1
            pointer = ((length & 0x3F) << 8) | data[offset + 1]
            if not jumped:
                jump_offset = offset + 2
                jumped = True
            offset = pointer
            continue
        offset += 1
        if offset + length > len(data):
            return "", offset + length
        labels.append(data[offset : offset + length].decode("utf-8"))
        offset += length
    name = ".".join(labels)
    return name, (jump_offset if jumped else offset)


def build_mdns_response(data, ip, hostname):
    if len(data) < 12:
        return None
    qdcount = (data[4] << 8) | data[5]
    if qdcount < 1:
        return None

    qname, qend = decode_dns_name(data, 12)
    if not qname:
        return None
    if qend + 4 > len(data):
        return None
    qtype = (data[qend] << 8) | data[qend + 1]
    qclass = (data[qend + 2] << 8) | data[qend + 3]

    target = hostname.lower() + ".local"
    if qname.lower().rstrip(".") != target:
        return None
    if qtype not in (1, 255):  # A or ANY
        return None

    question = data[12 : qend + 4]
    ip_bytes = bytes(int(part) for part in ip.split("."))

    resp = bytearray()
    resp += data[0:2]            # ID
    resp += b"\x84\x00"          # QR=1, AA=1
    resp += b"\x00\x01"          # QDCOUNT
    resp += b"\x00\x01"          # ANCOUNT
    resp += b"\x00\x00"          # NSCOUNT
    resp += b"\x00\x00"          # ARCOUNT
    resp += question
    resp += b"\xC0\x0C"          # NAME (pointer to qname)
    resp += b"\x00\x01"          # TYPE A
    resp += b"\x80\x01"          # CLASS IN with cache flush
    resp += b"\x00\x00\x00\x78"  # TTL 120s
    resp += b"\x00\x04"          # RDLENGTH
    resp += ip_bytes
    return resp


async def mdns_task(ip, hostname):
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
            mreq = socket.inet_aton(MDNS_ADDR) + socket.inet_aton("0.0.0.0")
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        except Exception:
            pass
        sock.bind(("0.0.0.0", MDNS_PORT))
        sock.setblocking(False)
    except Exception as exc:
        log("mDNS disabled:", exc)
        return

    log("mDNS responder active:", hostname + ".local")

    while True:
        try:
            data, addr = sock.recvfrom(512)
        except OSError:
            await asyncio.sleep_ms(50)
            continue
        if not data:
            continue
        resp = build_mdns_response(data, ip, hostname)
        if resp:
            try:
                sock.sendto(resp, (MDNS_ADDR, MDNS_PORT))
            except Exception:
                pass


async def main():
    stored = load_wifi_config()
    if stored:
        creds = stored
        force_ap = False
    else:
        creds = {"ssid": WIFI_SSID, "password": WIFI_PASSWORD}
        force_ap = True

    global ap_setup_mode
    ap_setup_mode = force_ap
    global ap_page_ssid
    ap_page_ssid = creds.get("ssid", "")

    wlan, mode, sta_connected = wifi_connect(creds, force_ap)
    if mode == "sta" and not sta_connected:
        ap_setup_mode = True
        wlan = start_ap()
        mode = "ap"
    uart = uart_init()

    asyncio.create_task(uart_reader_task(uart))
    asyncio.create_task(uart_startup_sync(uart))

    server = await asyncio.start_server(
        lambda r, w: handle_http(r, w, uart), HTTP_HOST, HTTP_PORT
    )
    log("HTTP server listening on", HTTP_HOST, HTTP_PORT)

    if mode == "sta" and sta_connected and MDNS_ENABLED:
        ip = wlan.ifconfig()[0]
        asyncio.create_task(mdns_task(ip, MDNS_HOSTNAME))

    if mode == "ap" and not stored:
        log("AP mode config: connect to", WIFI_AP_SSID, "and open http://", wlan.ifconfig()[0])
        log("Save SSID/password to reboot into STA mode.")

    while True:
        await asyncio.sleep(5)


try:
    asyncio.run(main())
finally:
    asyncio.new_event_loop()
