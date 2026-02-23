"""
Recorder Service - Standalone background process for F9 hotkey recording.
=========================================================================
Launched by proxy_server.py at startup. Uses Win32 APIs:
- RegisterHotKey for F9 toggle (main thread GetMessageW loop)
- Polling thread with GetAsyncKeyState / GetCursorPos for event capture

NO SetWindowsHookEx — polling is 100% safe, cannot freeze input.
"""

import os
import sys
import json
import time
import ctypes
import ctypes.wintypes
import subprocess
import threading
from datetime import datetime

# ── Win32 ────────────────────────────────────────────────────────────
user32 = ctypes.windll.user32

WM_HOTKEY = 0x0312
MOD_NOREPEAT = 0x4000
VK_F9 = 0x78
HOTKEY_ID = 9001

# Mouse button VK codes
VK_LBUTTON = 0x01
VK_RBUTTON = 0x02
VK_MBUTTON = 0x04

# ── Paths ────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOMA = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
RECORDINGS_DIR = os.path.join(SOMA, 'workspace', 'recordings')
SOUND_DIR = os.path.join(SOMA, 'data', 'sounds')
LOCK_FILE = os.path.join(SOMA, 'data', '.recorder_service.lock')
SOUND_RECORD_START = os.path.join(SOUND_DIR, 'Bell Fallen.wav')
SOUND_RECORD_STOP = os.path.join(SOUND_DIR, 'Gong KeepDown 2.wav')
_VBS_PLAYER = os.path.join(SOUND_DIR, 'play.vbs')
_CONFIG_PATH = os.path.join(SOMA, 'custom_settings.json')

# ── Recording state ──────────────────────────────────────────────────
_is_recording = False
_current_recording = None
_typing_buffer = ""
_typing_window = ""
_typing_start_time = 0.0
_recording_start_time = 0.0
_poll_thread = None
_stop_poll = threading.Event()

TYPING_COALESCE_SEC = 1.5
POLL_INTERVAL = 0.015  # ~66 Hz polling

# VK codes to ignore
IGNORE_VK = {
    VK_F9,
    0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5,  # Shift/Ctrl/Alt L/R
    0x5B, 0x5C,  # Win keys
    0x14, 0x90, 0x91,  # CapsLock, NumLock, ScrollLock
    0xB0, 0xB1, 0xB2, 0xB3, 0xAD, 0xAE, 0xAF,  # Media keys
}

# VK code to readable name for special keys
VK_SPECIAL = {
    0x08: 'backspace', 0x09: 'tab', 0x0D: 'enter', 0x1B: 'escape',
    0x20: ' ', 0x21: 'page_up', 0x22: 'page_down',
    0x23: 'end', 0x24: 'home',
    0x25: 'left', 0x26: 'up', 0x27: 'right', 0x28: 'down',
    0x2E: 'delete',
    0x70: 'f1', 0x71: 'f2', 0x72: 'f3', 0x73: 'f4',
    0x74: 'f5', 0x75: 'f6', 0x76: 'f7', 0x77: 'f8',
    0x79: 'f10', 0x7A: 'f11', 0x7B: 'f12',
}

# OEM key VK to char (US layout)
OEM_MAP = {
    0xBA: ';', 0xBB: '=', 0xBC: ',', 0xBD: '-', 0xBE: '.', 0xBF: '/',
    0xC0: '`', 0xDB: '[', 0xDC: '\\', 0xDD: ']', 0xDE: "'",
}

# All keyboard VK codes we poll (0x08-0x7B + OEM keys)
POLL_VKS = (
    list(range(0x08, 0x7C)) +
    [0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xC0, 0xDB, 0xDC, 0xDD, 0xDE]
)


# ── Helpers ──────────────────────────────────────────────────────────
def _get_sfx_volume():
    try:
        with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return int(cfg.get('voice_settings', {}).get('sfx_volume', 80))
    except Exception:
        return 80


