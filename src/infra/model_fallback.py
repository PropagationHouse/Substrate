"""
Model Fallback - Auto-retry with different models on failure.
Provides:
- Automatic fallback to alternative models when primary fails
- Configurable fallback chains
- Structured FailoverError with deep error inspection
- Provider cooldown tracking (skip rate-limited providers)
- HTTP status code extraction from errors
- Timeout vs abort distinction
- Attempt logging for debugging
"""

import re
import time
import logging
import threading
from typing import Dict, Any, Optional, List, Callable, TypeVar, Generic, Tuple
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)

T = TypeVar('T')

# ─── Cooldown defaults ───────────────────────────────────────────────
DEFAULT_COOLDOWN_SEC = 60       # 1 minute cooldown after rate limit
AUTH_COOLDOWN_SEC = 300         # 5 minutes for auth failures
SERVER_COOLDOWN_SEC = 30        # 30 seconds for server errors
MAX_COOLDOWN_SEC = 600          # 10 minute cap

# ─── Regex patterns for deep error inspection ────────────────────────
TIMEOUT_HINT_RE = re.compile(
    r'timeout|timed out|deadline exceeded|context deadline exceeded',
    re.IGNORECASE,
)
ABORT_TIMEOUT_RE = re.compile(
    r'request was aborted|request aborted',
    re.IGNORECASE,
)
HTTP_STATUS_RE = re.compile(r'\b(\d{3})\b')


class FailureType(str, Enum):
    """Classification of model failures."""
    RATE_LIMIT = "rate_limit"      # 429 - should retry with backoff
    AUTH_ERROR = "auth_error"      # 401/403 - try different provider
    BILLING = "billing"            # 402 - payment required
    MODEL_ERROR = "model_error"    # Model unavailable/invalid
    TIMEOUT = "timeout"            # Request timed out
    CONTEXT_LENGTH = "context_length"  # Input too long
    CONTENT_FILTER = "content_filter"  # Content blocked
    SERVER_ERROR = "server_error"  # 5xx errors
    NETWORK_ERROR = "network_error"  # Connection issues
    FORMAT_ERROR = "format_error"  # 400 - bad request format
    UNKNOWN = "unknown"


class FailoverError(Exception):
    """
    Structured error for model failover decisions.
    Carries failure classification, HTTP status, and provider context.
    """
    def __init__(
        self,
        message: str,
        *,
        reason: FailureType,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        profile_id: Optional[str] = None,
        status: Optional[int] = None,
        code: Optional[str] = None,
        cause: Optional[Exception] = None,
    ):
        super().__init__(message)
        self.reason = reason
        self.provider = provider
        self.model = model
        self.profile_id = profile_id
        self.status = status
        self.code = code
        self.__cause__ = cause

    def __repr__(self):
        return (
            f"FailoverError({self.reason.value}, "
            f"provider={self.provider}, model={self.model}, "
            f"profile_id={self.profile_id}, status={self.status})"
        )


@dataclass
class ModelAttempt:
    """Record of a single model attempt."""
    provider: str
    model: str
    error: str
    failure_type: FailureType
    duration_ms: int
    status: Optional[int] = None
    code: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class FallbackResult(Generic[T]):
    """Result of running with fallback."""
    success: bool
    result: Optional[T] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    attempts: List[ModelAttempt] = field(default_factory=list)
    error: Optional[str] = None


# Default fallback chains by provider
DEFAULT_FALLBACK_CHAINS = {
    # Local Ollama models
    "ollama": [
        "dolphin3:latest",
        "llama3.2-vision:11b",
        "deepseek-r1:32b",
        "qwen2.5:latest",
    ],
    # OpenAI
    "openai": [
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
    ],
    # Anthropic
    "anthropic": [
        "claude-3-5-sonnet-20241022",
        "claude-3-opus-20240229",
        "claude-3-haiku-20240307",
    ],
    # xAI/Grok
    "xai": [
        "grok-beta",
        "grok-2",
    ],
}


