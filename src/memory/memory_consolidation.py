"""
Memory Consolidation Engine
============================
Periodic background consolidation of memories into structured summaries.

Features:
- Queries recent memories since last consolidation
- Groups them by topic using lightweight LLM call
- Writes category summaries to data/consolidated/ as .md files
- Stores consolidated summaries back into unified memory as SYSTEM type
- Tracks last consolidation timestamp via marker file
- Non-destructive: never deletes original memories
"""

import os
import json
import time
import logging
import threading
import requests
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

from src.memory.unified_memory import (
    UnifiedMemoryManager,
    MemoryType,
    get_unified_memory,
)

logger = logging.getLogger(__name__)

# Soma (project root)
SOMA = Path(__file__).parent.parent.parent
DATA_DIR = SOMA / "data"
CONSOLIDATED_DIR = DATA_DIR / "consolidated"
MARKER_FILE = DATA_DIR / ".last_consolidation"

# Consolidation settings
MIN_MEMORIES_TO_CONSOLIDATE = 5
MAX_MEMORIES_PER_BATCH = 200
CONSOLIDATION_INTERVAL_SECONDS = 86400  # 24 hours


def _get_last_consolidation_time() -> float:
    """Read the last consolidation timestamp from marker file."""
    try:
        if MARKER_FILE.exists():
            data = json.loads(MARKER_FILE.read_text(encoding='utf-8'))
            return data.get('timestamp', 0.0)
    except Exception as e:
        logger.warning(f"Error reading consolidation marker: {e}")
    return 0.0


def _set_last_consolidation_time(timestamp: float) -> None:
    """Write the consolidation timestamp to marker file."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        MARKER_FILE.write_text(
            json.dumps({
                'timestamp': timestamp,
                'datetime': datetime.fromtimestamp(timestamp).isoformat(),
            }),
            encoding='utf-8'
        )
    except Exception as e:
        logger.error(f"Error writing consolidation marker: {e}")


def _format_memories_for_llm(memories: List[Dict]) -> str:
    """Format memory entries into a text block for the LLM."""
    parts = []
    for i, mem in enumerate(memories, 1):
        mem_type = mem.get('type', 'chat')
        user_msg = (mem.get('user_message') or '')[:500]
        asst_msg = (mem.get('assistant_response') or '')[:500]
        ts = mem.get('timestamp', 0)
        dt_str = datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M') if ts else 'unknown'

        entry = f"[{i}] ({mem_type}, {dt_str})"
        if user_msg:
            entry += f"\n  User: {user_msg}"
        if asst_msg:
            entry += f"\n  Assistant: {asst_msg}"
        parts.append(entry)

    return "\n\n".join(parts)


CONSOLIDATION_PROMPT = """You are a memory consolidation assistant. Given the following recent conversation memories, produce a structured summary organized by topic categories.

Rules:
- Group related memories into categories (e.g., "Projects", "Preferences", "Technical Decisions", "Personal Info", "Goals", "Issues/Bugs", "Knowledge")
- For each category, write a concise summary of the key facts, decisions, and context
- Resolve contradictions: if newer info conflicts with older info, keep the newer version
- Drop trivial/routine exchanges that don't contain lasting information
- Keep summaries factual and concise — no filler
- Output valid JSON with this structure:

{
  "categories": [
    {
      "name": "category_name_snake_case",
      "title": "Human Readable Title",
      "summary": "Concise summary of key facts in this category..."
    }
  ],
  "meta": {
    "memories_processed": <count>,
    "categories_generated": <count>
  }
}

Recent memories to consolidate:

