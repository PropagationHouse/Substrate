import sys
import time
import subprocess
from pywinauto import Desktop
from pywinauto.keyboard import send_keys

def post_to_x(content):
    print(f"Opening X to post: {content}")
    subprocess.Popen(['start', 'https://x.com/compose/post'], shell=True)
    
    # Wait for browser to open and load
    time.sleep(5)
    
    desktop = Desktop(backend="uia")
    target_window = None
    
    # Look for the compose window
    for w in desktop.windows():
        title = w.window_text()
        if "Compose new post" in title or "X" in title or "Twitter" in title:
            target_window = w
            break
            
    if target_window:
        print("Found window.")
        try:
            target_window.set_focus()
            time.sleep(1)
            
            # Format text for send_keys
            formatted_content = content.replace(' ', '{SPACE}').replace('\n', '{ENTER}')
            
            # Type content and press Ctrl+Enter to post
            send_keys(formatted_content)
            time.sleep(1)
            send_keys('^{ENTER}')
            print("Post submitted.")
            
            # Wait a moment then close the tab (Ctrl+W)
            time.sleep(2)
            send_keys('^w')
            
        except Exception as e:
            print(f"Error interacting with window: {e}")
            sys.exit(1)
    else:
        print("Could not find X compose window.")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        post_to_x(sys.argv[1])
    else:
        print("No content provided.")
        sys.exit(1)
