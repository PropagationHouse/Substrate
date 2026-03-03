import os
import json
import time
import datetime
import requests
import webbrowser
import pyautogui
import pyperclip
import win32gui
import traceback
from typing import Dict, Any, Optional
import pyautogui
import webbrowser
import subprocess
import winreg
import base64
import re
from PIL import Image
import io
import urllib.parse
from bs4 import BeautifulSoup

import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import traceback
import re
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.edge.service import Service
from selenium.webdriver.edge.options import Options
from webdriver_manager.microsoft import EdgeChromiumDriverManager
import cv2
import numpy as np
import win32con  # Added for keyboard control
import win32api  # For keyboard control
import random
from ..clock.clock_service import ClockService
import keyboard  # Import keyboard module
import pygetwindow as gw
from .command_parser import CommandParser
from ..memory.memory_manager import MemoryManager
from ..chat.chat_agent import ChatAgent

DEFAULT_NOTE_PROMPTS = {
    "system": """You are a creative assistant skilled in Obsidian markdown formatting. ALWAYS start your note with a clear, descriptive title using a level 1 heading (# Title). This title should be on the first line and should summarize the note content in 3-7 words. Do not use special characters like " * \ / < > : | ? in the title.

After the title, format the rest of your response using proper Obsidian syntax:

1. For diagrams and visualizations:
   A. For Gantt charts:
     ```mermaid
     gantt
         dateFormat  YYYY-MM-DD
         title Project Timeline
         
         section Planning
         Research      :a1, 2024-01-01, 7d
         Design       :a2, after a1, 5d
         
         section Development
         Coding       :a3, after a2, 10d
         Testing      :a4, after a3, 5d
     ```
     GANTT RULES:
     - MUST include dateFormat at start
     - Use YYYY-MM-DD for dates
     - Each task needs unique ID (a1, a2, etc.)
     - Duration in days (5d) or specific end date
     - Use 'after taskId' for dependencies
     - Always group tasks in sections

   B. For timelines:
     ```mermaid
     timeline
         title Project Milestones
         section 2024
           January : Milestone 1
           February : Milestone 2
         section 2025
           March : Milestone 3
     ```

   C. For flowcharts:
     ```mermaid
     flowchart TD
         A[Process] --> B{Decision}
         B -->|Yes| C[Action]
         B -->|No| D[End]
     ```

   D. For class diagrams:
     ```mermaid
     classDiagram
         Class01 <|-- Class02
         Class03 *-- Class04
         class Class01 {
             +String name
             -int id
             #method() String
         }
     ```

   E. For mindmaps:
     ```mermaid
     mindmap
       root((Main Topic))
         Topic1
           Subtopic1
           Subtopic2
         Topic2
           Subtopic3
     ```

2. For tables:
   | Header1 | Header2 | Header3 |
   | ------- | ------- | ------- |
   | Value1  | Value2  | Value3  |

3. For callouts:
   > [!note] Note Title
   > Note content with **formatting**

   > [!warning] Warning
   > Warning content

   > [!example] Example
   > Example content

4. For code blocks:
   ```python
   def example():
       return "Hello World"
   ```

5. For links:
   - Internal: [[Note Name]]
   - With alias: [[Note Name|Displayed Text]]
   - External: [Text](https://example.com)

6. For tags:
   #tag1 #tag2/subtag

7. For task lists:
   - [ ] Incomplete task
   - [x] Completed task

8. For embedded content:
   ![[image.png]]

9. For LaTeX:
   $$E = mc^2$$

10. For highlights:
    ==highlighted text==
""",

    "general_note": """Create a detailed and well-structured note.

FORMAT:
1. Overview
2. Key Points & Insights
3. Detailed Analysis
4. Connections & Implications
5. References & Resources

REQUIREMENTS:
- Clear hierarchical structure
- Include supporting evidence/quotes
- Analyze relationships between concepts
- Academic writing style
- Thorough coverage of all points""",

    "autonomous": """Based on recent context and interactions, create a detailed note that:

1. Summarizes key discussions and insights
2. Identifies important patterns and themes
3. Suggests potential areas for deeper exploration
4. Links related concepts and ideas
5. Provides actionable next steps

REQUIREMENTS:
- Focus on high-value insights
- Include relevant quotes/context
- Suggest follow-up questions
- Keep academic rigor
- Be concise but thorough"""
}