"""


def _call_llm_for_consolidation(
    formatted_memories: str,
    config: Dict,
) -> Optional[Dict]:
    """Make a lightweight LLM call to consolidate memories.
    
    Uses the same Google/Gemini API key from the agent config.
    Falls back to Ollama if no remote key is available.
    """
    prompt = CONSOLIDATION_PROMPT + formatted_memories

    # Try Google/Gemini first (cheapest: gemini-2.5-flash)
    google_key = None
    remote_keys = config.get('remote_api_keys', {})
    if isinstance(remote_keys, dict):
        google_key = remote_keys.get('google_api_key', '')
    if not google_key:
        google_key = os.environ.get('GOOGLE_API_KEY', '')

    if google_key and google_key.strip():
        try:
            model = 'gemini-2.5-flash'
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={google_key.strip()}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.3,
                    "maxOutputTokens": 4096,
                    "responseMimeType": "application/json",
                }
            }
            resp = requests.post(endpoint, json=payload, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            text = data['candidates'][0]['content']['parts'][0]['text']
            # Parse JSON from response
            return json.loads(text)
        except Exception as e:
            logger.warning(f"Gemini consolidation call failed: {e}")

    # Fallback to Ollama local model
    try:
        ollama_endpoint = config.get('api_endpoint', 'http://localhost:11434/api/generate')
        ollama_model = config.get('model', 'llama3.2-vision:11b')
        payload = {
            "model": ollama_model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.3, "num_predict": 4096}
        }
        resp = requests.post(ollama_endpoint, json=payload, timeout=120)
        resp.raise_for_status()
        text = resp.json().get('response', '')
        return json.loads(text)
    except Exception as e:
        logger.error(f"Ollama consolidation call failed: {e}")

    return None


def _write_consolidated_files(result: Dict, timestamp: float) -> List[str]:
    """Write consolidated summaries to data/consolidated/ as .md files."""
    CONSOLIDATED_DIR.mkdir(parents=True, exist_ok=True)
    written_files = []

    categories = result.get('categories', [])
    for cat in categories:
        name = cat.get('name', 'unknown')
        title = cat.get('title', name)
        summary = cat.get('summary', '')

        if not summary.strip():
            continue

        filepath = CONSOLIDATED_DIR / f"{name}.md"

        # If file exists, append new content with timestamp separator
        dt_str = datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M')
        new_section = f"\n\n## Updated {dt_str}\n\n{summary.strip()}\n"

        if filepath.exists():
            existing = filepath.read_text(encoding='utf-8')
            filepath.write_text(existing + new_section, encoding='utf-8')
        else:
            content = f"# {title}\n{new_section}"
            filepath.write_text(content, encoding='utf-8')

        written_files.append(str(filepath))
        logger.info(f"Wrote consolidated category: {name} -> {filepath}")

    return written_files


def run_consolidation(
    config: Dict,
    force: bool = False,
) -> Dict[str, Any]:
    """Run memory consolidation.
    
    Args:
        config: Agent config dict (for LLM API keys)
        force: If True, run even if interval hasn't elapsed
        
    Returns:
        Dict with status, categories count, memories processed
    """
    try:
        last_time = _get_last_consolidation_time()
        now = time.time()

        # Check if enough time has passed
        if not force and (now - last_time) < CONSOLIDATION_INTERVAL_SECONDS:
            remaining = CONSOLIDATION_INTERVAL_SECONDS - (now - last_time)
            logger.debug(f"Consolidation not due yet ({remaining:.0f}s remaining)")
            return {
                'status': 'skipped',
                'reason': 'interval_not_elapsed',
                'next_in_seconds': remaining,
            }

        # Get memories since last consolidation
        memory = get_unified_memory()
        memories = memory.get_memories_since(
            since_timestamp=last_time,
            limit=MAX_MEMORIES_PER_BATCH,
        )

        if len(memories) < MIN_MEMORIES_TO_CONSOLIDATE:
            logger.info(f"Only {len(memories)} memories since last consolidation, skipping (min: {MIN_MEMORIES_TO_CONSOLIDATE})")
            return {
                'status': 'skipped',
                'reason': 'insufficient_memories',
                'memories_found': len(memories),
                'min_required': MIN_MEMORIES_TO_CONSOLIDATE,
            }

        logger.info(f"Consolidating {len(memories)} memories...")

        # Format for LLM
        formatted = _format_memories_for_llm(memories)

        # Call LLM for consolidation
        result = _call_llm_for_consolidation(formatted, config)

        if not result or 'categories' not in result:
            logger.error("Consolidation LLM call returned no valid result")
            return {
                'status': 'error',
                'reason': 'llm_call_failed',
            }

        # Write .md files
        written = _write_consolidated_files(result, now)

        # Update marker
        _set_last_consolidation_time(now)

        result_summary = {
            'status': 'success',
            'memories_processed': len(memories),
            'categories_generated': len(categories),
            'files_written': written,
            'timestamp': now,
        }
        logger.info(f"Consolidation complete: {result_summary}")
        return result_summary

    except Exception as e:
        logger.error(f"Consolidation error: {e}")
        import traceback
        traceback.print_exc()
        return {
            'status': 'error',
            'reason': str(e),
        }


# Background consolidation thread
_consolidation_thread: Optional[threading.Thread] = None
_consolidation_stop = threading.Event()


def start_consolidation_timer(config: Dict, interval_seconds: int = CONSOLIDATION_INTERVAL_SECONDS):
    """Start a background thread that runs consolidation periodically.
    
    Args:
        config: Agent config dict
        interval_seconds: How often to check (default 24h)
    """
    global _consolidation_thread, _consolidation_stop

    if _consolidation_thread and _consolidation_thread.is_alive():
        logger.info("Consolidation timer already running")
        return

    _consolidation_stop.clear()

    def _timer_loop():
        logger.info(f"Memory consolidation timer started (check interval: {interval_seconds}s)")
        # Wait a bit on startup before first check
        _consolidation_stop.wait(timeout=60)

        while not _consolidation_stop.is_set():
            try:
                run_consolidation(config)
            except Exception as e:
                logger.error(f"Consolidation timer error: {e}")

            # Sleep until next check (wake every 5 min to check stop flag)
            for _ in range(interval_seconds // 300):
                if _consolidation_stop.is_set():
                    break
                _consolidation_stop.wait(timeout=300)

    _consolidation_thread = threading.Thread(target=_timer_loop, daemon=True, name="memory-consolidation")
    _consolidation_thread.start()


def stop_consolidation_timer():
    """Stop the background consolidation thread."""
    global _consolidation_stop
    _consolidation_stop.set()
    logger.info("Memory consolidation timer stopped")
