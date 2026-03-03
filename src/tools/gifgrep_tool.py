"""
Gifgrep Tool - GIF Search via Giphy API
========================================
Search and retrieve GIFs for fun responses.

Features:
- Search GIFs by keyword
- Get random GIFs by tag
- Get trending GIFs
- Return URLs or embed codes
"""

import logging
import requests
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Giphy API configuration
GIPHY_API_KEY = "QbjC1FoDYr9C4y7ef2kLm0WnrYfB5ckv"
GIPHY_BASE_URL = "https://api.giphy.com/v1/gifs"


def search(
    query: str,
    limit: int = 5,
    rating: str = "g",
    offset: int = 0
) -> Dict[str, Any]:
    """
    Search for GIFs by keyword.
    
    Args:
        query: Search term
        limit: Number of results (max 50)
        rating: Content rating (g, pg, pg-13, r)
        offset: Results offset for pagination
        
    Returns:
        Dict with GIF results
    """
    try:
        params = {
            "api_key": GIPHY_API_KEY,
            "q": query,
            "limit": min(limit, 50),
            "rating": rating,
            "offset": offset
        }
        
        response = requests.get(f"{GIPHY_BASE_URL}/search", params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        gifs = []
        for gif in data.get("data", []):
            gifs.append({
                "id": gif.get("id"),
                "title": gif.get("title"),
                "url": gif.get("url"),
                "embed_url": gif.get("embed_url"),
                "images": {
                    "original": gif.get("images", {}).get("original", {}).get("url"),
                    "downsized": gif.get("images", {}).get("downsized", {}).get("url"),
                    "preview": gif.get("images", {}).get("preview_gif", {}).get("url"),
                    "fixed_height": gif.get("images", {}).get("fixed_height", {}).get("url"),
                    "fixed_width": gif.get("images", {}).get("fixed_width", {}).get("url"),
                }
            })
        
        return {
            "status": "success",
            "query": query,
            "count": len(gifs),
            "total_count": data.get("pagination", {}).get("total_count", 0),
            "gifs": gifs
        }
        
    except requests.RequestException as e:
        logger.error(f"Giphy API error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


def random(tag: Optional[str] = None, rating: str = "g") -> Dict[str, Any]:
    """
    Get a random GIF, optionally filtered by tag.
    
    Args:
        tag: Optional tag to filter by
        rating: Content rating (g, pg, pg-13, r)
        
    Returns:
        Dict with random GIF
    """
    try:
        params = {
            "api_key": GIPHY_API_KEY,
            "rating": rating
        }
        if tag:
            params["tag"] = tag
        
        response = requests.get(f"{GIPHY_BASE_URL}/random", params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        gif = data.get("data", {})
        if not gif:
            return {
                "status": "error",
                "error": "No GIF found"
            }
        
        return {
            "status": "success",
            "tag": tag,
            "gif": {
                "id": gif.get("id"),
                "title": gif.get("title"),
                "url": gif.get("url"),
                "embed_url": gif.get("embed_url"),
                "images": {
                    "original": gif.get("images", {}).get("original", {}).get("url"),
                    "downsized": gif.get("images", {}).get("downsized", {}).get("url"),
                    "preview": gif.get("images", {}).get("preview_gif", {}).get("url"),
                    "fixed_height": gif.get("images", {}).get("fixed_height", {}).get("url"),
                }
            }
        }
        
    except requests.RequestException as e:
        logger.error(f"Giphy API error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


def trending(limit: int = 10, rating: str = "g") -> Dict[str, Any]:
    """
    Get trending GIFs.
    
    Args:
        limit: Number of results (max 50)
        rating: Content rating (g, pg, pg-13, r)
        
    Returns:
        Dict with trending GIFs
    """
    try:
        params = {
            "api_key": GIPHY_API_KEY,
            "limit": min(limit, 50),
            "rating": rating
        }
        
        response = requests.get(f"{GIPHY_BASE_URL}/trending", params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        gifs = []
        for gif in data.get("data", []):
            gifs.append({
                "id": gif.get("id"),
                "title": gif.get("title"),
                "url": gif.get("url"),
                "embed_url": gif.get("embed_url"),
                "images": {
                    "original": gif.get("images", {}).get("original", {}).get("url"),
                    "downsized": gif.get("images", {}).get("downsized", {}).get("url"),
                    "fixed_height": gif.get("images", {}).get("fixed_height", {}).get("url"),
                }
            })
        
        return {
            "status": "success",
            "count": len(gifs),
            "gifs": gifs
        }
        
    except requests.RequestException as e:
        logger.error(f"Giphy API error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


def get_by_id(gif_id: str) -> Dict[str, Any]:
    """
    Get a specific GIF by ID.
    
    Args:
        gif_id: Giphy GIF ID
        
    Returns:
        Dict with GIF data
    """
    try:
        params = {"api_key": GIPHY_API_KEY}
        
        response = requests.get(f"{GIPHY_BASE_URL}/{gif_id}", params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        gif = data.get("data", {})
        if not gif:
            return {
                "status": "error",
                "error": f"GIF not found: {gif_id}"
            }
        
        return {
            "status": "success",
            "gif": {
                "id": gif.get("id"),
                "title": gif.get("title"),
                "url": gif.get("url"),
                "embed_url": gif.get("embed_url"),
                "images": {
                    "original": gif.get("images", {}).get("original", {}).get("url"),
                    "downsized": gif.get("images", {}).get("downsized", {}).get("url"),
                    "fixed_height": gif.get("images", {}).get("fixed_height", {}).get("url"),
                }
            }
        }
        
    except requests.RequestException as e:
        logger.error(f"Giphy API error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


# Tool definitions for registry
GIFGREP_TOOLS = {
    "gif_search": {
        "function": search,
        "description": "Search for GIFs by keyword. Returns URLs to GIF images.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term (e.g., 'excited', 'thumbs up', 'celebration')"},
                "limit": {"type": "integer", "description": "Number of results (max 50)", "default": 5},
                "rating": {"type": "string", "description": "Content rating: g, pg, pg-13, r", "default": "g"}
            },
            "required": ["query"]
        }
    },
    "gif_random": {
        "function": random,
        "description": "Get a random GIF, optionally filtered by tag",
        "parameters": {
            "type": "object",
            "properties": {
                "tag": {"type": "string", "description": "Optional tag to filter by (e.g., 'funny', 'cat', 'dance')"},
                "rating": {"type": "string", "description": "Content rating: g, pg, pg-13, r", "default": "g"}
            }
        }
    },
    "gif_trending": {
        "function": trending,
        "description": "Get currently trending GIFs",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of results (max 50)", "default": 10},
                "rating": {"type": "string", "description": "Content rating: g, pg, pg-13, r", "default": "g"}
            }
        }
    }
}
