"""
Web Tool - Fetch and extract content from URLs
===============================================
Features:
- Fetch URL content
- Extract readable text (removes ads, navigation, etc.)
- Convert HTML to markdown or plain text
- Caching to avoid re-fetching
"""

import logging
import os
import re
import time
from typing import Dict, Any, Optional
from urllib.parse import urlparse
import hashlib

logger = logging.getLogger(__name__)

# Simple in-memory cache
_url_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes

DEFAULT_MAX_CHARS = 50000
DEFAULT_TIMEOUT = 30
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def _get_cache_key(url: str) -> str:
    """Generate cache key for URL."""
    return hashlib.md5(url.encode()).hexdigest()


def _get_cached(url: str) -> Optional[Dict[str, Any]]:
    """Get cached result if still valid."""
    key = _get_cache_key(url)
    if key in _url_cache:
        entry = _url_cache[key]
        if time.time() - entry.get('timestamp', 0) < CACHE_TTL_SECONDS:
            return entry.get('result')
    return None


def _set_cache(url: str, result: Dict[str, Any]):
    """Cache a result."""
    key = _get_cache_key(url)
    _url_cache[key] = {
        'timestamp': time.time(),
        'result': result
    }
    # Limit cache size
    if len(_url_cache) > 100:
        oldest = min(_url_cache.keys(), key=lambda k: _url_cache[k].get('timestamp', 0))
        del _url_cache[oldest]


def _html_to_text(html: str) -> str:
    """Convert HTML to plain text, removing scripts, styles, etc."""
    # Remove script and style elements
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<noscript[^>]*>.*?</noscript>', '', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove HTML comments
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
    
    # Convert common block elements to newlines
    html = re.sub(r'<(br|hr)[^>]*/?>', '\n', html, flags=re.IGNORECASE)
    html = re.sub(r'</(p|div|h[1-6]|li|tr|article|section)>', '\n', html, flags=re.IGNORECASE)
    
    # Remove remaining tags
    html = re.sub(r'<[^>]+>', '', html)
    
    # Decode common HTML entities
    html = html.replace('&nbsp;', ' ')
    html = html.replace('&amp;', '&')
    html = html.replace('&lt;', '<')
    html = html.replace('&gt;', '>')
    html = html.replace('&quot;', '"')
    html = html.replace('&#39;', "'")
    
    # Clean up whitespace
    html = re.sub(r'\n\s*\n', '\n\n', html)
    html = re.sub(r'[ \t]+', ' ', html)
    
    return html.strip()


