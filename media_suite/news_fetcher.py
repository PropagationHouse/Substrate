"""
RSS News Fetcher for Media Planning Suite.
Pulls articles from user-configured industry RSS feeds.
Extracts full content and stores for AI processing.
"""
import re
import feedparser
import requests
from datetime import datetime, timezone
from time import mktime
from bs4 import BeautifulSoup

# Default feeds for different industries
DEFAULT_FEEDS = [
    # Marketing & Advertising
    {"url": "https://www.adweek.com/feed/", "name": "Adweek", "type": "rss", "keywords": "marketing,advertising,media"},
    {"url": "https://www.marketingdive.com/feeds/news/", "name": "Marketing Dive", "type": "rss", "keywords": "marketing,strategy"},
    {"url": "https://www.socialmediatoday.com/rss.xml", "name": "Social Media Today", "type": "rss", "keywords": "social media,content"},
    
    # Content Creation & Video
    {"url": "https://www.videomaker.com/feed", "name": "Videomaker", "type": "rss", "keywords": "video,production"},
    {"url": "https://www.premiumbeat.com/blog/feed/", "name": "PremiumBeat Blog", "type": "rss", "keywords": "video,filmmaking"},
    
    # Photography
    {"url": "https://www.dpreview.com/feeds/news.xml", "name": "DPReview", "type": "rss", "keywords": "photography,camera"},
    {"url": "https://petapixel.com/feed/", "name": "PetaPixel", "type": "rss", "keywords": "photography"},
    
    # Design & Creative
    {"url": "https://www.creativebloq.com/feed", "name": "Creative Bloq", "type": "rss", "keywords": "design,creative"},
    {"url": "https://www.designboom.com/feed/", "name": "Designboom", "type": "rss", "keywords": "design,art"},
    
    # Tech & Innovation
    {"url": "https://techcrunch.com/feed/", "name": "TechCrunch", "type": "rss", "keywords": "technology,startup"},
    {"url": "https://www.theverge.com/rss/index.xml", "name": "The Verge", "type": "rss", "keywords": "technology,media"},
]

AD_SPAM_PATTERNS = re.compile(
    r'\b(buy now|shop now|on sale|% off|discount code|coupon|promo code|'
    r'sponsored|advertisement|press release|gift guide|best \d+ .* to buy|'
    r'amazon|walmart|target\.com|shopify|etsy|affiliate|deal of|'
    r'limited time offer|free shipping|order now|add to cart)\b',
    re.IGNORECASE
)

def _is_spam_article(title, link=""):
    """Return True if the article looks like a product ad or spam."""
    if AD_SPAM_PATTERNS.search(title):
        return True
    spam_domains = ['amazon.com', 'walmart.com', 'target.com', 'ebay.com',
                    'shopify.com', 'etsy.com', 'aliexpress.com']
    for d in spam_domains:
        if d in link.lower():
            return True
    return False

def _extract_content(url):
    """Extract article content from URL using BeautifulSoup."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "aside"]):
            script.decompose()
        
        # Try to find main content
        article = soup.find('article') or soup.find('main') or soup.find('div', class_=re.compile('content|article|post'))
        
        if article:
            text = article.get_text(separator='\n', strip=True)
        else:
            text = soup.get_text(separator='\n', strip=True)
        
        # Clean up whitespace
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        content = '\n'.join(lines)
        
        return content[:5000]  # Limit to 5000 chars
    except Exception as e:
        print(f"Error extracting content from {url}: {e}")
        return ""

def _extract_image(entry):
    """Extract image URL from feed entry."""
    # Try media:content
    if hasattr(entry, 'media_content') and entry.media_content:
        return entry.media_content[0].get('url', '')
    
    # Try media:thumbnail
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        return entry.media_thumbnail[0].get('url', '')
    
    # Try enclosure
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enc in entry.enclosures:
            if 'image' in enc.get('type', ''):
                return enc.get('href', '')
    
    # Try content
    if hasattr(entry, 'content') and entry.content:
        soup = BeautifulSoup(entry.content[0].value, 'html.parser')
        img = soup.find('img')
        if img and img.get('src'):
            return img['src']
    
    return ""

def fetch_feed(feed_url, feed_name, keywords=""):
    """Fetch articles from a single RSS feed."""
    articles = []
    
    try:
        feed = feedparser.parse(feed_url)
        
        for entry in feed.entries[:10]:  # Limit to 10 most recent
            title = entry.get('title', '').strip()
            link = entry.get('link', '').strip()
            
            if not title or not link:
                continue
            
            if _is_spam_article(title, link):
                continue
            
            # Get published date
            published = None
            if hasattr(entry, 'published_parsed') and entry.published_parsed:
                published = datetime.fromtimestamp(mktime(entry.published_parsed), tz=timezone.utc)
            elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                published = datetime.fromtimestamp(mktime(entry.updated_parsed), tz=timezone.utc)
            
            # Get summary
            summary = entry.get('summary', '') or entry.get('description', '')
            if summary:
                soup = BeautifulSoup(summary, 'html.parser')
                summary = soup.get_text(strip=True)[:500]
            
            # Get image
            image_url = _extract_image(entry)
            
            # Extract full content
            content = _extract_content(link)
            
            articles.append({
                'title': title,
                'url': link,
                'source': feed_name,
                'summary': summary,
                'content': content,
                'published_at': published,
                'image_url': image_url
            })
    
    except Exception as e:
        print(f"Error fetching feed {feed_name}: {e}")
    
    return articles

def fetch_all_feeds(keywords=""):
    """Fetch articles from all configured feeds."""
    all_articles = []
    
    for feed in DEFAULT_FEEDS:
        # Filter by keywords if provided
        if keywords:
            feed_keywords = feed.get('keywords', '').lower()
            user_keywords = keywords.lower().split(',')
            
            # Check if any user keyword matches feed keywords
            if not any(kw.strip() in feed_keywords for kw in user_keywords):
                continue
        
        articles = fetch_feed(feed['url'], feed['name'], feed.get('keywords', ''))
        all_articles.extend(articles)
    
    # Sort by published date
    all_articles.sort(key=lambda x: x['published_at'] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    
    return all_articles

def summarize_article(article_data, ai_client):
    """Use AI to create a concise summary of the article."""
    prompt = f"""Write a concise 2-3 sentence summary of this article that tells the reader what it's about and why it matters.

Title: {article_data['title']}
Source: {article_data['source']}
Content: {article_data['content'][:2000]}

Summary:"""

    try:
        response = ai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=150
        )
        return response.choices[0].message.content.strip()
    except:
        return article_data.get('summary', '')[:200]
