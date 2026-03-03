"""
Experiential Learning System — lessons.py
==========================================
Closed feedback loop: Act → Observe outcome → Extract lesson → Store → Inject next time → Act better.

The agent automatically extracts reusable lessons from tool execution history at the
end of each task, stores them in a lightweight JSON file, and injects the most relevant
ones at the start of each new task.

Lesson types:
- tactical: Tool-level patterns (e.g., "grep before edit_file")
- preference: User behavioral signals (e.g., "use web_search not browser for research")

Storage: workspace/state/lessons.json (not in src/ — it's runtime data)
Token cost: ~300 tokens extraction + ~300 tokens injection = ~600 tokens/task total.
"""

import os
import json
import time
import hashlib
import logging
import threading
import re
import requests
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────
SOMA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_STATE_DIR = os.path.join(SOMA, "workspace", "state")
_LESSONS_FILE = os.path.join(_STATE_DIR, "lessons.json")

# ── Limits ────────────────────────────────────────────────────────────
MAX_LESSONS = 150
MAX_INJECTION_LESSONS = 15          # Up from 10 — workflows need more slots
MAX_INJECTION_WORKFLOWS = 5         # Dedicated slots for workflow lessons
MIN_TOOL_CALLS_FOR_EXTRACTION = 3
DECAY_AFTER_DAYS = 90               # Up from 60 — workflows shouldn't decay fast
DECAY_AMOUNT = 0.05                 # Down from 0.1 — gentler decay
MIN_CONFIDENCE = 0.15               # Down from 0.2 — keep more lessons alive
DEDUP_TOKEN_OVERLAP_THRESHOLD = 0.35

# Thread safety
_lock = threading.Lock()


# ── Helpers ───────────────────────────────────────────────────────────

def _ensure_state_dir():
    os.makedirs(_STATE_DIR, exist_ok=True)


# Monotonic counter for unique IDs within a batch
_id_counter = 0
_id_counter_lock = threading.Lock()

def _lesson_id() -> str:
    global _id_counter
    with _id_counter_lock:
        _id_counter += 1
        counter = _id_counter
    ts = int(time.time() * 1000)
    h = hashlib.sha256(f"{ts}_{counter}".encode()).hexdigest()[:6]
    return f"les_{ts}_{h}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _days_since(iso_str: str) -> float:
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return max(0.0, delta.total_seconds() / 86400)
    except Exception:
        return 30.0  # Default to 30 days if parsing fails


def _tokenize(text: str) -> set:
    """Simple whitespace + punctuation tokenizer for dedup overlap."""
    return set(re.findall(r'\w+', text.lower()))


def _token_overlap(a: str, b: str) -> float:
    """Jaccard similarity between two strings' token sets."""
    ta, tb = _tokenize(a), _tokenize(b)
    if not ta or not tb:
        return 0.0
    intersection = ta & tb
    union = ta | tb
    return len(intersection) / len(union)


# Error category mapping for signature normalization
_ERROR_CATEGORIES = [
    (r"missing.*(?:argument|param|title|required)", "missing_arg"),
    (r"not found|not recognized|no such|does not exist", "not_found"),
    (r"access.*denied|permission|forbidden", "access_denied"),
    (r"invalid.*(?:argument|option|syntax)|syntax.*(?:error|incorrect)", "invalid_syntax"),
    (r"access violation|segfault|crash", "crash"),
    (r"timeout|timed? out", "timeout"),
    (r"unknown.*action|unsupported", "unknown_action"),
    (r"already exists|duplicate", "already_exists"),
    (r"truncat|too (?:long|large)", "truncated"),
]
_ERROR_CAT_RE = [(re.compile(p, re.IGNORECASE), cat) for p, cat in _ERROR_CATEGORIES]


def _extract_core_signature(pattern: str, tags: List[str]) -> str:
    """
    Extract a normalized 'core signature' from a lesson for semantic dedup.
    Format: 'tool:action:error_category'
    E.g., 'desktop(action=send_keys) fails with missing title' → 'desktop:send_keys:missing_arg'
    """
    # Extract tool name from tags or pattern
    tool_names = {"desktop", "process", "exec", "mouse", "browser", "edit_file",
                  "read_file", "write_file", "grep", "find_files", "web_fetch", "web_search"}
    tool = ""
    for t in tags:
        if t.lower() in tool_names:
            tool = t.lower()
            break
    if not tool:
        for t in tool_names:
            if t in pattern.lower():
                tool = t
                break

    # Extract action if present
    action_match = re.search(r'action=(\w+)', pattern)
    action = action_match.group(1).lower() if action_match else ""

    # Categorize the error
    error_cat = ""
    for regex, cat in _ERROR_CAT_RE:
        if regex.search(pattern):
            error_cat = cat
            break

    sig = f"{tool}:{action}:{error_cat}"
    return sig


