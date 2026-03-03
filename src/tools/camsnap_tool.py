"""Camsnap Tool - Fast Webcam/Camera Capture with Keep-Alive Pool

Capture images from connected cameras for visual awareness.
Uses a keep-alive camera pool for instant warm captures (~50ms vs ~1500ms cold).
"""

import os
import sys
import time
import base64
import logging
import threading
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# Try to import OpenCV
try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    logger.warning("OpenCV not installed. Run: pip install opencv-python")

IS_WINDOWS = sys.platform == 'win32'
CAMSNAP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "visual_memory", "images")
JPEG_QUALITY = 80  # Good enough for vision models, ~40% smaller than default 95
IDLE_TIMEOUT = 30  # Seconds before releasing an idle camera
COLD_WARMUP = 2    # Frames to skip on cold open (auto-exposure settle)
CAMERA_CONTEXT = "This is your live view through the camera."  # Prepended to vision prompts


def _ensure_camsnap_dir():
    """Ensure camsnap directory exists."""
    os.makedirs(CAMSNAP_DIR, exist_ok=True)
    return CAMSNAP_DIR


# ── Camera Pool (keep-alive singleton) ──────────────────────────────────────

class _CameraPool:
    """Keeps cameras open between calls for instant frame grabs.
    
    First call: opens camera + warmup (~300-800ms)
    Subsequent calls: just cap.read() (~30-60ms)
    Auto-releases after IDLE_TIMEOUT seconds of inactivity.
    """
    
    def __init__(self):
        self._cameras: Dict[str, cv2.VideoCapture] = {}  # key -> VideoCapture
        self._last_used: Dict[str, float] = {}           # key -> timestamp
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._started_cleanup = False
    
    def _key(self, camera_index: int = 0, camera_url: Optional[str] = None) -> str:
        return camera_url or f"idx:{camera_index}"
    
    def grab_frame(self, camera_index: int = 0, camera_url: Optional[str] = None):
        """Grab a single frame. Opens camera if needed, reuses if warm.
        
        Returns:
            (frame, is_warm) — numpy frame and whether the camera was already open
        """
        if not HAS_OPENCV:
            raise RuntimeError("OpenCV not installed")
        
        key = self._key(camera_index, camera_url)
        
        with self._lock:
            cap = self._cameras.get(key)
            is_warm = cap is not None and cap.isOpened()
            
            if not is_warm:
                # Cold open
                if camera_url:
                    cap = cv2.VideoCapture(camera_url)
                else:
                    backend = cv2.CAP_DSHOW if IS_WINDOWS else cv2.CAP_ANY
                    cap = cv2.VideoCapture(camera_index, backend)
                
                if not cap.isOpened():
                    raise RuntimeError(f"Could not open camera (index={camera_index}, url={camera_url})")
                
                # Cold warmup — let auto-exposure settle
                for _ in range(COLD_WARMUP):
                    cap.read()
                
                self._cameras[key] = cap
                logger.info(f"[CAMPOOL] Cold-opened camera '{key}'")
            
            # Grab frame
            ret, frame = cap.read()
            self._last_used[key] = time.time()
            
            if not ret or frame is None:
                # Camera may have disconnected — evict and retry once
                self._evict(key)
                raise RuntimeError("Failed to capture frame")
        
        # Start cleanup timer if not running
        self._ensure_cleanup_timer()
        
        return frame, is_warm
    
    def _evict(self, key: str):
        """Release and remove a camera. Must be called with lock held."""
        cap = self._cameras.pop(key, None)
        self._last_used.pop(key, None)
        if cap:
            try:
                cap.release()
            except Exception:
                pass
            logger.info(f"[CAMPOOL] Released camera '{key}'")
    
    def _cleanup_idle(self):
        """Release cameras that haven't been used recently."""
        now = time.time()
        with self._lock:
            to_evict = [k for k, t in self._last_used.items() if now - t > IDLE_TIMEOUT]
            for key in to_evict:
                self._evict(key)
        
        # Reschedule if any cameras still open
        with self._lock:
            if self._cameras:
                self._timer = threading.Timer(IDLE_TIMEOUT / 2, self._cleanup_idle)
                self._timer.daemon = True
                self._timer.start()
            else:
                self._timer = None
                self._started_cleanup = False
    
    def _ensure_cleanup_timer(self):
        if not self._started_cleanup:
            self._started_cleanup = True
            self._timer = threading.Timer(IDLE_TIMEOUT / 2, self._cleanup_idle)
            self._timer.daemon = True
            self._timer.start()
    
    def release_all(self):
        """Release all cameras immediately."""
        with self._lock:
            for key in list(self._cameras.keys()):
                self._evict(key)
            if self._timer:
                self._timer.cancel()
                self._timer = None
                self._started_cleanup = False


