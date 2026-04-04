"""
Cost Tracker — Per-conversation and cumulative token/cost tracking.

Tracks input_tokens, output_tokens, and estimated USD cost for every
LLM API call. Persists cumulative stats to data/usage_stats.json.

Usage:
    from src.infra.cost_tracker import tracker

    tracker.record(input_tokens=1200, output_tokens=800, model='deepseek-r1:32b')
    stats = tracker.get_stats()
    # {'session': {...}, 'cumulative': {...}, 'costUsd': ...}
"""

import json
import time
import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

SOMA = Path(__file__).parent.parent.parent
STATS_FILE = SOMA / "data" / "usage_stats.json"

# Cost per 1M tokens (input/output) by provider pattern.
# Local models (Ollama) are free. Cloud models have real costs.
MODEL_COSTS = {
    # Anthropic
    'claude-3-opus':      {'input': 15.00, 'output': 75.00},
    'claude-3.5-sonnet':  {'input': 3.00,  'output': 15.00},
    'claude-3-sonnet':    {'input': 3.00,  'output': 15.00},
    'claude-3-haiku':     {'input': 0.25,  'output': 1.25},
    'claude-sonnet-4':    {'input': 3.00,  'output': 15.00},
    'claude-4':           {'input': 3.00,  'output': 15.00},
    # OpenAI
    'gpt-4o':             {'input': 2.50,  'output': 10.00},
    'gpt-4-turbo':        {'input': 10.00, 'output': 30.00},
    'gpt-4':              {'input': 30.00, 'output': 60.00},
    'gpt-3.5-turbo':      {'input': 0.50,  'output': 1.50},
    'o1':                 {'input': 15.00, 'output': 60.00},
    'o3':                 {'input': 10.00, 'output': 40.00},
    'o4-mini':            {'input': 1.10,  'output': 4.40},
    # xAI / Grok
    'grok':               {'input': 3.00,  'output': 15.00},
    # Google Gemini
    'gemini-2.5-flash':   {'input': 0.15,  'output': 0.60},
    'gemini-2.5-pro':     {'input': 1.25,  'output': 10.00},
    'gemini-3-flash':     {'input': 0.15,  'output': 0.60},
    'gemini-3-pro':       {'input': 1.25,  'output': 10.00},
    'gemini-2.0-flash':   {'input': 0.10,  'output': 0.40},
    'gemini-1.5-flash':   {'input': 0.075, 'output': 0.30},
    'gemini-1.5-pro':     {'input': 1.25,  'output': 5.00},
    # Perplexity / Sonar
    'sonar':              {'input': 1.00,  'output': 1.00},
    'sonar-pro':          {'input': 3.00,  'output': 15.00},
    # DeepSeek (cloud)
    'deepseek-chat':      {'input': 0.14,  'output': 0.28},
    'deepseek-reasoner':  {'input': 0.55,  'output': 2.19},
    # Local (free)
    '_local':             {'input': 0.0,   'output': 0.0},
}


