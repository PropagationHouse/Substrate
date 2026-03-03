"""
Recorder Tool - Lightweight UI action recorder for teaching the agent
=====================================================================
Press F9 to start/stop recording.
Captures mouse clicks, keyboard input, and window context.
Saves structured JSON to workspace/recordings/ for agent analysis.

Uses:
- ctypes (Win32 RegisterHotKey): global F9 hotkey (works from background processes)
- pynput: mouse/keyboard event listeners during recording
- pywinauto: element identification at click point (best-effort)
- win32gui: foreground window title
"""

import os
import json
import time
import ctypes
import ctypes.wintypes
import threading
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SOMA = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))
RECORDINGS_DIR = os.path.join(SOMA, 'workspace', 'recordings')
EVENTS_DIR = os.path.join(SOMA, 'data', 'events')

# Sound files
SOUND_DIR = os.path.join(SOMA, 'data', 'sounds')
SOUND_RECORD_START = os.path.join(SOUND_DIR, 'Bell Fallen.wav')
SOUND_RECORD_STOP = os.path.join(SOUND_DIR, 'Gong KeepDown 2.wav')
SOUND_SKILL_PROMOTED = os.path.join(SOUND_DIR, 'Gong LowSustain 2.wav')


_VBS_PLAYER = os.path.join(SOUND_DIR, 'play.vbs')
_CONFIG_PATH = os.path.join(SOMA, 'custom_settings.json')


def _get_sfx_volume():
    """Read SFX volume (0-100) from config."""
    try:
        with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return int(cfg.get('voice_settings', {}).get('sfx_volume', 80))
    except Exception:
        return 80


def _play_sound(wav_path: str):
    """Play a WAV file via WScript/VBS (works from any process context)."""
    if not os.path.isfile(wav_path):
        logger.warning(f"[REC] Sound file not found: {wav_path}")
        return
    vol = _get_sfx_volume()
    if vol <= 0:
        return
    try:
        import subprocess
        subprocess.Popen(
            ['wscript', _VBS_PLAYER, wav_path, str(vol)],
            creationflags=0x08000000,
        )
    except Exception as e:
        logger.debug(f"[REC] Could not play sound: {e}")

# Recording state
_recorder_lock = threading.Lock()
_is_recording = False
_current_recording = None
_mouse_listener = None
_keyboard_listener = None
_typing_buffer = ""
_typing_window = ""
_typing_start_time = 0.0
_recording_start_time = 0.0

# Coalesce keystrokes within this window (seconds)
TYPING_COALESCE_SEC = 1.5

# Keys to ignore in typing buffer (modifiers, navigation)
MODIFIER_KEYS = {
    'Key.shift', 'Key.shift_r', 'Key.ctrl_l', 'Key.ctrl_r',
    'Key.alt_l', 'Key.alt_r', 'Key.cmd', 'Key.cmd_r',
    'Key.caps_lock', 'Key.num_lock',
}

SPECIAL_KEYS = {
    'Key.enter': 'enter', 'Key.tab': 'tab', 'Key.space': ' ',
    'Key.backspace': 'backspace', 'Key.delete': 'delete',
    'Key.esc': 'escape', 'Key.up': 'up', 'Key.down': 'down',
    'Key.left': 'left', 'Key.right': 'right',
    'Key.home': 'home', 'Key.end': 'end',
    'Key.page_up': 'page_up', 'Key.page_down': 'page_down',
    'Key.f1': 'f1', 'Key.f2': 'f2', 'Key.f3': 'f3', 'Key.f4': 'f4',
    'Key.f5': 'f5', 'Key.f6': 'f6', 'Key.f7': 'f7', 'Key.f8': 'f8',
    'Key.f9': 'f9', 'Key.f10': 'f10', 'Key.f11': 'f11', 'Key.f12': 'f12',
}

# Keys to silently ignore (the toggle hotkey itself, media keys)
IGNORE_KEYS = {
    'Key.f9', 'Key.media_next', 'Key.media_previous', 'Key.media_play_pause',
    'Key.media_volume_up', 'Key.media_volume_down', 'Key.media_volume_mute',
}


def _get_foreground_window_title() -> str:
    """Get the title of the currently focused window."""
    try:
        import win32gui
        hwnd = win32gui.GetForegroundWindow()
        return win32gui.GetWindowText(hwnd) or "Unknown"
    except Exception:
        return "Unknown"


