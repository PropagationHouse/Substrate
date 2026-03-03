"""
Webhooks - External HTTP Triggers for Automation
=================================================

Webhooks that allow external systems to trigger agent actions.

Examples:
- GitHub webhook → agent reviews PR
- IFTTT → agent processes event
- Zapier → agent runs workflow
- Custom integrations

Endpoints:
- POST /api/webhook/<trigger_id> → Queue event for agent
- GET /api/webhooks → List registered webhooks
- POST /api/webhooks → Register new webhook
- DELETE /api/webhooks/<id> → Remove webhook
"""

import os
import json
import time
import hmac
import hashlib
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field, asdict
from datetime import datetime

logger = logging.getLogger("gateway.webhooks")

# Soma (project root)
SOMA = Path(__file__).parent.parent.parent
DATA_DIR = SOMA / "data"
WEBHOOKS_FILE = DATA_DIR / "webhooks.json"
WEBHOOK_LOG_FILE = DATA_DIR / "webhook_events.jsonl"


@dataclass
class WebhookConfig:
    """Configuration for a webhook endpoint."""
    id: str
    name: str
    description: str = ""
    secret: Optional[str] = None  # For HMAC verification
    enabled: bool = True
    created_at: float = field(default_factory=time.time)
    
    # What to do when triggered
    action: str = "enqueue"  # enqueue, run_now, notify
    prompt_template: str = "Webhook '{name}' triggered with payload: {payload}"
    
    # Optional filters
    required_fields: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WebhookConfig":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class WebhookEvent:
    """A received webhook event."""
    webhook_id: str
    timestamp: float
    payload: Dict[str, Any]
    headers: Dict[str, str] = field(default_factory=dict)
    source_ip: Optional[str] = None
    processed: bool = False
    result: Optional[str] = None


class WebhookRegistry:
    """Registry for webhook configurations."""
    
    def __init__(self):
        self._webhooks: Dict[str, WebhookConfig] = {}
        self._load()
    
    def _load(self):
        """Load webhooks from file."""
        if WEBHOOKS_FILE.exists():
            try:
                with open(WEBHOOKS_FILE, 'r') as f:
                    data = json.load(f)
                for wh_data in data.get('webhooks', []):
                    wh = WebhookConfig.from_dict(wh_data)
                    self._webhooks[wh.id] = wh
                logger.info(f"Loaded {len(self._webhooks)} webhooks")
            except Exception as e:
                logger.error(f"Failed to load webhooks: {e}")
    
    def _save(self):
        """Save webhooks to file."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            data = {
                'webhooks': [wh.to_dict() for wh in self._webhooks.values()]
            }
            with open(WEBHOOKS_FILE, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save webhooks: {e}")
    
    def register(self, config: WebhookConfig) -> bool:
        """Register a new webhook."""
        if config.id in self._webhooks:
            logger.warning(f"Webhook {config.id} already exists")
            return False
        
        self._webhooks[config.id] = config
        self._save()
        logger.info(f"Registered webhook: {config.id}")
        return True
    
    def unregister(self, webhook_id: str) -> bool:
        """Remove a webhook."""
        if webhook_id not in self._webhooks:
            return False
        
        del self._webhooks[webhook_id]
        self._save()
        logger.info(f"Unregistered webhook: {webhook_id}")
        return True
    
    def get(self, webhook_id: str) -> Optional[WebhookConfig]:
        """Get a webhook by ID."""
        return self._webhooks.get(webhook_id)
    
    def list_all(self) -> List[WebhookConfig]:
        """List all webhooks."""
        return list(self._webhooks.values())
    
    def update(self, webhook_id: str, updates: Dict[str, Any]) -> bool:
        """Update a webhook configuration."""
        if webhook_id not in self._webhooks:
            return False
        
        wh = self._webhooks[webhook_id]
        for key, value in updates.items():
            if hasattr(wh, key):
                setattr(wh, key, value)
        
        self._save()
        return True


# Global registry
_registry: Optional[WebhookRegistry] = None


def get_webhook_registry() -> WebhookRegistry:
    """Get the global webhook registry."""
    global _registry
    if _registry is None:
        _registry = WebhookRegistry()
    return _registry


def verify_webhook_signature(
    payload: bytes,
    signature: str,
    secret: str,
    algorithm: str = "sha256"
) -> bool:
    """Verify HMAC signature for webhook payload."""
    if not secret:
        return True  # No secret configured, skip verification
    
    try:
        # Support GitHub-style "sha256=..." prefix
        if "=" in signature:
            algo, sig = signature.split("=", 1)
        else:
            sig = signature
        
        expected = hmac.new(
            secret.encode(),
            payload,
            getattr(hashlib, algorithm)
        ).hexdigest()
        
        return hmac.compare_digest(expected, sig)
    except Exception as e:
        logger.error(f"Signature verification failed: {e}")
        return False


def log_webhook_event(event: WebhookEvent):
    """Log a webhook event to the event log."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with open(WEBHOOK_LOG_FILE, 'a') as f:
            f.write(json.dumps({
                'webhook_id': event.webhook_id,
                'timestamp': event.timestamp,
                'payload': event.payload,
                'source_ip': event.source_ip,
                'processed': event.processed,
                'result': event.result,
            }) + '\n')
    except Exception as e:
        logger.error(f"Failed to log webhook event: {e}")


