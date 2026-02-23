---
name: Midjourney Generate
description: Generates an image on Midjourney by opening the imagine page and typing the prompt
triggers: midjourney, imagine, generate image, mj prompt
variables:
  prompt: "The image generation prompt (required, do NOT include 'imagine' prefix)"
---
import time
import subprocess
import urllib.parse

prompt = "{{prompt}}"

# 1. Open Midjourney imagine page with prompt pre-filled
encoded = urllib.parse.quote(prompt)
url = f"https://www.midjourney.com/imagine?prompt={encoded}"
subprocess.Popen(["cmd", "/c", "start", url])

# 2. Wait for page load
time.sleep(3)

# 3. Focus the browser window
try:
    import pywinauto
    try:
        app = pywinauto.Application(backend="uia").connect(title_re=".*Midjourney.*", found_index=0)
        win = app.top_window()
        win.set_focus()
    except Exception:
        try:
            app = pywinauto.Application(backend="uia").connect(title_re=".*Edge.*", found_index=0)
            win = app.top_window()
            win.set_focus()
        except Exception:
            pass
except ImportError:
    pass

# 4. Press Enter to submit (prompt is pre-filled via URL)
time.sleep(2)
import pyautogui
pyautogui.press('enter')
print(f"Midjourney prompt submitted: {prompt[:80]}...")