def _get_element_at_point(x: int, y: int) -> str:
    """Best-effort: identify the UI element at (x, y) via pywinauto."""
    try:
        from pywinauto import Desktop
        desktop = Desktop(backend="uia")
        elem = desktop.from_point(x, y)
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
        return ""
    except Exception:
        return ""


def _elapsed() -> float:
    """Seconds since recording started."""
    return round(time.time() - _recording_start_time, 2)


def _flush_typing_buffer():
    """Flush accumulated keystrokes as a single 'type' step."""
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


def _on_click(x, y, button, pressed):
    """Mouse click handler."""
    global _typing_buffer
    if not _is_recording or _current_recording is None:
        return
    if not pressed:
        return  # Only capture press, not release

    # Flush any pending typing
    _flush_typing_buffer()

    window_title = _get_foreground_window_title()
    element_info = _get_element_at_point(x, y)

    step = {
        't': _elapsed(),
        'action': 'click',
        'window': window_title,
        'coords': [x, y],
        'button': str(button).split('.')[-1],  # 'left', 'right', 'middle'
    }
    if element_info:
        step['element'] = element_info

    _current_recording['steps'].append(step)
    logger.debug(f"[REC] click ({x},{y}) on '{element_info}' in '{window_title}'")


def _on_scroll(x, y, dx, dy):
    """Mouse scroll handler."""
    if not _is_recording or _current_recording is None:
        return

    _flush_typing_buffer()

    window_title = _get_foreground_window_title()
    _current_recording['steps'].append({
        't': _elapsed(),
        'action': 'scroll',
        'window': window_title,
        'coords': [x, y],
        'direction': 'down' if dy < 0 else 'up',
        'amount': abs(dy),
    })


def _on_key_press(key):
    """Keyboard press handler."""
    global _typing_buffer, _typing_window, _typing_start_time
    if not _is_recording or _current_recording is None:
        return

    key_str = str(key)

    # Skip modifier-only keys and ignored keys (F9 toggle, media keys)
    if key_str in MODIFIER_KEYS or key_str in IGNORE_KEYS:
        return

    now = time.time()
    window_title = _get_foreground_window_title()

    # Check for special key combos (Ctrl+C, Ctrl+V, etc.)
    # pynput gives us the key after modifiers, so we detect combos via key type
    if key_str in SPECIAL_KEYS:
        # Flush typing buffer first
        _flush_typing_buffer()

        special_name = SPECIAL_KEYS[key_str]
        _current_recording['steps'].append({
            't': _elapsed(),
            'action': 'keypress',
            'window': window_title,
            'key': special_name,
        })
        return

    # Regular character — coalesce into typing buffer
    try:
        char = key.char
        if char is None:
            return
    except AttributeError:
        # Unknown special key
        _flush_typing_buffer()
        _current_recording['steps'].append({
            't': _elapsed(),
            'action': 'keypress',
            'window': window_title,
            'key': key_str,
        })
        return

    # Coalesce typing: if same window and within time window, append
    if (_typing_buffer and
            window_title == _typing_window and
            (now - _typing_start_time) < TYPING_COALESCE_SEC):
        _typing_buffer += char
        _typing_start_time = now  # extend the window
    else:
        # New typing sequence
        _flush_typing_buffer()
        _typing_buffer = char
        _typing_window = window_title
        _typing_start_time = now


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
        logger.info(f"[REC] Agent notified via event: {filename}")
    except Exception as e:
        logger.error(f"[REC] Failed to notify agent: {e}")


def start_recording():
    """Start recording UI actions."""
    global _is_recording, _current_recording, _mouse_listener, _keyboard_listener
    global _recording_start_time, _typing_buffer

    with _recorder_lock:
        if _is_recording:
            logger.warning("[REC] Already recording")
            return

        # Ensure recordings dir exists
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

        # Start listeners
        from pynput import mouse, keyboard as pynput_kb

        _mouse_listener = mouse.Listener(
            on_click=_on_click,
            on_scroll=_on_scroll,
        )
        _keyboard_listener = pynput_kb.Listener(
            on_press=_on_key_press,
        )
        _mouse_listener.start()
        _keyboard_listener.start()

        logger.info(f"[REC] Recording started: {_current_recording['name']}")
        _play_sound(SOUND_RECORD_START)


