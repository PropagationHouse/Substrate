import os
import time
import json
import psutil
from datetime import datetime

STATE_FILE = r"C:\Users\Bl0ck\Desktop\Substrate\workspace\temp\system_state.json"
RSS_FEED_FILE = r"C:\Users\Bl0ck\ph\intelligence_feed.md"

def get_system_stats():
    return {
        "cpu_percent": psutil.cpu_percent(interval=1),
        "memory_percent": psutil.virtual_memory().percent,
        "timestamp": datetime.now().isoformat()
    }

def get_rss_status():
    if os.path.exists(RSS_FEED_FILE):
        mtime = os.path.getmtime(RSS_FEED_FILE)
        return {
            "last_modified": datetime.fromtimestamp(mtime).isoformat(),
            "size": os.path.getsize(RSS_FEED_FILE)
        }
    return {"error": "RSS feed file not found"}

def main():
    print("Ghost Monitor started...")
    while True:
        try:
            state = {
                "system": get_system_stats(),
                "rss": get_rss_status(),
                "status": "active"
            }
            with open(STATE_FILE, "w") as f:
                json.dump(state, f, indent=4)
            
            # Sleep for 60 seconds before next check
            time.sleep(60)
        except Exception as e:
            with open(STATE_FILE, "w") as f:
                json.dump({"status": "error", "message": str(e)}, f)
            time.sleep(10)

if __name__ == "__main__":
    main()