# Global singleton
_pool = _CameraPool()


# ── Cached list_cameras ─────────────────────────────────────────────────────

_cameras_cache = None
_cameras_cache_time = 0
_CAMERAS_CACHE_TTL = 60  # seconds


def list_cameras(max_check: int = 5) -> Dict[str, Any]:
    """List available camera devices. Results cached for 60s."""
    global _cameras_cache, _cameras_cache_time
    
    if not HAS_OPENCV:
        return {"status": "error", "error": "OpenCV not installed. Run: pip install opencv-python"}
    
    now = time.time()
    if _cameras_cache and (now - _cameras_cache_time) < _CAMERAS_CACHE_TTL:
        return _cameras_cache
    
    available = []
    backend = cv2.CAP_DSHOW if IS_WINDOWS else cv2.CAP_ANY
    for i in range(max_check):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                available.append({
                    "index": i,
                    "resolution": f"{width}x{height}",
                    "name": f"Camera {i}"
                })
            cap.release()
    
    _cameras_cache = {"status": "success", "cameras": available, "count": len(available)}
    _cameras_cache_time = now
    return _cameras_cache


# ── Core capture (uses pool) ────────────────────────────────────────────────

def capture(
    camera_index: int = 0,
    camera_url: Optional[str] = None,
    save_path: Optional[str] = None,
    return_base64: bool = True,
) -> Dict[str, Any]:
    """Capture an image from a camera. Uses keep-alive pool for speed."""
    if not HAS_OPENCV:
        return {"status": "error", "error": "OpenCV not installed. Run: pip install opencv-python"}
    
    t0 = time.perf_counter()
    try:
        frame, is_warm = _pool.grab_frame(camera_index, camera_url)
    except RuntimeError as e:
        return {"status": "error", "error": str(e)}
    
    capture_ms = (time.perf_counter() - t0) * 1000
    
    # Generate save path
    if not save_path:
        _ensure_camsnap_dir()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_path = os.path.join(CAMSNAP_DIR, f"camsnap_{timestamp}.jpg")
    
    # Save with optimized quality
    cv2.imwrite(save_path, frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    
    result = {
        "status": "success",
        "path": save_path,
        "resolution": f"{frame.shape[1]}x{frame.shape[0]}",
        "timestamp": datetime.now().isoformat(),
        "capture_ms": round(capture_ms, 1),
        "warm": is_warm,
    }
    
    if return_base64:
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        result["image_base64"] = base64.b64encode(buffer).decode('utf-8')
    
    logger.info(f"[CAMSNAP] Captured in {capture_ms:.0f}ms ({'warm' if is_warm else 'cold'})")
    return result


# ── Capture + Describe ──────────────────────────────────────────────────────

def capture_and_describe(
    camera_index: int = 0,
    camera_url: Optional[str] = None,
    prompt: str = "",
    save_image: bool = True
) -> Dict[str, Any]:
    """Capture an image and get a description from the vision LLM."""
    capture_result = capture(
        camera_index=camera_index,
        camera_url=camera_url,
        return_base64=True
    )
    
    if capture_result["status"] != "success":
        return capture_result
    
    # Route to best available vision model via agent
    vision_prompt = f"{CAMERA_CONTEXT} {prompt}".strip() if prompt else CAMERA_CONTEXT
    try:
        _ps = sys.modules.get('proxy_server')
        _agent = getattr(_ps, 'agent', None) if _ps else None
        if _agent:
            description = _agent.describe_image(
                image_base64=capture_result["image_base64"],
                prompt=vision_prompt
            )
            capture_result["description"] = description or "No description available"
        else:
            raise RuntimeError("Agent not initialized")
    except Exception as e:
        logger.warning(f"describe_image via agent failed: {e}")
        capture_result["description"] = f"Image captured but vision failed: {e}"
    
    if not save_image and "image_base64" in capture_result:
        del capture_result["image_base64"]
    
    return capture_result


# ── Fast "look" tool — instant capture + describe, like screenshot ──────────

def look(
    prompt: str = "",
    camera_index: int = 0,
    camera_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Instantly look through the camera and describe what's visible.
    
    This is the fast path — equivalent to taking a screenshot but through
    the camera. Uses the keep-alive pool so warm captures are ~50ms.
    Does NOT save the image to disk unless needed.
    """
    if not HAS_OPENCV:
        return {"status": "error", "error": "OpenCV not installed"}
    
    t0 = time.perf_counter()
    
    try:
        frame, is_warm = _pool.grab_frame(camera_index, camera_url)
    except RuntimeError as e:
        return {"status": "error", "error": str(e)}
    
    # Encode to JPEG base64 (skip disk save for speed)
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    image_b64 = base64.b64encode(buffer).decode('utf-8')
    
    capture_ms = (time.perf_counter() - t0) * 1000
    
    # Get description from best available vision model
    vision_prompt = f"{CAMERA_CONTEXT} {prompt}".strip() if prompt else CAMERA_CONTEXT
    description = None
    try:
        _ps = sys.modules.get('proxy_server')
        _agent = getattr(_ps, 'agent', None) if _ps else None
        if _agent:
            description = _agent.describe_image(image_base64=image_b64, prompt=vision_prompt)
    except Exception as e:
        logger.warning(f"[LOOK] agent.describe_image failed: {e}")
    
    if not description:
        description = "Camera captured but vision model returned no description. Check online provider config."
    
    total_ms = (time.perf_counter() - t0) * 1000
    logger.info(f"[LOOK] Done in {total_ms:.0f}ms (capture={capture_ms:.0f}ms, {'warm' if is_warm else 'cold'})")
    
    return {
        "status": "success",
        "description": description,
        "resolution": f"{frame.shape[1]}x{frame.shape[0]}",
        "capture_ms": round(capture_ms, 1),
        "total_ms": round(total_ms, 1),
        "warm": is_warm,
    }


# ── Recent captures ─────────────────────────────────────────────────────────

def get_recent_captures(limit: int = 10) -> Dict[str, Any]:
    """Get list of recent camsnap captures."""
    _ensure_camsnap_dir()
    
    try:
        files = []
        for f in os.listdir(CAMSNAP_DIR):
            if f.endswith(('.jpg', '.png', '.jpeg')):
                path = os.path.join(CAMSNAP_DIR, f)
                files.append({
                    "filename": f,
                    "path": path,
                    "size": os.path.getsize(path),
                    "modified": datetime.fromtimestamp(os.path.getmtime(path)).isoformat()
                })
        
        files.sort(key=lambda x: x["modified"], reverse=True)
        
        return {
            "status": "success",
            "captures": files[:limit],
            "total": len(files)
        }
        
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ── Tool definitions for registry ───────────────────────────────────────────

CAMSNAP_TOOLS = {
    "look": {
        "function": look,
        "description": "Instantly look through the camera and describe what's visible. Uses default webcam (camera 0). Fast — like taking a screenshot but through the webcam.",
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "What to look for or describe"}
            }
        }
    },
}
