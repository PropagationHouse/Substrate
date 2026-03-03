#!/usr/bin/env python
"""
Substrate Wake / Daemon Installer
==================================

Manages the Substrate Gateway as a Windows Scheduled Task (ONLOGON).
The gateway runs persistently in the background and executes CIRCUITS.md
tasks when they come due.

Usage:
    python wake_circuits.py              # Run gateway headless (foreground, for testing)
    python wake_circuits.py --install    # Register schtasks ONLOGON daemon
    python wake_circuits.py --uninstall  # Remove scheduled task
    python wake_circuits.py --status     # Show task status
    python wake_circuits.py --once       # Single circuits pass and exit
    python wake_circuits.py --restart    # Stop + re-run the scheduled task
"""

import os
import sys
import json
import logging
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional

# ── Paths ──────────────────────────────────────────────────────────────
SUBSTRATE_ROOT = Path(__file__).parent.resolve()
SRC_PATH = SUBSTRATE_ROOT / "src"
sys.path.insert(0, str(SRC_PATH))

STATE_DIR = Path.home() / ".tpxgo"
LOG_DIR = STATE_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "wake_circuits.log"
GATEWAY_SCRIPT = STATE_DIR / "gateway.cmd"

# ── Logging ────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("wake_circuits")

# ── Constants ──────────────────────────────────────────────────────────
TASK_NAME = "SubstrateGateway"


# ======================================================================
# Single-shot circuits run
# ======================================================================

def run_once():
    """Run a single circuits pass with full tool access, then exit."""
    logger.info("=" * 60)
    logger.info(f"Single circuits pass at {datetime.now().isoformat()}")

    circuits_file = SUBSTRATE_ROOT / "CIRCUITS.md"
    if not circuits_file.exists():
        logger.warning("No CIRCUITS.md found — nothing to do")
        return

    try:
        from gateway.autonomous_runner import (
            run_autonomous_circuits,
            AutonomousConfig,
            get_autonomous_runner,
        )

        # Load model from the main app's config.json (same model user selected in UI)
        auto_config = AutonomousConfig.from_app_config(
            max_turns=50,
            max_tool_calls=200,
            total_timeout_seconds=1800,
            tools_enabled=True,
            notify_on_complete=True,
            notify_on_error=True,
        )

        logger.info(f"Model: {auto_config.default_model} @ {auto_config.ollama_url}")

        def _notify(title, msg):
            logger.info(f"NOTIFY: {title} — {msg}")
            try:
                from winotify import Notification
                Notification(app_id="Substrate", title=title, msg=msg, duration="short").show()
            except Exception:
                pass

        get_autonomous_runner(config=auto_config, on_notify=_notify)
        result = run_autonomous_circuits(session_key="main")

        logger.info(
            f"Done: success={result.success}, turns={result.turns}, "
            f"tools={result.tool_calls}, duration={result.duration_ms}ms"
        )
        if result.actions_taken:
            logger.info(f"Actions: {', '.join(result.actions_taken[:10])}")
        if result.error:
            logger.error(f"Error: {result.error}")

    except Exception as e:
        logger.error(f"Single-shot failed: {e}", exc_info=True)


# ======================================================================
# Scheduled Task management (schtasks)
# ======================================================================

def _build_gateway_cmd() -> str:
    """Build the gateway.cmd wrapper script content."""
    pythonw = Path(sys.executable).parent / "pythonw.exe"
    if not pythonw.exists():
        pythonw = Path(sys.executable)

    gateway_py = SUBSTRATE_ROOT / "gateway.py"
    lines = [
        "@echo off",
        f"rem Substrate Gateway daemon (installed {datetime.now().isoformat()})",
        f'cd /d "{SUBSTRATE_ROOT}"',
        f'"{pythonw}" "{gateway_py}" --headless',
    ]
    return "\r\n".join(lines) + "\r\n"