# Patterns that indicate a local/Ollama model tag (e.g. 'deepseek-r1:32b', 'dolphin3:latest')
_OLLAMA_TAG_SUFFIXES = (':latest', ':32b', ':7b', ':8b', ':70b', ':1b', ':3b', ':4b', ':14b', ':22b', ':72b')


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate USD cost for a call. Returns 0.0 for local models.
    
    Pricing lookup order:
      1. Dynamic pricing cache (fetched from LiteLLM index, refreshed weekly)
      2. Hardcoded MODEL_COSTS fallback table
      3. Unknown → assume free (local)
    """
    model_lower = model.lower() if model else ''

    # Explicit local indicators
    if 'localhost' in model_lower or '11434' in model_lower:
        return 0.0

    # Ollama tag patterns: 'model:tag' where tag is a size/version suffix
    if ':' in model_lower and any(model_lower.endswith(s) for s in _OLLAMA_TAG_SUFFIXES):
        return 0.0  # Local model, free

    # ── 1. Dynamic pricing (auto-fetched, cached locally with weekly refresh) ──
    try:
        from src.infra.model_pricing import get_pricing
        dynamic = get_pricing(model)
        if dynamic and (dynamic.get('input', 0) > 0 or dynamic.get('output', 0) > 0):
            cost = (input_tokens * dynamic['input'] + output_tokens * dynamic['output']) / 1_000_000
            return round(cost, 6)
    except Exception as _dyn_err:
        logger.debug(f"[COST] Dynamic pricing lookup failed: {_dyn_err}")

    # ── 2. Hardcoded fallback table ──
    best_match = None
    best_len = 0
    for pattern, costs in MODEL_COSTS.items():
        if pattern in model_lower and len(pattern) > best_len:
            best_match = costs
            best_len = len(pattern)

    if best_match:
        cost = (input_tokens * best_match['input'] + output_tokens * best_match['output']) / 1_000_000
        return round(cost, 6)

    # ── 3. Unknown model — assume free (local) ──
    if model_lower and model_lower != 'unknown':
        print(f"[COST_TRACKER] No pricing match for model={model!r}, assuming free", flush=True)
    return 0.0


@dataclass
class SessionStats:
    """Stats for the current agent session (resets on restart)."""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0
    call_count: int = 0
    started_at: float = field(default_factory=time.time)
    last_call_at: float = 0.0
    by_model: Dict[str, Dict[str, int]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'inputTokens': self.input_tokens,
            'outputTokens': self.output_tokens,
            'totalTokens': self.total_tokens,
            'costUsd': round(self.cost_usd, 4),
            'callCount': self.call_count,
            'startedAt': self.started_at,
            'lastCallAt': self.last_call_at,
            'durationMinutes': round((time.time() - self.started_at) / 60, 1),
            'byModel': self.by_model,
        }


class CostTracker:
    """Thread-safe token and cost tracker with persistence."""

    def __init__(self):
        self._session = SessionStats()
        self._cumulative = self._load_cumulative()
        self._lock = threading.Lock()
        self._threshold_usd: Optional[float] = None  # Alert threshold
        self._threshold_callback = None

    def record(
        self,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model: str = '',
        session_key: str = 'main',
    ):
        """Record token usage from an API call."""
        cost = _estimate_cost(model, input_tokens, output_tokens)

        with self._lock:
            # Session stats
            self._session.input_tokens += input_tokens
            self._session.output_tokens += output_tokens
            self._session.total_tokens += input_tokens + output_tokens
            self._session.cost_usd += cost
            self._session.call_count += 1
            self._session.last_call_at = time.time()

            # Per-model breakdown
            model_key = model or 'unknown'
            if model_key not in self._session.by_model:
                self._session.by_model[model_key] = {'input': 0, 'output': 0, 'calls': 0, 'cost': 0.0}
            self._session.by_model[model_key]['input'] += input_tokens
            self._session.by_model[model_key]['output'] += output_tokens
            self._session.by_model[model_key]['calls'] += 1
            self._session.by_model[model_key]['cost'] = round(
                self._session.by_model[model_key]['cost'] + cost, 6
            )

            # Cumulative stats
            self._cumulative['input_tokens'] = self._cumulative.get('input_tokens', 0) + input_tokens
            self._cumulative['output_tokens'] = self._cumulative.get('output_tokens', 0) + output_tokens
            self._cumulative['total_tokens'] = self._cumulative.get('total_tokens', 0) + input_tokens + output_tokens
            self._cumulative['cost_usd'] = round(self._cumulative.get('cost_usd', 0.0) + cost, 6)
            self._cumulative['call_count'] = self._cumulative.get('call_count', 0) + 1
            self._cumulative['last_call_at'] = time.time()

        # Persist (async to avoid blocking)
        threading.Thread(target=self._save_cumulative, daemon=True).start()

        # Emit event via bus (lazy import to avoid circular)
        try:
            from src.infra.event_bus import bus
            bus.emit('cost_updated', {
                'input_tokens': input_tokens,
                'output_tokens': output_tokens,
                'cost_usd': cost,
                'model': model,
                'session_key': session_key,
                'session_total_usd': self._session.cost_usd,
            })
        except Exception:
            pass

        # Threshold check
        if self._threshold_usd and self._session.cost_usd >= self._threshold_usd:
            if self._threshold_callback:
                try:
                    self._threshold_callback(self._session.cost_usd, self._threshold_usd)
                except Exception:
                    pass

    def set_threshold(self, usd: float, callback=None):
        """Set a cost threshold alert."""
        self._threshold_usd = usd
        self._threshold_callback = callback

    def get_stats(self) -> Dict[str, Any]:
        """Get combined session + cumulative stats."""
        with self._lock:
            return {
                'session': self._session.to_dict(),
                'cumulative': {
                    'inputTokens': self._cumulative.get('input_tokens', 0),
                    'outputTokens': self._cumulative.get('output_tokens', 0),
                    'totalTokens': self._cumulative.get('total_tokens', 0),
                    'costUsd': round(self._cumulative.get('cost_usd', 0.0), 4),
                    'callCount': self._cumulative.get('call_count', 0),
                    'firstSeen': self._cumulative.get('first_seen', 0),
                },
            }

    def get_session_stats(self) -> Dict[str, Any]:
        """Get session stats only."""
        with self._lock:
            return self._session.to_dict()

    def _load_cumulative(self) -> Dict[str, Any]:
        """Load cumulative stats from disk."""
        try:
            if STATS_FILE.exists():
                data = json.loads(STATS_FILE.read_text(encoding='utf-8'))
                if isinstance(data, dict):
                    return data
        except Exception as e:
            logger.warning(f"[COST] Failed to load cumulative stats: {e}")
        return {'first_seen': time.time()}

    def _save_cumulative(self):
        """Save cumulative stats to disk."""
        try:
            STATS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with self._lock:
                data = dict(self._cumulative)
            STATS_FILE.write_text(json.dumps(data, indent=2), encoding='utf-8')
        except Exception as e:
            logger.warning(f"[COST] Failed to save cumulative stats: {e}")


# Global singleton
tracker = CostTracker()

# Start background pricing refresh (weekly check, daemon thread)
try:
    from src.infra.model_pricing import start_background_refresh
    start_background_refresh()
except Exception as _bg_err:
    logger.debug(f"[COST] Background pricing refresh not started: {_bg_err}")
