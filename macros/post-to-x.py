---
name: Post to X
description: Posts a message to X/Twitter by opening the compose URL and typing the content via browser automation
triggers: post to x, tweet this, quick post, send tweet, post on x, x post
variables:
  content: "The text content to post (required)"
---
import sys
import time
import subprocess

content = "{{content}}"

# 1. Open the compose URL in default browser
subprocess.Popen(["cmd", "/c", "start", "https://x.com/compose/post"])

# 2. Wait for page to load and focus the browser window
time.sleep(5)
try:
    import pywinauto
    # Try to find the specific compose window
    try:
        app = pywinauto.Application(backend="uia").connect(title_re=".*Compose new post.*", found_index=0)
        win = app.top_window()
        win.set_focus()
    except Exception:
        # Fallback to any Edge window
        try:
            app = pywinauto.Application(backend="uia").connect(title_re=".*Edge.*", found_index=0)
            win = app.top_window()
            win.set_focus()
        except Exception:
            pass
except ImportError:
    pass

# 3. Type the content character-by-character
time.sleep(1)
import pyautogui
pyautogui.write(content, interval=0.05)
time.sleep(1)

# 4. Submit with Ctrl+Enter
pyautogui.hotkey('ctrl', 'enter')
print(f"Posted to X: {content[:80]}...")
