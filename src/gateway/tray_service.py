"""
Substrate Gateway - System Tray Background Service
===================================================

A lightweight background daemon that:
- Runs circuits on schedule (even when UI is closed)
- Executes cron jobs on time
- Shows Windows toast notifications
- Provides system tray icon with quick actions
- Persists across app restarts

Usage:
    pythonw tray_service.py  # Run hidden (no console)
    python tray_service.py   # Run with console (for debugging)
"""

import os
import sys
import time
import json
import logging
import threading
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Callable, List
from dataclasses import dataclass, field

# Setup logging
LOG_DIR = Path.home() / ".tpxgo" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "gateway.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger("gateway")

# Try to import Windows-specific libraries
HAS_PYSTRAY = False
HAS_WIN10TOAST = False
HAS_WINOTIFY = False

try:
    import pystray
    from PIL import Image, ImageDraw
    HAS_PYSTRAY = True
except ImportError:
    logger.warning("pystray not installed. Run: pip install pystray pillow")

try:
    from winotify import Notification, audio
    HAS_WINOTIFY = True
except ImportError:
    try:
        from win10toast import ToastNotifier
        HAS_WIN10TOAST = True
    except ImportError:
        logger.warning("No toast library. Run: pip install winotify")


# Configuration
CONFIG_DIR = Path.home() / ".tpxgo"
CONFIG_FILE = CONFIG_DIR / "gateway_config.json"
STATE_FILE = CONFIG_DIR / "gateway_state.json"
EVENTS_FILE = CONFIG_DIR / "pending_events.json"


@dataclass
class GatewayConfig:
    """Gateway configuration."""
    circuits_enabled: bool = True
    circuits_interval_seconds: int = 300  # 5 minutes
    circuits_active_hours_start: Optional[str] = None  # "09:00"
    circuits_active_hours_end: Optional[str] = None    # "22:00"
    cron_enabled: bool = True
    notifications_enabled: bool = True
    auto_start: bool = False
    substrate_path: Optional[str] = None  # Path to main Substrate app
    ollama_url: str = "http://localhost:11434"
    default_model: str = "dolphin3:latest"
    
    @classmethod
    def load(cls) -> "GatewayConfig":
        """Load config from file."""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                return cls(**{k: v for k, v in data.items() if hasattr(cls, k)})
            except Exception as e:
                logger.error(f"Failed to load config: {e}")
        return cls()
    
    def save(self):
        """Save config to file."""
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, 'w') as f:
            json.dump(self.__dict__, f, indent=2)


@dataclass
class GatewayState:
    """Runtime state."""
    running: bool = False
    started_at: Optional[str] = None
    last_circuits_run: Optional[str] = None
    circuits_count: int = 0
    last_cron_check: Optional[str] = None
    cron_jobs_run: int = 0
    errors: List[str] = field(default_factory=list)
    
    @classmethod
    def load(cls) -> "GatewayState":
        """Load state from file."""
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE, 'r') as f:
                    data = json.load(f)
                return cls(**{k: v for k, v in data.items() if hasattr(cls, k)})
            except Exception:
                pass
        return cls()
    
    def save(self):
        """Save state to file."""
        with open(STATE_FILE, 'w') as f:
            json.dump(self.__dict__, f, indent=2)


class NotificationManager:
    """Handle Windows toast notifications."""
    
    def __init__(self):
        self.app_id = "Substrate"
        self._toast_notifier = None
        if HAS_WIN10TOAST and not HAS_WINOTIFY:
            self._toast_notifier = ToastNotifier()
    
    def notify(
        self,
        title: str,
        message: str,
        icon_path: Optional[str] = None,
        duration: str = "short",
        on_click: Optional[Callable] = None,
    ):
        """Show a Windows toast notification."""
        if HAS_WINOTIFY:
            try:
                toast = Notification(
                    app_id=self.app_id,
                    title=title,
                    msg=message,
                    duration=duration,
                )
                if icon_path and Path(icon_path).exists():
                    toast.set_audio(audio.Default, loop=False)
                toast.show()
                return True
            except Exception as e:
                logger.error(f"winotify error: {e}")
        
        elif HAS_WIN10TOAST and self._toast_notifier:
            try:
                self._toast_notifier.show_toast(
                    title,
                    message,
                    icon_path=icon_path,
                    duration=5 if duration == "short" else 10,
                    threaded=True,
                )
                return True
            except Exception as e:
                logger.error(f"win10toast error: {e}")
        
        else:
            # Fallback: log it
            logger.info(f"NOTIFICATION: {title} - {message}")
        
        return False


