"""
Screen Tool - Screen capture and recording
===========================================
Features:
- Take screenshots of screen/window
- Record screen to video
- Capture specific regions
- Multi-monitor support

Use Cases for AI:
- Debug complex UI flows when clicking fails
- Create demos ("show me how to do X")
- Evidence/audit trails for compliance
- Training data capture for fine-tuning
- Error reproduction ("it broke" -> replay what happened)
"""

import os
import time
import base64
import logging
import threading
import tempfile
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)

# Default screenshot directory
SCREENSHOTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'visual_memory', 'screenshots')


MAX_SCREENSHOT_AGE_DAYS = 7
MAX_SCREENSHOTS_FOLDER_MB = 500


def cleanup_screenshots(
    max_age_days: int = MAX_SCREENSHOT_AGE_DAYS,
    max_folder_mb: int = MAX_SCREENSHOTS_FOLDER_MB,
) -> Dict[str, Any]:
    """
    Clean up old/excess screenshots.
    
    - Deletes files older than max_age_days
    - If folder still exceeds max_folder_mb, deletes oldest files until under limit
    
    Returns:
        Dict with cleanup stats
    """
    if not os.path.isdir(SCREENSHOTS_DIR):
        return {"status": "success", "deleted": 0, "message": "No screenshots directory"}

    now = time.time()
    age_cutoff = now - (max_age_days * 86400)
    deleted_age = 0
    deleted_size = 0

    # Phase 1: delete files older than max_age_days
    for f in os.listdir(SCREENSHOTS_DIR):
        fpath = os.path.join(SCREENSHOTS_DIR, f)
        if not os.path.isfile(fpath):
            continue
        try:
            mtime = os.path.getmtime(fpath)
            if mtime < age_cutoff:
                fsize = os.path.getsize(fpath)
                os.remove(fpath)
                deleted_age += 1
                deleted_size += fsize
                logger.info(f"Screenshot cleanup: deleted old file {f} (age: {(now - mtime) / 86400:.0f}d)")
        except Exception as e:
            logger.warning(f"Screenshot cleanup: failed to delete {f}: {e}")

    # Phase 2: if still over size limit, delete oldest first
    deleted_cap = 0
    try:
        files = []
        for f in os.listdir(SCREENSHOTS_DIR):
            fpath = os.path.join(SCREENSHOTS_DIR, f)
            if os.path.isfile(fpath):
                files.append((fpath, os.path.getmtime(fpath), os.path.getsize(fpath)))
        
        total_bytes = sum(s for _, _, s in files)
        max_bytes = max_folder_mb * 1024 * 1024

        if total_bytes > max_bytes:
            # Sort oldest first
            files.sort(key=lambda x: x[1])
            for fpath, _, fsize in files:
                if total_bytes <= max_bytes:
                    break
                try:
                    os.remove(fpath)
                    total_bytes -= fsize
                    deleted_cap += 1
                    deleted_size += fsize
                    logger.info(f"Screenshot cleanup: deleted {os.path.basename(fpath)} (over size cap)")
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Screenshot cleanup size check error: {e}")

    total_deleted = deleted_age + deleted_cap
    return {
        "status": "success",
        "deleted": total_deleted,
        "deleted_by_age": deleted_age,
        "deleted_by_size_cap": deleted_cap,
        "freed_bytes": deleted_size,
        "freed_mb": round(deleted_size / (1024 * 1024), 1),
    }


_cleanup_thread: Optional[threading.Thread] = None
_cleanup_stop = threading.Event()
CLEANUP_INTERVAL_SECONDS = 6 * 3600  # every 6 hours


def start_screenshot_cleanup_timer():
    """Start a background thread that cleans up screenshots periodically."""
    global _cleanup_thread, _cleanup_stop

    if _cleanup_thread and _cleanup_thread.is_alive():
        return

    _cleanup_stop.clear()

    def _loop():
        while not _cleanup_stop.is_set():
            _cleanup_stop.wait(timeout=CLEANUP_INTERVAL_SECONDS)
            if _cleanup_stop.is_set():
                break
            try:
                result = cleanup_screenshots()
                if result.get('deleted', 0) > 0:
                    logger.info(f"Periodic screenshot cleanup: {result}")
            except Exception as e:
                logger.warning(f"Screenshot cleanup timer error: {e}")

    _cleanup_thread = threading.Thread(target=_loop, daemon=True, name="screenshot-cleanup")
    _cleanup_thread.start()


