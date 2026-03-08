---
name: Post to X
description: Posts a message to X/Twitter by opening the compose URL and typing the content via browser automation
triggers: post to x, tweet this, quick post, send tweet, post on x, x post
variables:
  content: "The text content to post (required)"
---
import subprocess
import os

# Use the robust script we just created
script_path = os.path.join(os.getcwd(), "workspace", "temp", "x_post_robust.py")
content = """{{content}}"""

try:
    # Run the script via the system python which has pywinauto
    result = subprocess.run(["python", script_path, content], capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print(f"Error: {result.stderr}")
except Exception as e:
    print(f"Macro failure: {e}")