# ── Storage ───────────────────────────────────────────────────────────

def _load_lessons_file() -> Dict:
    """Load lessons.json from disk. Returns empty structure if missing/corrupt."""
    try:
        if os.path.isfile(_LESSONS_FILE):
            with open(_LESSONS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict) and "lessons" in data:
                return data
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"[LESSONS] Failed to load lessons file, starting fresh: {e}")
    return {"version": 1, "lessons": []}


def _save_lessons_file(data: Dict) -> bool:
    """Write lessons.json to disk."""
    try:
        _ensure_state_dir()
        with open(_LESSONS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, default=str)
        return True
    except Exception as e:
        logger.error(f"[LESSONS] Failed to save lessons file: {e}")
        return False


# ── Compact tool history (reuse format from task_persistence) ─────────

def _compact_history_for_extraction(tool_history: List[Dict], max_entries: int = 30) -> str:
    """Format tool history into a compact string for the extraction LLM call."""
    lines = []
    successes = 0
    errors = 0
    for i, entry in enumerate(tool_history[-max_entries:], 1):
        tool = entry.get("tool", "?")
        args = entry.get("args", {})
        result = entry.get("result", {})

        # Key args (truncated — more space for workflow context)
        arg_parts = []
        for k, v in list(args.items())[:4]:
            vs = str(v)
            if len(vs) > 100:
                vs = vs[:100] + "..."
            arg_parts.append(f"{k}={vs}")
        arg_str = ", ".join(arg_parts)

        # Outcome
        if isinstance(result, dict):
            status = result.get("status", result.get("_status", "?"))
            error = result.get("error", result.get("_error", ""))
            if error:
                outcome = f"ERROR: {str(error)[:100]}"
                errors += 1
            else:
                outcome = f"OK ({status})" if status else "OK"
                successes += 1
        else:
            outcome = "OK"
            successes += 1

        lines.append(f"{i}. {tool}({arg_str}) → {outcome}")

    # Add summary line so LLM knows overall success rate
    total = successes + errors
    lines.insert(0, f"[{total} tool calls: {successes} succeeded, {errors} failed]")

    return "\n".join(lines)


# ── Rule-based extraction (zero tokens, catches common patterns) ──────

