"""
Tool Verification Layer
========================
Per-tool validators that run after tool execution, before the result
is sent back to the LLM. Provides:

1. **Contextual error enrichment** — when a tool fails, auto-fetch
   relevant context so the LLM can fix it in one shot (no extra round).
2. **Auto-retry** — retry transient/recoverable failures at the infra
   level without involving the LLM at all.
3. **Tool-specific validators** — check for subtle failures that the
   tool's status field doesn't catch (e.g. exec exit_code=0 but stderr
   contains errors).
4. **Fix hints** — actionable suggestions appended to error observations.

Usage:
    from src.infra.tool_verification import verify_and_enrich

    result = registry.execute(tool_name, tool_args)
    result, enrichment = verify_and_enrich(tool_name, tool_args, result)
    # enrichment is a string to append to the observation, or ""
"""

import os
import re
import logging
import time
from typing import Dict, Any, Tuple, Optional, List, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)


# ── Result container ──────────────────────────────────────────────────

@dataclass
class VerificationResult:
    """Result of tool verification."""
    retried: bool = False           # Was the tool auto-retried?
    retry_succeeded: bool = False   # Did the retry succeed?
    enrichment: str = ""            # Extra context to append to observation
    hints: List[str] = None         # Actionable fix hints for the LLM
    suppressed_error: bool = False  # Was a transient error suppressed?

    def __post_init__(self):
        if self.hints is None:
            self.hints = []

    def format_enrichment(self) -> str:
        """Format the full enrichment string for the observation."""
        parts = []
        if self.enrichment:
            parts.append(self.enrichment)
        if self.hints:
            parts.append("Fix hints:")
            for hint in self.hints:
                parts.append(f"  → {hint}")
        return "\n".join(parts)


# ── Validator registry ────────────────────────────────────────────────

_validators: Dict[str, Callable] = {}


def _register_validator(tool_name: str):
    """Decorator to register a validator for a specific tool."""
    def decorator(fn):
        _validators[tool_name] = fn
        return fn
    return decorator


# ── Main entry point ──────────────────────────────────────────────────

