"""
Image Generation Tool
=====================
Generate images via OpenAI DALL-E, Google Imagen, or other providers.
Saves generated images to uploads/generated/ and returns URLs + base64.

Supports:
- OpenAI DALL-E 3 (via openai_api_key)
- Google Imagen (via google_api_key)  
- Extensible for Flux, Banana, Stability, etc.
"""

import os
import sys
import json
import time
import base64
import logging
import requests
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

SOMA = Path(__file__).parent.parent.parent
GENERATED_DIR = SOMA / "uploads" / "generated"


def _ensure_dir():
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)


def _get_api_key(provider: str) -> Optional[str]:
    """Get API key from config or environment."""
    key_map = {
        "openai": ("remote_api_keys/openai_api_key", "OPENAI_API_KEY"),
        "google": ("remote_api_keys/google_api_key", "GOOGLE_API_KEY"),
    }
    field, env_var = key_map.get(provider, ("", ""))
    
    # Try environment first
    key = os.environ.get(env_var, "")
    if key:
        return key
    
    # Try config file
    try:
        config_path = SOMA / "config.json"
        if config_path.exists():
            config = json.loads(config_path.read_text())
            parts = field.split("/")
            val = config
            for part in parts:
                val = val.get(part, {})
            if isinstance(val, str) and val.strip():
                return val.strip()
    except Exception:
        pass
    
    return None


def _generate_openai(prompt: str, size: str = "1024x1024", quality: str = "auto", style: str = "vivid", model: str = "dall-e-3") -> Dict[str, Any]:
    """Generate image via OpenAI DALL-E API."""
    api_key = _get_api_key("openai")
    if not api_key:
        return {"success": False, "error": "OpenAI API key not configured. Set OPENAI_API_KEY or add to config."}
    
    try:
        resp = requests.post(
            "https://api.openai.com/v1/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "prompt": prompt,
                "n": 1,
                "size": size,
                "quality": quality,
                "style": style,
                "response_format": "b64_json",
            },
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        
        if "data" in data and len(data["data"]) > 0:
            img_data = data["data"][0]
            b64 = img_data.get("b64_json", "")
            revised_prompt = img_data.get("revised_prompt", prompt)
            
            # Save to disk
            _ensure_dir()
            filename = f"dalle_{int(time.time()*1000)}.png"
            filepath = GENERATED_DIR / filename
            filepath.write_bytes(base64.b64decode(b64))
            
            # Return both URL path and base64 for rendering
            return {
                "success": True,
                "image_base64": f"data:image/png;base64,{b64}",
                "image_path": str(filepath),
                "image_url": f"/uploads/generated/{filename}",
                "revised_prompt": revised_prompt,
                "provider": "openai",
                "model": model,
            }
        else:
            return {"success": False, "error": "No image data in response"}
            
    except requests.exceptions.HTTPError as e:
        error_body = ""
        try:
            error_body = e.response.json().get("error", {}).get("message", str(e))
        except Exception:
            error_body = str(e)
        return {"success": False, "error": f"OpenAI API error: {error_body}"}
    except Exception as e:
        return {"success": False, "error": f"Image generation failed: {e}"}


