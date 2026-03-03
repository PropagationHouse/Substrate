---
name: Midjourney Generate
description: Generates an image on Midjourney by opening the imagine page and typing the prompt
triggers: midjourney, imagine, generate image, mj prompt
variables:
  prompt: "The image generation prompt (required, do NOT include 'imagine' prefix)"
---
import subprocess
import urllib.parse

prompt = "{{prompt}}"

# 1. Open Midjourney imagine page with prompt pre-filled
encoded = urllib.parse.quote(prompt)
url = f"https://www.midjourney.com/imagine?prompt={encoded}"
subprocess.Popen(["cmd", "/c", "start", url])

print(f"Midjourney imagine page opened with prompt: {prompt[:80]}...")
print("Please manually press Enter in the Midjourney browser window to submit the prompt.")