def play_sound(wav_path):
    if not os.path.isfile(wav_path):
        return
    vol = _get_sfx_volume()
    if vol <= 0:
        return
    try:
        subprocess.Popen(
            ['wscript', _VBS_PLAYER, wav_path, str(vol)],
            creationflags=0x08000000,
        )
    except Exception:
        pass


def get_foreground_window_title():
    try:
        import win32gui
        hwnd = win32gui.GetForegroundWindow()
        return win32gui.GetWindowText(hwnd) or "Unknown"
    except Exception:
        return "Unknown"


def get_element_at_point(x, y):
    try:
        from pywinauto import Desktop
        elem = Desktop(backend="uia").from_point(x, y)
        if elem:
            name = getattr(elem, 'window_text', lambda: '')()
            ctrl_type = getattr(elem, 'friendly_class_name', lambda: '')()
            auto_id = ''
            try:
                auto_id = elem.automation_id()
            except Exception:
                pass
            parts = []
            if name:
                parts.append(name)
            if ctrl_type:
                parts.append(f"({ctrl_type})")
            if auto_id:
                parts.append(f"[{auto_id}]")
            return ' '.join(parts) if parts else ""
    except Exception:
        pass
    return ""


def elapsed():
    return round(time.time() - _recording_start_time, 2)


def flush_typing_buffer():
    global _typing_buffer, _typing_window, _typing_start_time
    if _typing_buffer and _current_recording is not None:
        _current_recording['steps'].append({
            't': round(_typing_start_time - _recording_start_time, 2),
            'action': 'type',
            'window': _typing_window,
            'value': _typing_buffer,
        })
    _typing_buffer = ""
    _typing_window = ""
    _typing_start_time = 0.0


def _vk_to_char(vk):
    """Fast VK-to-char for printable keys."""
    if 0x30 <= vk <= 0x39:
        return chr(vk)
    if 0x41 <= vk <= 0x5A:
        return chr(vk).lower()
    if 0x60 <= vk <= 0x69:
        return chr(vk - 0x30)
    return OEM_MAP.get(vk)


# ── Polling thread ───────────────────────────────────────────────────
def _poll_loop():
    """Poll GetAsyncKeyState at ~66Hz. Read-only, no hooks, cannot freeze."""
    global _typing_buffer, _typing_window, _typing_start_time

    prev_mouse = {VK_LBUTTON: False, VK_RBUTTON: False, VK_MBUTTON: False}
    prev_keys = {vk: False for vk in POLL_VKS}
    btn_names = {VK_LBUTTON: 'left', VK_RBUTTON: 'right', VK_MBUTTON: 'middle'}
    pt = ctypes.wintypes.POINT()

    while not _stop_poll.is_set():
        try:
            if not _is_recording or _current_recording is None:
                time.sleep(0.05)
                for vk in prev_mouse:
                    prev_mouse[vk] = False
                for vk in prev_keys:
                    prev_keys[vk] = False
                continue

            # ── Mouse clicks ──
            for vk, name in btn_names.items():
                state = user32.GetAsyncKeyState(vk)
                is_down = bool(state & 0x8000)
                was_down = prev_mouse[vk]
                prev_mouse[vk] = is_down
                if is_down and not was_down:
                    user32.GetCursorPos(ctypes.byref(pt))
                    x, y = pt.x, pt.y
                    flush_typing_buffer()
                    window_title = get_foreground_window_title()
                    step = {
                        't': elapsed(),
                        'action': 'click',
                        'window': window_title,
                        'coords': [x, y],
                        'button': name,
                    }
                    try:
                        elem = get_element_at_point(x, y)
                        if elem:
                            step['element'] = elem
                    except Exception:
                        pass
                    _current_recording['steps'].append(step)

            # ── Keyboard ──
            now = time.time()
            for vk in POLL_VKS:
                state = user32.GetAsyncKeyState(vk)
                is_down = bool(state & 0x8000)
                was_down = prev_keys[vk]
                prev_keys[vk] = is_down
                if not (is_down and not was_down):
                    continue
                if vk in IGNORE_VK:
                    continue

                window_title = get_foreground_window_title()

                # Special key?
                if vk in VK_SPECIAL:
                    flush_typing_buffer()
                    _current_recording['steps'].append({
                        't': elapsed(),
                        'action': 'keypress',
                        'window': window_title,
                        'key': VK_SPECIAL[vk],
                    })
                    continue

                # Printable char?
                char = _vk_to_char(vk)
                if char:
                    if (_typing_buffer and
                            window_title == _typing_window and
                            (now - _typing_start_time) < TYPING_COALESCE_SEC):
                        _typing_buffer += char
                        _typing_start_time = now
                    else:
                        flush_typing_buffer()
                        _typing_buffer = char
                        _typing_window = window_title
                        _typing_start_time = now
                    continue

                # Unknown VK
                flush_typing_buffer()
                _current_recording['steps'].append({
                    't': elapsed(),
                    'action': 'keypress',
                    'window': window_title,
                    'key': f'vk_{vk:#04x}',
                })

            time.sleep(POLL_INTERVAL)

        except Exception as e:
            print(f"[REC] Poll error: {e}", flush=True)
            time.sleep(0.1)