def stop_screenshot_cleanup_timer():
    """Stop the background cleanup thread."""
    _cleanup_stop.set()


def _normalize_screenshot_path(save_path: Optional[str], prefix: str = 'screen') -> Optional[str]:
    """Ensure screenshot save_path is inside the screenshots/ directory."""
    if save_path is None:
        return None
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    # If it's just a filename (no directory), put it in screenshots/
    if os.path.dirname(save_path) == '' or os.path.dirname(save_path) == '.':
        return os.path.join(SCREENSHOTS_DIR, save_path)
    # If it's an absolute path outside screenshots/, redirect it
    if not os.path.abspath(save_path).startswith(os.path.abspath(SCREENSHOTS_DIR)):
        filename = os.path.basename(save_path)
        return os.path.join(SCREENSHOTS_DIR, filename)
    return save_path

# Try to import screen capture libraries
HAS_PYAUTOGUI = False
HAS_PIL = False
HAS_CV2 = False
HAS_MSS = False

try:
    import pyautogui
    HAS_PYAUTOGUI = True
except ImportError:
    logger.debug("pyautogui not installed - basic screenshot may be limited")

try:
    from PIL import Image
    import io
    HAS_PIL = True
except ImportError:
    logger.debug("PIL not installed - image processing limited")

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    logger.debug("opencv-python not installed - video recording disabled")

try:
    import mss
    HAS_MSS = True
except ImportError:
    logger.debug("mss not installed - fast screenshot disabled")


class RecordingStatus(str, Enum):
    IDLE = "idle"
    RECORDING = "recording"
    STOPPED = "stopped"
    FAILED = "failed"


@dataclass
class RecordingSession:
    """Represents a screen recording session."""
    session_id: str
    status: RecordingStatus = RecordingStatus.IDLE
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    output_path: Optional[str] = None
    fps: int = 10
    region: Optional[Tuple[int, int, int, int]] = None  # x, y, width, height
    screen_index: int = 0
    frames_captured: int = 0
    error: Optional[str] = None
    _stop_event: threading.Event = field(default_factory=threading.Event)
    _thread: Optional[threading.Thread] = None


# Global recording state
_active_recording: Optional[RecordingSession] = None
_recording_lock = threading.Lock()
_recording_counter = 0


def _generate_recording_id() -> str:
    global _recording_counter
    _recording_counter += 1
    return f"rec_{int(time.time())}_{_recording_counter}"


