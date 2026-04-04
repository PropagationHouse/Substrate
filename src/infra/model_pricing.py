"""
Dynamic Model Pricing — Auto-fetches and caches LLM API pricing.

Fetches pricing data from LiteLLM's maintained model cost database,
caches locally to data/model_pricing_cache.json with per-model TTLs.
Falls back to hardcoded defaults if network is unavailable.

Usage:
    from src.infra.model_pricing import get_pricing, refresh_pricing

    costs = get_pricing('gemini-2.5-flash')
    # {'input': 0.15, 'output': 0.60, 'source': 'litellm', 'fetched_at': 1712345678}

    refresh_pricing()  # Force refresh all cached models
"""

import json
import time
import logging
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

SOMA = Path(__file__).parent.parent.parent
CACHE_FILE = SOMA / "data" / "model_pricing_cache.json"

# How long before a cached model price is considered stale (7 days)
CACHE_TTL_SECONDS = 7 * 24 * 3600

# How long before the bulk pricing index is refetched (24 hours)
INDEX_TTL_SECONDS = 24 * 3600

# LiteLLM's comprehensive model pricing database (300+ models, community maintained)
LITELLM_PRICING_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)

# ─── Provider name normalization ──────────────────────────────────
_PROVIDER_PATTERNS = {
    'anthropic': ('claude', 'anthropic'),
    'openai':    ('gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt', 'openai'),
    'google':    ('gemini', 'gemma'),
    'xai':       ('grok', 'xai'),
    'deepseek':  ('deepseek',),
    'perplexity': ('sonar', 'perplexity'),
    'meta':      ('llama',),
    'mistral':   ('mistral', 'mixtral'),
    'cohere':    ('command',),
}


def _infer_provider(model: str) -> str:
    """Infer the cloud provider from a model name."""
    ml = model.lower()
    for provider, patterns in _PROVIDER_PATTERNS.items():
        if any(p in ml for p in patterns):
            return provider
    return 'unknown'


# ─── Cache ────────────────────────────────────────────────────────
class PricingCache:
    """Thread-safe local JSON cache for model pricing data."""

    def __init__(self):
        self._lock = threading.Lock()
        self._data: Dict[str, Any] = self._load()
        self._index: Optional[Dict[str, Any]] = None
        self._index_fetched_at: float = 0
        self._fetch_lock = threading.Lock()

    def _load(self) -> Dict[str, Any]:
        try:
            if CACHE_FILE.exists():
                raw = json.loads(CACHE_FILE.read_text(encoding='utf-8'))
                if isinstance(raw, dict):
                    return raw
        except Exception as e:
            logger.warning(f"[PRICING] Failed to load cache: {e}")
        return {}

    def _save(self):
        try:
            CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            with self._lock:
                snapshot = dict(self._data)
            CACHE_FILE.write_text(json.dumps(snapshot, indent=2), encoding='utf-8')
        except Exception as e:
            logger.warning(f"[PRICING] Failed to save cache: {e}")

    def get(self, model_key: str) -> Optional[Dict[str, Any]]:
        """Get cached pricing for a model. Returns None if missing or stale."""
        with self._lock:
            entry = self._data.get(model_key)
        if not entry:
            return None
        fetched_at = entry.get('fetched_at', 0)
        if time.time() - fetched_at > CACHE_TTL_SECONDS:
            return None  # Stale
        return entry

    def put(self, model_key: str, pricing: Dict[str, Any]):
        """Cache pricing for a model."""
        pricing['fetched_at'] = time.time()
        with self._lock:
            self._data[model_key] = pricing
        # Async save
        threading.Thread(target=self._save, daemon=True).start()

    def get_all(self) -> Dict[str, Any]:
        """Get full cache contents."""
        with self._lock:
            return dict(self._data)

    def model_count(self) -> int:
        with self._lock:
            return len(self._data)


_cache = PricingCache()