def _html_to_markdown(html: str) -> str:
    """Convert HTML to simple markdown."""
    # Remove script and style
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert headers
    for i in range(1, 7):
        html = re.sub(rf'<h{i}[^>]*>(.*?)</h{i}>', rf'\n{"#" * i} \1\n', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert links
    html = re.sub(r'<a[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', r'[\2](\1)', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert bold/strong
    html = re.sub(r'<(b|strong)[^>]*>(.*?)</\1>', r'**\2**', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert italic/em
    html = re.sub(r'<(i|em)[^>]*>(.*?)</\1>', r'*\2*', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert code
    html = re.sub(r'<code[^>]*>(.*?)</code>', r'`\1`', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert lists
    html = re.sub(r'<li[^>]*>(.*?)</li>', r'\n- \1', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert paragraphs and divs
    html = re.sub(r'<(p|div)[^>]*>(.*?)</\1>', r'\n\2\n', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove remaining tags
    html = re.sub(r'<[^>]+>', '', html)
    
    # Decode entities
    html = html.replace('&nbsp;', ' ')
    html = html.replace('&amp;', '&')
    html = html.replace('&lt;', '<')
    html = html.replace('&gt;', '>')
    html = html.replace('&quot;', '"')
    
    # Clean up
    html = re.sub(r'\n{3,}', '\n\n', html)
    html = re.sub(r'[ \t]+', ' ', html)
    
    return html.strip()


def _extract_title(html: str) -> str:
    """Extract page title from HTML."""
    match = re.search(r'<title[^>]*>(.*?)</title>', html, re.DOTALL | re.IGNORECASE)
    if match:
        title = match.group(1).strip()
        title = re.sub(r'<[^>]+>', '', title)
        return title
    return ""


def _extract_main_content(html: str) -> str:
    """Try to extract main content area."""
    # Try common main content selectors
    patterns = [
        r'<main[^>]*>(.*?)</main>',
        r'<article[^>]*>(.*?)</article>',
        r'<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)</div>',
        r'<div[^>]*id="content"[^>]*>(.*?)</div>',
        r'<div[^>]*class="[^"]*post[^"]*"[^>]*>(.*?)</div>',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match and len(match.group(1)) > 500:
            return match.group(1)
    
    # Fall back to body
    match = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1)
    
    return html


def web_fetch(
    url: str,
    extract_mode: str = "markdown",
    max_chars: int = DEFAULT_MAX_CHARS,
    timeout: int = DEFAULT_TIMEOUT,
    use_cache: bool = True,
) -> Dict[str, Any]:
    """
    Fetch and extract content from a URL.
    
    Args:
        url: URL to fetch
        extract_mode: "markdown" or "text"
        max_chars: Maximum characters to return
        timeout: Request timeout in seconds
        use_cache: Whether to use cached results
        
    Returns:
        Dict with status, content, title, url
    """
    try:
        # Validate URL
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return {
                "status": "error",
                "error": f"Invalid URL scheme: {parsed.scheme}. Use http or https.",
            }
        
        # Check cache
        if use_cache:
            cached = _get_cached(url)
            if cached:
                logger.info(f"Cache hit for {url}")
                return cached
        
        # Fetch URL
        import urllib.request
        import ssl
        
        # Create SSL context that doesn't verify (for simplicity)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        )
        
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as response:
            # Check content type
            content_type = response.headers.get('Content-Type', '')
            if 'text/html' not in content_type and 'text/plain' not in content_type:
                # Try to read anyway for JSON, etc.
                pass
            
            # Read content
            raw_content = response.read()
            
            # Try to decode
            encoding = 'utf-8'
            if 'charset=' in content_type:
                match = re.search(r'charset=([^\s;]+)', content_type)
                if match:
                    encoding = match.group(1)
            
            try:
                html = raw_content.decode(encoding)
            except UnicodeDecodeError:
                html = raw_content.decode('utf-8', errors='replace')
        
        # Extract title
        title = _extract_title(html)
        
        # Extract main content
        main_html = _extract_main_content(html)
        
        # Convert to requested format
        if extract_mode == "text":
            content = _html_to_text(main_html)
        else:
            content = _html_to_markdown(main_html)
        
        # Truncate if needed
        truncated = False
        if len(content) > max_chars:
            content = content[:max_chars] + f"\n\n[...truncated, {len(content)} total chars]"
            truncated = True
        
        result = {
            "status": "success",
            "url": url,
            "title": title,
            "content": content,
            "chars": len(content),
            "truncated": truncated,
        }
        
        # Cache result
        if use_cache:
            _set_cache(url, result)
        
        return result
        
    except urllib.error.HTTPError as e:
        return {
            "status": "error",
            "error": f"HTTP {e.code}: {e.reason}",
            "url": url,
        }
    except urllib.error.URLError as e:
        return {
            "status": "error",
            "error": f"URL error: {e.reason}",
            "url": url,
        }
    except Exception as e:
        logger.error(f"Error fetching {url}: {e}")
        return {
            "status": "error",
            "error": str(e),
            "url": url,
        }


def web_search(
    query: str,
    max_results: int = 5,
    show_citations: bool = True,
) -> Dict[str, Any]:
    """
    Search the web using Perplexity Sonar API.
    
    Token-efficient - returns synthesized answers with citations
    without needing to open a browser or scrape pages.
    
    Args:
        query: Search query
        max_results: Not used (Sonar returns synthesized answer)
        show_citations: Include source citations
    
    Returns:
        Synthesized answer with optional citations
    """
    try:
        # Try to use Perplexity Sonar
        from ..perplexity.sonar_handler import SonarHandler
        
        handler = SonarHandler()
        
        if not handler.is_configured:
            # Fall back to browser suggestion
            return {
                "status": "info",
                "message": f"Perplexity API not configured. Set PERPLEXITY_API_KEY environment variable.",
                "suggestion": f"browser_open https://www.google.com/search?q={query.replace(' ', '+')}",
            }
        
        # Query Sonar
        result = handler.get_sonar_response(
            query=query,
            should_cite=show_citations,
            max_tokens=1024,
        )
        
        if 'error' in result:
            return {
                "status": "error",
                "error": result.get('error'),
                "message": result.get('message', 'Sonar API error'),
            }
        
        # Extract the response
        content = result.get('content', '')
        citations = result.get('citations', [])
        
        response = {
            "status": "success",
            "query": query,
            "answer": content,
        }
        
        if citations and show_citations:
            response["citations"] = citations
        
        return response
        
    except ImportError:
        # Sonar module not available
        return {
            "status": "info",
            "message": f"Sonar module not available. To search for '{query}', use browser.",
            "suggestion": f"browser_open https://www.google.com/search?q={query.replace(' ', '+')}",
        }
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return {
            "status": "error",
            "error": str(e),
            "suggestion": f"browser_open https://www.google.com/search?q={query.replace(' ', '+')}",
        }


def open_url(url: str, new_window: bool = True) -> Dict[str, Any]:
    """
    Open a URL in the user's default browser.
    
    Opens in a new window by default so it doesn't interrupt the user's tabs.
    Uses subprocess + --new-window flag since webbrowser.open(new=1) is ignored
    by modern browsers.
    
    Args:
        url: URL to open
        new_window: Open in a new window (True) or new tab (False)
        
    Returns:
        Dict with status
    """
    try:
        import subprocess
        from urllib.parse import quote_plus
        
        logger.info(f"[open_url] Raw input: {repr(url)}")
        
        # Aggressively strip quotes — LLMs love wrapping in "quotes" or 'quotes'
        # Strip repeatedly in case of nested quotes like '"query"'
        while url and url[0] in ('"', "'", '\u201c', '\u201d', '\u2018', '\u2019', ' '):
            url = url[1:]
        while url and url[-1] in ('"', "'", '\u201c', '\u201d', '\u2018', '\u2019', ' '):
            url = url[:-1]
        
        logger.info(f"[open_url] After strip: {repr(url)}")
        
        # Detect if this is a search query rather than a URL
        # A URL has a dot in the first path segment and no spaces before it
        is_url = ('.' in url.split('/')[0].split('?')[0] or 
                  url.startswith(('http://', 'https://', 'file://')))
        
        if not is_url:
            # It's a search query — remove any remaining embedded quotes
            query = url.replace('"', '').replace("'", '')
            url = f'https://www.google.com/search?q={quote_plus(query)}'
            logger.info(f"[open_url] Converted search query to: {url}")
        elif not url.startswith(('http://', 'https://', 'file://')):
            url = 'https://' + url
        
        if new_window:
            # Launch browser with --new-window flag
            # webbrowser.open(new=1) is ignored by modern browsers — they always open a tab
            edge_paths = [
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            ]
            chrome_paths = [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            ]
            
            browser_exe = None
            for path in edge_paths + chrome_paths:
                if os.path.exists(path):
                    browser_exe = path
                    break
            
            if browser_exe:
                subprocess.Popen([browser_exe, "--new-window", url])
                return {
                    "status": "success",
                    "url": url,
                    "message": f"Opened {url} in a new browser window",
                }
        
        # Fallback: webbrowser module (opens as tab if --new-window didn't work)
        import webbrowser
        webbrowser.open(url, new=2)
        
        return {
            "status": "success",
            "url": url,
            "message": f"Opened {url} in browser",
        }
    except Exception as e:
        logger.error(f"Error opening URL: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


# Expose for tool registry
class WebTool:
    """Web tool interface for tool registry."""
    
    @staticmethod
    def fetch(url: str, extract_mode: str = "markdown", max_chars: int = DEFAULT_MAX_CHARS) -> Dict[str, Any]:
        return web_fetch(url, extract_mode, max_chars)
    
    @staticmethod
    def search(query: str, max_results: int = 5) -> Dict[str, Any]:
        return web_search(query, max_results)
