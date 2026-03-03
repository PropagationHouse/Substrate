
from bs4 import BeautifulSoup

try:
    with open("hacker_news.html", "r", encoding="utf-8") as f:
        html_content = f.read()
except UnicodeDecodeError:
    # If UTF-8 fails, try another common encoding like latin-1 or utf-16
    with open("hacker_news.html", "r", encoding="latin-1") as f:
        html_content = f.read()

soup = BeautifulSoup(html_content, 'html.parser')

print("--- Debugging Hacker News Headlines ---")
for title_tag in soup.find_all('span', class_='titleline'):
    print(title_tag) # Print the raw tag to inspect its structure
    a_tag = title_tag.find('a')
    if a_tag:
        print(f"- {a_tag.get_text(strip=True)}")
    else:
        print("(No <a> tag found within this titleline span)")
