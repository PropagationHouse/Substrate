---
name: Midjourney Generate
description: Generates an image on Midjourney by opening the imagine page and typing the prompt
triggers: midjourney, imagine, generate image, mj prompt
variables:
  prompt: "The image generation prompt (required, do NOT include 'imagine' prefix)"
---
import subprocess
import urllib.parse
import time
from pywinauto import Desktop

prompt = "{{prompt}}"

# 1. Open Midjourney imagine page with prompt pre-filled
encoded = urllib.parse.quote(prompt)
url = f"https://www.midjourney.com/imagine?prompt={encoded}"
subprocess.Popen(["cmd", "/c", "start", url])

print(f"Midjourney imagine page opened with prompt: {prompt[:80]}...")

# 2. Give it a moment to load and focus
time.sleep(3) 

try:
    # Try to find the window and send Enter
    desktop = Desktop(backend="uia")
    # Look for a window that contains 'Midjourney' or 'Create' and 'Edge'
    window = desktop.window(title_re=".*Create.*Microsoft.*Edge.*")
    if window.exists():
        window.set_focus()
        window.type_keys("{ENTER}")
        print("Prompt submitted via Enter key.")
    else:
        print("Could not find Midjourney window to auto-submit. Please press Enter manually.")
except Exception as e:
    print(f"Auto-submit failed: {e}")
    print("Please manually press Enter in the Midjourney browser window to submit the prompt.")