def _rule_based_extraction(tool_history: List[Dict]) -> List[Dict]:
    """
    Extract lessons from tool history using deterministic rules.
    This is the zero-cost fallback when LLM extraction fails.
    """
    lessons = []
    tool_names = [h.get("tool", "") for h in tool_history]
    tool_results = [(h.get("tool", ""), h.get("result", {})) for h in tool_history]

    # Pattern: edit_file failed with "not found" → should grep first
    for name, result in tool_results:
        if name == "edit_file" and isinstance(result, dict):
            error = str(result.get("error", "")).lower()
            if "not found" in error or "no match" in error:
                # Check if grep was used before this edit
                edit_idx = tool_names.index("edit_file")
                grep_before = any(t == "grep" for t in tool_names[:edit_idx])
                if not grep_before:
                    lessons.append({
                        "pattern": "edit_file fails with 'string not found'",
                        "lesson": "Always use grep first to find the exact content before calling edit_file. The file content may differ from what you expect.",
                        "type": "tactical",
                        "tags": ["edit_file", "grep"],
                    })
                break

    # Pattern: web_fetch used for research (search engine URL)
    search_domains = ["google.com/search", "bing.com/search", "duckduckgo.com", "search.yahoo.com"]
    for name, result in tool_results:
        if name == "web_fetch":
            # Check the args for URL
            for h in tool_history:
                if h.get("tool") == "web_fetch":
                    url = str(h.get("args", {}).get("url", "")).lower()
                    if any(d in url for d in search_domains):
                        lessons.append({
                            "pattern": "web_fetch used on a search engine URL",
                            "lesson": "Use web_search (Sonar) instead of web_fetch for research. It returns pre-summarized answers with citations and costs far fewer tokens.",
                            "type": "tactical",
                            "tags": ["web_fetch", "web_search"],
                        })
                    break
            break

    # Pattern: web_fetch content was truncated
    for h in tool_history:
        if h.get("tool") == "web_fetch":
            result = h.get("result", {})
            if isinstance(result, dict) and result.get("truncated"):
                lessons.append({
                    "pattern": "web_fetch returned truncated content from a large page",
                    "lesson": "For general research questions, prefer web_search (Sonar) which returns concise summarized answers. Only use web_fetch for specific documentation or API reference pages.",
                    "type": "tactical",
                    "tags": ["web_fetch", "web_search", "token_efficiency"],
                })
                break

    # Pattern: write_file failed because file exists
    for name, result in tool_results:
        if name == "write_file" and isinstance(result, dict):
            error = str(result.get("error", "")).lower()
            if "already exists" in error:
                lessons.append({
                    "pattern": "write_file fails because file already exists",
                    "lesson": "Use edit_file for modifying existing files (much more token-efficient). Only use write_file with overwrite=true when replacing the entire file.",
                    "type": "tactical",
                    "tags": ["write_file", "edit_file"],
                })
                break

    # Pattern: multiple retries of the same tool (tool called 3+ times in a row)
    for i in range(len(tool_names) - 2):
        if tool_names[i] == tool_names[i+1] == tool_names[i+2]:
            repeated_tool = tool_names[i]
            # Check if they were failures
            failures = sum(
                1 for j in range(i, i+3)
                if isinstance(tool_results[j][1], dict) and
                tool_results[j][1].get("status") in ("error", "failed")
            )
            if failures >= 2:
                lessons.append({
                    "pattern": f"{repeated_tool} called 3+ times in a row with repeated failures",
                    "lesson": f"When {repeated_tool} fails twice, stop and reassess the approach instead of retrying the same thing. Read the error message carefully and try a different strategy.",
                    "type": "tactical",
                    "tags": [repeated_tool, "retry_loop"],
                })
                break

    # ── Workflow extraction: capture successful multi-step sequences ──
    # Count successes vs failures
    total = len(tool_history)
    failures = sum(
        1 for h in tool_history
        if isinstance(h.get("result"), dict) and
        h["result"].get("status") in ("error", "failed")
    )
    success_rate = (total - failures) / max(1, total)

    # If >70% success rate and 3+ tools used, extract a workflow lesson
    if success_rate >= 0.7 and total >= 3:
        # Build a compact step list from the successful tools
        steps = []
        for h in tool_history:
            tool = h.get("tool", "?")
            args = h.get("args", {})
            result = h.get("result", {})
            # Skip failed steps
            if isinstance(result, dict) and result.get("status") in ("error", "failed"):
                continue
            # Build a compact description
            key_args = []
            for k, v in list(args.items())[:2]:
                vs = str(v)
                if len(vs) > 50:
                    vs = vs[:50] + "..."
                key_args.append(f"{k}={vs}")
            arg_str = ", ".join(key_args)
            steps.append(f"{tool}({arg_str})" if arg_str else tool)

        if len(steps) >= 3:
            # Extract task-level tags from tool args (URLs, filenames, etc.)
            task_tags = set(tool_names)
            _PLATFORM_KEYWORDS = {
                "x.com": "twitter", "twitter.com": "twitter",
                "reddit.com": "reddit", "discord": "discord",
                "youtube.com": "youtube", "github.com": "github",
                "obsidian": "obsidian", "spotify": "spotify",
                "gmail": "email", "outlook": "email",
            }
            for h in tool_history:
                for v in h.get("args", {}).values():
                    vs = str(v).lower()
                    for keyword, tag in _PLATFORM_KEYWORDS.items():
                        if keyword in vs:
                            task_tags.add(tag)

            procedure = " → ".join(steps[:10])  # Cap at 10 steps
            lessons.append({
                "pattern": f"Successful {total}-step task using {', '.join(sorted(set(tool_names))[:4])}",
                "lesson": f"Working procedure: {procedure}",
                "type": "workflow",
                "tags": list(task_tags)[:10],
            })

    return lessons


# ── LLM-based extraction ─────────────────────────────────────────────