# ─── Deep error inspection ───────────────────────────────────────────

def _get_status_code(error: Exception) -> Optional[int]:
    """Extract HTTP status code from an error object (deep inspection)."""
    # Check common attributes
    for attr in ('status', 'status_code', 'http_status', 'code'):
        val = getattr(error, attr, None)
        if isinstance(val, int) and 100 <= val <= 599:
            return val
        if isinstance(val, str) and val.isdigit():
            code = int(val)
            if 100 <= code <= 599:
                return code
    
    # Check response attribute (requests library)
    resp = getattr(error, 'response', None)
    if resp is not None:
        status = getattr(resp, 'status_code', None)
        if isinstance(status, int):
            return status
    
    # Check error message for HTTP status codes
    msg = str(error)
    match = HTTP_STATUS_RE.search(msg)
    if match:
        code = int(match.group(1))
        if 400 <= code <= 599:
            return code
    
    return None


def _get_error_code(error: Exception) -> Optional[str]:
    """Extract error code string from an error."""
    code = getattr(error, 'code', None)
    if isinstance(code, str) and code.strip():
        return code.strip()
    return None


def _is_timeout_error(error: Exception) -> bool:
    """Deep inspection for timeout errors — checks name, message, and cause chain."""
    # Check error class name
    if type(error).__name__ == 'TimeoutError':
        return True
    
    # Check message
    msg = str(error)
    if TIMEOUT_HINT_RE.search(msg):
        return True
    
    # Check error code
    code = (_get_error_code(error) or '').upper()
    if code in ('ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNABORTED'):
        return True
    
    # Check cause chain
    cause = getattr(error, '__cause__', None)
    if cause and cause is not error:
        if isinstance(cause, Exception):
            return _is_timeout_error(cause)
    
    return False


def _is_abort_error(error: Exception) -> bool:
    """Check if this is a user abort (not a timeout)."""
    name = type(error).__name__
    if name == 'AbortError' or name == 'CancelledError':
        # Could be abort or timeout — check message
        msg = str(error)
        if ABORT_TIMEOUT_RE.search(msg):
            return True  # Timeout disguised as abort
        if not TIMEOUT_HINT_RE.search(msg):
            return True  # Genuine abort
    return False


def classify_error(error: Exception) -> FailureType:
    """
    Classify an error to determine retry strategy.
    Uses deep inspection: HTTP status codes, error codes, message patterns,
    and cause chain analysis.
    """
    # If it's already a FailoverError, use its reason
    if isinstance(error, FailoverError):
        return error.reason
    
    # 1. Check HTTP status code (strongest signal)
    status = _get_status_code(error)
    if status:
        if status == 402:
            return FailureType.BILLING
        if status == 429:
            return FailureType.RATE_LIMIT
        if status in (401, 403):
            return FailureType.AUTH_ERROR
        if status == 408:
            return FailureType.TIMEOUT
        if status == 400:
            return FailureType.FORMAT_ERROR
        if 500 <= status <= 599:
            return FailureType.SERVER_ERROR
    
    # 2. Check for timeout (deep inspection)
    if _is_timeout_error(error):
        return FailureType.TIMEOUT
    
    # 3. Fall back to message-based classification
    error_str = str(error).lower()
    
    if "429" in error_str or "rate limit" in error_str or "too many requests" in error_str:
        return FailureType.RATE_LIMIT
    
    if "401" in error_str or "403" in error_str or "unauthorized" in error_str or "forbidden" in error_str:
        return FailureType.AUTH_ERROR
    
    if "402" in error_str or "billing" in error_str or "payment" in error_str or "quota" in error_str:
        return FailureType.BILLING
    
    if "model" in error_str and ("not found" in error_str or "invalid" in error_str or "unavailable" in error_str):
        return FailureType.MODEL_ERROR
    
    if "context" in error_str and ("length" in error_str or "too long" in error_str or "exceed" in error_str):
        return FailureType.CONTEXT_LENGTH
    
    if "content" in error_str and ("filter" in error_str or "blocked" in error_str or "policy" in error_str):
        return FailureType.CONTENT_FILTER
    
    if "500" in error_str or "502" in error_str or "503" in error_str or "504" in error_str:
        return FailureType.SERVER_ERROR
    
    if "connection" in error_str or "network" in error_str or "dns" in error_str:
        return FailureType.NETWORK_ERROR
    
    return FailureType.UNKNOWN