class CommandExecutor:
    def __init__(self):
        """Initialize command executor"""
        pyautogui.FAILSAFE = True
        self.screen_width, self.screen_height = pyautogui.size()
        self.session = requests.Session()
        
        # Initialize endpoints
        self.llama_vision_endpoint = "http://localhost:11434/api/chat"
        self.ollama_endpoint = "http://localhost:11434/api/generate"
        
        # Default config with fallback model
        self.config = {
            "model": "llama3.2-vision:11b"
        }
        
        # Define default window position and size
        self.window_pos = (50, 50, 1067, 840)  # x, y, width (800 * 1.33), height (600 * 1.4)
        # Add headers to mimic a browser
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
        })
        
        # Initialize browser
        try:
            self.browser = webbrowser.get('edge')
        except webbrowser.Error:
            try:
                self.browser = webbrowser.get('windows-default')
            except webbrowser.Error:
                self.browser = webbrowser.get()
        
        self.llama_vision_endpoint = "http://localhost:11434/api/generate"
        self.clock_service = ClockService()  # Initialize clock service
        self.target_window = None
        self.command_parser = CommandParser()
        self.memory_manager = MemoryManager()
        
        # Initialize chat agent with memory manager and self reference
        self.chat_agent = ChatAgent(self.memory_manager, self)
        
        # Store last note content for retries
        self.last_note_content = None
        
        # Load config for note prompts
        self.config = self.load_config()
        self.note_prompts = self.config.get('note_prompts', DEFAULT_NOTE_PROMPTS)

    def set_config(self, config):
        """Update the configuration for this CommandExecutor instance"""
        if config and isinstance(config, dict):
            self.config = config
            pass  # Config updated
            

    def enum_windows_callback(self, hwnd, windows):
        """Callback for EnumWindows to collect window handles"""
        if win32gui.IsWindowVisible(hwnd):
            windows.append(hwnd)
        return True  # Continue enumeration
            
    def load_config(self):
        """Load configuration from file"""
        try:
            with open('config.json', 'r') as f:
                return json.load(f)
        except:
            return {
                'note_prompts': DEFAULT_NOTE_PROMPTS
            }

    def scan_installed_apps(self):
        """Scan for installed applications in common locations"""
        # Scan Start Menu
        start_menu_paths = [
            os.path.join(os.environ["PROGRAMDATA"], "Microsoft", "Windows", "Start Menu", "Programs"),
            os.path.join(os.environ["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs")
        ]
        
        for start_menu in start_menu_paths:
            if os.path.exists(start_menu):
                for root, dirs, files in os.walk(start_menu):
                    for file in files:
                        if file.endswith('.lnk'):
                            name = os.path.splitext(os.path.basename(file))[0].lower()
                            full_path = os.path.join(root, file)
                            self.app_paths[name] = full_path
                            # Also add without spaces for more flexible matching
                            name_no_spaces = name.replace(' ', '')
                            if name_no_spaces != name:
                                self.app_paths[name_no_spaces] = full_path
        
        # Common Windows apps
        common_apps = {
            'notepad': 'notepad.exe',
            'calc': 'calc.exe',
            'calculator': 'calc.exe',
            'cmd': 'cmd.exe',
            'command': 'cmd.exe',
            'commandprompt': 'cmd.exe',
            'explorer': 'explorer.exe',
            'fileexplorer': 'explorer.exe',
            'taskmgr': 'taskmgr.exe',
            'taskmanager': 'taskmgr.exe',
            'control': 'control.exe',
            'controlpanel': 'control.exe',
            'mspaint': 'mspaint.exe',
            'paint': 'mspaint.exe',
            'wordpad': 'wordpad.exe'
        }
        
        for name, exe in common_apps.items():
            system32_path = os.path.join(os.environ['SystemRoot'], 'System32', exe)
            if os.path.exists(system32_path):
                self.app_paths[name] = system32_path
        
        # Scan registry for installed programs
        registry_paths = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")
        ]
        
        for hkey, registry_path in registry_paths:
            try:
                reg_key = winreg.OpenKey(hkey, registry_path, 0, winreg.KEY_READ)
                for i in range(winreg.QueryInfoKey(reg_key)[0]):
                    try:
                        app_name = winreg.EnumKey(reg_key, i)
                        app_key = winreg.OpenKey(reg_key, app_name)
                        try:
                            path = winreg.QueryValue(app_key, None)
                            if path and os.path.exists(path):
                                name = os.path.splitext(os.path.basename(path))[0].lower()
                                self.app_paths[name] = path
                                # Also add without spaces
                                name_no_spaces = name.replace(' ', '')
                                if name_no_spaces != name:
                                    self.app_paths[name_no_spaces] = path
                        except:
                            pass
                        winreg.CloseKey(app_key)
                    except:
                        continue
                winreg.CloseKey(reg_key)
            except:
                continue

    def execute(self, command_info):
        """Execute a command based on the provided command info"""
        # Check if command_info is None
        if command_info is None:
            return {"status": "error", "result": "No command info provided"}
        
        # Store command in memory for context retention
        if isinstance(command_info, dict):
            self.memory_manager.add_memory(str(command_info), context="command_execution")
            
        command_type = command_info.get('type')
        print(f"[DEBUG] Command type: {command_type}")
        
        # No special handling for 'chill' commands
        
        try:
            print("\n[DEBUG] ===== START COMMAND EXECUTION =====")
            print("[DEBUG] Raw command info:", command_info)
            
            if not command_info:
                print("[DEBUG] No command info provided")
                return {"status": "error", "result": "No command info provided"}
            
            # Weather command handling has been completely removed
            
            # Rest of the method remains the same
            command_type = command_info.get('type', '')
            action = command_info.get('action', '')
            name = command_info.get('name', '')
            
            print(f"[DEBUG] Command type: {command_type}, action: {action}, name: {name}")
            
            if command_type == 'web':
                # Handle web commands
                url = command_info.get('url')
                if url:
                    # YouTube URLs: just open in browser (transcript tool deprecated)
                    if name == 'youtube' and ('youtube.com/watch' in url or 'youtu.be/' in url):
                        webbrowser.open(url)
                        return {
                            'status': 'success',
                            'result': f"Opening the YouTube video for you."
                        }
                    else:
                        # Regular web URL handling
                        webbrowser.open(url)
                        return {
                            'status': 'success',
                            'result': f'Opening {url} in your browser',
                            'url': url  # Include URL in the response for debugging
                        }
                return {
                    'status': 'error',
                    'result': 'No URL provided for web command'
                }
            # Check if this is a command to create a note
            elif command_type == 'create_note':
                content = command_info.get('content', '')
                return self.create_note(content)
                
            # Check if this is a chat message that might be a note creation trigger
            elif command_type == 'chat' and 'message' in command_info:
                message = command_info.get('message', '')
                if self.chat_agent.is_note_creation_trigger(message):
                    print(f"[DEBUG] Detected note creation trigger: {message}")
                    return self.chat_agent.handle_note_creation_request(message)
            elif command_type == 'note':
                content = command_info.get('content', '')
                print(f"[DEBUG] Creating note with content: {content}")
                
                if action == 'retry':
                    if self.last_note_content is None:
                        return {
                            "status": "error",
                            "result": "No previous note to retry"
                        }
                    # For retries, use the last content as context
                    retry_content = f"try again{': ' + content if content else ''}"
                    return self.create_note(retry_content)
                else:
                    self.last_note_content = content  # Store for potential retry
                    return self.create_note(content)
            elif command_type == 'app':
                # Route open commands directly to the improved _execute_open_command method
                if command_info.get('action', '') == 'open':
                    return self._execute_open_command(command_info.get('name', ''))
                else:
                    return self._execute_app_command(command_info.get('action', ''), command_info.get('name', ''))
            elif command_type == 'search':
                # Special handling for YouTube searches
                # Support different transcription variations (youtube, you tube, etc.)
                source = command_info.get('source', '').lower().replace(' ', '')
                if source == 'youtube' or source == 'yourtube' or source == 'utube':
                    print(f"[DEBUG] YouTube search detected: {command_info.get('query', '')}")
                    url = f'https://www.youtube.com/results?search_query={urllib.parse.quote(command_info.get("query", ""))}'
                    # Use the YouTube handler which includes the click functionality
                    return self._handle_youtube_command(url, command_info.get('query', ''))
                # Special handling for Midjourney searches
                elif command_info.get('source') == 'midjourney':
                    print(f"[DEBUG] Midjourney imagine detected: {command_info.get('query', '')}")
                    # Use the Midjourney handler directly
                    return self._handle_midjourney_imagine('https://www.midjourney.com/imagine', command_info.get('query', ''))
                # Handle other searches
                return self._execute_search_command(
                    command_info.get('query', ''),
                    command_info.get('browser', 'edge'),
                    command_info.get('site'),
                    command_info.get('source')
                )
            elif command_type == 'clock':
                return self.execute_clock_command(command_info)
            else:
                return {"status": "error", "result": f"Unknown command type: {command_type}"}
                
        except Exception as e:
            print(f"[DEBUG] Error executing command: {str(e)}")
            return {"status": "error", "result": str(e)}

    def execute_clock_command(self, command):
        """Execute a clock command"""
        if not command or 'action' not in command:
            return "Invalid clock command"
            
        try:
            action = command['action']
            
            if action == 'time':
                current_time = datetime.datetime.now().strftime("%I:%M %p")
                return f"The current time is {current_time}"
                
            elif action == 'set_alarm':
                time_str = command.get('time')
                if not time_str:
                    return "Please specify a time for the alarm"
                # Parse time string and set alarm...
                return f"Setting alarm for {time_str}"
                
            elif action == 'manage_timer':
                # Handle timer management...
                return "Timer management not implemented yet"
                
            else:
                return f"Unknown clock action: {action}"
                
        except Exception as e:
            return f"Error executing clock command: {str(e)}"

    def _capture_screen(self):
        """Capture the current screen"""
        screenshot = pyautogui.screenshot()
        buffered = io.BytesIO()
        screenshot.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode()

    def _analyze_screenshot(self, base64_image, query):
        """Analyze screenshot using Llama Vision to find the most relevant result"""
        prompt = f"""Analyze this YouTube search results page. Find the most relevant result for the query: '{query}'.
        Identify the coordinates of where to click to select that result.
        Focus on:
        1. Exact title matches first
        2. Official channels/playlists
        3. Higher view counts and better ratings
        4. Relevant thumbnails
        
        Return ONLY the x,y coordinates where to click in this format: x,y"""
        
        # Use the model from config or fallback to llama3.2-vision:11b
        model_to_use = self.config.get('model', 'llama3.2-vision:11b')
        print(f"[DEBUG] Using model: {model_to_use} for screenshot analysis")
        
        data = {
            "model": model_to_use,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt
                        },
                        {
                            "type": "image",
                            "image": base64_image
                        }
                    ]
                }
            ]
        }
        
        try:
            response = requests.post(self.llama_vision_endpoint, json=data)
            response_data = response.json()
            if 'response' in response_data:
                # Extract coordinates from response
                coords = response_data['response'].strip().split(',')
                if len(coords) == 2:
                    try:
                        x, y = map(int, coords)
                        return x, y
                    except ValueError:
                        return None
            return None
        except Exception as e:
            print(f"Error analyzing screenshot: {e}")
            return None

    def _find_youtube_result(self):
        """Find the first YouTube result by looking for the thumbnail area"""
        try:
            # Make sure our window is active
            if hasattr(self, 'current_window'):
                win32gui.SetForegroundWindow(self.current_window)
                time.sleep(0.5)  # Wait for window to become active
            
            # Take a screenshot of just the browser window area
            x, y, w, h = self.window_pos
            screenshot = pyautogui.screenshot(region=(x, y, w, h))
            img = np.array(screenshot)
            
            # The first result appears below the search bar
            # Adjusted Y coordinate to be lower
            target_x = 320  # Approximate x-coordinate of first result
            target_y = 275  # Increased from 225 to 275 to click lower
            
            # Add some randomness to avoid detection
            target_x += random.randint(-10, 10)
            target_y += random.randint(-5, 5)
            
            # Convert coordinates to screen position
            screen_x = self.window_pos[0] + target_x
            screen_y = self.window_pos[1] + target_y
            
            return screen_x, screen_y
            
        except Exception as e:
            print(f"Error finding YouTube result: {e}")
            return None

    def _handle_midjourney_imagine(self, url, prompt):
        """Handle Midjourney imagine prompt submission"""
        print(f"[DEBUG] Starting Midjourney imagine automation for prompt: {prompt}")
        try:
            # Calculate taller window size for Midjourney (45% taller)
            midjourney_height = int(self.window_pos[3] * 1.45)  # 45% taller
            midjourney_window = (
                self.window_pos[0],  # x
                self.window_pos[1],  # y
                self.window_pos[2],  # width
                midjourney_height    # height
            )
            print(f"[DEBUG] Using window size: {midjourney_window}")
            
            # Use direct subprocess call to open Edge with the URL
            # This is more reliable than _open_browser when called from background threads
            print(f"[DEBUG] Opening Edge browser directly with subprocess")
            try:
                edge_cmd = [
                    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
                    '--new-window',
                    'https://www.midjourney.com/imagine',
                    f'--window-position={midjourney_window[0]},{midjourney_window[1]}',
                    f'--window-size={midjourney_window[2]},{midjourney_window[3]}'
                ]
                
                # Run the command with CREATE_NO_WINDOW flag to hide console
                subprocess.Popen(edge_cmd, creationflags=subprocess.CREATE_NO_WINDOW)
                print(f"[DEBUG] Edge browser process started")
                
                # Wait for browser to open
                time.sleep(3)
                
                # Type just the prompt (without /imagine)
                print(f"[DEBUG] Typing prompt: {prompt}")
                pyautogui.write(prompt)
                time.sleep(0.5)
                
                # Press enter to submit
                print(f"[DEBUG] Pressing Enter to submit")
                pyautogui.press('enter')
                print(f"[DEBUG] Midjourney automation completed successfully")
                return True
            except Exception as inner_e:
                print(f"[DEBUG] Error in Edge subprocess: {inner_e}")
                # Fall back to the original _open_browser method
                print(f"[DEBUG] Falling back to _open_browser method")
                self._open_browser('https://www.midjourney.com/imagine', new_window=True, window_size=midjourney_window)
                
                # Wait for page to load
                time.sleep(2)
                
                # Type just the prompt (without /imagine)
                pyautogui.write(prompt)
                time.sleep(0.5)
                
                # Press enter to submit
                pyautogui.press('enter')
                return True
            
        except Exception as e:
            print(f"[DEBUG] Error in Midjourney imagine automation: {e}")
            print(f"[DEBUG] Full error: {traceback.format_exc()}")
            return False
            
    def _handle_sflix_search(self, url, query):
        """Handle SFlix search functionality"""
        try:
            # Open the SFlix search URL
            formatted_url = url.format(query)
            self._open_browser(formatted_url, new_window=True)
            return True
        except Exception as e:
            print(f"Error in SFlix search: {e}")
            return False

    def _handle_youtube_command(self, url, query):
        """Handle YouTube-specific commands and navigation"""
        try:
            print(f"[DEBUG] Handling YouTube command for: {query}")
            
            # First, open the URL in a new browser window
            import webbrowser as wb
            wb.open(url, new=2)  # Open in a new window
            
            # Wait for the window to load
            time.sleep(3.0)  # Give time for the browser to open
            
            # Use a different approach - find the window by title
            def find_youtube_window(hwnd, windows):
                if win32gui.IsWindowVisible(hwnd):
                    title = win32gui.GetWindowText(hwnd)
                    # Support different variations in window titles
                    if title and ('youtube' in title.lower() or 'you tube' in title.lower() or 'edge' in title.lower()):
                        windows.append(hwnd)
            
            # Find all windows that might be YouTube
            youtube_windows = []
            win32gui.EnumWindows(find_youtube_window, youtube_windows)
            
            # If we found any matching windows, use the first one
            if youtube_windows:
                youtube_window = youtube_windows[0]
                print(f"[DEBUG] Found {len(youtube_windows)} possible YouTube windows")
                
                # Get window position and bring to front
                rect = win32gui.GetWindowRect(youtube_window)
                win32gui.SetForegroundWindow(youtube_window)  # Bring window to front
                
                # Get the actual window position
                actual_x = rect[0]  # Left position
                actual_y = rect[1]  # Top position
                actual_width = rect[2] - rect[0]  # Window width
                actual_height = rect[3] - rect[1]  # Window height
                
                print(f"[DEBUG] YouTube window at position ({actual_x}, {actual_y}) with size {actual_width}x{actual_height}")
                
                # Wait for window to be in foreground
                time.sleep(1.0)  # Give window time to come to foreground
                
                # Calculate click position based on window size and position
                # For YouTube, the first video is typically in the top portion of the window
                # We'll calculate positions that adapt to the window size
                
                # For a typical YouTube search results page:
                # - First video is about 45% across from left edge
                # - First video is about 30% down from top edge
                rel_x = int(actual_width * 0.45)  # 45% across from left
                rel_y = int(actual_height * 0.30)  # 30% down from top
                
                target_x = actual_x + rel_x
                target_y = actual_y + rel_y
                
                # Add small random offset to avoid detection
                target_x += random.randint(-5, 5)
                target_y += random.randint(-5, 5)
                
                print(f"[DEBUG] Moving to click YouTube result at ({target_x}, {target_y})")
                
                # Click the result
                pyautogui.moveTo(target_x, target_y, duration=0.3)
                time.sleep(0.3)  # Pause before clicking
                pyautogui.click()
                
                return {"status": "success", "result": f"Opened YouTube video for: {query}"}
            else:
                print(f"[DEBUG] Could not find YouTube window")
                return {"status": "success", "result": f"Opened YouTube search for: {query} (no click)"}
                
        except Exception as e:
            print(f"[DEBUG] Error in YouTube handler: {str(e)}")
            # Fallback to simple browser open
            try:
                import webbrowser as wb
                wb.open(url)
                return {"status": "success", "result": f"Opened YouTube search for: {query}"}
            except Exception as e2:
                return {"status": "error", "result": f"Error during YouTube automation: {str(e)}"}

    def handle_web_command(self, command):
        """Handle web commands, including YouTube transcript retrieval"""
        try:
            print(f"[DEBUG] handle_web_command called with command: {command}")
            command_type = command.get('type')
            command_name = command.get('name')
            query = command.get('query')
            
            print(f"[DEBUG] Parsed command - type: {command_type}, name: {command_name}, query: {query}")
            
            # Handle YouTube-specific commands
            if command_name == 'youtube':
                # Check if this is a YouTube URL (just open it directly)
                is_youtube_url = any(
                    re.match(p, query) for p in [
                        r'https?://(?:www\.)?youtube\.com/watch\?v=[\w-]+(?:&t=\d+s?)?',
                        r'https?://youtu\.be/[\w-]+(?:\?t=\d+s?)?'
                    ]
                )
                
                if is_youtube_url:
                    try:
                        import webbrowser as wb
                        wb.open(query, new=2)
                        return {
                            "status": "success",
                            "result": f"Opening the YouTube video for you."
                        }
                    except Exception as e:
                        return {
                            "status": "error",
                            "result": f"Couldn't open the YouTube video. Error: {str(e)}"
                        }
                else:
                    # Handle as a YouTube search query
                    try:
                        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
                        import webbrowser as wb
                        wb.open(url, new=2)
                        return {
                            "status": "success",
                            "result": f"I've opened YouTube search results for: {query}"
                        }
                    except Exception as e:
                        return {
                            "status": "error",
                            "result": f"I couldn't open YouTube search. Error: {str(e)}"
                        }
            
            # Handle other web commands
            url = command.get('query')  # Assume query contains the URL
            if not url:
                return {
                    "status": "error",
                    "result": "No URL provided for web command"
                }
            
            return self._execute_web_command(url)
            
        except Exception as e:
            print(f"[DEBUG] Error in handle_web_command: {str(e)}")
            traceback.print_exc()
            return {
                "status": "error",
                "result": f"Error processing web command: {str(e)}"
            }

    def _execute_web_command(self, url):
        """Execute a web command"""
        try:
            # First check if this is a YouTube URL
            for pattern in [
                r'https?://(?:www\.)?youtube\.com/watch\?v=[\w-]+(?:&t=\d+s?)?',
                r'https?://youtu\.be/[\w-]+(?:\?t=\d+s?)?'
            ]:
                if re.match(pattern, url):
                    print(f"[DEBUG] Blocking direct URL open for YouTube URL: {url}")
                    return {"status": "info", "result": f"YouTube URL detected, processing as transcript request..."}
            
            # Add http:// if no protocol specified
            if not url.startswith(('http://', 'https://')):
                url = 'https://' + url

            # Open in Edge
            self._open_browser(url)
            return {"status": "success", "result": f"Opened {url}"}
        except Exception as e:
            return {"status": "error", "result": str(e)}

    def _execute_app_command(self, action, app_name):
        """Execute an application command"""
        try:
            if action == "open":
                # Redirect to the improved _execute_open_command method
                return self._execute_open_command(app_name)
            elif action == "close":
                # Handle closing apps by window title
                import win32gui
                
                def window_enum_handler(hwnd, windows):
                    if win32gui.IsWindowVisible(hwnd):
                        title = win32gui.GetWindowText(hwnd).lower()
                        if app_name.lower() in title:
                            windows.append(hwnd)
                
                windows = []
                win32gui.EnumWindows(window_enum_handler, windows)
                
                if windows:
                    for hwnd in windows:
                        try:
                            win32gui.PostMessage(hwnd, 0x0010, 0, 0)  # WM_CLOSE
                        except:
                            continue
                    return {"status": "success", "result": f"Closed windows containing '{app_name}'"}
                
                # Try using taskkill as a fallback
                try:
                    subprocess.run(['taskkill', '/im', f"{app_name}.exe", '/f'], 
                                capture_output=True, text=True)
                    return {"status": "success", "result": f"Closed {app_name}"}
                except Exception as e:
                    pass
                
                return {"status": "error", "result": f"Could not find any windows containing '{app_name}'"}
            else:
                raise Exception(f"Unsupported action: {action}")
        except Exception as e:
            return {"status": "error", "result": f"Failed to {action} application '{app_name}': {str(e)}"}

    def _execute_open_command(self, app_name):
        """Execute an open command for an app"""
        try:
            print(f"[DEBUG] Attempting to open app: {app_name}")
            app_name_lower = app_name.lower()
            
            # First try direct execution for very common apps
            # This is a minimal app indexing approach for reliability
            common_apps = {
                'notepad': 'notepad.exe',
                'calculator': 'calc.exe',
                'calc': 'calc.exe',
                'explorer': 'explorer.exe',
                'edge': 'msedge.exe',
                'chrome': 'chrome.exe',
                'firefox': 'firefox.exe',
                'cmd': 'cmd.exe',
                'paint': 'mspaint.exe'
            }
            
            if app_name_lower in common_apps:
                try:
                    print(f"[DEBUG] Opening common app directly: {app_name_lower}")
                    os.system(f"start {common_apps[app_name_lower]}")
                    return {"status": "success", "result": f"Opened {app_name}"}
                except Exception as e:
                    print(f"[DEBUG] Error with direct execution: {str(e)}")
                    # Continue to Windows search if direct execution fails
            
            # PRIMARY METHOD: Use Windows search for all other apps (including Obsidian)
            print(f"[DEBUG] Using Windows search for: {app_name}")
            import pyautogui
            
            # Method 1: Use Win+S for search
            try:
                # Press Win+S to open search
                pyautogui.hotkey('win', 's')
                time.sleep(0.7)  # Increased wait time for search to open
                
                # Type the app name
                pyautogui.write(app_name)
                time.sleep(0.5)  # Increased wait time for search results
                
                # Press Enter to launch the top result
                pyautogui.press('enter')
                time.sleep(0.2)  # Wait briefly after pressing enter
                
                # Press Enter again to ensure it launches (some apps need confirmation)
                pyautogui.press('enter')
                
                return {"status": "success", "result": f"Launched {app_name} using Windows search"}
            except Exception as e:
                print(f"[DEBUG] Error with Win+S search: {str(e)}")
                
                # Method 2: Use Start menu directly as fallback
                try:
                    # Press Windows key to open Start menu
                    pyautogui.press('win')
                    time.sleep(0.7)  # Wait for Start menu to open
                    
                    # Type the app name directly
                    pyautogui.write(app_name)
                    time.sleep(0.5)  # Wait for search results
                    
                    # Press Enter to launch
                    pyautogui.press('enter')
                    time.sleep(0.2)  # Wait briefly
                    pyautogui.press('enter')  # Press again for confirmation dialogs
                    
                    return {"status": "success", "result": f"Launched {app_name} using Start menu search"}
                except Exception as e2:
                    print(f"[DEBUG] Error with Start menu search: {str(e2)}")

        except Exception as e:
            print(f"[DEBUG] Error opening {app_name}: {str(e)}")
            # Try one last method - using the Run dialog
            try:
                pyautogui.hotkey('win', 'r')
                time.sleep(0.3)
                pyautogui.write(app_name)
                time.sleep(0.2)
                pyautogui.press('enter')
                return {"status": "success", "result": f"Tried to launch {app_name} using Run dialog"}
            except:
                return {"status": "error", "result": f"Error opening {app_name}: {str(e)}"}


    def _open_browser(self, url, needs_positioning=False, new_window=True, window_size=None):
        """Open URL in browser with appropriate window size"""
        try:
            if new_window:
                # Get list of current windows
                current_windows = []
                win32gui.EnumWindows(self.enum_windows_callback, current_windows)
                
                # Construct Edge command with start position
                window_pos = window_size if window_size else self.window_pos
                edge_cmd = [
                    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
                    '--new-window',
                    url,
                    f'--window-position={window_pos[0]},{window_pos[1]}',
                    f'--window-size={window_pos[2]},{window_pos[3]}'
                ]
                
                # Run the command
                subprocess.Popen(edge_cmd, creationflags=subprocess.CREATE_NO_WINDOW)
                
                # Wait for new window to appear
                time.sleep(1.5)
                
                # Find the new window handle
                new_windows = []
                win32gui.EnumWindows(self.enum_windows_callback, new_windows)
                
                # Get the most recently created window
                new_handles = set(new_windows) - set(current_windows)
                if new_handles:
                    new_window = list(new_handles)[0]
                    # Position the window exactly where we want it
                    win32gui.SetWindowPos(
                        new_window, 
                        win32con.HWND_TOP,
                        window_pos[0], 
                        window_pos[1],
                        window_pos[2], 
                        window_pos[3],
                        win32con.SWP_SHOWWINDOW
                    )
                    # Store the window handle for future use
                    self.current_window = new_window
                    return True
                    
                return False
                
            else:
                self.browser.open(url)
                return True
                
        except Exception as e:
            print(f"Error opening browser window: {e}")
            # Fallback to regular browser open
            self.browser.open(url)
            return False

    def _execute_search_command(self, query, browser='edge', site=None, source_preference=None):
        """Execute a search command"""
        print(f"\n[DEBUG] ========== SEARCH COMMAND EXECUTION ===========")
        print(f"[DEBUG] Search command details: query='{query}', browser='{browser}', site='{site}', source='{source_preference}'")
        print(f"[DEBUG] Stack trace: {traceback.format_stack()[-3:]}")
        
        query_lower = query.lower()
        
        # Google Earth functionality has been completely removed
        if source_preference == 'google_earth':
            print(f"[DEBUG] Google Earth functionality has been removed")
            return "I'm sorry, Google Earth functionality is not available."
        
        # Handle YouTube searches
        if site == 'youtube' or source_preference == 'youtube':
            print(f"[DEBUG] Executing YouTube search for: {query}")
            url = f'https://www.youtube.com/results?search_query={urllib.parse.quote(query)}'
            # Use the specialized YouTube handler to open search and click on first result
            try:
                return self._handle_youtube_command(url, query)
            except Exception as e:
                print(f"Error in YouTube handler: {str(e)}")
                # Fallback to simple browser open
                try:
                    webbrowser.open(url)
                    return {"status": "success", "result": f"Opened YouTube search for: {query}"}
                except Exception as e:
                    print(f"Error opening browser window: {str(e)}")
                    return {"status": "error", "result": f"Failed to open YouTube search: {str(e)}"}
        
        # Handle SFlix searches
        if site == 'sflix' or source_preference == 'sflix':
            url = f'https://sflix.to/search/{urllib.parse.quote(query)}'
            try:
                import webbrowser as wb
                wb.open(url)
                return {"status": "success", "result": f"Searching SFlix for: {query}"}
            except Exception as e:
                print(f"Error opening browser window: {str(e)}")
                return {"status": "error", "result": f"Failed to open SFlix search: {str(e)}"}
            
        # Handle FitGirl searches
        if site == 'games' or source_preference == 'games' or site == 'fitgirl' or source_preference == 'fitgirl':
            url = f'https://fitgirl-repacks.site/?s={urllib.parse.quote(query)}'
            try:
                import webbrowser as wb
                wb.open(url, new=2)
                return {"status": "success", "result": f"Searching FitGirl Repacks for: {query}"}
            except Exception as e:
                print(f"Error opening browser window: {str(e)}")
                return {"status": "error", "result": f"Failed to open FitGirl search: {str(e)}"}
            
        # Handle APK searches - completely rewritten
        if site == 'apk' or source_preference == 'apk' or 'apk' in query_lower:
            # Clean query
            clean_query = query.replace('APK', '').replace('apk', '').strip()
            print(f"[DEBUG] APK search detected. Query: '{query}', Cleaned: '{clean_query}'")
            
            # Define the APKMirror URL with search parameters
            search_url = f'https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s={urllib.parse.quote(clean_query)}'
            print(f"[DEBUG] Opening APK search URL: {search_url}")
            
            # Open directly in browser
            try:
                # Try direct browser open
                import webbrowser as wb
                wb.open(search_url)
                return {"status": "success", "result": f"Searching for {clean_query} APK on APKMirror"}
            except Exception as e:
                print(f"[ERROR] Failed to open browser: {e}")
                # Return error message instead of using fallback
                return {"status": "error", "result": f"Failed to open APKMirror search: {str(e)}"}
        
        # Define direct URLs for specific queries
        direct_urls = {
            # Weather entry removed to prevent conflicts with location-based queries
            # and to ensure all weather queries go through Sonar API instead
            'aurora': [
                {'url': 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast', 'type': 'forecast'},
                {'url': 'https://www.swpc.noaa.gov/communities/aurora-dashboard-experimental', 'type': 'wind'}
            ],
            'earthquake': [
                {'url': 'https://earthquake.usgs.gov/earthquakes/map/', 'type': 'map'},
                {'url': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', 'type': 'feed'}
            ],
            'games': [
                {'url': 'https://fitgirl-repacks.site/?s={query}', 'type': 'fitgirl'}
            ]
        }

        # Check for direct URLs for non-location-specific queries
        # Use exact word matching to avoid partial matches (e.g., 'new' matching 'news')
        query_words = query_lower.split()
        for key, sources in direct_urls.items():
            if key in query_words:
                # If source preference specified, try to match it
                if source_preference:
                    for source in sources:
                        if source_preference.lower() in source['type'].lower():
                            self._open_browser(source['url'].format(query=query), new_window=True)
                            return {"status": "success", "result": f"Opened {source['type']} information"}

                # If no preference or no match found and multiple sources exist
                if len(sources) > 1:
                    print("\nMultiple sources available:")
                    for i, source in enumerate(sources, 1):
                        print(f"{i}. {source['type']} information")
                    
                    # Open first source in new window, rest in same window
                    first_source = True
                    for source in sources:
                        self._open_browser(source['url'].format(query=query), new_window=first_source)
                        if first_source:
                            time.sleep(0.5)  # Small delay to ensure window is ready
                            first_source = False
                    return {"status": "success", "result": "Opened multiple relevant sources"}
                else:
                    # If only one source, open it directly
                    self._open_browser(sources[0]['url'].format(query=query), new_window=True)
                    return {"status": "success", "result": f"Opened {sources[0]['type']} information"}
        
        # Define site-specific search URLs and their handlers
        site_search_urls = {
            'youtube': {
                'url': 'https://www.youtube.com/results?search_query={}',
                'handler': self._handle_youtube_command,
            },
            # 'windy' entry removed to prevent errors with location-based queries
            # and to ensure all weather queries go through Sonar API instead
            'midjourney': {
                'url': 'https://www.midjourney.com/imagine',
                'handler': self._handle_midjourney_imagine,
                'needs_positioning': True
            },
            'google': {
                'url': 'https://www.google.com/search?q={}',
                'handler': None,
                'needs_positioning': False
            },
            'reddit': {
                'url': 'https://www.reddit.com/search/?q={}',
                'handler': None,
                'needs_positioning': False
            },
            'amazon': {
                'url': 'https://www.amazon.com/s?k={}',
                'handler': None,
                'needs_positioning': False
            },
            'netflix': {
                'url': 'https://www.netflix.com/search?q={}',
                'handler': None,
                'needs_positioning': False
            },
            'sflix': {
                'url': 'https://sflix.to/search/{}',
                'handler': self._handle_sflix_search,
                'needs_positioning': False
            },
            'github': {
                'url': 'https://github.com/search?q={}',
                'handler': None,
                'needs_positioning': False
            },
            # 'news' entry removed - now handled by Sonar
            # 'perplexity' entry removed - now handled exclusively through the Sonar API
        }

        # Handle site-specific searches
        if site and site.lower() in site_search_urls:
            site_info = site_search_urls[site.lower()]
            url = site_info['url'].format(urllib.parse.quote(query))
            
            if site_info['handler']:
                # For YouTube and other sites with special handling
                return site_info['handler'](url, query)
            else:
                # For regular sites - use direct webbrowser approach for consistency
                try:
                    import webbrowser
                    print(f"Opening site-specific search URL: {url}")
                    webbrowser.open(url, new=2)  # new=2 forces a new window
                    return {"status": "success", "result": f"Searched {site} for: {query}"}
                except Exception as e:
                    print(f"Error opening site-specific search: {e}")
                    return {"status": "error", "result": f"Failed to search {site}: {str(e)}"}

        # Check if this is a news-related query that should be handled by Sonar instead of browser
        news_keywords = ['news', 'latest', 'current events', 'breaking', 'headlines', 'today\'s news', 'recent developments']
        is_news_query = any(keyword in query_lower for keyword in news_keywords)
        
        if is_news_query:
            print(f"[DEBUG] News query detected: '{query}'. Routing to Sonar API instead of browser.")
            # Return a special status that will be recognized by the caller to use Sonar
            return {
                "status": "use_sonar", 
                "result": f"Getting the latest information about: {query}",
                "query": query
            }
        
        # For all other searches, use Google as the default search engine
        try:
            import webbrowser
            url = f'https://www.google.com/search?q={urllib.parse.quote(query)}'
            print(f"Opening default search URL: {url}")
            webbrowser.open(url, new=2)  # new=2 forces a new window
            return {"status": "success", "result": f"Searched for: {query}"}
        except Exception as e:
            print(f"Error opening search: {e}")
            return {"status": "error", "result": f"Failed to open search: {str(e)}"}

        # Weather, aurora, and earthquake functionality has been completely removed
        # Duplicate search code removed to prevent double-triggering

    def _get_coordinates(self, location):
        """Get coordinates for a location using Nominatim geocoding"""
        try:
            import requests
            # Use Nominatim (OpenStreetMap) for geocoding
            url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(location)}&format=json&limit=1"
            headers = {'User-Agent': 'TINY_PIRATE_Location_Search/1.0'}  # Updated user agent
            response = requests.get(url, headers=headers)
            data = response.json()
            
            if data and len(data) > 0:
                lat = data[0]['lat']
                lon = data[0]['lon']
                return float(lat), float(lon)
        except Exception as e:
            print(f"Error getting coordinates: {e}")
        return None
        
    def save_app_paths(self, file_path='app_paths.json'):
        """Save scanned app paths to file"""
        try:
            app_paths_file = os.path.join(os.path.dirname(__file__), file_path)
            with open(app_paths_file, 'w') as f:
                json.dump(self.app_paths, f)
        except Exception as e:
            print(f"Error saving app paths: {e}")
            
    def load_app_paths(self):
        """Load application paths from the JSON file"""
        try:
            app_paths_file = os.path.join(os.path.dirname(__file__), 'app_paths.json')
            if os.path.exists(app_paths_file):
                with open(app_paths_file, 'r') as f:
                    return json.load(f)
            return self.app_paths
        except Exception as e:
            print(f"Error loading app paths: {e}")
            return self.app_paths

    def _extract_note_title(self, content):
        """Extract a title from the note content or generate a default one
        
        Args:
            content: The note content to extract title from
            
        Returns:
            A suitable title for the note with invalid characters removed
        """
        try:
            # Generate timestamp for uniqueness
            current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
            
            # Start with a default title
            title = f"Note {current_time}"
            
            # Try to extract a better title
            # First priority: Look for level 1 markdown headers (# Title)
            # This should be the standard format based on our updated system prompt
            header_match = re.search(r'^#\s+(.+?)$', content, re.MULTILINE)
            if header_match:
                extracted_title = header_match.group(1).strip()
                if extracted_title:
                    # Use the header directly without adding timestamp since it should be a clean title
                    title = extracted_title
                    print(f"[DEBUG] Found H1 header title: {title}")
            else:
                # Second priority: Check for the first line if it's short enough to be a title
                first_line = content.strip().split('\n')[0]
                
                # Skip code block markers like ```mermaid
                if first_line.startswith('```'):
                    # Look for the second line instead
                    lines = content.strip().split('\n')
                    if len(lines) > 1:
                        first_line = lines[1].strip()
                    else:
                        first_line = "Note"  # Fallback
                
                # Skip other common non-title elements
                if len(first_line) <= 100 and not first_line.startswith('#') and not first_line.startswith('>') \
                   and not first_line.startswith('```') and not first_line.startswith('---'):
                    title = f"{first_line} - {current_time}"
                    print(f"[DEBUG] Using first line as title: {title}")
            
            # Remove invalid filename characters: \ / : * ? " < > |
            title = re.sub(r'[\\/:*?"<>|]', '', title)
            
            # Remove code block markers if they somehow got through
            title = re.sub(r'```\w*', '', title).strip()
            
            # Ensure the title isn't too long
            if len(title) > 150:
                title = title[:147] + "..."
                
            print(f"[DEBUG] Generated note title: {title}")
            return title
        except Exception as e:
            print(f"[DEBUG] Error extracting note title: {str(e)}")
            return f"Note {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}"
    
    def create_note(self, content, pre_processed=False, has_transcript=False, transcript_data=None):
        """Create a new note in Obsidian
        
        Args:
            content: The content to create a note with
            pre_processed: Whether the content is already processed
            has_transcript: Whether this note contains a transcript marker that needs to be replaced
            transcript_data: The raw transcript data to insert at the marker
        """
        try:
            print("[DEBUG] Starting note creation...")
            
            # Process the content through our enhanced generator if not already processed
            if not pre_processed:
                note_content = self.generate_note_content(content)
            else:
                note_content = content
                
            # Store the final note content for reference and summarization
            self.last_note_content = note_content
                
            # Replace transcript placeholder if needed
            if has_transcript and transcript_data:
                note_content = note_content.replace("{{TRANSCRIPT_PLACEHOLDER}}", transcript_data)
            
            # Find Obsidian window - search by partial title match
            obsidian_hwnd = None
            def find_obsidian_window(hwnd, results):
                if win32gui.IsWindowVisible(hwnd):
                    title = win32gui.GetWindowText(hwnd).lower()
                    if 'obsidian' in title:
                        results.append(hwnd)
            
            obsidian_windows = []
            win32gui.EnumWindows(find_obsidian_window, obsidian_windows)
            
            if obsidian_windows:
                obsidian_hwnd = obsidian_windows[0]
                print(f"[DEBUG] Found existing Obsidian window: {obsidian_hwnd}")
            else:
                # Obsidian not running, launch it
                print("[DEBUG] Obsidian not running, launching...")
                os.startfile("obsidian://")
                time.sleep(3)
                
                # Find it again after launch
                obsidian_windows = []
                win32gui.EnumWindows(find_obsidian_window, obsidian_windows)
                if obsidian_windows:
                    obsidian_hwnd = obsidian_windows[0]
                    print(f"[DEBUG] Found Obsidian window after launch: {obsidian_hwnd}")
            
            if obsidian_hwnd:
                # Bring Obsidian to foreground
                try:
                    # Restore if minimized
                    if win32gui.IsIconic(obsidian_hwnd):
                        win32gui.ShowWindow(obsidian_hwnd, win32con.SW_RESTORE)
                        time.sleep(0.3)
                    
                    # Bring to front
                    win32gui.SetForegroundWindow(obsidian_hwnd)
                    time.sleep(0.5)
                    
                    # Get actual window position and size
                    rect = win32gui.GetWindowRect(obsidian_hwnd)
                    win_left, win_top, win_right, win_bottom = rect
                    win_width = win_right - win_left
                    win_height = win_bottom - win_top
                    
                    # Calculate center of the window
                    center_x = win_left + (win_width // 2)
                    center_y = win_top + (win_height // 2)
                    
                    print(f"[DEBUG] Obsidian window at ({win_left}, {win_top}) size {win_width}x{win_height}")
                    print(f"[DEBUG] Clicking center at ({center_x}, {center_y})")
                    
                    # Move to center and click to ensure focus
                    pyautogui.moveTo(center_x, center_y, duration=0.2)
                    time.sleep(0.2)
                    pyautogui.click()
                    time.sleep(0.3)
                    
                except Exception as focus_error:
                    print(f"[DEBUG] Error focusing Obsidian: {focus_error}")
                    # Fallback to old method
                    screen_width, screen_height = pyautogui.size()
                    pyautogui.moveTo(screen_width // 4, screen_height // 2)
                    pyautogui.click()
                    time.sleep(0.5)
            else:
                # Fallback if we still can't find the window
                print("[DEBUG] Could not find Obsidian window, using fallback position")
                screen_width, screen_height = pyautogui.size()
                pyautogui.moveTo(screen_width // 4, screen_height // 2)
                pyautogui.click()
                time.sleep(0.5)
            
            # New note shortcut
            pyautogui.hotkey('ctrl', 'n')
            time.sleep(1)
            
            # Extract title from content or generate a default title
            title = self._extract_note_title(note_content)
            
            # Type the title
            pyperclip.copy(title)
            pyautogui.hotkey('ctrl', 'v')
            time.sleep(0.5)
            
            # Move down to content area
            pyautogui.press('down')
            time.sleep(0.5)
            
            # Ensure no modifier keys are held down before typing
            pyautogui.keyUp('ctrl')
            pyautogui.keyUp('shift')
            pyautogui.keyUp('alt')
            
            # Paste the entire content at once for all notes
            # This ensures we don't create multiple notes for different parts
            print("[DEBUG] Creating a single comprehensive note with all content")
        
            # FINAL FILTER: One last check for format instructions before copying to clipboard
            # This is our last line of defense against format instructions
            if "FORMAT:" in note_content or "REQUIREMENTS:" in note_content:
                print("[DEBUG] Found format instructions in final note content, applying emergency filter")
                
                # Split the content into lines
                lines = note_content.split('\n')
                filtered_lines = []
                in_format_section = False
                format_section_found = False
                analysis_section_found = False
                
                # Process each line
                for line in lines:
                    # Check if we're entering a format section
                    if re.match(r'^\s*(FORMAT|REQUIREMENTS|STRUCTURE)\s*:', line, re.IGNORECASE):
                        in_format_section = True
                        format_section_found = True
                        continue
                        
                    # Check if we're entering the Analysis section
                    if re.match(r'^\s*##\s*Analysis', line):
                        analysis_section_found = True
                        in_format_section = False
                        filtered_lines.append(line)
                        continue
                        
                    # Skip lines in format section until we hit a section header
                    if in_format_section and not line.strip().startswith('#'):
                        continue
                        
                    # End format section when we hit a new section
                    if in_format_section and line.strip().startswith('#'):
                        in_format_section = False
                        
                    # Add non-format lines
                    if not in_format_section:
                        filtered_lines.append(line)
                
                # If we found and removed a format section, use the filtered content
                if format_section_found:
                    note_content = '\n'.join(filtered_lines)
                    print("[DEBUG] Successfully removed format instructions from final note content")
                    
                # If we found an analysis section, also check for format instructions right after it
                if analysis_section_found:
                    # Find the Analysis section and clean what comes immediately after it
                    sections = note_content.split('## Analysis')
                    if len(sections) > 1:
                        header = sections[0] + '## Analysis'
                        analysis_content = sections[1]
                        
                        # Clean the first few lines after ## Analysis
                        analysis_lines = analysis_content.split('\n')
                        cleaned_analysis_lines = []
                        skip_next_lines = 0
                        
                        for i, line in enumerate(analysis_lines):
                            if skip_next_lines > 0:
                                skip_next_lines -= 1
                                continue
                                
                            # Skip format instructions at the beginning of analysis
                            if i < 5 and re.search(r'(FORMAT|REQUIREMENTS|I will|Here is|Below is|This is my|analysis)', line, re.IGNORECASE):
                                skip_next_lines = 1  # Skip this line and the next one
                                continue
                                
                            cleaned_analysis_lines.append(line)
                        
                        # Reassemble the note
                        note_content = header + '\n'.join(cleaned_analysis_lines)
            
            # Copy the final filtered content to clipboard
            pyperclip.copy(note_content)
            pyautogui.hotkey('ctrl', 'v')
                
            # Final safety check for modifier keys
            pyautogui.keyUp('ctrl')
            pyautogui.keyUp('shift')
            pyautogui.keyUp('alt')
            
            # Persist the full note into legacy conversation memory as a chat turn
            try:
                self._append_to_legacy_chat_memory(
                    user_message="Create note",
                    assistant_response=note_content
                )
            except Exception as mem_e:
                print(f"[DEBUG] Could not append note to legacy chat memory: {str(mem_e)}")

            # Generate a summary of what was included in the note
            try:
                # Use the first 100 characters of the note content for the summary prompt
                summary_prompt = f"Briefly summarize what's in this note (1-2 sentences): {note_content[:500]}..."
                summary_system_prompt = "You are a helpful assistant that provides brief summaries of note content."
                summary = self.chat_response_raw(summary_system_prompt, summary_prompt)
                
                # Create an enhanced response with the summary
                enhanced_result = f"I've created a note in Obsidian that includes {summary}"
                
                return {"status": "success", "result": enhanced_result, "speak": True}
            except Exception as e:
                print(f"[DEBUG] Error generating note summary: {str(e)}")
                # Fall back to generic message if summarization fails
                return {"status": "success", "result": "Note created in Obsidian", "speak": True}
        except Exception as e:
            print(f"[DEBUG] Error creating note: {str(e)}")
            return {
                "status": "error",
                "result": f"Error creating note: {str(e)}",
                "speak": True
            }

    def _append_to_legacy_chat_memory(self, user_message: str, assistant_response: str):
        """Append a chat-style entry to the legacy conversation history used by ChatAgent.
        This ensures notes are remembered as part of natural conversation across sessions.
        """
        try:
            from pathlib import Path
            import json as _json
            ts = datetime.datetime.now().isoformat()
            # Substrate/src/commands -> soma (project root) is parents[2]
            soma = Path(__file__).resolve().parents[2]
            data_dir = soma / 'data'
            data_dir.mkdir(parents=True, exist_ok=True)
            memory_file = data_dir / 'conversation_history.json'

            conversations = []
            if memory_file.exists():
                try:
                    with memory_file.open('r', encoding='utf-8') as f:
                        raw = _json.load(f)
                        conversations = raw.get('conversations', []) if isinstance(raw, dict) else []
                except Exception:
                    conversations = []

            conversations.append({
                'timestamp': ts,
                'user_message': user_message or '',
                'assistant_response': assistant_response or ''
            })

            with memory_file.open('w', encoding='utf-8') as f:
                _json.dump({'conversations': conversations}, f, indent=2)
        except Exception as e:
            print(f"[DEBUG] Error writing legacy chat memory: {str(e)}")

    def generate_note_content(self, prompt):
        """Generate note content based on the prompt"""
        try:
            print(f"[DEBUG] Generating note content with prompt: {prompt}")
            self.last_note_content = prompt  # Store for potential retry
            
            # Get recent conversation history from memory manager
            recent_messages = self.memory_manager.short_term.get_recent(10)
            conversation_context = "\n".join([msg['content'] for msg in recent_messages if 'content' in msg])
            
            # Add this prompt to memory for future reference
            self.memory_manager.add_memory(prompt, context=conversation_context)
            
            # Check if this is an autonomous note request from NoteHandler
            if prompt.startswith("Create a note based on:"):
                # This is an autonomous note request
                # Extract the actual prompt and context
                parts = prompt.split("\n\nContext:", 1)
                if len(parts) == 2:
                    autonomous_prompt = parts[0].replace("Create a note based on:", "").strip()
                    context = parts[1].strip()
                    
                    # Use the autonomous prompt directly with the context
                    user_prompt = f"Based on the following context, {autonomous_prompt}:\n\n{context}"
                    
                    # Use a general system prompt for formatting
                    system_prompt = self.note_prompts.get('system', DEFAULT_NOTE_PROMPTS['system'])
                    
                    # Get AI response
                    response = self.chat_response_raw(system_prompt, user_prompt)
                    
                    # Add timestamp
                    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    response += f"\n\n---\nCreated: {timestamp}"
                    
                    return response
        
            # For regular note creation, use the standard system prompt
            system_prompt = self.note_prompts.get('system', DEFAULT_NOTE_PROMPTS['system'])
            
            # Include conversation context in the prompt if available
            enhanced_prompt = prompt
            recent_messages = self.memory_manager.short_term.get_recent(5)
            if recent_messages and len(recent_messages) > 1:
                conversation_history = "\n".join([f"{'User' if i % 2 == 0 else 'Assistant'}: {msg['content']}" 
                                               for i, msg in enumerate(recent_messages) if 'content' in msg])
                enhanced_prompt = f"{prompt}\n\nBased on our recent conversation:\n{conversation_history}"
            
            # Get AI response
            response = self.chat_response_raw(system_prompt, enhanced_prompt)
            
            # Store the generated note content in memory for future reference
            self.memory_manager.add_memory(
                f"Created note with content: {response[:100]}...",
                context="note_creation"
            )
            
            # Add timestamp
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            response += f"\n\n---\nCreated: {timestamp}"
            
            return response
            
        except Exception as e:
            print(f"[DEBUG] Error generating note content: {str(e)}")
            return f"Error creating note: {str(e)}\n\nCreated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

    def chat_response_raw(self, system_prompt, user_prompt):
        """Get a raw response from the chat model using Ollama"""
        try:
            import requests
            import json
            
            # Format the request for Ollama
            url = "http://localhost:11434/api/generate"
            
            # Use the model from config or fallback to llama3.2-vision:11b
            model_to_use = self.config.get('model', 'llama3.2-vision:11b')
            print(f"[DEBUG] Using model: {model_to_use} for LLM request")
            print(f"[MODEL USAGE] Using model: {model_to_use} for chat_response_raw request")
            
            # Enhance system prompt to explicitly prevent format instructions
            enhanced_system_prompt = system_prompt
            if "do not include formatting instructions" not in system_prompt.lower():
                enhanced_system_prompt = f"{system_prompt}\n\nIMPORTANT: Do not include any formatting instructions, format sections, or notes about how you've structured your response in your output."
            
            data = {
                "model": model_to_use,
                "system": enhanced_system_prompt,
                "prompt": user_prompt,
                "stream": False
            }
            
            print(f"[DEBUG] System prompt length: {len(system_prompt)} characters")
            print(f"[DEBUG] User prompt length: {len(user_prompt)} characters")
            print(f"[DEBUG] User prompt preview: {user_prompt[:100]}...")
            
            # Check if transcript is in the prompt for debug logging
            if "TRANSCRIPT:" in user_prompt:
                transcript_start = user_prompt.find("TRANSCRIPT:")
                transcript_end = user_prompt.find("\n\n", transcript_start + 11)
                if transcript_end == -1:
                    transcript_end = len(user_prompt)
                transcript_length = transcript_end - transcript_start - 11
                print(f"[DEBUG] Transcript length in prompt: {transcript_length} characters")
            
            print("[DEBUG] Sending request to Ollama API")
            response = requests.post(url, json=data)
            
            # Get raw response text
            raw_text = response.text
            print(f"[DEBUG] Response status code: {response.status_code}")
            print(f"[DEBUG] Raw response text (first 200 chars): {raw_text[:200]}...")
            
            # Check if the response is empty
            if not raw_text or len(raw_text) < 10:
                print("[DEBUG] Response is empty or too short")
                return "Error: Empty response from LLM API"
            
            try:
                # Try to parse as JSON
                response_json = json.loads(raw_text)
                print(f"[DEBUG] Successfully parsed JSON response")
                print(f"[DEBUG] JSON response keys: {list(response_json.keys())}")
                
                # Print the full response structure for debugging
                print(f"[DEBUG] Full JSON response structure: {json.dumps(response_json)[:500]}...")
                
                if 'response' in response_json:
                    response_text = response_json['response']
                    response_length = len(response_text)
                    print(f"[DEBUG] Response length: {response_length} characters")
                    print(f"[DEBUG] Response preview: {response_text[:200]}...")
                    
                    # Check if response is too short or empty
                    if response_length < 100:
                        print("[WARNING] LLM response is very short, may be incomplete")
                    
                    return response_text
                else:
                    # Try to find an alternative field that might contain the response
                    print(f"[ERROR] No 'response' field in JSON response")
                    
                    # For mistral model, try common alternative field names
                    for field in ['text', 'content', 'output', 'completion', 'generated_text']:
                        if field in response_json:
                            print(f"[DEBUG] Found alternative field '{field}' in response")
                            response_text = response_json[field]
                            return response_text
                    
                    # If we can't find any known field, return the entire JSON as a string
                    print(f"[WARNING] Returning raw JSON as no known response field was found")
                    return f"Error: No valid response field found in API response. Raw JSON: {raw_text[:500]}..."
                    
            except json.JSONDecodeError as je:
                print(f"[DEBUG] JSON decode error: {je}")
                # If it's not JSON, return the raw text if it looks reasonable
                if len(raw_text) > 0 and not raw_text.startswith('{'):
                    print(f"[DEBUG] Returning non-JSON response: {raw_text[:200]}...")
                    return raw_text
            
            print("[ERROR] Could not get valid response from AI")
            return "Error: Could not get valid response from AI. Please check the logs for details."
            
        except Exception as e:
            print(f"[DEBUG] Error in chat response: {str(e)}")
            return f"Error generating content: {str(e)}"
