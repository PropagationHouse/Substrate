"""
Link Understanding - Auto-extract URL content before LLM processing.
When a user message contains URLs, this module:
1. Detects URLs in the message text
2. Fetches and extracts readable content (title, text, metadata)
3. Injects the extracted content into the context so the LLM already has it

This saves a tool-call round-trip — the agent doesn't need to decide to fetch the URL.
"""

import re
import logging
import time
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

# URL detection regex (matches http/https URLs)
URL_PATTERN = re.compile(
    r'https?://[^\s<>\[\](){}\'"`,;!]+',
    re.IGNORECASE
)

# Skip these URL patterns (not useful to fetch)
SKIP_PATTERNS = [
    r'localhost',
    r'127\.0\.0\.1',
    r'0\.0\.0\.0',
    r'\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|mp4|mp3|wav|pdf|zip|tar|gz|exe|dmg)(\?|$)',
    r'data:',
    r'chrome://',
    r'file://',
]
_skip_compiled = [re.compile(p, re.IGNORECASE) for p in SKIP_PATTERNS]

# Max content length to inject (chars)
MAX_CONTENT_CHARS = 8000
# Max URLs to process per message
MAX_URLS_PER_MESSAGE = 3
# Fetch timeout per URL
FETCH_TIMEOUT_SECONDS = 10


@dataclass
class LinkResult:
    """Result of fetching a URL."""
    url: str
    title: Optional[str] = None
    text: Optional[str] = None
    error: Optional[str] = None
    fetch_ms: int = 0


def extract_urls(text: str) -> List[str]:
    """Extract URLs from message text."""
    if not text:
        return []
    
    urls = URL_PATTERN.findall(text)
    
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for url in urls:
        # Clean trailing punctuation
        url = url.rstrip('.,;:!?)')
        if url not in seen:
            seen.add(url)
            unique.append(url)
    
    # Filter out skip patterns
    filtered = []
    for url in unique:
        skip = False
        for pattern in _skip_compiled:
            if pattern.search(url):
                skip = True
                break
        if not skip:
            filtered.append(url)
    
    return filtered[:MAX_URLS_PER_MESSAGE]


def _fetch_url_content(url: str) -> LinkResult:
    """Fetch and extract readable content from a URL."""
    start = time.time()
    result = LinkResult(url=url)
    
    try:
        import requests
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        
        resp = requests.get(url, headers=headers, timeout=FETCH_TIMEOUT_SECONDS, allow_redirects=True)
        resp.raise_for_status()
        
        content_type = resp.headers.get('content-type', '')
        
        # Only process HTML/text content
        if 'text/html' in content_type or 'text/plain' in content_type or 'application/json' in content_type:
            raw_text = resp.text
            
            if 'application/json' in content_type:
                # JSON — just truncate
                result.title = f"JSON from {url}"
                result.text = raw_text[:MAX_CONTENT_CHARS]
            elif 'text/plain' in content_type:
                result.title = url
                result.text = raw_text[:MAX_CONTENT_CHARS]
            else:
                # HTML — extract readable text
                result.title, result.text = _extract_html_content(raw_text, url)
        else:
            result.error = f"Non-text content type: {content_type}"
            
    except Exception as e:
        result.error = str(e)[:200]
    
    result.fetch_ms = int((time.time() - start) * 1000)
    return result


def _extract_html_content(html: str, url: str) -> Tuple[Optional[str], Optional[str]]:
    """Extract title and readable text from HTML."""
    title = None
    text = None
    
    # Try BeautifulSoup first
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        
        # Extract title
        title_tag = soup.find('title')
        if title_tag:
            title = title_tag.get_text(strip=True)
        
        # Remove script, style, nav, footer, header elements
        for tag in soup.find_all(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']):
            tag.decompose()
        
        # Try article/main content first
        main = soup.find('article') or soup.find('main') or soup.find(role='main')
        if main:
            text = main.get_text(separator='\n', strip=True)
        else:
            # Fall back to body
            body = soup.find('body')
            if body:
                text = body.get_text(separator='\n', strip=True)
            else:
                text = soup.get_text(separator='\n', strip=True)
        
        # Clean up excessive whitespace
        if text:
            lines = [line.strip() for line in text.split('\n') if line.strip()]
            text = '\n'.join(lines)
            text = text[:MAX_CONTENT_CHARS]
        
        return title, text
        
    except ImportError:
        pass
    
    # Fallback: regex-based extraction
    try:
        # Title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = title_match.group(1).strip()
        
        # Strip tags
        text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        text = text[:MAX_CONTENT_CHARS]
        
        return title, text
        
    except Exception:
        return None, None


def process_message_links(message: str) -> Optional[str]:
    """
    Detect URLs in a message and fetch their content.
    
    Returns a formatted string with extracted content to inject into context,
    or None if no URLs found or all fetches failed.
    """
    urls = extract_urls(message)
    if not urls:
        return None
    
    logger.info(f"[LINK] Detected {len(urls)} URL(s) in message: {[u[:60] for u in urls]}")
    
    results: List[LinkResult] = []
    
    # Fetch URLs in parallel
    with ThreadPoolExecutor(max_workers=min(len(urls), 3)) as executor:
        futures = {executor.submit(_fetch_url_content, url): url for url in urls}
        for future in as_completed(futures, timeout=FETCH_TIMEOUT_SECONDS + 5):
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                url = futures[future]
                results.append(LinkResult(url=url, error=str(e)[:200]))
    
    # Build context injection
    parts = []
    for r in results:
        if r.error:
            logger.debug(f"[LINK] Failed to fetch {r.url}: {r.error}")
            continue
        if not r.text or len(r.text.strip()) < 50:
            logger.debug(f"[LINK] Skipping {r.url}: too little content")
            continue
        
        title_str = f" — {r.title}" if r.title else ""
        parts.append(f"[Content from {r.url}{title_str} ({r.fetch_ms}ms)]\n{r.text}")
        logger.info(f"[LINK] Extracted {len(r.text)} chars from {r.url} ({r.fetch_ms}ms)")
    
    if not parts:
        return None
    
    return "Auto-extracted link content (for your reference):\n\n" + "\n\n---\n\n".join(parts)