def get_screen_info() -> Dict[str, Any]:
    """
    Get information about available screens/monitors.
    
    Returns:
        Dict with screen information
    """
    try:
        if HAS_MSS:
            with mss.mss() as sct:
                monitors = []
                for i, mon in enumerate(sct.monitors):
                    monitors.append({
                        "index": i,
                        "left": mon["left"],
                        "top": mon["top"],
                        "width": mon["width"],
                        "height": mon["height"],
                        "is_primary": i == 1,  # Monitor 0 is "all monitors", 1 is primary
                    })
                return {
                    "status": "success",
                    "monitors": monitors,
                    "total": len(monitors),
                }
        elif HAS_PYAUTOGUI:
            size = pyautogui.size()
            return {
                "status": "success",
                "monitors": [{
                    "index": 0,
                    "left": 0,
                    "top": 0,
                    "width": size.width,
                    "height": size.height,
                    "is_primary": True,
                }],
                "total": 1,
            }
        else:
            return {
                "status": "error",
                "error": "No screen capture library available. Install mss or pyautogui.",
            }
    except Exception as e:
        logger.error(f"Error getting screen info: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def take_screenshot(
    screen_index: int = 0,
    region: Optional[Tuple[int, int, int, int]] = None,
    save_path: Optional[str] = None,
    quality: int = 85,
) -> Dict[str, Any]:
    """
    Take a screenshot of the screen or a region.
    
    Args:
        screen_index: Monitor index (0 = all monitors, 1 = primary, etc.)
        region: Optional region as (x, y, width, height)
        save_path: Path to save screenshot (returns base64 if not provided)
        quality: JPEG quality (1-100)
        
    Returns:
        Dict with screenshot data or path
    """
    save_path = _normalize_screenshot_path(save_path, prefix='screen')
    try:
        if HAS_MSS:
            with mss.mss() as sct:
                if region:
                    monitor = {"left": region[0], "top": region[1], 
                               "width": region[2], "height": region[3]}
                else:
                    monitors = sct.monitors
                    if screen_index >= len(monitors):
                        screen_index = 0
                    monitor = monitors[screen_index]
                
                screenshot = sct.grab(monitor)
                
                if HAS_PIL:
                    img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
                else:
                    # Return raw data
                    if save_path:
                        mss.tools.to_png(screenshot.rgb, screenshot.size, output=save_path)
                        return {
                            "status": "success",
                            "path": save_path,
                            "size": {"width": screenshot.width, "height": screenshot.height},
                        }
                    else:
                        return {
                            "status": "success",
                            "size": {"width": screenshot.width, "height": screenshot.height},
                            "message": "Screenshot captured (PIL not available for base64)",
                        }
        elif HAS_PYAUTOGUI:
            if region:
                img = pyautogui.screenshot(region=region)
            else:
                img = pyautogui.screenshot()
        else:
            return {
                "status": "error",
                "error": "No screenshot library available. Install mss or pyautogui.",
            }
        
        if save_path:
            img.save(save_path, quality=quality)
            return {
                "status": "success",
                "path": save_path,
                "size": {"width": img.width, "height": img.height},
            }
        else:
            # Return base64
            if HAS_PIL:
                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=quality)
                b64 = base64.b64encode(buffer.getvalue()).decode()
                return {
                    "status": "success",
                    "base64": b64,
                    "size": {"width": img.width, "height": img.height},
                    "format": "jpeg",
                }
            else:
                return {
                    "status": "error",
                    "error": "PIL required for base64 output",
                }
                
    except Exception as e:
        logger.error(f"Error taking screenshot: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def start_recording(
    output_path: Optional[str] = None,
    fps: int = 10,
    screen_index: int = 0,
    region: Optional[Tuple[int, int, int, int]] = None,
    max_duration_sec: int = 300,
) -> Dict[str, Any]:
    """
    Start screen recording.
    
    Args:
        output_path: Path to save video (auto-generated if not provided)
        fps: Frames per second (default 10, max 30)
        screen_index: Monitor index (0 = all, 1 = primary)
        region: Optional region as (x, y, width, height)
        max_duration_sec: Maximum recording duration in seconds (default 5 min)
        
    Returns:
        Dict with recording session info
    """
    global _active_recording
    
    if not HAS_CV2:
        return {
            "status": "error",
            "error": "opencv-python required for recording. Install: pip install opencv-python",
        }
    
    if not HAS_MSS and not HAS_PYAUTOGUI:
        return {
            "status": "error",
            "error": "mss or pyautogui required for screen capture",
        }
    
    with _recording_lock:
        if _active_recording and _active_recording.status == RecordingStatus.RECORDING:
            return {
                "status": "error",
                "error": "Recording already in progress",
                "session_id": _active_recording.session_id,
            }
        
        session_id = _generate_recording_id()
        
        # Generate output path if not provided
        if not output_path:
            output_dir = os.path.join(tempfile.gettempdir(), "substrate_recordings")
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, f"{session_id}.mp4")
        
        # Clamp FPS
        fps = max(1, min(30, fps))
        
        session = RecordingSession(
            session_id=session_id,
            status=RecordingStatus.RECORDING,
            started_at=time.time(),
            output_path=output_path,
            fps=fps,
            region=region,
            screen_index=screen_index,
        )
        
        _active_recording = session
        
        def record_thread():
            try:
                # Get screen dimensions
                if HAS_MSS:
                    with mss.mss() as sct:
                        monitors = sct.monitors
                        if screen_index >= len(monitors):
                            mon = monitors[0]
                        else:
                            mon = monitors[screen_index]
                        
                        if region:
                            width, height = region[2], region[3]
                            capture_region = {"left": region[0], "top": region[1],
                                            "width": width, "height": height}
                        else:
                            width, height = mon["width"], mon["height"]
                            capture_region = mon
                else:
                    size = pyautogui.size()
                    width, height = size.width, size.height
                    capture_region = None
                
                # Create video writer
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
                
                frame_interval = 1.0 / fps
                start_time = time.time()
                
                while not session._stop_event.is_set():
                    frame_start = time.time()
                    
                    # Check max duration
                    if (frame_start - start_time) > max_duration_sec:
                        logger.info(f"Recording reached max duration: {max_duration_sec}s")
                        break
                    
                    # Capture frame
                    if HAS_MSS:
                        with mss.mss() as sct:
                            screenshot = sct.grab(capture_region)
                            frame = np.array(screenshot)
                            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
                    else:
                        if region:
                            screenshot = pyautogui.screenshot(region=region)
                        else:
                            screenshot = pyautogui.screenshot()
                        frame = np.array(screenshot)
                        frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                    
                    out.write(frame)
                    session.frames_captured += 1
                    
                    # Maintain frame rate
                    elapsed = time.time() - frame_start
                    if elapsed < frame_interval:
                        time.sleep(frame_interval - elapsed)
                
                out.release()
                session.status = RecordingStatus.STOPPED
                session.ended_at = time.time()
                logger.info(f"Recording saved: {output_path} ({session.frames_captured} frames)")
                
            except Exception as e:
                logger.error(f"Recording error: {e}")
                session.status = RecordingStatus.FAILED
                session.error = str(e)
                session.ended_at = time.time()
        
        # Start recording thread
        session._thread = threading.Thread(target=record_thread, daemon=True)
        session._thread.start()
        
        return {
            "status": "success",
            "session_id": session_id,
            "output_path": output_path,
            "fps": fps,
            "message": f"Recording started. Call stop_recording() to save.",
        }