# ─── LiteLLM index fetch ─────────────────────────────────────────
def _fetch_litellm_index(force: bool = False) -> Optional[Dict[str, Any]]:
    """Fetch the LiteLLM model pricing index. Cached in memory for INDEX_TTL_SECONDS."""
    if (
        not force
        and _cache._index is not None
        and time.time() - _cache._index_fetched_at < INDEX_TTL_SECONDS
    ):
        return _cache._index

    with _cache._fetch_lock:
        # Double-check after acquiring lock
        if (
            not force
            and _cache._index is not None
            and time.time() - _cache._index_fetched_at < INDEX_TTL_SECONDS
        ):
            return _cache._index

        try:
            import requests
            logger.info("[PRICING] Fetching LiteLLM model pricing index...")
            resp = requests.get(LITELLM_PRICING_URL, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and len(data) > 10:
                _cache._index = data
                _cache._index_fetched_at = time.time()
                logger.info(f"[PRICING] Loaded {len(data)} models from LiteLLM index")
                return data
            else:
                logger.warning(f"[PRICING] LiteLLM index unexpectedly small: {len(data)} entries")
                return None
        except Exception as e:
            logger.warning(f"[PRICING] Failed to fetch LiteLLM index: {e}")
            return None


def _extract_pricing_from_litellm(model: str, index: Dict[str, Any]) -> Optional[Dict[str, float]]:
    """Extract input/output cost per 1M tokens from LiteLLM index entry.
    
    LiteLLM uses cost per token (not per 1M), so we multiply by 1_000_000.
    Keys: 'input_cost_per_token', 'output_cost_per_token'.
    """
    model_lower = model.lower()

    # Try exact match first, then common prefixed variants
    candidates = [
        model_lower,
        model,
        f"openai/{model_lower}",
        f"anthropic/{model_lower}",
        f"google/{model_lower}",
        f"gemini/{model_lower}",
        f"xai/{model_lower}",
        f"deepseek/{model_lower}",
        f"perplexity/{model_lower}",
    ]

    entry = None
    matched_key = None
    for candidate in candidates:
        if candidate in index:
            entry = index[candidate]
            matched_key = candidate
            break

    # Fuzzy: find longest matching key in index
    if entry is None:
        best_key = None
        best_overlap = 0
        for key in index:
            key_base = key.split('/')[-1].lower()  # strip provider prefix
            if model_lower in key_base or key_base in model_lower:
                overlap = min(len(model_lower), len(key_base))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_key = key
        if best_key and best_overlap >= 4:
            entry = index[best_key]
            matched_key = best_key

    if not entry or not isinstance(entry, dict):
        return None

    input_cpt = entry.get('input_cost_per_token', 0)
    output_cpt = entry.get('output_cost_per_token', 0)

    if input_cpt == 0 and output_cpt == 0:
        return None

    return {
        'input': round(input_cpt * 1_000_000, 6),
        'output': round(output_cpt * 1_000_000, 6),
        'source': 'litellm',
        'matched_key': matched_key,
        'max_tokens': entry.get('max_tokens'),
        'max_input_tokens': entry.get('max_input_tokens'),
        'max_output_tokens': entry.get('max_output_tokens'),
        'supports_vision': entry.get('supports_vision', False),
        'supports_function_calling': entry.get('supports_function_calling', False),
        'provider': _infer_provider(matched_key or model),
    }


# ─── Public API ───────────────────────────────────────────────────
def get_pricing(model: str) -> Optional[Dict[str, Any]]:
    """Get pricing for a model. Checks cache first, fetches if needed.
    
    Returns dict with at least:
        {'input': <cost_per_1M>, 'output': <cost_per_1M>, 'source': str, 'fetched_at': float}
    Or None if pricing cannot be determined (assume local/free).
    """
    if not model:
        return None

    model_lower = model.lower()

    # Local model detection — skip fetch
    if 'localhost' in model_lower or '11434' in model_lower:
        return None
    ollama_suffixes = (':latest', ':32b', ':7b', ':8b', ':70b', ':1b', ':3b', ':4b', ':14b', ':22b', ':72b', ':11b')
    if ':' in model_lower and any(model_lower.endswith(s) for s in ollama_suffixes):
        return None

    # Check cache
    cached = _cache.get(model_lower)
    if cached:
        return cached

    # Fetch from LiteLLM index
    index = _fetch_litellm_index()
    if index:
        pricing = _extract_pricing_from_litellm(model, index)
        if pricing:
            _cache.put(model_lower, pricing)
            logger.info(f"[PRICING] Cached pricing for '{model}': "
                        f"${pricing['input']}/1M in, ${pricing['output']}/1M out "
                        f"(matched: {pricing.get('matched_key', '?')})")
            return pricing

    # No pricing found
    logger.debug(f"[PRICING] No pricing found for '{model}'")
    return None


def get_model_profile(model: str) -> Dict[str, Any]:
    """Get full model profile including pricing and capabilities.
    
    Returns a dict with pricing, provider, capabilities, and cache status.
    Always returns a dict (never None).
    """
    pricing = get_pricing(model)
    provider = _infer_provider(model)
    is_local = provider == 'unknown' or (
        ':' in model.lower() and any(model.lower().endswith(s) 
        for s in (':latest', ':32b', ':7b', ':8b', ':70b', ':1b', ':3b', ':4b', ':14b', ':22b', ':72b', ':11b'))
    )

    profile = {
        'model': model,
        'provider': pricing.get('provider', provider) if pricing else provider,
        'is_local': is_local,
        'pricing': {
            'input_per_1m': pricing['input'] if pricing else 0.0,
            'output_per_1m': pricing['output'] if pricing else 0.0,
            'source': pricing.get('source', 'none') if pricing else 'local',
        },
        'capabilities': {
            'max_tokens': pricing.get('max_tokens') if pricing else None,
            'max_input_tokens': pricing.get('max_input_tokens') if pricing else None,
            'max_output_tokens': pricing.get('max_output_tokens') if pricing else None,
            'supports_vision': pricing.get('supports_vision', False) if pricing else False,
            'supports_function_calling': pricing.get('supports_function_calling', False) if pricing else False,
        },
        'cached': pricing is not None,
        'fetched_at': pricing.get('fetched_at', 0) if pricing else 0,
    }
    return profile


def refresh_pricing(models: Optional[list] = None):
    """Force refresh pricing for specified models (or all cached models).
    
    Called on weekly schedule or manually.
    """
    index = _fetch_litellm_index(force=True)
    if not index:
        logger.warning("[PRICING] Cannot refresh — failed to fetch index")
        return 0

    targets = models or list(_cache.get_all().keys())
    refreshed = 0
    for model in targets:
        pricing = _extract_pricing_from_litellm(model, index)
        if pricing:
            _cache.put(model.lower(), pricing)
            refreshed += 1

    logger.info(f"[PRICING] Refreshed pricing for {refreshed}/{len(targets)} models")
    return refreshed


def get_cache_summary() -> Dict[str, Any]:
    """Get a summary of the pricing cache for diagnostics."""
    all_data = _cache.get_all()
    now = time.time()
    stale = sum(1 for v in all_data.values() if now - v.get('fetched_at', 0) > CACHE_TTL_SECONDS)
    return {
        'total_models': len(all_data),
        'stale_models': stale,
        'fresh_models': len(all_data) - stale,
        'cache_file': str(CACHE_FILE),
        'index_loaded': _cache._index is not None,
        'index_models': len(_cache._index) if _cache._index else 0,
        'index_age_hours': round((now - _cache._index_fetched_at) / 3600, 1) if _cache._index_fetched_at else None,
        'models': {k: {
            'input': v.get('input', 0),
            'output': v.get('output', 0),
            'source': v.get('source', '?'),
            'age_hours': round((now - v.get('fetched_at', 0)) / 3600, 1),
        } for k, v in all_data.items()},
    }


# ─── Background weekly refresh ───────────────────────────────────
def _background_refresh_loop():
    """Runs in a daemon thread. Checks weekly if cached prices need refresh."""
    while True:
        try:
            time.sleep(CACHE_TTL_SECONDS)  # Sleep for 7 days
            logger.info("[PRICING] Weekly refresh triggered")
            refresh_pricing()
        except Exception as e:
            logger.warning(f"[PRICING] Background refresh failed: {e}")


def start_background_refresh():
    """Start the background refresh daemon thread."""
    t = threading.Thread(target=_background_refresh_loop, daemon=True, name='pricing-refresh')
    t.start()
    logger.info("[PRICING] Background refresh thread started (7-day interval)")