_EXTRACTION_PROMPT = """You are a learning system. Given this tool execution history for a task, extract reusable lessons.

Task: "{task}"

Tool history:
{history}

Extract TWO kinds of lessons:

1. **WORKFLOW lessons** (type: "workflow") — Successful multi-step procedures that worked.
   - These are the MOST VALUABLE. If the task completed successfully using 3+ tools, capture the working sequence.
   - pattern: Describe WHAT the user wanted to accomplish (the goal, not the tools). E.g., "Post a tweet to X/Twitter"
   - lesson: The step-by-step procedure that worked. E.g., "1) browser(navigate) to x.com 2) browser(click) compose button 3) browser(type) the text 4) browser(click) post"
   - tags: MUST include both tool names AND task-level keywords. E.g., ["browser", "twitter", "x", "social media", "post"]

2. **TACTICAL lessons** (type: "tactical") — Error patterns and workarounds.
   - pattern: A SPECIFIC error situation (must reference concrete tool names and error messages)
   - lesson: What to do instead (the fix)
   - tags: tool names + task keywords

3. **PREFERENCE lessons** (type: "preference") — User behavioral signals observed.
   - pattern: What the user prefers or how they work
   - lesson: The preference to remember
   - tags: relevant keywords

For ALL lessons:
- tags MUST include task-level keywords (e.g., "reddit", "email", "screenshot", "music") not just tool names
- Keep workflow lessons detailed (up to 80 words) — they need to capture the full procedure
- Keep tactical/preference lessons concise (under 40 words)
- Maximum 4 lessons per task (prioritize workflows over tactical)
- GENERALIZE: replace specific app names/URLs with generic descriptions where possible, BUT keep platform names (Twitter, Reddit, Discord, etc.)
- If the task completed successfully, you MUST extract at least one workflow lesson

Tool rules (NEVER contradict these):
- web_search (Sonar) is ALWAYS preferred over web_fetch or browser for research
- desktop + screen + mouse is ALWAYS preferred over browser for UI automation (posting to social media, filling forms, clicking buttons, etc.)
- Use exec('start https://...') to open URLs, NOT browser(navigate) — browser CDP often fails with 'No tab connected'
- browser tool is FALLBACK ONLY — only use when CDP is already connected and you need DOM/CSS selector access
- edit_file is preferred over write_file for modifying existing files
- grep before edit_file to verify exact content

Return ONLY a JSON array: [{{"pattern": "...", "lesson": "...", "type": "...", "tags": [...]}}]
If nothing noteworthy: []"""


