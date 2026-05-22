---
name: x_quick_post
description: Posting to X by opening the compose URL directly and typing the content.
triggers: post to x,tweet this,quick post,send tweet
---

# x_quick_post Skill

## Description
Posts a message to X (Twitter) by opening the direct compose URL and typing the text character-by-character. This is the most efficient UI-driven method.

## Triggers
- post to x
- tweet this
- quick post
- send tweet

## Logic
1. **No Hashtags**: Do not include hashtags in the post content. They are considered outdated.
2. **Open URL**: Use `start https://x.com/compose/post` to open the compose modal directly in the browser.
2. **Execute Macro**: Run a Python script that waits for the page to load, focuses the window, and types the text.

### Macro Script (`workspace/temp/x_post.py`)
```python
import sys, time, pyautogui, pywinauto
text = sys.argv[1]

# 1. Wait briefly
time.sleep(1.5)
try:
    app = pywinauto.Application(backend="uia").connect(title_re=".*Compose new post / X.*", timeout=3)
    win = app.top_window()
    win.set_focus()
except Exception:
    pass

# 2. Type fast
pyautogui.write(text, interval=0.01)

# 3. Submit
time.sleep(0.5)
pyautogui.hotkey('ctrl', 'enter')
```

## Usage
```bash
start https://x.com/compose/post
python workspace/temp/x_post.py "Your post content here"
```
