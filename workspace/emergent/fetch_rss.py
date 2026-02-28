import re
import json
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import os

FEED_FILE = r"C:\Users\Bl0ck\ph\intelligence_feed.md"
OUTPUT_FILE = r"workspace\temp\rss_items.json"

def get_feed_urls(file_path):
    urls = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            matches = re.findall(r'\*\s+(https?://[^\s]+)', content)
            urls = matches
    except Exception as e:
        print(f"Error reading feed file: {e}")
    return urls

def parse_feed(url):
    items = []
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        xml_content = response.content
        
        try:
            root = ET.fromstring(xml_content)
            
            # RSS
            for item in root.findall('.//item')[:5]:
                title = item.find('title').text if item.find('title') is not None else "No Title"
                link = item.find('link').text if item.find('link') is not None else ""
                desc = item.find('description').text if item.find('description') is not None else ""
                pubDate = item.find('pubDate').text if item.find('pubDate') is not None else ""
                items.append({
                    'source': url,
                    'title': title,
                    'link': link,
                    'description': desc[:500] + "..." if desc and len(desc) > 500 else (desc or ""),
                    'pubDate': pubDate
                })
                
            # Atom
            for entry in root.findall('.//{http://www.w3.org/2005/Atom}entry')[:5]:
                title = entry.find('{http://www.w3.org/2005/Atom}title').text if entry.find('{http://www.w3.org/2005/Atom}title') is not None else "No Title"
                link_elem = entry.find('{http://www.w3.org/2005/Atom}link')
                link = link_elem.attrib.get('href') if link_elem is not None else ""
                summary = entry.find('{http://www.w3.org/2005/Atom}summary')
                content = entry.find('{http://www.w3.org/2005/Atom}content')
                desc = summary.text if summary is not None else (content.text if content is not None else "")
                updated = entry.find('{http://www.w3.org/2005/Atom}updated').text if entry.find('{http://www.w3.org/2005/Atom}updated') is not None else ""
                items.append({
                    'source': url,
                    'title': title,
                    'link': link,
                    'description': desc[:500] + "..." if desc and len(desc) > 500 else (desc or ""),
                    'pubDate': updated
                })
                
        except ET.ParseError:
            print(f"XML Parse Error for {url}")
            
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        
    return items

def main():
    urls = get_feed_urls(FEED_FILE)
    print(f"Found {len(urls)} feeds.")
    
    all_items = []
    for url in urls:
        print(f"Fetching {url}...")
        items = parse_feed(url)
        all_items.extend(items)
        
    # Deduplicate
    seen = set()
    unique_items = []
    for item in all_items:
        if item['link'] and item['link'] not in seen:
            seen.add(item['link'])
            unique_items.append(item)
            
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(unique_items, f, indent=2)
        
    print(f"Saved {len(unique_items)} items to {OUTPUT_FILE}")

if __name__ == '__main__':
    main()