# ── Agent notification ───────────────────────────────────────────────
EVENTS_DIR = os.path.join(SOMA, 'data', 'events')


def _notify_agent_of_recording(recording_path: str, step_count: int, duration: float):
    """Drop an immediate event file so the agent analyzes this recording."""
    try:
        os.makedirs(EVENTS_DIR, exist_ok=True)
        event = {
            "type": "immediate",
            "text": (
                f"[SKILL LEARNING] A new F9 recording just finished.\n"
                f"Recording: {recording_path}\n"
                f"Steps: {step_count}, Duration: {duration}s\n\n"
                f"INSTRUCTIONS — Follow the Skill Learning Protocol:\n"
                f"1. Use read_file to load the recording JSON.\n"
                f"2. Analyze what the user was doing — identify the GOAL, the APPS used, "
                f"the KEY DECISIONS (where the user chose what to click/type based on context), "
                f"and any VARIABLE PARTS (URLs, search terms, content that would change each time).\n"
                f"3. Ask the user:\n"
                f"   - \"Here's what I think you were doing: [summary]. Is that right?\"\n"
                f"   - \"What should I look for to know when to [key decision point]?\"\n"
                f"   - \"Are there variations? (e.g. different subreddits, different content types)\"\n"
                f"   - \"What's the end goal — when do I know I'm done?\"\n"
                f"4. After the user answers, generate a DYNAMIC skill (not a macro replay) that:\n"
                f"   - Understands the goal, not just the clicks\n"
                f"   - Uses screen reading/snapshots to find the right elements\n"
                f"   - Handles variations (different pages, different content)\n"
                f"   - Has decision points where it checks context before acting\n"
                f"5. Offer to practice the skill once with the user watching.\n"
                f"6. Only save the skill (via skill tool) after the user confirms it works.\n"
            ),
            "channelId": "main",
            "wake": "now",
        }
        ts = int(time.time() * 1000)
        filename = f"recording-learned-{ts}.json"
        filepath = os.path.join(EVENTS_DIR, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(event, f, indent=2)
        print(f"[REC] Agent notified via event: {filename}", flush=True)
    except Exception as e:
        print(f"[REC] Failed to notify agent: {e}", flush=True)


# ── Recording control ────────────────────────────────────────────────
def start_recording():
    global _is_recording, _current_recording, _recording_start_time, _typing_buffer
    global _poll_thread
    if _is_recording:
        return
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    _current_recording = {
        'name': f'recording_{timestamp}',
        'started': datetime.now().isoformat(),
        'steps': [],
    }
    _recording_start_time = time.time()
    _typing_buffer = ""
    _is_recording = True

    play_sound(SOUND_RECORD_START)

    _stop_poll.clear()
    _poll_thread = threading.Thread(target=_poll_loop, daemon=True)
    _poll_thread.start()

    print(f"[REC] Recording started: {_current_recording['name']}", flush=True)


def stop_recording():
    global _is_recording, _current_recording, _poll_thread
    if not _is_recording:
        return
    _is_recording = False
    _stop_poll.set()
    if _poll_thread:
        _poll_thread.join(timeout=1.0)
        _poll_thread = None

    flush_typing_buffer()
    _current_recording['ended'] = datetime.now().isoformat()
    _current_recording['duration_sec'] = round(time.time() - _recording_start_time, 2)
    _current_recording['total_steps'] = len(_current_recording['steps'])
    filename = f"{_current_recording['name']}.json"
    filepath = os.path.join(RECORDINGS_DIR, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(_current_recording, f, indent=2, ensure_ascii=False)
    logger.info(
        f"[REC] Recording saved: {filepath} "
        f"({_current_recording['total_steps']} steps, "
        f"{_current_recording['duration_sec']}s)"
    )

    saved_path = filepath
    step_count = _current_recording['total_steps']
    duration = _current_recording['duration_sec']
    _current_recording = None

    play_sound(SOUND_RECORD_STOP)

    # Drop an immediate event so the agent analyzes this recording
    _notify_agent_of_recording(saved_path, step_count, duration)

    return saved_path


def toggle_recording():
    if _is_recording:
        stop_recording()
    else:
        start_recording()


# ── Main ─────────────────────────────────────────────────────────────
def _is_pid_alive(pid):
    """Check if a process with the given PID is still running."""
    try:
        import ctypes as _ct
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        h = _ct.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if h:
            _ct.windll.kernel32.CloseHandle(h)
            return True
        return False
    except Exception:
        return False


def _acquire_lock():
    """Write our PID to the lock file. Returns True if we got the lock."""
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    # Check for existing lock
    if os.path.isfile(LOCK_FILE):
        try:
            with open(LOCK_FILE, 'r') as f:
                old_pid = int(f.read().strip())
            if old_pid != os.getpid() and _is_pid_alive(old_pid):
                print(f"[REC] Another instance already running (PID {old_pid}). Exiting.", flush=True)
                return False
        except (ValueError, OSError):
            pass
    # Write our PID
    with open(LOCK_FILE, 'w') as f:
        f.write(str(os.getpid()))
    return True


def _release_lock():
    """Remove the lock file."""
    try:
        if os.path.isfile(LOCK_FILE):
            with open(LOCK_FILE, 'r') as f:
                pid = int(f.read().strip())
            if pid == os.getpid():
                os.remove(LOCK_FILE)
    except Exception:
        pass


def main():
    """Register F9 hotkey and run message loop. Polling thread handles capture."""
    if not _acquire_lock():
        sys.exit(0)

    result = user32.RegisterHotKey(None, HOTKEY_ID, MOD_NOREPEAT, VK_F9)
    if not result:
        err = ctypes.GetLastError()
        print(f"[REC] RegisterHotKey FAILED (error {err}). F9 may be in use.", flush=True)
        _release_lock()
        sys.exit(1)

    print("[REC] F9 hotkey active — press F9 to start/stop recording (poll mode)", flush=True)

    msg = ctypes.wintypes.MSG()
    try:
        while True:
            ret = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if ret <= 0:
                break
            if msg.message == WM_HOTKEY:
                try:
                    toggle_recording()
                except Exception as e:
                    print(f"[REC] Error: {e}", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        if _is_recording:
            stop_recording()
        user32.UnregisterHotKey(None, HOTKEY_ID)
        _release_lock()
        print("[REC] Hotkey unregistered, exiting.", flush=True)


if __name__ == '__main__':
    main()
