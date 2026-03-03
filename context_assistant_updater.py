import threading
import time
import win32clipboard
import win32gui
import win32con
import win32api
import logging
import re
from datetime import datetime, timedelta

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ContextAssistantUpdater:
    """
    Monitors for highlighted text and provides it as context for chat queries.
    This allows users to highlight text anywhere on their system and then ask questions about it.
    The highlighted text is only valid for a short period after highlighting.
    
    FIXED VERSION: This version completely avoids the Ctrl+C spam issue by using an alternative
    approach that doesn't rely on continuous keyboard events.
    """
    
    def __init__(self, context_timeout_seconds=30):
        self.highlighted_text = None
        self.monitoring_active = False
        self.monitor_thread = None
        self.lock = threading.Lock()
        self.last_highlight_time = None
        self.context_timeout_seconds = context_timeout_seconds
        
        # Configuration for polling
        self.polling_interval = 5.0  # Only check every 5 seconds
        self.last_check_time = 0
        self.last_clipboard_content = None
        
        logger.info("Context Assistant initialized with fixed polling mechanism")
        
    def start_monitoring(self):
        """Start monitoring for highlighted text"""
        if self.monitoring_active:
            return
            
        self.monitoring_active = True
        
        # Start text monitoring with fixed approach
        self.monitor_thread = threading.Thread(target=self._monitor_clipboard_changes, daemon=True)
        self.monitor_thread.start()
        
        logger.info("Started monitoring clipboard changes (fixed mode)")
        
    def stop_monitoring(self):
        """Stop monitoring"""
        self.monitoring_active = False
        
        if self.monitor_thread:
            self.monitor_thread.join(timeout=1.0)
            self.monitor_thread = None
            
        logger.info("Stopped monitoring")
    
    def _monitor_clipboard_changes(self):
        """Monitor clipboard for changes instead of sending Ctrl+C commands"""
        while self.monitoring_active:
            try:
                # Only check periodically
                current_time = time.time()
                if current_time - self.last_check_time < self.polling_interval:
                    time.sleep(0.5)
                    continue
                    
                self.last_check_time = current_time
                
                # Get current clipboard content
                current_content = self._get_clipboard_text()
                
                # If content changed since last check and isn't empty
                if current_content and current_content != self.last_clipboard_content:
                    # Clean up the text
                    cleaned_text = self._clean_text(current_content)
                    
                    # Update the highlighted text if it's valid
                    if cleaned_text:
                        with self.lock:
                            self.highlighted_text = cleaned_text
                            self.last_highlight_time = datetime.now()
                            logger.debug(f"Clipboard context updated: {cleaned_text[:30]}...")
                    
                    # Update last seen content
                    self.last_clipboard_content = current_content
                
                # Check if the highlighted text has expired
                self._check_expiration()
                
                # Sleep to reduce CPU usage
                time.sleep(0.5)
                
            except Exception as e:
                logger.error(f"Error monitoring clipboard: {str(e)}")
                time.sleep(1.0)  # Sleep longer on error
    
    def _get_clipboard_text(self):
        """Get text from clipboard without sending keyboard events"""
        try:
            win32clipboard.OpenClipboard()
            try:
                if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_TEXT):
                    clipboard_content = win32clipboard.GetClipboardData(win32clipboard.CF_TEXT)
                    if isinstance(clipboard_content, bytes):
                        clipboard_content = clipboard_content.decode('utf-8', errors='replace')
                    return clipboard_content
                elif win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                    return win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
            finally:
                win32clipboard.CloseClipboard()
        except Exception as e:
            logger.error(f"Error reading clipboard: {str(e)}")
        return None
    
    def _check_expiration(self):
        """Check if the highlighted text has expired and clear it if necessary"""
        with self.lock:
            if (self.highlighted_text and self.last_highlight_time and 
                datetime.now() > self.last_highlight_time + timedelta(seconds=self.context_timeout_seconds)):
                logger.debug(f"Clipboard context expired")
                self.highlighted_text = None
                self.last_highlight_time = None
    
    def _clean_text(self, text):
        """Clean up text by removing excessive whitespace and normalizing line endings"""
        if not text:
            return None
            
        # Replace multiple whitespace with a single space
        cleaned = re.sub(r'\s+', ' ', text)
        # Remove leading/trailing whitespace
        cleaned = cleaned.strip()
        
        return cleaned if cleaned else None
    
    def get_highlighted_text(self):
        """Get the current highlighted text (thread-safe) if it hasn't expired"""
        with self.lock:
            # Check if the text has expired
            if (self.highlighted_text and self.last_highlight_time and 
                datetime.now() > self.last_highlight_time + timedelta(seconds=self.context_timeout_seconds)):
                logger.debug(f"Clipboard context expired on access")
                self.highlighted_text = None
                self.last_highlight_time = None
                return None
            
            return self.highlighted_text
    
    def clear_highlighted_text(self):
        """Clear the current highlighted text (thread-safe)"""
        with self.lock:
            self.highlighted_text = None
            self.last_highlight_time = None
            logger.info("Cleared highlighted text")
