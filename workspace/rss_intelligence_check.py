
import os
from datetime import datetime

def run_rss_intelligence_check():
    output_dir = r"C:\Users\Bl0ck\ph"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    output_file_path = os.path.join(output_dir, f"RSS_Intelligence_Check_{timestamp}.md")

    content = """
# RSS Intelligence Check - {timestamp}

## [The Deep Dive]
- Detailed summaries with source links will go here.
- Example: [Article Title 1](http://example.com/article1) - Summary 1
- Example: [Article Title 2](http://example.com/article2) - Summary 2

## [The Signal]
- Broader industry discussion/article openers will go here.
- Example: "The rise of AI in computational biology is a significant trend..."

## [The Feature Article]
- A publishable 3-minute read will go here.
- This will be a synthesized article based on the deep dive and signal.
""".format(timestamp=timestamp)

    with open(output_file_path, "w") as f:
        f.write(content)

    print(f"RSS Intelligence Check output saved to: {output_file_path}")

if __name__ == "__main__":
    run_rss_intelligence_check()
