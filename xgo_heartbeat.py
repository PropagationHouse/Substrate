#!/usr/bin/env python3
"""
XGO Boot Announce
-----------------
Runs once on XGO (Raspberry Pi) boot. Waits for network, then
announces its IP to the PC's proxy_server and exits.

Deploy to the Pi and run on boot:
    crontab -e
    @reboot sleep 15 && python3 /root/xgo_heartbeat.py

Or use the systemd service (xgo_heartbeat.service).

The proxy_server records request.remote_addr as the XGO's IP,
so this works automatically on both local WiFi and ZeroTier.
"""

import time
import urllib.request
import urllib.error
import socket
import json
import sys

# ── Configuration ─────────────────────────────────────────────────────
# PC IPs to try (ZeroTier first — works on any network, local WiFi as fallback)
PC_ZEROTIER_IP = "10.147.17.34"  # PC's ZeroTier IP (primary)
PC_LOCAL_IP = "10.0.0.250"       # PC's local WiFi IP (fallback)
PROXY_PORT = 8765
MAX_RETRIES = 30                 # give up after ~5 minutes
RETRY_DELAY = 10                 # seconds between retries


def announce(ip):
    """Send a single heartbeat POST to the PC."""
    url = f"http://{ip}:{PROXY_PORT}/api/xgo_heartbeat"
    req = urllib.request.Request(url, method='POST',
                                data=b'{}',
                                headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=5) as resp:
        result = json.loads(resp.read().decode())
        print(f"[XGO] Registered with PC at {ip} -> my IP: {result.get('registered_ip')}")
        return True


def main():
    print("[XGO] Boot announce starting...")
    print(f"[XGO] Will try zerotier={PC_ZEROTIER_IP}, local={PC_LOCAL_IP}")

    for attempt in range(1, MAX_RETRIES + 1):
        for ip in [PC_ZEROTIER_IP, PC_LOCAL_IP]:
            try:
                announce(ip)
                print("[XGO] Done. Exiting.")
                return
            except (urllib.error.URLError, OSError, socket.timeout) as e:
                print(f"[XGO] {ip} unreachable: {e}")
                continue

        print(f"[XGO] Attempt {attempt}/{MAX_RETRIES} failed, retrying in {RETRY_DELAY}s...")
        time.sleep(RETRY_DELAY)

    print("[XGO] Could not reach PC after all retries. Exiting.")
    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[XGO] Stopped")
        sys.exit(0)