def verify_and_enrich(
    tool_name: str,
    tool_args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """
    Verify a tool result and enrich it with context if it failed.

    Args:
        tool_name: Name of the tool that was executed
        tool_args: Arguments passed to the tool
        result: Raw result from the tool
        registry: Tool registry (for auto-retry execution)

    Returns:
        Tuple of (possibly-updated result, VerificationResult)
    """
    if not isinstance(result, dict):
        return result, VerificationResult()

    # Run tool-specific validator if one exists
    validator = _validators.get(tool_name)
    if validator:
        try:
            return validator(tool_args, result, registry)
        except Exception as e:
            logger.error(f"[VERIFY] Validator for {tool_name} failed: {e}")
            return result, VerificationResult()

    # Default: no enrichment
    return result, VerificationResult()


# ── Tool-specific validators ─────────────────────────────────────────

@_register_validator("edit_file")
def _verify_edit_file(
    args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """
    Verify edit_file results. The most impactful validator because
    'string not found' is the #1 failure mode for LLM file editing.

    On failure: auto-reads the file region around where the old_string
    was expected, so the LLM can see the current state and fix it
    without an extra read_file round.
    """
    vr = VerificationResult()

    status = result.get("status", "")
    error = result.get("error", "")

    if status == "error" and "not found" in error.lower():
        # old_string wasn't found — this is the most common failure
        path = args.get("path", "")
        old_string = args.get("old_string", "")

        if path and old_string:
            vr.hints.append(
                "The old_string you provided doesn't match the current file content exactly. "
                "Check whitespace, indentation, and whether the file was modified by a previous edit."
            )

            # Auto-read the file to show current state
            try:
                from src.tools.file_tool import read_file
                from src.tools.grep_tool import grep

                # Resolve path to absolute so read_file doesn't default to workspace/
                if not os.path.isabs(path):
                    proj_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                    abs_path = os.path.normpath(os.path.join(proj_root, path))
                    if os.path.isfile(abs_path):
                        path = abs_path

                # Extract a distinctive search keyword from old_string.
                # Strategy: find the most unique identifier (function/class name,
                # variable, etc.) rather than searching for the full first line,
                # which may have minor differences (type annotations, whitespace).
                first_line = old_string.strip().split('\n')[0].strip()
                search_terms = []
                if len(first_line) > 5:
                    # Try to extract identifiers (function names, variable names)
                    identifiers = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]{3,}', first_line)
                    # Filter out common keywords
                    keywords = {'self', 'def', 'class', 'return', 'import', 'from',
                                'None', 'True', 'False', 'with', 'for', 'while',
                                'elif', 'else', 'try', 'except', 'finally', 'pass',
                                'raise', 'yield', 'lambda', 'global', 'nonlocal',
                                'assert', 'break', 'continue', 'print', 'type',
                                'string', 'dict', 'list', 'tuple', 'bool', 'int',
                                'float', 'str', 'Optional', 'Any', 'Dict', 'List'}
                    distinctive = [i for i in identifiers if i not in keywords]
                    if distinctive:
                        # Use the longest/most distinctive identifier
                        search_terms.append(max(distinctive, key=len))
                    # Also try the full first line as fallback
                    search_terms.append(first_line[:80])

                found_match = False
                for term in search_terms:
                    grep_result = grep(
                        query=term,
                        path=os.path.dirname(path) or ".",
                        includes=[os.path.basename(path)],
                        fixed_strings=True,
                        max_results=5,
                    )

                    if grep_result.get("status") == "success" and grep_result.get("matches"):
                        match_lines = [m["line"] for m in grep_result["matches"]]
                        # Read a window around the first match
                        center = match_lines[0]
                        old_line_count = len(old_string.split('\n'))
                        start = max(1, center - 5)
                        end = center + old_line_count + 5
                        file_result = read_file(path, start_line=start, end_line=end)

                        if file_result.get("status") == "success":
                            content = file_result.get("content", "")
                            vr.enrichment = (
                                f"Current file content around the expected location "
                                f"(lines {start}-{end}):\n{content}"
                            )
                            vr.hints.append(
                                f"Partial match found at line {center}. "
                                f"Use the content above to construct the correct old_string."
                            )
                            found_match = True
                        break

                if found_match:
                    return result, vr

                # Fallback: couldn't find partial match, read first 50 lines
                file_result = read_file(path, start_line=1, end_line=50)
                if file_result.get("status") == "success":
                    total = file_result.get("total_lines", "?")
                    content = file_result.get("content", "")
                    vr.enrichment = (
                        f"File has {total} lines. First 50 lines:\n{content}"
                    )
                    vr.hints.append(
                        "Could not locate a partial match. The file may have changed "
                        "significantly. Re-read the relevant section with read_file."
                    )

            except Exception as e:
                logger.debug(f"[VERIFY] edit_file enrichment failed: {e}")
                vr.hints.append(
                    "Use read_file with start_line/end_line to see the current file content, "
                    "then retry edit_file with the correct old_string."
                )

    elif status == "error" and "appears" in error.lower() and "times" in error.lower():
        # old_string is not unique
        vr.hints.append(
            "The old_string matches multiple locations. Add more surrounding "
            "context lines to make it unique, or use replace_all=true if you "
            "want to replace all occurrences."
        )

    elif status == "success":
        # Success — verify the replacement count makes sense
        replacements = result.get("replacements", 0)
        if replacements == 0:
            vr.hints.append("Edit reported success but 0 replacements were made.")
            return result, vr

        # Post-success verification: re-read the edited region for multi-line edits
        # to catch broken indentation, syntax errors, or unintended changes.
        # Only for edits where new_string spans 3+ lines (single-line edits are low-risk).
        new_string = args.get("new_string", "")
        replace_all = args.get("replace_all", False)
        new_line_count = len(new_string.split('\n'))

        if new_line_count >= 15 and not replace_all:
            path = args.get("path", result.get("path", ""))
            if path:
                try:
                    from src.tools.file_tool import read_file
                    from src.tools.grep_tool import grep

                    # Resolve relative path
                    if not os.path.isabs(path):
                        proj_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                        abs_path = os.path.normpath(os.path.join(proj_root, path))
                        if os.path.isfile(abs_path):
                            path = abs_path

                    # Find where the new_string landed by searching for its first line
                    first_new_line = new_string.strip().split('\n')[0].strip()
                    if len(first_new_line) > 10:
                        # Extract distinctive identifier
                        identifiers = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]{3,}', first_new_line)
                        _kw = {'self', 'def', 'class', 'return', 'import', 'from',
                               'None', 'True', 'False', 'with', 'for', 'while',
                               'elif', 'else', 'try', 'except', 'finally', 'pass',
                               'raise', 'yield', 'lambda', 'print', 'type',
                               'str', 'int', 'float', 'bool', 'dict', 'list'}
                        distinctive = [i for i in identifiers if i not in _kw]
                        search_term = max(distinctive, key=len) if distinctive else first_new_line[:60]

                        grep_result = grep(
                            query=search_term,
                            path=os.path.dirname(path) or ".",
                            includes=[os.path.basename(path)],
                            fixed_strings=True,
                            max_results=3,
                        )

                        if grep_result.get("status") == "success" and grep_result.get("matches"):
                            center = grep_result["matches"][0]["line"]
                            start = max(1, center - 2)
                            end = center + new_line_count + 2
                            file_result = read_file(path, start_line=start, end_line=end)

                            if file_result.get("status") == "success":
                                content = file_result.get("content", "")
                                vr.enrichment = (
                                    f"Post-edit verification (lines {start}-{end}):\n{content}"
                                )

                except Exception as e:
                    logger.debug(f"[VERIFY] Post-success edit verification failed: {e}")

    return result, vr


