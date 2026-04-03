"""
Standalone launcher for Substrate's proxy_server.py (no Electron needed).
Runs the Flask + WebSocket server and keeps the process alive for
dashboard development.

Usage:  python start_standalone.py
"""
import sys, os, time, threading, signal

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print("[STANDALONE] Starting Substrate backend...", flush=True)

import proxy_server  # registers all Flask routes

# Monkey-patch the stdin reader so main()'s while-loop blocks forever
# instead of exiting on EOF (which happens without Electron's stdin pipe).
_stop = threading.Event()

def _blocking_reader():
    """Block until Ctrl+C instead of reading stdin."""
    _stop.wait()
    return None

proxy_server.get_message_from_frontend = _blocking_reader

# Use the real main() — it handles port cleanup, agent init, Flask + HTTPS
# startup (in daemon threads), and then enters the while-loop (which now
# blocks harmlessly via our patched reader).
try:
    proxy_server.main()
except KeyboardInterrupt:
    print("\n[STANDALONE] Shutting down.", flush=True)
    _stop.set()
except Exception as e:
    # main() exited (e.g. the while-loop broke out), but Flask threads
    # are daemon threads that die with main. Keep process alive.
    print(f"[STANDALONE] main() exited ({e}), keeping server alive...", flush=True)

# If main() returns for any reason, keep the process alive so Flask
# daemon threads continue serving. Block until Ctrl+C.
print("[STANDALONE] Server running. Press Ctrl+C to stop.", flush=True)
try:
    _stop.wait()
except KeyboardInterrupt:
    print("\n[STANDALONE] Shutting down.", flush=True)