class CircuitsScheduler:
    """Schedule-aware circuits runner.
    
    Instead of polling every N minutes, this parses CIRCUITS.md schedules
    locally, computes when the next task is due, and sleeps until that
    exact time. Zero model calls between tasks. Uses a schedule-aware
    timer pattern: parse → sleep → runDueJobs → re-arm.
    """
    
    # How often to check if CIRCUITS.md was edited (seconds).
    # This is a cheap local stat() call, not a model call.
    FILE_CHECK_INTERVAL = 60
    
    def __init__(
        self,
        config: GatewayConfig,
        state: GatewayState,
        notifications: NotificationManager,
        on_circuits: Optional[Callable[[str], str]] = None,
    ):
        self.config = config
        self.state = state
        self.notifications = notifications
        self.on_circuits = on_circuits
        
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._circuits_path = Path(__file__).parent.parent.parent / "CIRCUITS.md"
        self._last_mtime: Optional[float] = None
    
    def is_within_active_hours(self) -> bool:
        """Check if current time is within active hours."""
        if not self.config.circuits_active_hours_start:
            return True
        if not self.config.circuits_active_hours_end:
            return True
        
        try:
            now = datetime.now()
            start = datetime.strptime(self.config.circuits_active_hours_start, "%H:%M").time()
            end = datetime.strptime(self.config.circuits_active_hours_end, "%H:%M").time()
            current = now.time()
            
            if start <= end:
                return start <= current <= end
            else:
                return current >= start or current <= end
        except Exception:
            return True
    
    def _file_changed(self) -> bool:
        """Check if CIRCUITS.md was modified since last parse."""
        try:
            mtime = self._circuits_path.stat().st_mtime
            if self._last_mtime is None:
                self._last_mtime = mtime
                return False
            if mtime != self._last_mtime:
                self._last_mtime = mtime
                return True
        except FileNotFoundError:
            pass
        return False
    
    def run_circuits(self) -> Optional[str]:
        """Execute a single circuits run (calls the model)."""
        if not self.config.circuits_enabled:
            return None
        
        if not self.is_within_active_hours():
            logger.debug("Outside active hours, skipping circuits")
            return None
        
        logger.info("Running circuits...")
        
        try:
            if self.on_circuits:
                response = self.on_circuits("circuits")
                self.state.last_circuits_run = datetime.now().isoformat()
                self.state.circuits_count += 1
                self.state.save()
                
                if response and "CIRCUITS_OK" not in response:
                    self.notifications.notify(
                        "Substrate Circuits",
                        response[:200] + ("..." if len(response) > 200 else ""),
                    )
                
                return response
            else:
                self.state.last_circuits_run = datetime.now().isoformat()
                self.state.circuits_count += 1
                self.state.save()
                return "CIRCUITS_OK"
                
        except Exception as e:
            logger.error(f"Circuits error: {e}")
            self.state.errors.append(f"{datetime.now().isoformat()}: {str(e)}")
            if len(self.state.errors) > 100:
                self.state.errors = self.state.errors[-100:]
            self.state.save()
            return None
    
    def _scheduler_loop(self):
        """Schedule-aware loop: parse → compute next due → sleep → run → repeat."""
        from .schedule_parser import parse_circuits_file, next_wake_at, get_due_jobs
        
        while not self._stop_event.is_set():
            try:
                # Parse CIRCUITS.md and compute next due times
                jobs = parse_circuits_file(self._circuits_path)
                self._last_mtime = (
                    self._circuits_path.stat().st_mtime
                    if self._circuits_path.exists() else None
                )
                
                if not jobs:
                    logger.info("No scheduled jobs found in CIRCUITS.md, rechecking in 5m")
                    self._stop_event.wait(300)
                    continue
                
                wake_at = next_wake_at(jobs)
                if not wake_at:
                    logger.info("No upcoming due times, rechecking in 5m")
                    self._stop_event.wait(300)
                    continue
                
                # Sleep until next due time, but wake periodically to check
                # for file edits (cheap local stat, no model call)
                now = datetime.now()
                total_wait = (wake_at - now).total_seconds()
                
                if total_wait > 0:
                    logger.info(
                        f"Next task due at {wake_at.strftime('%Y-%m-%d %H:%M')} "
                        f"({total_wait/3600:.1f}h from now). Sleeping..."
                    )
                
                # Wait in FILE_CHECK_INTERVAL chunks so we can detect edits
                while total_wait > 0 and not self._stop_event.is_set():
                    chunk = min(total_wait, self.FILE_CHECK_INTERVAL)
                    self._stop_event.wait(chunk)
                    
                    if self._stop_event.is_set():
                        break
                    
                    # Check if file was edited — re-parse if so
                    if self._file_changed():
                        logger.info("CIRCUITS.md changed, re-parsing schedules")
                        break  # Break inner loop to re-parse
                    
                    now = datetime.now()
                    total_wait = (wake_at - now).total_seconds()
                
                if self._stop_event.is_set():
                    break
                
                # Re-parse to get fresh state (file may have changed, or
                # we need to confirm which jobs are actually due now)
                jobs = parse_circuits_file(self._circuits_path)
                due = get_due_jobs(jobs)
                
                if due:
                    names = [j.name for j in due]
                    logger.info(f"{len(due)} job(s) due: {', '.join(names)}")
                    self.run_circuits()
                else:
                    logger.debug("Re-parsed but no jobs due yet, looping")
                
            except Exception as e:
                logger.error(f"Scheduler error: {e}")
                # On error, wait a bit before retrying
                self._stop_event.wait(60)
    
    def start(self):
        """Start the scheduler."""
        if self._running:
            return
        
        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._thread.start()
        logger.info("Circuits scheduler started (schedule-aware, zero-poll)")
    
    def stop(self):
        """Stop the scheduler."""
        self._running = False
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Circuits scheduler stopped")