def process_webhook(
    webhook_id: str,
    payload: Dict[str, Any],
    headers: Dict[str, str] = None,
    source_ip: str = None,
) -> Dict[str, Any]:
    """
    Process an incoming webhook.
    
    Returns result dict with status and message.
    """
    registry = get_webhook_registry()
    webhook = registry.get(webhook_id)
    
    if not webhook:
        return {"status": "error", "message": f"Unknown webhook: {webhook_id}"}
    
    if not webhook.enabled:
        return {"status": "error", "message": f"Webhook {webhook_id} is disabled"}
    
    # Check required fields
    for field in webhook.required_fields:
        if field not in payload:
            return {"status": "error", "message": f"Missing required field: {field}"}
    
    # Create event
    event = WebhookEvent(
        webhook_id=webhook_id,
        timestamp=time.time(),
        payload=payload,
        headers=headers or {},
        source_ip=source_ip,
    )
    
    # Build prompt from template
    prompt = webhook.prompt_template.format(
        name=webhook.name,
        payload=json.dumps(payload, indent=2),
        **payload  # Allow direct field access in template
    )
    
    # Handle based on action type
    if webhook.action == "enqueue":
        # Queue as system event for next circuits run
        try:
            from ..infra.system_events import enqueue_system_event
            enqueue_system_event({
                "type": "webhook",
                "webhook_id": webhook_id,
                "text": prompt,
                "payload": payload,
            })
            event.processed = True
            event.result = "enqueued"
        except Exception as e:
            event.result = f"enqueue_failed: {e}"
            
    elif webhook.action == "run_now":
        # Trigger immediate agent run
        try:
            from .autonomous_runner import get_autonomous_runner
            runner = get_autonomous_runner()
            result = runner.run(initial_prompt=prompt)
            event.processed = True
            event.result = f"ran: {result.response[:100]}"
        except Exception as e:
            event.result = f"run_failed: {e}"
            
    elif webhook.action == "notify":
        # Just log and notify
        event.processed = True
        event.result = "notified"
        logger.info(f"Webhook notification: {webhook.name} - {prompt[:100]}")
    
    # Log the event
    log_webhook_event(event)
    
    return {
        "status": "success",
        "message": f"Webhook {webhook_id} processed",
        "action": webhook.action,
        "result": event.result,
    }


def create_webhook(
    webhook_id: str,
    name: str,
    description: str = "",
    action: str = "enqueue",
    prompt_template: str = None,
    secret: str = None,
) -> Dict[str, Any]:
    """Create a new webhook."""
    import secrets
    
    registry = get_webhook_registry()
    
    config = WebhookConfig(
        id=webhook_id,
        name=name,
        description=description,
        action=action,
        prompt_template=prompt_template or f"Webhook '{name}' triggered: {{payload}}",
        secret=secret or secrets.token_urlsafe(32),
    )
    
    if registry.register(config):
        return {
            "status": "success",
            "webhook": config.to_dict(),
        }
    else:
        return {
            "status": "error",
            "message": f"Webhook {webhook_id} already exists",
        }


# Exports
__all__ = [
    "WebhookConfig",
    "WebhookEvent",
    "WebhookRegistry",
    "get_webhook_registry",
    "verify_webhook_signature",
    "process_webhook",
    "create_webhook",
    "log_webhook_event",
]
