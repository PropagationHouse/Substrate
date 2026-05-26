"""
Patch Tool — Apply unified diffs to files.
============================================

Gives Substrate the ability to apply multi-file patches using standard
unified diff format. This is a major upgrade over simple string-replace
editing for complex code changes.

Supports:
- Standard unified diff format (--- a/file, +++ b/file, @@ hunks)
- Single-file and multi-file patches
- Fuzzy line matching (configurable tolerance)
- Dry-run mode for validation
- Create/delete file operations
"""

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── Hunk parsing ──────────────────────────────────────────────────────────

_HUNK_HEADER_RE = re.compile(
    r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@"
)


def _parse_unified_diff(patch_text: str) -> List[Dict[str, Any]]:
    """
    Parse a unified diff into a list of file patches.

    Each file patch has:
    - old_path: str (original file path)
    - new_path: str (new file path)
    - hunks: list of hunk dicts
    - is_new_file: bool
    - is_deleted: bool
    """
    files = []
    lines = patch_text.split("\n")
    i = 0

    while i < len(lines):
        # Look for --- line
        if lines[i].startswith("--- "):
            old_path_line = lines[i][4:].strip()
            i += 1
            if i >= len(lines) or not lines[i].startswith("+++ "):
                continue
            new_path_line = lines[i][4:].strip()
            i += 1

            # Normalize paths (strip a/ b/ prefixes)
            old_path = _strip_prefix(old_path_line)
            new_path = _strip_prefix(new_path_line)

            is_new = old_path == "/dev/null"
            is_deleted = new_path == "/dev/null"

            hunks = []
            while i < len(lines):
                match = _HUNK_HEADER_RE.match(lines[i])
                if not match:
                    break

                old_start = int(match.group(1))
                old_count = int(match.group(2)) if match.group(2) else 1
                new_start = int(match.group(3))
                new_count = int(match.group(4)) if match.group(4) else 1
                i += 1

                hunk_lines = []
                while i < len(lines):
                    line = lines[i]
                    if line.startswith("@@") or line.startswith("--- ") or line.startswith("diff "):
                        break
                    if line.startswith("+") or line.startswith("-") or line.startswith(" ") or line == "":
                        hunk_lines.append(line)
                        i += 1
                    elif line == "\\ No newline at end of file":
                        i += 1
                    else:
                        break

                hunks.append({
                    "old_start": old_start,
                    "old_count": old_count,
                    "new_start": new_start,
                    "new_count": new_count,
                    "lines": hunk_lines,
                })

            files.append({
                "old_path": old_path,
                "new_path": new_path,
                "hunks": hunks,
                "is_new_file": is_new,
                "is_deleted": is_deleted,
            })
        elif lines[i].startswith("diff "):
            # Skip diff --git header line
            i += 1
        else:
            i += 1

    return files


def _strip_prefix(path: str) -> str:
    """Strip a/ or b/ prefix from diff paths."""
    if path.startswith("a/") or path.startswith("b/"):
        return path[2:]
    return path


# ── Hunk application ──────────────────────────────────────────────────────

def _apply_hunk(
    original_lines: List[str],
    hunk: Dict[str, Any],
    fuzz: int = 2,
) -> Tuple[Optional[List[str]], Optional[str]]:
    """
    Apply a single hunk to file lines.

    Returns (new_lines, error) — error is None on success.
    Uses fuzzy matching: tries exact position first, then searches
    nearby within `fuzz` lines.
    """
    old_start = hunk["old_start"] - 1  # Convert to 0-indexed
    hunk_lines = hunk["lines"]

    # Build expected old lines and new lines from hunk
    old_chunk = []
    new_chunk = []
    for line in hunk_lines:
        if line.startswith("-"):
            old_chunk.append(line[1:])
        elif line.startswith("+"):
            new_chunk.append(line[1:])
        elif line.startswith(" "):
            old_chunk.append(line[1:])
            new_chunk.append(line[1:])
        elif line == "":
            # Empty context line
            old_chunk.append("")
            new_chunk.append("")

    # Try to find the old_chunk in original_lines near old_start
    match_offset = _find_match(original_lines, old_chunk, old_start, fuzz)

    if match_offset is None:
        # Show what we expected vs what's there
        actual = original_lines[old_start:old_start + len(old_chunk)] if old_start < len(original_lines) else []
        return None, (
            f"Hunk at line {hunk['old_start']} failed to match. "
            f"Expected {len(old_chunk)} lines, got: {actual[:3]}..."
        )

    # Apply: replace old_chunk at match_offset with new_chunk
    result = original_lines[:match_offset] + new_chunk + original_lines[match_offset + len(old_chunk):]
    return result, None


