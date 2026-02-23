
import requests
import xml.etree.ElementTree as ET

try:
    response = requests.get("http://feeds.bbci.co.uk/news/rss.xml")
    response.raise_for_status()  # Raise an exception for bad status codes
    root = ET.fromstring(response.content)

    print("--- Current News Headlines ---")
    for item in root.findall('.//item'):
        title = item.find('title').text
        print(f"- {title}")

except requests.exceptions.RequestException as e:
    print(f"Error fetching RSS feed: {e}")
except ET.ParseError as e:
    print(f"Error parsing XML: {e}")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