@_register_validator("exec")
def _verify_exec(
    args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """
    Verify exec results. Checks for:
    - Non-zero exit codes with actionable hints
    - Exit code 0 but error patterns in output (false success)
    - Common failure patterns with specific fix suggestions
    """
    vr = VerificationResult()

    exit_code = result.get("exit_code")
    output = str(result.get("output", ""))
    command = args.get("command", "")
    error = result.get("error", "")

    # Non-zero exit code
    if isinstance(exit_code, int) and exit_code != 0:
        # Common error patterns with specific hints
        error_hints = {
            "not recognized": f"Command not found. Check spelling or use full path.",
            "cannot find": "File or path not found. Verify the path exists.",
            "access is denied": "Permission denied. Try running with elevated privileges.",
            "is not recognized": "Command not found in PATH. Use full executable path.",
            "no such file": "File not found. Check the path.",
            "permission denied": "Permission denied. Check file permissions.",
            "connection refused": "Connection refused. Check if the service is running.",
            "timed out": "Command timed out. Increase timeout_sec or check for hangs.",
            "syntax error": "Syntax error in command. Check quoting and escaping.",
            "modulenotfounderror": "Python module not found. Check if it's installed in the venv.",
            "importerror": "Python import failed. Check module name and installation.",
        }

        combined_output = (output + " " + error).lower()
        for pattern, hint in error_hints.items():
            if pattern in combined_output:
                vr.hints.append(hint)
                break

        if not vr.hints:
            vr.hints.append(f"Command exited with code {exit_code}. Review the output for details.")

    # Exit code 0 but output contains error indicators (false success)
    elif exit_code == 0 and output:
        false_success_patterns = [
            (r"(?i)error:", "Output contains 'error:' despite exit code 0 — check if the command partially failed."),
            (r"(?i)traceback \(most recent", "Python traceback detected despite exit code 0 — the script may have caught and suppressed the error."),
            (r"(?i)fatal:", "Fatal error in output despite exit code 0."),
            (r"(?i)FAILED", "FAILED marker in output despite exit code 0."),
        ]

        for pattern, hint in false_success_patterns:
            if re.search(pattern, output):
                vr.hints.append(hint)
                # Don't override _success — just warn
                break

    # Background command — remind about checking status
    if result.get("session_id") and result.get("status") == "running":
        session_id = result.get("session_id", "")
        vr.hints.append(
            f"Background command started (session: {session_id}). "
            f"Use process(action='exec_status', session_id='{session_id}') to check output."
        )

    return result, vr


@_register_validator("read_file")
def _verify_read_file(
    args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """
    Verify read_file results. On 'file not found', auto-search for
    similar filenames so the LLM can correct the path in one shot.
    """
    vr = VerificationResult()

    status = result.get("status", "")
    error = result.get("error", "")

    if status == "error" and "not found" in error.lower():
        path = args.get("path", "")
        if path:
            # Try to find similar files
            try:
                from src.tools.grep_tool import find_files
                basename = os.path.basename(path)
                name_no_ext = os.path.splitext(basename)[0]

                # Search for files with similar names
                pattern = f"*{name_no_ext}*" if len(name_no_ext) > 2 else f"*{basename}"
                find_result = find_files(
                    pattern=pattern,
                    path=".",
                    file_type="file",
                    max_results=5,
                )

                if find_result.get("status") == "success" and find_result.get("results"):
                    similar = [r["path"] for r in find_result["results"]]
                    vr.enrichment = f"Similar files found: {', '.join(similar)}"
                    vr.hints.append("The file path may be wrong. Check the similar files above.")
                else:
                    vr.hints.append(
                        "File not found and no similar files detected. "
                        "Use find_files or list_dir to discover the correct path."
                    )
            except Exception as e:
                logger.debug(f"[VERIFY] read_file enrichment failed: {e}")
                vr.hints.append("File not found. Use find_files to search for it.")

    elif status == "success":
        # Warn about reading large files without line ranges
        total_lines = result.get("total_lines", 0)
        start_line = args.get("start_line")
        end_line = args.get("end_line")

        if total_lines and total_lines > 200 and start_line is None and end_line is None:
            vr.hints.append(
                f"You read the entire file ({total_lines} lines). "
                f"For large files, use start_line/end_line to read only the relevant section. "
                f"Use grep to find the right lines first."
            )

    return result, vr


@_register_validator("write_file")
def _verify_write_file(
    args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """
    Verify write_file results. Suggest edit_file for existing files.
    """
    vr = VerificationResult()

    status = result.get("status", "")
    error = result.get("error", "")

    if status == "error" and "already exists" in error.lower():
        vr.hints.append(
            "File already exists. Use edit_file for surgical modifications "
            "(much more token-efficient than rewriting the whole file). "
            "Only use write_file with overwrite=true if you truly need to replace everything."
        )

    return result, vr


@_register_validator("grep")
def _verify_grep(
    args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """
    Verify grep results. On zero matches, suggest broader searches.
    """
    vr = VerificationResult()

    if result.get("status") == "success" and result.get("total_matches", 0) == 0:
        query = args.get("query", "")
        includes = args.get("includes", [])
        fixed = args.get("fixed_strings", False)

        hints = []
        if not fixed and any(c in query for c in r'\.[](){}*+?^$|'):
            hints.append("Your query contains regex special characters. Try fixed_strings=true for literal search.")
        if includes:
            hints.append(f"You filtered to {includes}. Try removing the includes filter to search all file types.")
        if args.get("case_sensitive"):
            hints.append("Try case_sensitive=false (the default) for a broader search.")
        if len(query.split()) > 1:
            hints.append("Try searching for a single distinctive keyword instead of a multi-word phrase.")

        if not hints:
            hints.append("No matches found. Try a broader search term or different path.")

        vr.hints = hints

    return result, vr


@_register_validator("find_files")
def _verify_find_files(
    args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """Verify find_files results."""
    vr = VerificationResult()

    if result.get("status") == "success" and result.get("total", 0) == 0:
        pattern = args.get("pattern", "")
        vr.hints.append(
            f"No files matching '{pattern}' found. "
            f"Try a broader glob pattern (e.g. '*' to list everything) "
            f"or check the search path."
        )

    return result, vr


@_register_validator("web_fetch")
def _verify_web_fetch(
    args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], VerificationResult]:
    """
    Verify web_fetch results. Nudge toward web_search when appropriate.
    """
    vr = VerificationResult()

    url = args.get("url", "")

    # Detect search engine URLs — should have used web_search instead
    search_domains = ["google.com/search", "bing.com/search", "duckduckgo.com",
                      "search.yahoo.com", "perplexity.ai"]
    if any(d in url.lower() for d in search_domains):
        vr.hints.append(
            "You fetched a search engine page. Use web_search instead — "
            "it returns a pre-summarized answer with citations, far cheaper than parsing raw search results."
        )

    # Warn if content was truncated (large page)
    if result.get("status") == "success" and result.get("truncated"):
        chars = result.get("chars", 0)
        vr.hints.append(
            f"Page content was {chars} chars and got truncated. "
            f"Consider using web_search for a summarized answer instead."
        )

    return result, vr


# ── Auto-retry for transient failures ─────────────────────────────────

# Tools that are safe to auto-retry (no side effects or idempotent)
SAFE_TO_RETRY = {"read_file", "grep", "find_files", "file_info", "list_dir", "memory_search", "memory_get", "web_fetch"}

# Transient error patterns that warrant a retry
TRANSIENT_PATTERNS = [
    "permission denied",      # File briefly locked
    "being used by another",  # Windows file lock
    "winerror 32",            # Windows sharing violation
    "resource busy",          # Unix file lock
    "temporarily unavailable",
    "connection reset",
    "timeout",
]

MAX_AUTO_RETRIES = 2
RETRY_DELAY_SEC = 0.5


def auto_retry_if_transient(
    tool_name: str,
    tool_args: Dict[str, Any],
    result: Dict[str, Any],
    registry=None,
) -> Tuple[Dict[str, Any], bool]:
    """
    Check if a tool failure is transient and auto-retry if safe.

    Returns:
        Tuple of (result, was_retried)
    """
    if tool_name not in SAFE_TO_RETRY:
        return result, False

    if not isinstance(result, dict):
        return result, False

    status = result.get("status", "")
    error = str(result.get("error", "")).lower()

    if status != "error":
        return result, False

    # Check if error matches a transient pattern
    is_transient = any(pat in error for pat in TRANSIENT_PATTERNS)
    if not is_transient:
        return result, False

    if registry is None:
        return result, False

    # Auto-retry with backoff
    for attempt in range(1, MAX_AUTO_RETRIES + 1):
        logger.info(f"[VERIFY] Auto-retrying {tool_name} (attempt {attempt}/{MAX_AUTO_RETRIES}) — transient error: {error[:80]}")
        time.sleep(RETRY_DELAY_SEC * attempt)

        try:
            retry_result = registry.execute(tool_name, tool_args)
            if isinstance(retry_result, dict) and retry_result.get("status") != "error":
                logger.info(f"[VERIFY] Auto-retry succeeded for {tool_name} on attempt {attempt}")
                return retry_result, True
        except Exception as e:
            logger.debug(f"[VERIFY] Auto-retry attempt {attempt} failed: {e}")

    logger.info(f"[VERIFY] Auto-retry exhausted for {tool_name} after {MAX_AUTO_RETRIES} attempts")
    return result, False