# Backward compat alias
HeartbeatScheduler = CircuitsScheduler


class CronScheduler:
    """Run cron jobs on schedule."""
    
    def __init__(
        self,
        config: GatewayConfig,
        state: GatewayState,
        notifications: NotificationManager,
    ):
        self.config = config
        self.state = state
        self.notifications = notifications
        
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._jobs_file = CONFIG_DIR / "cron_jobs.json"
    
    def load_jobs(self) -> List[Dict[str, Any]]:
        """Load cron jobs from file."""
        if self._jobs_file.exists():
            try:
                with open(self._jobs_file, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return []
    
    def check_and_run_jobs(self):
        """Check for due jobs and run them."""
        if not self.config.cron_enabled:
            return
        
        jobs = self.load_jobs()
        now = time.time()
        
        for job in jobs:
            if not job.get("enabled", True):
                continue
            
            next_run = job.get("next_run_at")
            if next_run and now >= next_run:
                self._run_job(job)
    
    def _run_job(self, job: Dict[str, Any]):
        """Execute a cron job."""
        job_id = job.get("id", "unknown")
        job_name = job.get("name", job_id)
        
        logger.info(f"Running cron job: {job_name}")
        
        try:
            # Handle different job types
            if job.get("system_event"):
                # Queue system event for next circuits run
                self._queue_event({
                    "type": "cron",
                    "job_id": job_id,
                    "text": job["system_event"],
                    "timestamp": datetime.now().isoformat(),
                })
            
            if job.get("message"):
                # Show notification
                self.notifications.notify(
                    f"Substrate: {job_name}",
                    job["message"],
                )
            
            self.state.last_cron_check = datetime.now().isoformat()
            self.state.cron_jobs_run += 1
            self.state.save()
            
        except Exception as e:
            logger.error(f"Cron job error ({job_name}): {e}")
    
    def _queue_event(self, event: Dict[str, Any]):
        """Queue an event for processing."""
        events = []
        if EVENTS_FILE.exists():
            try:
                with open(EVENTS_FILE, 'r') as f:
                    events = json.load(f)
            except Exception:
                pass
        
        events.append(event)
        
        with open(EVENTS_FILE, 'w') as f:
            json.dump(events, f, indent=2)
    
    def _scheduler_loop(self):
        """Main cron check loop."""
        while not self._stop_event.is_set():
            try:
                self.check_and_run_jobs()
            except Exception as e:
                logger.error(f"Cron scheduler error: {e}")
            
            # Check every minute
            self._stop_event.wait(60)
    
    def start(self):
        """Start the cron scheduler."""
        if self._running:
            return
        
        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._thread.start()
        logger.info("Cron scheduler started")
    
    def stop(self):
        """Stop the cron scheduler."""
        self._running = False
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Cron scheduler stopped")


class SubstrateGateway:
    """Main gateway service."""
    
    def __init__(self):
        self.config = GatewayConfig.load()
        self.state = GatewayState.load()
        self.notifications = NotificationManager()
        
        self.circuits = CircuitsScheduler(
            self.config,
            self.state,
            self.notifications,
            on_circuits=self._run_agent_circuits,
        )
        
        self.cron = CronScheduler(
            self.config,
            self.state,
            self.notifications,
        )
        
        self._tray_icon = None
        self._running = False
    
    def _run_agent_circuits(self, prompt: str) -> str:
        """Run the agent for circuits with full autonomous tool loop."""
        try:
            # Try to use autonomous runner with full tool support
            try:
                from .autonomous_runner import (
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
                    notify_on_complete=self.config.notifications_enabled,
                    notify_on_error=self.config.notifications_enabled,
                )
                
                # Set up runner with notification callback
                runner = get_autonomous_runner(
                    config=auto_config,
                    on_notify=lambda title, msg: self.notifications.notify(title, msg),
                )
                
                # Load pending events from file
                events = []
                if EVENTS_FILE.exists():
                    try:
                        with open(EVENTS_FILE, 'r') as f:
                            events = json.load(f)
                        # Clear events file
                        EVENTS_FILE.unlink()
                    except Exception:
                        pass
                
                # Run autonomous circuits with full tool loop
                result = run_autonomous_circuits(
                    session_key="main",
                    events=events if events else None,
                )
                
                # Log results
                if result.actions_taken:
                    logger.info(f"Circuits completed: {len(result.actions_taken)} actions, {result.turns} turns")
                    return f"Completed {len(result.actions_taken)} actions: {', '.join(result.actions_taken[:5])}"
                else:
                    return result.response or "CIRCUITS_OK"
                    
            except ImportError as e:
                logger.warning(f"Autonomous runner not available, using simple mode: {e}")
                # Fall back to simple Ollama call
                return self._run_simple_circuits(prompt)
                
        except Exception as e:
            logger.error(f"Agent circuits error: {e}")
            return "CIRCUITS_OK"
    
    def _run_simple_circuits(self, prompt: str) -> str:
        """Simple circuits without tools (fallback)."""
        import requests
        
        # Check for pending events
        events = []
        if EVENTS_FILE.exists():
            try:
                with open(EVENTS_FILE, 'r') as f:
                    events = json.load(f)
                # Clear events file
                EVENTS_FILE.unlink()
            except Exception:
                pass
        
        # Build circuits prompt
        full_prompt = "You are running in circuits mode.\n\n"
        
        if events:
            full_prompt += "PENDING EVENTS:\n"
            for evt in events:
                full_prompt += f"- {evt.get('type', 'event')}: {evt.get('text', str(evt))}\n"
            full_prompt += "\nProcess these events and respond appropriately.\n"
        else:
            full_prompt += "No pending events. If nothing needs attention, respond with CIRCUITS_OK.\n"
        
        response = requests.post(
            f"{self.config.ollama_url}/api/generate",
            json={
                "model": self.config.default_model,
                "prompt": full_prompt,
                "stream": False,
            },
            timeout=120,
        )
        
        if response.ok:
            result = response.json()
            return result.get("response", "CIRCUITS_OK")
        else:
            return "CIRCUITS_OK"
    
    def _create_tray_icon(self) -> Optional[Image.Image]:
        """Create tray icon image."""
        if not HAS_PYSTRAY:
            return None
        
        # Create a simple icon (green circle)
        size = 64
        image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        
        # Draw filled circle
        margin = 4
        draw.ellipse(
            [margin, margin, size - margin, size - margin],
            fill=(76, 175, 80, 255),  # Green
            outline=(56, 142, 60, 255),
            width=2,
        )
        
        # Draw "T" in center
        draw.text(
            (size // 2 - 8, size // 2 - 12),
            "T",
            fill=(255, 255, 255, 255),
        )
        
        return image
    
    def _create_menu(self):
        """Create tray menu."""
        if not HAS_PYSTRAY:
            return None
        
        return pystray.Menu(
            pystray.MenuItem("Substrate Gateway", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Status",
                self._show_status,
            ),
            pystray.MenuItem(
                "Run Circuits Now",
                self._trigger_circuits,
            ),
            pystray.MenuItem(
                "Open Substrate",
                self._open_main_app,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Circuits",
                pystray.Menu(
                    pystray.MenuItem(
                        "Enabled",
                        self._toggle_circuits,
                        checked=lambda item: self.config.circuits_enabled,
                    ),
                ),
            ),
            pystray.MenuItem(
                "Notifications",
                pystray.Menu(
                    pystray.MenuItem(
                        "Enabled",
                        self._toggle_notifications,
                        checked=lambda item: self.config.notifications_enabled,
                    ),
                ),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit),
        )
    
    def _show_status(self, icon=None, item=None):
        """Show status notification."""
        status = f"Running since: {self.state.started_at or 'N/A'}\n"
        status += f"Circuits runs: {self.state.circuits_count}\n"
        status += f"Last: {self.state.last_circuits_run or 'Never'}"
        
        self.notifications.notify("Substrate Gateway Status", status)
    
    def _trigger_circuits(self, icon=None, item=None):
        """Manually trigger circuits run."""
        threading.Thread(target=self.circuits.run_circuits, daemon=True).start()
        self.notifications.notify("Substrate", "Circuits triggered")
    
    def _open_main_app(self, icon=None, item=None):
        """Open main Substrate app."""
        if self.config.substrate_path and Path(self.config.substrate_path).exists():
            subprocess.Popen([sys.executable, self.config.substrate_path])
        else:
            # Try to find it
            soma = Path(__file__).parent.parent.parent
            possible_paths = [
                soma / "main.py",
                soma / "app.py",
            ]
            for p in possible_paths:
                if p.exists():
                    subprocess.Popen([sys.executable, str(p)])
                    return
            
            self.notifications.notify("Substrate", "Could not find main app")
    
    def _toggle_circuits(self, icon=None, item=None):
        """Toggle circuits."""
        self.config.circuits_enabled = not self.config.circuits_enabled
        self.config.save()
        
        status = "enabled" if self.config.circuits_enabled else "disabled"
        self.notifications.notify("Substrate", f"Circuits {status}")
    
    def _toggle_notifications(self, icon=None, item=None):
        """Toggle notifications."""
        self.config.notifications_enabled = not self.config.notifications_enabled
        self.config.save()
    
    def _quit(self, icon=None, item=None):
        """Quit the gateway."""
        logger.info("Gateway shutting down...")
        self._running = False
        
        self.circuits.stop()
        self.cron.stop()
        
        if self._tray_icon:
            self._tray_icon.stop()
        
        self.state.running = False
        self.state.save()
    
    def start(self):
        """Start the gateway service."""
        logger.info("Starting Substrate Gateway...")
        
        self._running = True
        self.state.running = True
        self.state.started_at = datetime.now().isoformat()
        self.state.save()
        
        # Start schedulers
        self.circuits.start()
        self.cron.start()
        
        # Show startup notification
        self.notifications.notify(
            "Substrate Gateway Started",
            f"Circuits every {self.config.circuits_interval_seconds // 60} minutes",
        )
        
        # Start tray icon (blocks)
        if HAS_PYSTRAY:
            icon_image = self._create_tray_icon()
            self._tray_icon = pystray.Icon(
                "Substrate",
                icon_image,
                "Substrate Gateway",
                menu=self._create_menu(),
            )
            self._tray_icon.run()
        else:
            # No tray, just run in console
            logger.info("Running without tray icon (pystray not available)")
            try:
                while self._running:
                    time.sleep(1)
            except KeyboardInterrupt:
                self._quit()
    
    def run_headless(self):
        """Run without tray icon (for scheduled tasks)."""
        logger.info("Starting Substrate Gateway (headless)...")
        
        self._running = True
        self.state.running = True
        self.state.started_at = datetime.now().isoformat()
        self.state.save()
        
        # Start schedulers
        self.circuits.start()
        self.cron.start()
        
        try:
            while self._running:
                time.sleep(1)
        except KeyboardInterrupt:
            self._quit()


def install_autostart():
    """Install gateway as a Windows Scheduled Task (ONLOGON).
    
    Uses schtasks instead of the registry Run key for reliability.
    Delegates to wake_circuits.py which manages the full lifecycle.
    """
    soma = Path(__file__).parent.parent.parent
    wake_script = soma / "wake_circuits.py"
    
    if wake_script.exists():
        result = subprocess.run(
            [sys.executable, str(wake_script), "--install"],
            cwd=str(soma),
        )
        return result.returncode == 0
    else:
        # Fallback: direct schtasks registration
        pythonw = Path(sys.executable).parent / "pythonw.exe"
        if not pythonw.exists():
            pythonw = Path(sys.executable)
        gateway_py = soma / "gateway.py"
        command = f'"{pythonw}" "{gateway_py}" --headless'
        
        try:
            result = subprocess.run(
                ["schtasks", "/Create", "/F",
                 "/SC", "ONLOGON", "/RL", "LIMITED",
                 "/TN", "SubstrateGateway",
                 "/TR", command],
                capture_output=True, text=True,
            )
            if result.returncode == 0:
                print(f"Installed scheduled task: SubstrateGateway")
                subprocess.run(["schtasks", "/Run", "/TN", "SubstrateGateway"],
                               capture_output=True)
                return True
            else:
                print(f"Failed: {result.stderr}")
                return False
        except Exception as e:
            print(f"Failed to install autostart: {e}")
            return False


def uninstall_autostart():
    """Remove gateway scheduled task and legacy registry key."""
    soma = Path(__file__).parent.parent.parent
    wake_script = soma / "wake_circuits.py"
    
    if wake_script.exists():
        result = subprocess.run(
            [sys.executable, str(wake_script), "--uninstall"],
            cwd=str(soma),
        )
        return result.returncode == 0
    else:
        try:
            subprocess.run(
                ["schtasks", "/Delete", "/F", "/TN", "SubstrateGateway"],
                capture_output=True, text=True,
            )
            print("Removed scheduled task")
            return True
        except Exception as e:
            print(f"Failed to remove autostart: {e}")
            return False


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Substrate Gateway Service")
    parser.add_argument("--install", action="store_true", help="Install to run on startup")
    parser.add_argument("--uninstall", action="store_true", help="Remove from startup")
    parser.add_argument("--headless", action="store_true", help="Run without tray icon")
    parser.add_argument("--once", action="store_true", help="Run circuits once and exit")
    
    args = parser.parse_args()
    
    if args.install:
        install_autostart()
        return
    
    if args.uninstall:
        uninstall_autostart()
        return
    
    gateway = SubstrateGateway()
    
    if args.once:
        # Single circuits run
        result = gateway.circuits.run_circuits()
        print(f"Circuits result: {result}")
        return
    
    if args.headless:
        gateway.run_headless()
    else:
        gateway.start()


if __name__ == "__main__":
    main()
