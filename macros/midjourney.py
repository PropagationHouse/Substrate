---
name: Midjourney Generate
description: Generates an image on Midjourney by opening the imagine page, typing the prompt, and submitting it.
triggers: midjourney, imagine, generate image, mj prompt
variables:
  prompt: "The image generation prompt (required, do NOT include 'imagine' prefix)"
---
import subprocess
import urllib.parse
import time
from pywinauto import Desktop

prompt = "{{prompt}}"

# 1. Open Midjourney imagine page
# We'll open the base imagine page as the ?prompt= parameter might not be reliable for auto-typing
url = "https://www.midjourney.com/imagine"
subprocess.Popen(["cmd", "/c", "start", url])

print(f"Midjourney imagine page opened. Preparing to type prompt: {prompt[:80]}...")

# 2. Give it time to load and focus the input field
# Midjourney's web app usually focuses the prompt input by default on /imagine
time.sleep(8) 

try:
    # Try to find the browser window
    desktop = Desktop(backend="uia")
    # Broad regex to find the Midjourney window in Edge or Chrome
    window = desktop.window(title_re=".*Midjourney.*")
    
    if not window.exists():
        # Fallback to looking for 'Create' which is often in the title
        window = desktop.window(title_re=".*Create.*")

    if window.exists():
        window.set_focus()
        # Ensure the window is focused and ready by clicking the center of the window first
        window.click_input()
        # Small delay after focus
        time.sleep(1)
        # Type the prompt and press Enter
        # We use with_spaces=True to ensure spaces are typed correctly
        # We also escape special characters if needed, but for a prompt it's usually fine
        # {ENTER} is the pywinauto key for Enter
        window.type_keys(prompt, with_spaces=True)
        time.sleep(0.5)
        window.type_keys("{ENTER}")
        print("Prompt typed and submitted.")
    else:
        print("Could not find Midjourney window to auto-type. Please type the prompt manually.")
except Exception as e:
    print(f"Auto-type failed: {e}")
    print("Please manually type the prompt in the Midjourney browser window.")