def stop_recording() -> Optional[str]:
    """Stop recording and save to file. Returns the file path."""
    global _is_recording, _current_recording, _mouse_listener, _keyboard_listener

    with _recorder_lock:
        if not _is_recording:
            logger.warning("[REC] Not currently recording")
            return None

        _is_recording = False

        # Stop listeners
        if _mouse_listener:
            _mouse_listener.stop()
            _mouse_listener = None
        if _keyboard_listener:
            _keyboard_listener.stop()
            _keyboard_listener = None

        # Flush remaining typing
        _flush_typing_buffer()

        # Finalize recording
        _current_recording['ended'] = datetime.now().isoformat()
        _current_recording['duration_sec'] = round(
            time.time() - _recording_start_time, 2
        )
        _current_recording['total_steps'] = len(_current_recording['steps'])

        # Save
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

        _play_sound(SOUND_RECORD_STOP)

        # Notify agent to analyze this recording
        _notify_agent_of_recording(saved_path, step_count, duration)

        return saved_path


def toggle_recording():
    """Toggle recording on/off. Called by the hotkey."""
    if _is_recording:
        path = stop_recording()
        if path:
            logger.info(f"[REC] Saved to: {path}")
    else:
        start_recording()


def _win32_hotkey_loop():
    """Background thread: register F9 via Win32 RegisterHotKey and pump messages.
    RegisterHotKey works from background/service processes unlike keyboard/pynput."""
    try:
        user32 = ctypes.windll.user32
        MOD_NOREPEAT = 0x4000
        VK_F9 = 0x78
        HOTKEY_ID = 9001  # Arbitrary unique ID

        result = user32.RegisterHotKey(None, HOTKEY_ID, MOD_NOREPEAT, VK_F9)
        if not result:
            err = ctypes.GetLastError()
            print(f"[REC] RegisterHotKey FAILED (error {err}). F9 may be in use by another app.")
            logger.error(f"[REC] RegisterHotKey failed (error {err}). F9 may be in use by another app.")
            return

        print("[REC] F9 hotkey registered via Win32 API — press F9 to record")
        logger.info("[REC] F9 hotkey registered via Win32 API")

        msg = ctypes.wintypes.MSG()
        while True:
            ret = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if ret <= 0:
                print(f"[REC] GetMessageW returned {ret}, exiting hotkey loop")
                break
            if msg.message == 0x0312:  # WM_HOTKEY
                try:
                    toggle_recording()
                except Exception as e:
                    print(f"[REC] Error in toggle_recording: {e}")
                    logger.error(f"[REC] Error in toggle_recording: {e}")

        user32.UnregisterHotKey(None, HOTKEY_ID)
        logger.info("[REC] Hotkey unregistered")
    except Exception as e:
        print(f"[REC] Hotkey loop crashed: {e}")
        logger.error(f"[REC] Hotkey loop crashed: {e}")
        import traceback
        traceback.print_exc()


def init_recorder_hotkey():
    """Register the F9 global hotkey to toggle recording.
    Call this once at startup. Runs in background, non-blocking.
    Uses Win32 RegisterHotKey API which works from background processes."""
    try:
        t = threading.Thread(target=_win32_hotkey_loop, daemon=True, name="RecorderHotkey")
        t.start()
        logger.info("[REC] Recorder hotkey thread started (F9)")
    except Exception as e:
        logger.error(f"[REC] Failed to start recorder hotkey thread: {e}")


def get_recording_status() -> Dict[str, Any]:
    """Get current recording status (for agent tool use)."""
    if _is_recording and _current_recording:
        return {
            'status': 'recording',
            'name': _current_recording['name'],
            'duration_sec': round(time.time() - _recording_start_time, 2),
            'steps_so_far': len(_current_recording['steps']),
        }
    else:
        # List existing recordings
        recordings = []
        if os.path.isdir(RECORDINGS_DIR):
            for f in sorted(os.listdir(RECORDINGS_DIR), reverse=True):
                if f.endswith('.json'):
                    fpath = os.path.join(RECORDINGS_DIR, f)
                    try:
                        size = os.path.getsize(fpath)
                        recordings.append({'file': f, 'size': size})
                    except Exception:
                        recordings.append({'file': f})
        return {
            'status': 'idle',
            'recordings_dir': RECORDINGS_DIR,
            'recordings': recordings[:10],  # Last 10
        }