def coerce_to_failover_error(
    error: Exception,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> Optional[FailoverError]:
    """
    Try to convert any error into a FailoverError.
    Returns None if the error doesn't match any known failover pattern.
    """
    if isinstance(error, FailoverError):
        return error
    
    reason = classify_error(error)
    if reason == FailureType.UNKNOWN:
        return None
    
    status = _get_status_code(error)
    code = _get_error_code(error)
    
    return FailoverError(
        str(error),
        reason=reason,
        provider=provider,
        model=model,
        status=status,
        code=code,
        cause=error,
    )


def _cooldown_for_failure(failure_type: FailureType) -> int:
    """Return cooldown duration in seconds for a given failure type."""
    if failure_type == FailureType.RATE_LIMIT:
        return DEFAULT_COOLDOWN_SEC
    if failure_type in (FailureType.AUTH_ERROR, FailureType.BILLING):
        return AUTH_COOLDOWN_SEC
    if failure_type == FailureType.SERVER_ERROR:
        return SERVER_COOLDOWN_SEC
    return 0  # No cooldown for other failures


def should_retry(failure_type: FailureType) -> bool:
    """Determine if we should retry based on failure type."""
    retryable = {
        FailureType.RATE_LIMIT,
        FailureType.MODEL_ERROR,
        FailureType.TIMEOUT,
        FailureType.SERVER_ERROR,
        FailureType.NETWORK_ERROR,
    }
    return failure_type in retryable


def should_try_different_provider(failure_type: FailureType) -> bool:
    """Determine if we should try a different provider."""
    provider_issues = {
        FailureType.AUTH_ERROR,
        FailureType.BILLING,
        FailureType.RATE_LIMIT,
        FailureType.SERVER_ERROR,
    }
    return failure_type in provider_issues


class ProviderCooldownTracker:
    """
    Tracks provider cooldowns to avoid hammering rate-limited or errored providers.
    Thread-safe. Cooldowns are in-memory and reset on restart.
    """
    
    def __init__(self):
        self._lock = threading.Lock()
        # provider -> (cooldown_until_timestamp, reason)
        self._cooldowns: Dict[str, Tuple[float, str]] = {}
    
    def enter_cooldown(self, provider: str, failure_type: FailureType, model: str = ""):
        """Put a provider into cooldown after a failure."""
        duration = _cooldown_for_failure(failure_type)
        if duration <= 0:
            return
        
        until = time.time() + min(duration, MAX_COOLDOWN_SEC)
        reason = f"{failure_type.value} on {model}" if model else failure_type.value
        
        with self._lock:
            existing_until = self._cooldowns.get(provider, (0, ""))[0]
            # Only extend cooldown, never shorten it
            if until > existing_until:
                self._cooldowns[provider] = (until, reason)
                logger.info(f"[COOLDOWN] {provider} in cooldown for {duration}s ({reason})")
    
    def is_in_cooldown(self, provider: str) -> bool:
        """Check if a provider is currently in cooldown."""
        with self._lock:
            entry = self._cooldowns.get(provider)
            if not entry:
                return False
            until, _ = entry
            if time.time() >= until:
                del self._cooldowns[provider]
                return False
            return True
    
    def get_cooldown_info(self, provider: str) -> Optional[Dict[str, Any]]:
        """Get cooldown details for a provider, or None if not in cooldown."""
        with self._lock:
            entry = self._cooldowns.get(provider)
            if not entry:
                return None
            until, reason = entry
            remaining = until - time.time()
            if remaining <= 0:
                del self._cooldowns[provider]
                return None
            return {
                "provider": provider,
                "remaining_sec": round(remaining, 1),
                "reason": reason,
            }
    
    def clear_cooldown(self, provider: str):
        """Manually clear a provider's cooldown (e.g., after successful request)."""
        with self._lock:
            self._cooldowns.pop(provider, None)
    
    def get_all_cooldowns(self) -> List[Dict[str, Any]]:
        """Get all active cooldowns."""
        now = time.time()
        result = []
        with self._lock:
            expired = []
            for provider, (until, reason) in self._cooldowns.items():
                remaining = until - now
                if remaining <= 0:
                    expired.append(provider)
                else:
                    result.append({
                        "provider": provider,
                        "remaining_sec": round(remaining, 1),
                        "reason": reason,
                    })
            for p in expired:
                del self._cooldowns[p]
        return result


def _run_fallback_loop(
    run_fn: Callable,
    models: List[str],
    provider: str,
    is_async: bool = False,
    cooldown_tracker: Optional[ProviderCooldownTracker] = None,
) -> FallbackResult:
    """
    Core fallback loop shared by sync and async versions.
    Handles cooldown checks, error classification, and attempt tracking.
    """
    attempts: List[ModelAttempt] = []
    
    for model in models:
        # Check provider cooldown before attempting
        if cooldown_tracker and cooldown_tracker.is_in_cooldown(provider):
            info = cooldown_tracker.get_cooldown_info(provider)
            reason = info['reason'] if info else 'unknown'
            remaining = info['remaining_sec'] if info else '?'
            logger.info(f"[FALLBACK] Skipping {provider}/{model} — provider in cooldown ({reason}, {remaining}s remaining)")
            attempts.append(ModelAttempt(
                provider=provider,
                model=model,
                error=f"Provider {provider} in cooldown ({reason})",
                failure_type=FailureType.RATE_LIMIT,
                duration_ms=0,
            ))
            continue
        
        start_time = time.time()
        try:
            result = run_fn(provider, model)
            # Clear cooldown on success
            if cooldown_tracker:
                cooldown_tracker.clear_cooldown(provider)
            return FallbackResult(
                success=True,
                result=result,
                provider=provider,
                model=model,
                attempts=attempts,
            )
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            
            # User abort — rethrow immediately, don't try fallback
            if _is_abort_error(e) and not _is_timeout_error(e):
                raise
            
            failure_type = classify_error(e)
            status = _get_status_code(e)
            code = _get_error_code(e)
            
            attempt = ModelAttempt(
                provider=provider,
                model=model,
                error=str(e)[:500],
                failure_type=failure_type,
                duration_ms=duration_ms,
                status=status,
                code=code,
            )
            attempts.append(attempt)
            
            logger.warning(
                f"[FALLBACK] {provider}/{model} failed "
                f"({failure_type.value}, status={status}): {str(e)[:200]}"
            )
            
            # Enter cooldown if this is a provider-level issue
            if cooldown_tracker and should_try_different_provider(failure_type):
                cooldown_tracker.enter_cooldown(provider, failure_type, model)
            
            # Check if we should continue trying
            if not should_retry(failure_type):
                logger.info(f"[FALLBACK] Not retrying due to {failure_type.value}")
                break
    
    # All attempts failed
    last_error = attempts[-1].error if attempts else "No models available"
    return FallbackResult(
        success=False,
        attempts=attempts,
        error=last_error,
    )


async def run_with_fallback(
    run_fn: Callable[[str, str], T],
    primary_model: str,
    fallback_models: Optional[List[str]] = None,
    provider: str = "ollama",
    max_attempts: int = 3,
    cooldown_tracker: Optional[ProviderCooldownTracker] = None,
) -> FallbackResult[T]:
    """
    Run a function with automatic model fallback.
    Respects provider cooldowns and uses deep error classification.
    """
    models = [primary_model]
    if fallback_models:
        models.extend(m for m in fallback_models if m != primary_model)
    elif provider in DEFAULT_FALLBACK_CHAINS:
        models.extend(m for m in DEFAULT_FALLBACK_CHAINS[provider] if m != primary_model)
    models = models[:max_attempts]
    
    return _run_fallback_loop(run_fn, models, provider, is_async=True, cooldown_tracker=cooldown_tracker)


def run_with_fallback_sync(
    run_fn: Callable[[str, str], T],
    primary_model: str,
    fallback_models: Optional[List[str]] = None,
    provider: str = "ollama",
    max_attempts: int = 3,
    cooldown_tracker: Optional[ProviderCooldownTracker] = None,
) -> FallbackResult[T]:
    """
    Synchronous version of run_with_fallback.
    Respects provider cooldowns and uses deep error classification.
    """
    models = [primary_model]
    if fallback_models:
        models.extend(m for m in fallback_models if m != primary_model)
    elif provider in DEFAULT_FALLBACK_CHAINS:
        models.extend(m for m in DEFAULT_FALLBACK_CHAINS[provider] if m != primary_model)
    models = models[:max_attempts]
    
    return _run_fallback_loop(run_fn, models, provider, is_async=False, cooldown_tracker=cooldown_tracker)


class ModelFallbackManager:
    """
    Manager for model fallback configuration with cooldown tracking.
    
    Tracks provider cooldowns so rate-limited or errored providers are
    automatically skipped during fallback, preventing wasted API calls.
    """
    
    def __init__(self):
        self.fallback_chains: Dict[str, List[str]] = DEFAULT_FALLBACK_CHAINS.copy()
        self.stats: Dict[str, Dict[str, int]] = {}  # provider -> {model -> failure_count}
        self.cooldowns = ProviderCooldownTracker()
    
    def set_fallback_chain(self, provider: str, models: List[str]):
        """Set custom fallback chain for a provider."""
        self.fallback_chains[provider] = models
    
    def get_fallback_chain(self, provider: str) -> List[str]:
        """Get fallback chain for a provider."""
        return self.fallback_chains.get(provider, [])
    
    def record_failure(self, provider: str, model: str, failure_type: Optional[FailureType] = None):
        """Record a model failure for statistics and cooldown."""
        if provider not in self.stats:
            self.stats[provider] = {}
        if model not in self.stats[provider]:
            self.stats[provider][model] = 0
        self.stats[provider][model] += 1
        
        # Enter cooldown if appropriate
        if failure_type and should_try_different_provider(failure_type):
            self.cooldowns.enter_cooldown(provider, failure_type, model)
    
    def record_success(self, provider: str):
        """Record a successful request — clears cooldown for the provider."""
        self.cooldowns.clear_cooldown(provider)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get failure statistics and active cooldowns."""
        return {
            "fallback_chains": self.fallback_chains,
            "failure_counts": self.stats,
            "active_cooldowns": self.cooldowns.get_all_cooldowns(),
        }
    
    def run(
        self,
        run_fn: Callable[[str, str], T],
        primary_model: str,
        provider: str = "ollama",
        max_attempts: int = 3,
    ) -> FallbackResult[T]:
        """Run with fallback using this manager's configuration and cooldowns."""
        fallback_models = self.get_fallback_chain(provider)
        result = run_with_fallback_sync(
            run_fn=run_fn,
            primary_model=primary_model,
            fallback_models=fallback_models,
            provider=provider,
            max_attempts=max_attempts,
            cooldown_tracker=self.cooldowns,
        )
        
        # Record failures and successes
        for attempt in result.attempts:
            if attempt.error:
                self.record_failure(attempt.provider, attempt.model, attempt.failure_type)
        
        if result.success and result.provider:
            self.record_success(result.provider)
        
        return result


# Global manager instance
_manager: Optional[ModelFallbackManager] = None


def get_fallback_manager() -> ModelFallbackManager:
    """Get the global fallback manager."""
    global _manager
    if _manager is None:
        _manager = ModelFallbackManager()
    return _manager