def stop_recording() -> Dict[str, Any]:
    """
    Stop the current screen recording.
    
    Returns:
        Dict with recording result
    """
    global _active_recording
    
    with _recording_lock:
        if not _active_recording:
            return {
                "status": "error",
                "error": "No active recording",
            }
        
        session = _active_recording
        
        if session.status != RecordingStatus.RECORDING:
            return {
                "status": "error",
                "error": f"Recording not active: {session.status.value}",
            }
        
        # Signal stop
        session._stop_event.set()
        
        # Wait for thread to finish
        if session._thread:
            session._thread.join(timeout=5)
        
        duration_sec = (session.ended_at or time.time()) - (session.started_at or time.time())
        
        return {
            "status": "success",
            "session_id": session.session_id,
            "output_path": session.output_path,
            "frames_captured": session.frames_captured,
            "duration_sec": round(duration_sec, 2),
            "fps": session.fps,
            "message": f"Recording saved to {session.output_path}",
        }


def get_recording_status() -> Dict[str, Any]:
    """
    Get the status of the current recording.
    
    Returns:
        Dict with recording status
    """
    global _active_recording
    
    with _recording_lock:
        if not _active_recording:
            return {
                "status": "success",
                "recording_status": "idle",
                "message": "No active recording",
            }
        
        session = _active_recording
        duration = 0
        if session.started_at:
            duration = time.time() - session.started_at
        
        return {
            "status": "success",
            "session_id": session.session_id,
            "recording_status": session.status.value,
            "output_path": session.output_path,
            "frames_captured": session.frames_captured,
            "duration_sec": round(duration, 2),
            "fps": session.fps,
            "error": session.error,
        }


class ScreenTool:
    """
    Screen tool for LLM function calling.
    """
    
    name = "screen"
    description = "Screen capture and recording"
    
    @staticmethod
    def info() -> Dict[str, Any]:
        return get_screen_info()
    
    @staticmethod
    def screenshot(
        screen_index: int = 0,
        region: Tuple[int, int, int, int] = None,
        save_path: str = None,
    ) -> Dict[str, Any]:
        return take_screenshot(screen_index, region, save_path)
    
    @staticmethod
    def start_recording(
        output_path: str = None,
        fps: int = 10,
        screen_index: int = 0,
        max_duration_sec: int = 300,
    ) -> Dict[str, Any]:
        return start_recording(output_path, fps, screen_index, None, max_duration_sec)
    
    @staticmethod
    def stop_recording() -> Dict[str, Any]:
        return stop_recording()
    
    @staticmethod
    def recording_status() -> Dict[str, Any]:
        return get_recording_status()
