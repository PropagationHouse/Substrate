import feedparser
import datetime
import os

# Configuration
FEED_FILE = r"C:\Users\Bl0ck\Documents\Obsidian\Notes\Intelligence_Feed.md"
FEEDS = [
    ("OpenAI", "https://openai.com/news/rss.xml"),
    ("Anthropic", "https://www.anthropic.com/news.rss"),
    ("DeepMind", "https://deepmind.google/blog/rss/"),
    ("ArXiv AI", "http://export.arxiv.org/rss/cs.AI"),
    ("Ollama", "https://ollama.com/blog/rss"),
    ("LocalLLaMA", "https://www.reddit.com/r/LocalLLaMA/.rss"),
    ("llama.cpp", "https://github.com/ggerganov/llama.cpp/releases.atom"),
    ("Stratechery", "https://stratechery.com/feed/"),
    ("Latent Space", "https://www.latent.space/feed"),
    ("SemiAnalysis", "https://www.semianalysis.com/feed"),
    ("Hacker News", "https://news.ycombinator.com/rss")
]

def harvest():
    pulse_items = []
    
    for name, url in FEEDS:
        print(f"Fetching {name}...")
        try:
            feed = feedparser.parse(url)
            # Get the top 2 items from each feed for brevity
            for entry in feed.entries[:2]:
                title = entry.title
                link = entry.link
                # Try to get a summary or description
                summary = entry.get('summary', entry.get('description', ''))
                # Clean up summary (strip HTML and shorten)
                import re
                summary = re.sub('<[^<]+?>', '', summary)[:150] + "..."
                
                pulse_items.append(f"- **{name}**: [{title}]({link}) - {summary}")
        except Exception as e:
            print(f"Error fetching {name}: {e}")
            pulse_items.append(f"- **{name}**: [Error fetching feed] - {e}")

    # Update the file
    if os.path.exists(FEED_FILE):
        with open(FEED_FILE, 'r', encoding='utf-8') as f:
            content = f.read()

        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pulse_section = f"## ⚡ Latest Pulse\n*Last updated: {timestamp}*\n\n### High-Signal Signals\n"
        pulse_section += "\n".join(pulse_items)
        pulse_section += "\n\n---"

        # Replace the Latest Pulse section
        import re
        pattern = r"## ⚡ Latest Pulse.*?---"
        new_content = re.sub(pattern, pulse_section, content, flags=re.DOTALL)

        with open(FEED_FILE, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Intelligence Feed updated successfully.")
    else:
        print(f"File not found: {FEED_FILE}")

if __name__ == "__main__":
    harvest()
