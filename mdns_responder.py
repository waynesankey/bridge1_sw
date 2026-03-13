"""mDNS announcer for MicroPython on Pico W.

The firmware holds port 5353 so we cannot receive queries. Instead we
send unsolicited mDNS announcements to the multicast group so every
device on the LAN caches preamp.local -> our IP.

  - Burst of 3 announcements at 1 s intervals on first connect
  - Then one announcement every ANNOUNCE_INTERVAL_S seconds
  - OS caches the record for MDNS_TTL seconds; with a 30 s interval
    and 120 s TTL the cache is always warm before it expires

Usage:
    from mdns_responder import MDNSResponder
    import uasyncio as asyncio

    asyncio.create_task(MDNSResponder("preamp", lambda: sta_ip).run())
"""

import socket
import struct
import sys
import uasyncio as asyncio

MDNS_ADDR = "224.0.0.251"
MDNS_PORT = 5353
MDNS_TTL = 120          # seconds clients cache the record
ANNOUNCE_INTERVAL_S = 30
BURST_COUNT = 3
BURST_INTERVAL_S = 1


def _encode_name(name):
    out = bytearray()
    for label in name.rstrip(".").split("."):
        b = label.encode()
        out.append(len(b))
        out.extend(b)
    out.append(0)
    return bytes(out)


def _build_announcement(name, ip_str):
    """Build an unsolicited mDNS A-record announcement (query ID = 0)."""
    name_enc = _encode_name(name)
    ip_bytes = bytes(int(x) for x in ip_str.split("."))
    # Flags: QR=1 (response), AA=1 (authoritative)
    hdr = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 0)
    # Answer RR: name | TYPE=A | CLASS=IN with cache-flush | TTL | RDLEN=4 | IP
    rr = name_enc + struct.pack("!HHIH", 1, 0x8001, MDNS_TTL, 4) + ip_bytes
    return hdr + rr


def _send(pkt):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.sendto(pkt, (MDNS_ADDR, MDNS_PORT))
    finally:
        s.close()


class MDNSResponder:
    def __init__(self, hostname):
        """
        hostname : bare name e.g. "preamp"  (no .local suffix)
        Reads sta_ip directly from the __main__ module at runtime so it
        always sees the current value regardless of MicroPython closure rules.
        """
        self._fqdn = hostname.lower() + ".local"

    def _get_ip(self):
        main = sys.modules.get("__main__")
        if main is None:
            return ""
        return getattr(main, "sta_ip", "")

    def _announce(self, ip):
        try:
            _send(_build_announcement(self._fqdn, ip))
        except Exception as e:
            print("[mdns] send error:", e)

    async def run(self):
        print("[mdns] Announcer ready for", self._fqdn)
        last_ip = ""
        while True:
            try:
                ip = self._get_ip()
                print("[mdns] get_ip =", repr(ip))
                if ip:
                    if ip != last_ip:
                        # New or changed IP: burst-announce so caches fill quickly
                        print("[mdns] Announcing", self._fqdn, "->", ip)
                        for _ in range(BURST_COUNT):
                            self._announce(ip)
                            await asyncio.sleep(BURST_INTERVAL_S)
                        last_ip = ip
                    else:
                        self._announce(ip)
                        await asyncio.sleep(ANNOUNCE_INTERVAL_S)
                else:
                    last_ip = ""
                    await asyncio.sleep(1)
            except Exception as e:
                print("[mdns] run error:", e)
                await asyncio.sleep(5)