def _exec_schtasks(args: list) -> tuple:
    """Run schtasks and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            ["schtasks"] + args,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        return 1, "", str(e)


def install_daemon():
    """Register the gateway as a Windows Scheduled Task (ONLOGON)."""
    # Write the .cmd wrapper
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    script_content = _build_gateway_cmd()
    GATEWAY_SCRIPT.write_text(script_content, encoding="utf-8")
    logger.info(f"Wrote gateway script: {GATEWAY_SCRIPT}")

    # Resolve user for /RU
    username = os.environ.get("USERNAME", "")
    domain = os.environ.get("USERDOMAIN", "")
    task_user = f"{domain}\\{username}" if domain and username else username

    # Create the scheduled task
    base_args = [
        "/Create", "/F",
        "/SC", "ONLOGON",
        "/RL", "LIMITED",
        "/TN", TASK_NAME,
        "/TR", str(GATEWAY_SCRIPT),
    ]

    # Try with user first (interactive token), fall back without
    code, stdout, stderr = _exec_schtasks(
        base_args + ["/RU", task_user, "/NP", "/IT"] if task_user else base_args
    )
    if code != 0 and task_user:
        code, stdout, stderr = _exec_schtasks(base_args)

    if code != 0:
        detail = stderr or stdout
        hint = ""
        if "access is denied" in detail.lower():
            hint = " Try running as Administrator."
        print(f"✗ Failed to create task: {detail}{hint}")
        logger.error(f"schtasks create failed: {detail}")
        return False

    print(f"✓ Scheduled Task '{TASK_NAME}' registered (ONLOGON)")
    print(f"  Script: {GATEWAY_SCRIPT}")
    logger.info("Scheduled task installed")

    # Start it immediately
    code, _, stderr = _exec_schtasks(["/Run", "/TN", TASK_NAME])
    if code == 0:
        print(f"✓ Gateway started")
        logger.info("Gateway started via schtasks /Run")
    else:
        print(f"  (Could not auto-start: {stderr.strip()})")
        print(f"  It will start on next login, or run: python wake_circuits.py --restart")

    return True


def uninstall_daemon():
    """Remove the scheduled task and wrapper script."""
    # Remove old registry key if it exists (clean up legacy install)
    try:
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
        try:
            winreg.DeleteValue(key, "SubstrateGateway")
            print("  (Also removed legacy registry autostart)")
        except FileNotFoundError:
            pass
        winreg.CloseKey(key)
    except Exception:
        pass

    # Delete scheduled task
    code, stdout, stderr = _exec_schtasks(["/Delete", "/F", "/TN", TASK_NAME])
    if code == 0:
        print(f"✓ Scheduled Task '{TASK_NAME}' removed")
    else:
        print(f"  Task not found or already removed")

    # Remove wrapper script
    if GATEWAY_SCRIPT.exists():
        GATEWAY_SCRIPT.unlink()
        print(f"  Removed {GATEWAY_SCRIPT}")

    logger.info("Daemon uninstalled")
    return True


def restart_daemon():
    """Stop and re-run the scheduled task."""
    _exec_schtasks(["/End", "/TN", TASK_NAME])
    code, _, stderr = _exec_schtasks(["/Run", "/TN", TASK_NAME])
    if code == 0:
        print(f"✓ Gateway restarted")
    else:
        print(f"✗ Could not restart: {stderr.strip()}")
        print(f"  Is the task installed? Run: python wake_circuits.py --install")


def show_status():
    """Show the current scheduled task status."""
    code, stdout, stderr = _exec_schtasks(["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"])
    if code == 0:
        print(stdout)
    else:
        print(f"Task '{TASK_NAME}' not found.")
        print(f"Run: python wake_circuits.py --install")

    # Also show log tail
    if LOG_FILE.exists():
        print(f"\nRecent log ({LOG_FILE}):")
        lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
        for line in lines[-10:]:
            print(f"  {line}")


# ======================================================================
# Entry point
# ======================================================================

def main():
    parser = argparse.ArgumentParser(description="Substrate Gateway Daemon Manager")
    parser.add_argument("--install", action="store_true", help="Register ONLOGON scheduled task")
    parser.add_argument("--uninstall", action="store_true", help="Remove scheduled task")
    parser.add_argument("--status", action="store_true", help="Show task status + recent logs")
    parser.add_argument("--restart", action="store_true", help="Stop and re-run the task")
    parser.add_argument("--once", action="store_true", help="Single circuits pass and exit")

    args = parser.parse_args()

    if args.install:
        install_daemon()
    elif args.uninstall:
        uninstall_daemon()
    elif args.status:
        show_status()
    elif args.restart:
        restart_daemon()
    elif args.once:
        run_once()
    else:
        # Default: run gateway headless in foreground (for testing)
        print("Starting gateway headless (Ctrl+C to stop)...")
        print("Use --install to register as a persistent background daemon.")
        from gateway.tray_service import SubstrateGateway
        gateway = SubstrateGateway()
        gateway.run_headless()


if __name__ == "__main__":
    main()