def _generate_google(prompt: str, size: str = "1024x1024") -> Dict[str, Any]:
    """Generate image via Google Imagen API."""
    api_key = _get_api_key("google")
    if not api_key:
        return {"success": False, "error": "Google API key not configured. Set GOOGLE_API_KEY or add to config."}
    
    try:
        # Parse size
        w, h = 1024, 1024
        if "x" in size:
            parts = size.split("x")
            w, h = int(parts[0]), int(parts[1])
        
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "instances": [{"prompt": prompt}],
                "parameters": {
                    "sampleCount": 1,
                    "aspectRatio": "1:1" if w == h else ("16:9" if w > h else "9:16"),
                },
            },
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        
        predictions = data.get("predictions", [])
        if predictions and len(predictions) > 0:
            b64 = predictions[0].get("bytesBase64Encoded", "")
            mime = predictions[0].get("mimeType", "image/png")
            
            _ensure_dir()
            ext = "png" if "png" in mime else "jpg"
            filename = f"imagen_{int(time.time()*1000)}.{ext}"
            filepath = GENERATED_DIR / filename
            filepath.write_bytes(base64.b64decode(b64))
            
            return {
                "success": True,
                "image_base64": f"data:{mime};base64,{b64}",
                "image_path": str(filepath),
                "image_url": f"/uploads/generated/{filename}",
                "revised_prompt": prompt,
                "provider": "google",
                "model": "imagen-3.0",
            }
        else:
            return {"success": False, "error": "No image data in Google response"}
            
    except requests.exceptions.HTTPError as e:
        error_body = ""
        try:
            error_body = e.response.json().get("error", {}).get("message", str(e))
        except Exception:
            error_body = str(e)
        return {"success": False, "error": f"Google Imagen API error: {error_body}"}
    except Exception as e:
        return {"success": False, "error": f"Google image generation failed: {e}"}


def generate_image(prompt: str, provider: str = "auto", size: str = "1024x1024", quality: str = "auto", style: str = "vivid", model: str = "") -> Dict[str, Any]:
    """
    Generate an image from a text prompt.
    
    Args:
        prompt: Text description of the image to generate
        provider: "openai", "google", or "auto" (tries openai first, then google)
        size: Image size (e.g., "1024x1024", "1792x1024", "1024x1792")
        quality: "auto", "standard", or "hd" (OpenAI only)
        style: "vivid" or "natural" (OpenAI only)
        model: Specific model name (e.g., "dall-e-3", "dall-e-2")
    
    Returns:
        Dict with success, image_base64, image_path, image_url, etc.
    """
    if not prompt or not prompt.strip():
        return {"success": False, "error": "Prompt is required"}
    
    prompt = prompt.strip()
    
    if provider == "auto":
        # Try OpenAI first (DALL-E 3 is best quality), fall back to Google
        if _get_api_key("openai"):
            result = _generate_openai(prompt, size=size, quality=quality, style=style, model=model or "dall-e-3")
            if result.get("success"):
                return result
            logger.warning(f"OpenAI image gen failed, trying Google: {result.get('error')}")
        
        if _get_api_key("google"):
            result = _generate_google(prompt, size=size)
            if result.get("success"):
                return result
        
        return {"success": False, "error": "No image generation API keys configured. Add openai_api_key or google_api_key to config."}
    
    elif provider == "openai":
        return _generate_openai(prompt, size=size, quality=quality, style=style, model=model or "dall-e-3")
    
    elif provider == "google":
        return _generate_google(prompt, size=size)
    
    else:
        return {"success": False, "error": f"Unknown provider: {provider}. Use 'openai', 'google', or 'auto'."}


# Tool schema for registry
GENERATE_IMAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "prompt": {
            "type": "string",
            "description": "Detailed text description of the image to generate. Be specific about style, composition, lighting, colors, etc."
        },
        "provider": {
            "type": "string",
            "enum": ["auto", "openai", "google"],
            "description": "Image generation provider. 'auto' tries OpenAI DALL-E first, then Google Imagen."
        },
        "size": {
            "type": "string",
            "enum": ["1024x1024", "1792x1024", "1024x1792"],
            "description": "Image dimensions. 1024x1024 (square), 1792x1024 (landscape), 1024x1792 (portrait)."
        },
        "quality": {
            "type": "string",
            "enum": ["auto", "standard", "hd"],
            "description": "Image quality (OpenAI only). 'hd' produces more detailed images."
        },
        "style": {
            "type": "string",
            "enum": ["vivid", "natural"],
            "description": "Image style (OpenAI only). 'vivid' is more creative, 'natural' is more realistic."
        },
    },
    "required": ["prompt"],
}