def _extract_via_llm(
    tool_history: List[Dict],
    task_description: str,
    config: Dict,
) -> Optional[List[Dict]]:
    """
    Make a cheap LLM call to extract lessons from tool history.
    Uses Gemini Flash (cheapest option).
    """
    compact = _compact_history_for_extraction(tool_history)
    prompt = _EXTRACTION_PROMPT.format(task=task_description[:200], history=compact)

    # Try Google/Gemini first
    google_key = None
    remote_keys = config.get('remote_api_keys', {})
    if isinstance(remote_keys, dict):
        google_key = remote_keys.get('google_api_key', '')
    if not google_key:
        google_key = os.environ.get('GOOGLE_API_KEY', '')

    if google_key and google_key.strip():
        try:
            model = 'gemini-2.0-flash-lite'
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={google_key.strip()}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 1024,
                    "responseMimeType": "application/json",
                }
            }
            resp = requests.post(endpoint, json=payload, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            text = data['candidates'][0]['content']['parts'][0]['text']
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return parsed
            logger.warning(f"[LESSONS] LLM returned non-list: {type(parsed)}")
        except Exception as e:
            logger.warning(f"[LESSONS] Gemini extraction failed: {e}")

    return None  # Caller will fall back to rule-based


# ── Quality filter ────────────────────────────────────────────────────

# Patterns that indicate a lesson is too vague to be useful
_VAGUE_PATTERNS = [
    r"^when a command fails",
    r"^when an? (?:error|failure) occurs",
    r"^when something (?:fails|goes wrong|doesn't work)",
    r"^when a (?:tool|program|file|website|search|task) (?:needs|is needed|is required)",
    r"^when (?:you need|needing) to",
    r"^(?:always|generally|usually) ",
    r"^if (?:a|an|the) (?:tool|command|operation) ",
    r"fails because (?:the |a |an )?(?:file|path|directory|folder) (?:is )?not found",
    r"^\w+ (?:is used to|can be used to|allows you to)",
    r"fails with (?:a |an )?(?:4\d\d|5\d\d) error\.?$",
]
_VAGUE_RE = [re.compile(p, re.IGNORECASE) for p in _VAGUE_PATTERNS]

# Lessons that conflict with established tool rules
_CONFLICTING_PATTERNS = [
    r"browser.*(?:read|navigate|content).*(?:research|information|search|gather)",
    r"use browser.*(?:to|for) (?:read|search|research|find|look)",
    r"web_fetch.*(?:search|research|general)",
    r"use browser.*(?:to|for) (?:post|click|type|fill|submit|automat)",
    r"browser\(action='?navigate'?\).*(?:to open|to go|to visit)",
    r"prefer browser over desktop",
]
_CONFLICT_RE = [re.compile(p, re.IGNORECASE) for p in _CONFLICTING_PATTERNS]

# Generic filler phrases that indicate low-value advice
_GENERIC_ADVICE = [
    "try alternative", "try different", "try again",
    "read the error", "check the error", "look at the error",
    "be careful", "make sure", "double check",
    "use appropriate", "use suitable", "use correct",
    "check the query", "check the path", "check the file",
    "verify the path", "verify the file",
]


def _is_low_quality_lesson(pattern: str, lesson: str) -> bool:
    """
    Returns True if a lesson should be rejected for being too vague,
    generic, or conflicting with established tool rules.
    """
    combined = f"{pattern} {lesson}".lower()

    # Check vague patterns
    for regex in _VAGUE_RE:
        if regex.search(pattern):
            return True

    # Check conflicting lessons (e.g., suggesting browser for research)
    for regex in _CONFLICT_RE:
        if regex.search(lesson):
            return True

    # Check generic filler advice
    generic_hits = sum(1 for phrase in _GENERIC_ADVICE if phrase in combined)
    if generic_hits >= 2:
        return True

    # Pattern too short to be specific (< 20 chars)
    if len(pattern.strip()) < 20:
        return True

    # Lesson too short to be actionable (< 15 chars)
    if len(lesson.strip()) < 15:
        return True

    # Reject lessons that just restate what a tool does (tautological)
    tautology_patterns = [
        r"use (\w+) to .{0,20}(\1|file|content|text)",  # "use edit_file to edit file"
        r"specifying the .{0,20} for .{0,10} modifications",
        r"for precise (?:modifications|changes|edits)",
    ]
    for tp in tautology_patterns:
        if re.search(tp, lesson, re.IGNORECASE):
            return True

    # Reject if lesson is just "check X" or "verify X" with no actionable alternative
    if re.match(r'^(?:check|verify|ensure|confirm) (?:the |that )', lesson, re.IGNORECASE):
        # Only reject if there's no alternative action suggested (no "use", "try", "switch")
        if not re.search(r'\b(?:use|try|switch|instead|replace|prefer)\b', lesson, re.IGNORECASE):
            return True

    return False


# ── Public API ────────────────────────────────────────────────────────

def extract_lessons(
    tool_history: List[Dict],
    task_description: str,
    config: Dict,
) -> List[Dict]:
    """
    Extract reusable lessons from a completed task's tool history.

    Tries LLM extraction first (Gemini Flash, ~300 tokens), falls back to
    rule-based extraction (0 tokens) if LLM fails.

    Args:
        tool_history: List of tool execution records from chat_with_tools
        task_description: The original user task/message
        config: Agent config dict (for API keys)

    Returns:
        List of lesson dicts with pattern, lesson, type, tags
    """
    if len(tool_history) < MIN_TOOL_CALLS_FOR_EXTRACTION:
        return []

    # Try LLM extraction
    llm_lessons = _extract_via_llm(tool_history, task_description, config)

    if llm_lessons is not None:
        # Validate structure and quality-filter
        valid = []
        for l in llm_lessons:
            if isinstance(l, dict) and l.get("pattern") and l.get("lesson"):
                ltype = l.get("type", "tactical")
                pattern = str(l["pattern"])[:200]
                # Workflow lessons get more space for step-by-step procedures
                max_lesson_len = 500 if ltype == "workflow" else 300
                lesson = str(l["lesson"])[:max_lesson_len]
                # Quality filter: skip for workflow type (they shouldn't be rejected for being "obvious")
                if ltype != "workflow" and _is_low_quality_lesson(pattern, lesson):
                    logger.debug(f"[LESSONS] Rejected low-quality lesson: {pattern[:60]}")
                    continue
                valid.append({
                    "pattern": pattern,
                    "lesson": lesson,
                    "type": ltype,
                    "tags": l.get("tags", []) if isinstance(l.get("tags"), list) else [],
                })
        if valid:
            logger.info(f"[LESSONS] LLM extracted {len(valid)} lessons (after quality filter)")
            return valid[:4]  # Cap at 4 per task (up from 3)
        logger.info("[LESSONS] LLM returned no valid lessons after filtering, trying rule-based")

    # Fallback to rule-based
    rules = _rule_based_extraction(tool_history)
    if rules:
        logger.info(f"[LESSONS] Rule-based extracted {len(rules)} lessons")
    return rules


def store_lessons(new_lessons: List[Dict]) -> int:
    """
    Store extracted lessons, deduplicating against existing ones.

    Dedup logic:
    - Exact match on pattern → increment occurrences, boost confidence
    - High token overlap (>60%) → same as exact match
    - No match → create new entry

    Args:
        new_lessons: List of lesson dicts from extract_lessons()

    Returns:
        Number of genuinely new lessons added (not counting reinforcements)
    """
    if not new_lessons:
        return 0

    with _lock:
        data = _load_lessons_file()
        existing = data.get("lessons", [])
        now = _now_iso()
        added = 0

        for new in new_lessons:
            pattern = new.get("pattern", "")
            lesson = new.get("lesson", "")
            combined = f"{pattern} {lesson}"

            # Check for duplicates
            matched = False
            for ex in existing:
                ex_combined = f"{ex.get('pattern', '')} {ex.get('lesson', '')}"

                # Check: exact match, token overlap, or same core signature
                new_sig = _extract_core_signature(pattern, new.get("tags", []))
                ex_sig = _extract_core_signature(ex.get("pattern", ""), ex.get("tags", []))
                is_dup = (
                    ex.get("pattern") == pattern
                    or _token_overlap(combined, ex_combined) > DEDUP_TOKEN_OVERLAP_THRESHOLD
                    or (new_sig and ex_sig and new_sig == ex_sig)
                )
                if is_dup:
                    # Reinforce existing lesson
                    ex["occurrences"] = ex.get("occurrences", 1) + 1
                    ex["last_seen"] = now
                    ex["last_reinforced"] = now
                    ex["confidence"] = min(1.0, ex.get("confidence", 0.5) + 0.1)
                    # Merge tags
                    existing_tags = set(ex.get("tags", []))
                    existing_tags.update(new.get("tags", []))
                    ex["tags"] = list(existing_tags)
                    matched = True
                    logger.debug(f"[LESSONS] Reinforced existing lesson: {pattern[:60]}... (now {ex['occurrences']}x)")
                    break

            if not matched:
                # Create new lesson — workflows start higher confidence
                ltype = new.get("type", "tactical")
                init_confidence = 0.7 if ltype == "workflow" else 0.5
                max_lesson_len = 500 if ltype == "workflow" else 300
                entry = {
                    "id": _lesson_id(),
                    "type": ltype,
                    "pattern": pattern[:200],
                    "lesson": lesson[:max_lesson_len],
                    "confidence": init_confidence,
                    "occurrences": 1,
                    "first_seen": now,
                    "last_seen": now,
                    "last_reinforced": now,
                    "source": new.get("source", "auto_extracted"),
                    "tags": new.get("tags", [])[:10],
                }
                existing.append(entry)
                added += 1
                logger.info(f"[LESSONS] New lesson stored: {pattern[:60]}...")

        # Enforce max lessons (keep highest confidence)
        if len(existing) > MAX_LESSONS:
            existing.sort(key=lambda x: x.get("confidence", 0), reverse=True)
            removed = len(existing) - MAX_LESSONS
            existing = existing[:MAX_LESSONS]
            logger.info(f"[LESSONS] Pruned {removed} low-confidence lessons (max {MAX_LESSONS})")

        data["lessons"] = existing
        _save_lessons_file(data)

        return added


def load_lessons(
    task_description: Optional[str] = None,
    limit: int = MAX_INJECTION_LESSONS,
) -> List[Dict]:
    """
    Load the most relevant lessons for a given task.

    Scoring:
        score = confidence × recency_factor × relevance_factor × type_boost × source_boost
        - Workflow lessons get a 1.5× boost (they capture procedures)
        - User-explicit lessons get a 1.3× boost
        - Relevance matches against tags + pattern + lesson text (not just tags)

    Returns:
        Top lessons sorted by score, with dedicated workflow slots
    """
    with _lock:
        data = _load_lessons_file()

    lessons = data.get("lessons", [])
    if not lessons:
        return []

    # Tokenize task for relevance matching — include full message
    task_tokens = _tokenize(task_description) if task_description else set()

    scored_workflows = []
    scored_other = []
    for les in lessons:
        confidence = les.get("confidence", 0.5)
        if confidence < MIN_CONFIDENCE:
            continue

        ltype = les.get("type", "tactical")

        # Recency factor: recently reinforced lessons score higher
        days = _days_since(les.get("last_reinforced", les.get("last_seen", "")))
        # Workflows decay slower in scoring (divide by 60 instead of 30)
        recency_divisor = 60.0 if ltype == "workflow" else 30.0
        recency = 1.0 / (1.0 + days / recency_divisor)

        # Relevance factor: match against tags + pattern + lesson text
        if task_tokens:
            les_tokens = set()
            for tag in les.get("tags", []):
                les_tokens.update(_tokenize(tag))
            les_tokens.update(_tokenize(les.get("pattern", "")))
            les_tokens.update(_tokenize(les.get("lesson", "")))
            if les_tokens:
                # Bidirectional: check both directions of overlap
                overlap_forward = len(task_tokens & les_tokens) / max(1, len(task_tokens))
                overlap_backward = len(task_tokens & les_tokens) / max(1, len(les_tokens))
                overlap = max(overlap_forward, overlap_backward)
                relevance = 0.3 + 0.7 * min(1.0, overlap)
            else:
                relevance = 0.5
        else:
            relevance = 0.5

        # Occurrence boost (more observations = more reliable)
        occ_boost = min(1.0, 0.7 + 0.06 * les.get("occurrences", 1))

        # Type boost: workflows are more valuable
        type_boost = 1.5 if ltype == "workflow" else 1.0

        # User-explicit lessons always rank high
        source_boost = 1.3 if les.get("source") in ("user_correction", "explicit") else 1.0

        score = confidence * recency * relevance * occ_boost * type_boost * source_boost

        if ltype == "workflow":
            scored_workflows.append((score, les))
        else:
            scored_other.append((score, les))

    # Sort each pool by score
    scored_workflows.sort(key=lambda x: x[0], reverse=True)
    scored_other.sort(key=lambda x: x[0], reverse=True)

    # Reserve dedicated slots for workflows, fill rest with tactical/preference
    result = []
    workflow_count = min(MAX_INJECTION_WORKFLOWS, len(scored_workflows))
    for _, les in scored_workflows[:workflow_count]:
        result.append(les)

    remaining_slots = limit - len(result)
    for _, les in scored_other[:remaining_slots]:
        result.append(les)

    return result


def format_lessons_for_injection(lessons: List[Dict]) -> str:
    """
    Format lessons into a compact system message for injection.

    Workflows get a dedicated section with clear procedure formatting.
    Tactical/preference lessons are listed separately.

    Args:
        lessons: List of lesson dicts from load_lessons()

    Returns:
        Formatted string to inject as a system message
    """
    if not lessons:
        return ""

    workflows = [l for l in lessons if l.get("type") == "workflow"]
    others = [l for l in lessons if l.get("type") != "workflow"]

    lines = [
        "## Lessons from Previous Tasks",
        "These are patterns learned from experience. Follow them unless the user explicitly overrides.",
        "",
    ]

    if workflows:
        lines.append("### Known Procedures (use these instead of improvising)")
        for i, les in enumerate(workflows, 1):
            pattern = les.get("pattern", "?")
            lesson = les.get("lesson", "?")
            occ = les.get("occurrences", 1)
            reliability = f" (confirmed {occ}x)" if occ > 1 else ""
            lines.append(f"  {i}. **{pattern}**{reliability}: {lesson}")
        lines.append("")

    if others:
        lines.append("### Tool Patterns")
        for i, les in enumerate(others, 1):
            ltype = les.get("type", "tactical").upper()
            pattern = les.get("pattern", "?")
            lesson = les.get("lesson", "?")
            lines.append(f"  {i}. [{ltype}] {pattern} → {lesson}")

    return "\n".join(lines)


def add_explicit_lesson(
    pattern: str,
    lesson: str,
    lesson_type: str = "preference",
    tags: Optional[List[str]] = None,
) -> Dict:
    """
    Add a lesson explicitly (user correction or explicit instruction).

    These start at confidence 1.0 and source "user_correction".

    Args:
        pattern: When this lesson applies
        lesson: What to do
        lesson_type: "tactical" or "preference"
        tags: Optional tags

    Returns:
        The stored lesson dict
    """
    entry = {
        "pattern": pattern[:200],
        "lesson": lesson[:300],
        "type": lesson_type,
        "tags": tags or [],
        "source": "user_correction",
    }

    # store_lessons handles dedup and persistence
    store_lessons([entry])

    # Re-load to get the actual stored entry (may have been merged)
    with _lock:
        data = _load_lessons_file()
    for les in data.get("lessons", []):
        if les.get("pattern") == pattern[:200]:
            # Ensure user corrections have high confidence
            if les.get("source") != "user_correction":
                les["source"] = "user_correction"
                les["confidence"] = max(les.get("confidence", 0.5), 1.0)
                with _lock:
                    _save_lessons_file(data)
            return les

    return entry


def decay_lessons() -> int:
    """
    Decay old lessons that haven't been reinforced recently.

    Called periodically (e.g., on lessons load or daily).
    - Lessons not reinforced in 60+ days: confidence -= 0.1
    - Lessons with confidence < 0.2: deleted

    Returns:
        Number of lessons decayed or removed
    """
    with _lock:
        data = _load_lessons_file()
        lessons = data.get("lessons", [])

        if not lessons:
            return 0

        decayed = 0
        to_keep = []

        for les in lessons:
            # User-sourced lessons never decay
            if les.get("source") in ("user_correction", "explicit"):
                to_keep.append(les)
                continue

            days = _days_since(les.get("last_reinforced", les.get("last_seen", "")))

            if days > DECAY_AFTER_DAYS:
                # Workflow lessons decay at half the rate
                decay = DECAY_AMOUNT * 0.5 if les.get("type") == "workflow" else DECAY_AMOUNT
                les["confidence"] = max(0.0, les.get("confidence", 0.5) - decay)
                decayed += 1

                if les["confidence"] < MIN_CONFIDENCE:
                    logger.info(f"[LESSONS] Removing decayed lesson: {les.get('pattern', '?')[:60]}...")
                    continue  # Don't keep it

            to_keep.append(les)

        removed = len(lessons) - len(to_keep)
        if decayed > 0 or removed > 0:
            data["lessons"] = to_keep
            _save_lessons_file(data)
            logger.info(f"[LESSONS] Decay pass: {decayed} decayed, {removed} removed")

        return decayed + removed


def consolidate_lessons() -> int:
    """
    Merge near-duplicate lessons that slipped past the per-insert dedup.
    Groups by core signature, keeps the one with highest confidence,
    and sums occurrences.

    Returns:
        Number of lessons removed by merging
    """
    with _lock:
        data = _load_lessons_file()
        lessons = data.get("lessons", [])
        if len(lessons) < 2:
            return 0

        def _merge_group(group: List[Dict]) -> Tuple[Dict, int]:
            """Merge a group of lessons, keeping the best one."""
            group.sort(key=lambda x: (x.get("confidence", 0), x.get("occurrences", 1)), reverse=True)
            best = group[0]
            total_occ = sum(g.get("occurrences", 1) for g in group)
            all_tags = set()
            for g in group:
                all_tags.update(g.get("tags", []))
            best["occurrences"] = total_occ
            best["confidence"] = min(1.0, best.get("confidence", 0.5) + 0.05 * (len(group) - 1))
            best["tags"] = list(all_tags)
            return best, len(group) - 1

        # Pass 1: Group by exact core signature (tool:action:error_category)
        groups: Dict[str, List[Dict]] = {}
        ungrouped = []
        for les in lessons:
            sig = _extract_core_signature(les.get("pattern", ""), les.get("tags", []))
            if sig and len(sig) > 3:
                groups.setdefault(sig, []).append(les)
            else:
                ungrouped.append(les)

        pass1 = []
        merges = 0
        for sig, group in groups.items():
            if len(group) == 1:
                pass1.append(group[0])
            else:
                best, m = _merge_group(group)
                pass1.append(best)
                merges += m
                logger.info(f"[LESSONS] Pass 1 merged {len(group)} → 1: {sig}")

        # Pass 2: Group by tool:error_category (ignoring action)
        # e.g., desktop:send_keys:missing_arg + desktop:wait:missing_arg → same root lesson
        broad_groups: Dict[str, List[Dict]] = {}
        ungrouped2 = []
        for les in pass1:
            sig = _extract_core_signature(les.get("pattern", ""), les.get("tags", []))
            parts = sig.split(":")
            if len(parts) == 3 and parts[0] and parts[2]:
                broad_key = f"{parts[0]}:*:{parts[2]}"
                broad_groups.setdefault(broad_key, []).append(les)
            else:
                ungrouped2.append(les)

        merged = []
        for bkey, group in broad_groups.items():
            if len(group) == 1:
                merged.append(group[0])
            else:
                best, m = _merge_group(group)
                merged.append(best)
                merges += m
                logger.info(f"[LESSONS] Pass 2 merged {len(group)} → 1: {bkey}")

        merged.extend(ungrouped)
        merged.extend(ungrouped2)

        if merges > 0:
            data["lessons"] = merged
            _save_lessons_file(data)
            logger.info(f"[LESSONS] Consolidation removed {merges} duplicate lessons ({len(lessons)} → {len(merged)})")

        return merges


def get_lessons_stats() -> Dict:
    """Get statistics about the lessons store."""
    with _lock:
        data = _load_lessons_file()

    lessons = data.get("lessons", [])
    if not lessons:
        return {"total": 0}

    tactical = sum(1 for l in lessons if l.get("type") == "tactical")
    preference = sum(1 for l in lessons if l.get("type") == "preference")
    workflow = sum(1 for l in lessons if l.get("type") == "workflow")
    avg_conf = sum(l.get("confidence", 0) for l in lessons) / len(lessons)
    avg_occ = sum(l.get("occurrences", 1) for l in lessons) / len(lessons)
    user_sourced = sum(1 for l in lessons if l.get("source") in ("user_correction", "explicit"))

    return {
        "total": len(lessons),
        "tactical": tactical,
        "preference": preference,
        "workflow": workflow,
        "user_sourced": user_sourced,
        "avg_confidence": round(avg_conf, 2),
        "avg_occurrences": round(avg_occ, 1),
    }


def clear_all_lessons() -> bool:
    """Clear all lessons (use with caution)."""
    with _lock:
        try:
            if os.path.isfile(_LESSONS_FILE):
                os.remove(_LESSONS_FILE)
                logger.info("[LESSONS] All lessons cleared")
            return True
        except Exception as e:
            logger.error(f"[LESSONS] Failed to clear lessons: {e}")
            return False
