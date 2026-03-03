import pyautogui
import random
import time
import threading
import base64
import logging
from io import BytesIO
from PIL import Image

# Try to import screeninfo for multi-monitor support
try:
    from screeninfo import get_monitors
    HAS_SCREENINFO = True
except ImportError:
    HAS_SCREENINFO = False

logger = logging.getLogger(__name__)


def get_active_monitor_region():
    """Get the region of the monitor where the cursor is currently located.
    Returns (left, top, width, height) or None if we should capture all screens."""
    if not HAS_SCREENINFO:
        return None
    
    try:
        # Get cursor position
        cursor_x, cursor_y = pyautogui.position()
        
        # Find which monitor contains the cursor
        for monitor in get_monitors():
            if (monitor.x <= cursor_x < monitor.x + monitor.width and
                monitor.y <= cursor_y < monitor.y + monitor.height):
                logger.info(f"Cursor at ({cursor_x}, {cursor_y}) is on monitor: {monitor.name} ({monitor.width}x{monitor.height})")
                return (monitor.x, monitor.y, monitor.width, monitor.height)
        
        # Fallback to primary monitor if cursor not found on any
        for monitor in get_monitors():
            if monitor.is_primary:
                logger.info(f"Cursor not found on any monitor, using primary: {monitor.name}")
                return (monitor.x, monitor.y, monitor.width, monitor.height)
        
        return None
    except Exception as e:
        logger.warning(f"Error getting active monitor: {e}")
        return None

class ScreenshotHandler(threading.Thread):
    def __init__(self, chat_agent):
        super().__init__()
        self.chat_agent = chat_agent
        self.daemon = True
        self._stop_event = threading.Event()
        self.last_screenshot_time = time.time()
        
        # Get initial config
        screenshot_config = self.chat_agent.config.get('autonomy', {}).get('screenshot', {})
        self.enabled = screenshot_config.get('enabled', True)
        self.min_interval = screenshot_config.get('min_interval', 30)
        self.max_interval = screenshot_config.get('max_interval', 300)
        # Initialize with autonomy prompt if set; default will be finalized in run()
        self.screenshot_prompt = screenshot_config.get('prompt', '')
        logger.info(f"Screenshot handler initialized with config: enabled={self.enabled}, min={self.min_interval}, max={self.max_interval}")
        
    def stop(self):
        """Stop the screenshot handler"""
        self._stop_event.set()
        
    def run(self):
        """Main screenshot loop"""
        logger.info("Starting screenshot handler thread")
        while not self._stop_event.is_set():
            try:
                # Get latest config
                with self.chat_agent._memory_lock:
                    screenshot_config = self.chat_agent.config.get('autonomy', {}).get('screenshot', {})
                    self.enabled = screenshot_config.get('enabled', True)
                    
                    # Convert to boolean explicitly to handle string values like "false"
                    if isinstance(self.enabled, str):
                        self.enabled = self.enabled.lower() == "true"
                        logger.info(f"Screenshot autonomy enabled state (converted from string): {self.enabled}")
                        
                    self.min_interval = screenshot_config.get('min_interval', 30)
                    self.max_interval = screenshot_config.get('max_interval', 300)
                    # Resolve both system-level and user-level prompts
                    # If autonomy.screenshot.prompt is empty, default it to the root screenshot system prompt
                    self.screenshot_prompt = screenshot_config.get('prompt', '')
                    # Read root-level screenshot system prompt from main config so edits propagate live
                    self.root_screenshot_system_prompt = self.chat_agent.config.get('screenshot_prompt', '')
                    if not self.screenshot_prompt:
                        # Fallback the user prompt to the root directive to keep behavior consistent
                        self.screenshot_prompt = self.root_screenshot_system_prompt or "What do you see?"
                
                # Log the current state
                logger.info(f"Screenshot handler current state: enabled={self.enabled} (type: {type(self.enabled).__name__})")
                
                if not self.enabled:
                    logger.info("Screenshot autonomy is disabled, skipping screenshot")
                    time.sleep(10)  # Sleep longer when disabled
                    continue
                
                current_time = time.time()
                # Check if enough time has passed
                if current_time - self.last_screenshot_time >= self.min_interval:
                    # Randomly decide whether to take a screenshot
                    if random.random() < 0.5:  # 50% chance when min_interval is reached
                        logger.info("Taking screenshot...")
                        try:
                            # Take screenshot of active monitor (where cursor is)
                            region = get_active_monitor_region()
                            if region:
                                screenshot = pyautogui.screenshot(region=region)
                                logger.info(f"Captured screenshot of active monitor region: {region}")
                            else:
                                screenshot = pyautogui.screenshot()
                                logger.info("Captured full screen screenshot (no multi-monitor support)")
                            
                            # Convert to base64
                            buffered = BytesIO()
                            screenshot.save(buffered, format="PNG")
                            img_str = base64.b64encode(buffered.getvalue()).decode()
                            
                            # Create messages for the screenshot
                            messages = [
                                {
                                    "role": "system",
                                    # Use the root config screenshot prompt as the authoritative system directive.
                                    # Fallback mirrors the current root default to avoid surprises if unset.
                                    "content": (self.root_screenshot_system_prompt or
                                                 "respond to what you see in less than 20 words. Respond naturally. Randomly decide to either troll the user, ask a question about what you see or make a general comment.")
                                },
                                {
                                    "role": "user",
                                    "content": [
                                        {"type": "text", "text": self.screenshot_prompt},
                                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_str}"}}
                                    ]
                                }
                            ]
                            
                            # Process the screenshot
                            logger.info("Sending screenshot to chat...")
                            self.chat_agent.chat_response(
                                self.screenshot_prompt or "What do you see?",
                                image_data=f"data:image/png;base64,{img_str}",
                                override_messages=messages
                            )
                            
                            # Update last screenshot time
                            self.last_screenshot_time = current_time
                            
                        except Exception as e:
                            logger.error(f"Error taking/processing screenshot: {e}")
                            
                # Sleep for a bit before checking again
                time.sleep(min(self.min_interval, 60))  # Sleep for min_interval or 60 seconds, whichever is less
                
            except Exception as e:
                logger.error(f"Error in screenshot loop: {e}")
                time.sleep(60)  # Sleep for a minute on error