def _find_match(
    lines: List[str],
    pattern: List[str],
    start: int,
    fuzz: int,
) -> Optional[int]:
    """Find where pattern matches in lines, trying start position first, then nearby."""
    if not pattern:
        return start

    # Try exact position first
    if _lines_match(lines, pattern, start):
        return start

    # Try nearby positions
    for offset in range(1, fuzz + 1):
        if start - offset >= 0 and _lines_match(lines, pattern, start - offset):
            return start - offset
        if _lines_match(lines, pattern, start + offset):
            return start + offset

    # Extended search (up to 50 lines away)
    for offset in range(fuzz + 1, 50):
        if start - offset >= 0 and _lines_match(lines, pattern, start - offset):
            return start - offset
        if start + offset + len(pattern) <= len(lines) and _lines_match(lines, pattern, start + offset):
            return start + offset

    return None


def _lines_match(lines: List[str], pattern: List[str], offset: int) -> bool:
    """Check if pattern matches lines at given offset."""
    if offset < 0 or offset + len(pattern) > len(lines):
        return False
    for i, p in enumerate(pattern):
        if lines[offset + i].rstrip() != p.rstrip():
            return False
    return True


# ── Public API ────────────────────────────────────────────────────────────

def apply_patch(
    patch: str,
    base_dir: Optional[str] = None,
    dry_run: bool = False,
    fuzz: int = 2,
) -> Dict[str, Any]:
    """
    Apply a unified diff patch to files.

    Args:
        patch: Unified diff text (multi-file supported)
        base_dir: Base directory for relative paths (default: Substrate root)
        dry_run: If True, validate without writing changes
        fuzz: Line matching tolerance (default 2)

    Returns:
        Dict with status, files_modified, errors
    """
    if not patch or not patch.strip():
        return {"status": "error", "error": "Empty patch provided"}

    if base_dir:
        base = Path(base_dir)
    else:
        base = Path(__file__).parent.parent.parent  # Substrate root

    if not base.is_dir():
        return {"status": "error", "error": f"Base directory does not exist: {base}"}

    # Parse the patch
    file_patches = _parse_unified_diff(patch)
    if not file_patches:
        return {"status": "error", "error": "No valid hunks found in patch. Ensure unified diff format (--- a/file, +++ b/file, @@ hunks)."}

    results = []
    errors = []

    for fp in file_patches:
        target_path = fp["new_path"] if not fp["is_deleted"] else fp["old_path"]
        full_path = base / target_path

        if fp["is_new_file"]:
            # Create new file from hunks
            new_content = []
            for hunk in fp["hunks"]:
                for line in hunk["lines"]:
                    if line.startswith("+"):
                        new_content.append(line[1:])
                    elif line.startswith(" "):
                        new_content.append(line[1:])

            if not dry_run:
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text("\n".join(new_content) + "\n", encoding="utf-8")

            results.append({"file": target_path, "action": "created", "lines_added": len(new_content)})

        elif fp["is_deleted"]:
            if not dry_run:
                if full_path.exists():
                    full_path.unlink()
            results.append({"file": target_path, "action": "deleted"})

        else:
            # Modify existing file
            if not full_path.exists():
                errors.append({"file": target_path, "error": "File not found"})
                continue

            try:
                content = full_path.read_text(encoding="utf-8")
            except Exception as e:
                errors.append({"file": target_path, "error": f"Cannot read file: {e}"})
                continue

            current_lines = content.split("\n")

            # Apply hunks in reverse order (bottom-up) to preserve line numbers
            sorted_hunks = sorted(fp["hunks"], key=lambda h: h["old_start"], reverse=True)

            file_error = False
            for hunk in sorted_hunks:
                new_lines, err = _apply_hunk(current_lines, hunk, fuzz=fuzz)
                if err:
                    errors.append({"file": target_path, "error": err})
                    file_error = True
                    break
                current_lines = new_lines

            if file_error:
                continue

            if not dry_run:
                full_path.write_text("\n".join(current_lines), encoding="utf-8")

            # Count changes
            added = sum(1 for h in fp["hunks"] for l in h["lines"] if l.startswith("+"))
            removed = sum(1 for h in fp["hunks"] for l in h["lines"] if l.startswith("-"))
            results.append({
                "file": target_path,
                "action": "modified",
                "hunks_applied": len(fp["hunks"]),
                "lines_added": added,
                "lines_removed": removed,
            })

    status = "success" if not errors else ("partial" if results else "error")
    response = {
        "status": status,
        "dry_run": dry_run,
        "files_processed": len(results),
        "results": results,
    }
    if errors:
        response["errors"] = errors

    return response


def patch_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """
    Dispatch patch tool actions.

    Actions:
    - apply: Apply a unified diff patch
    - validate: Dry-run a patch to check if it would apply cleanly
    """
    if action == "apply":
        return apply_patch(
            patch=kwargs.get("patch", ""),
            base_dir=kwargs.get("base_dir"),
            dry_run=kwargs.get("dry_run", False),
            fuzz=kwargs.get("fuzz", 2),
        )
    elif action == "validate":
        return apply_patch(
            patch=kwargs.get("patch", ""),
            base_dir=kwargs.get("base_dir"),
            dry_run=True,
            fuzz=kwargs.get("fuzz", 2),
        )
    else:
        return {"status": "error", "error": f"Unknown patch action: {action}. Available: apply, validate"}
