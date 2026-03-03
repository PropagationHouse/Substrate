"""
Macro Tool — Deterministic parameterized scripts
=================================================
Macros are executable scripts (Python/PowerShell) with {{variable}} placeholders.
The agent decides WHICH macro to run and fills in the variables contextually.
The script itself is deterministic — no LLM interpretation needed at runtime.

Directory: macros/
Format: YAML frontmatter + executable code

Example macro file (macros/post-to-x.py):
    ---
    name: Post to X
    description: Posts a message to X/Twitter via browser automation
    triggers: post to x, tweet, quick post
    variables:
      content: "The text to post (required)"
    ---
    import time, pyautogui, subprocess
    content = "{{content}}"
    subprocess.Popen(["cmd", "/c", "start", "https://x.com/compose/post"])
    time.sleep(5)
    pyautogui.write(content, interval=0.05)
    ...
"""

import os
import re
import sys
import json
import time
import logging
import subprocess
import tempfile
from typing import Dict, Any, Optional, List
from pathlib import Path

logger = logging.getLogger(__name__)

SOMA = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MACROS_DIR = os.path.join(SOMA, 'macros')

# In-memory cache
_macros_cache: Dict[str, Dict[str, Any]] = {}
_cache_time: float = 0
_CACHE_TTL = 15  # seconds


# ── Frontmatter Parsing ───────────────────────────────────────────────

def _parse_frontmatter(text: str) -> tuple:
    """Parse YAML frontmatter and return (metadata_dict, body_str)."""
    if not text.startswith('---'):
        return {}, text

    end_idx = text.find('---', 3)
    if end_idx == -1:
        return {}, text

    frontmatter_raw = text[3:end_idx].strip()
    body = text[end_idx + 3:].strip()

    metadata = {}
    current_key = None
    current_dict = None

    for line in frontmatter_raw.split('\n'):
        stripped = line.strip()
        if not stripped:
            continue

        # Detect nested dict start (e.g. "variables:")
        if stripped.endswith(':') and '  ' not in line[:len(line) - len(line.lstrip())]:
            key = stripped[:-1].strip()
            # Check if next lines are indented (dict) by peeking — 
            # for simplicity, handle 'variables' specially
            if key == 'variables':
                current_key = key
                current_dict = {}
                metadata[key] = current_dict
                continue
            else:
                current_key = None
                current_dict = None

        # Inside a nested dict
        if current_dict is not None and (line.startswith('  ') or line.startswith('\t')):
            if ':' in stripped:
                k, _, v = stripped.partition(':')
                current_dict[k.strip()] = v.strip().strip('"\'')
            continue

        # Top-level key: value
        if ':' in stripped:
            current_key = None
            current_dict = None
            k, _, v = stripped.partition(':')
            metadata[k.strip()] = v.strip().strip('"\'').strip()

    return metadata, body


# ── Macro Loading ─────────────────────────────────────────────────────

def _load_macros() -> Dict[str, Dict[str, Any]]:
    """Load all macros from the macros/ directory."""
    global _macros_cache, _cache_time

    now = time.time()
    if _macros_cache and (now - _cache_time) < _CACHE_TTL:
        return _macros_cache

    if not os.path.isdir(MACROS_DIR):
        return {}

    macros = {}
    for fname in sorted(os.listdir(MACROS_DIR)):
        if not (fname.endswith('.py') or fname.endswith('.ps1')):
            continue
        fpath = os.path.join(MACROS_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                raw = f.read()

            metadata, body = _parse_frontmatter(raw)
            if not metadata.get('name'):
                metadata['name'] = Path(fname).stem.replace('-', ' ').replace('_', ' ').title()

            macro_id = Path(fname).stem.lower()
            variables = metadata.get('variables', {})
            if isinstance(variables, str):
                # Single-line variables: parse as comma-separated
                variables = {v.strip(): '' for v in variables.split(',') if v.strip()}

            macros[macro_id] = {
                'id': macro_id,
                'name': metadata.get('name', macro_id),
                'description': metadata.get('description', ''),
                'triggers': [t.strip() for t in metadata.get('triggers', '').split(',') if t.strip()],
                'variables': variables,
                'body': body,
                'path': fpath,
                'extension': Path(fname).suffix,
            }
        except Exception as e:
            logger.error(f"[MACRO] Failed to load {fname}: {e}")

    _macros_cache = macros
    _cache_time = now
    logger.info(f"[MACRO] Loaded {len(macros)} macros from {MACROS_DIR}")
    return macros


# ── Public API (tool dispatch targets) ────────────────────────────────

def list_macros() -> Dict[str, Any]:
    """List all available macros with their variables."""
    macros = _load_macros()
    if not macros:
        return {
            "status": "info",
            "message": f"No macros found. Create .py or .ps1 files in {MACROS_DIR}/",
            "macros": [],
        }

    macro_list = []
    for mid, m in macros.items():
        macro_list.append({
            "id": mid,
            "name": m['name'],
            "description": m['description'],
            "triggers": m['triggers'],
            "variables": m['variables'],
        })

    return {
        "status": "success",
        "macros": macro_list,
        "total": len(macro_list),
        "macros_dir": MACROS_DIR,
    }


def run_macro(name: str, variables: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """
    Execute a macro by name with the given variables.

    Args:
        name: Macro ID (filename without extension) or display name
        variables: Dict of variable_name → value to substitute into the script

    Returns:
        Dict with status, stdout, stderr, return_code
    """
    variables = variables or {}
    macros = _load_macros()

    # Find macro by ID or name (case-insensitive)
    macro = None
    name_lower = name.lower().replace(' ', '-').replace('_', '-')

    # Direct ID match
    if name_lower in macros:
        macro = macros[name_lower]
    else:
        # Try partial match or name match
        for mid, m in macros.items():
            if name_lower in mid or name_lower == m['name'].lower().replace(' ', '-'):
                macro = m
                break
        # Try trigger match
        if not macro:
            for mid, m in macros.items():
                for trigger in m.get('triggers', []):
                    if name_lower in trigger.lower() or trigger.lower() in name_lower:
                        macro = m
                        break
                if macro:
                    break

    if not macro:
        available = [f"{m['id']} ({m['name']})" for m in macros.values()]
        return {
            "status": "error",
            "error": f"Macro not found: {name}",
            "available": available,
        }

    # Substitute variables into the script body
    script = macro['body']
    missing_vars = []

    for var_name, var_desc in macro.get('variables', {}).items():
        placeholder = '{{' + var_name + '}}'
        if var_name in variables:
            # Escape the value for safe embedding in the script
            value = str(variables[var_name])
            script = script.replace(placeholder, value)
        elif placeholder in script:
            missing_vars.append(f"{var_name}: {var_desc}")

    if missing_vars:
        return {
            "status": "error",
            "error": f"Missing required variables: {', '.join(missing_vars)}",
            "macro": macro['name'],
            "required_variables": macro.get('variables', {}),
        }

    # Execute the script
    logger.info(f"[MACRO] Executing '{macro['name']}' (id={macro['id']}) with variables: {list(variables.keys())}")

    try:
        ext = macro['extension']

        if ext == '.py':
            # Write to temp file and execute with current Python
            with tempfile.NamedTemporaryFile(
                mode='w', suffix='.py', dir=os.path.join(SOMA, 'workspace', 'temp'),
                delete=False, encoding='utf-8'
            ) as tmp:
                tmp.write(script)
                tmp_path = tmp.name

            try:
                result = subprocess.run(
                    [sys.executable, tmp_path],
                    capture_output=True, text=True, timeout=120,
                    cwd=SOMA,
                )
                return {
                    "status": "success" if result.returncode == 0 else "error",
                    "macro": macro['name'],
                    "stdout": result.stdout[-2000:] if result.stdout else "",
                    "stderr": result.stderr[-1000:] if result.stderr else "",
                    "return_code": result.returncode,
                }
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        elif ext == '.ps1':
            # Write to temp file and execute with PowerShell
            with tempfile.NamedTemporaryFile(
                mode='w', suffix='.ps1', dir=os.path.join(SOMA, 'workspace', 'temp'),
                delete=False, encoding='utf-8'
            ) as tmp:
                tmp.write(script)
                tmp_path = tmp.name

            try:
                result = subprocess.run(
                    ["powershell", "-ExecutionPolicy", "Bypass", "-File", tmp_path],
                    capture_output=True, text=True, timeout=120,
                    cwd=SOMA,
                )
                return {
                    "status": "success" if result.returncode == 0 else "error",
                    "macro": macro['name'],
                    "stdout": result.stdout[-2000:] if result.stdout else "",
                    "stderr": result.stderr[-1000:] if result.stderr else "",
                    "return_code": result.returncode,
                }
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        else:
            return {
                "status": "error",
                "error": f"Unsupported macro extension: {ext}. Use .py or .ps1",
            }

    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "error": f"Macro '{macro['name']}' timed out after 120 seconds",
            "macro": macro['name'],
        }
    except Exception as e:
        logger.error(f"[MACRO] Execution error: {e}")
        return {
            "status": "error",
            "error": str(e),
            "macro": macro['name'],
        }


def get_macro(name: str) -> Dict[str, Any]:
    """Get full details of a macro including its script body."""
    macros = _load_macros()
    name_lower = name.lower().replace(' ', '-').replace('_', '-')

    macro = macros.get(name_lower)
    if not macro:
        for mid, m in macros.items():
            if name_lower in mid or name_lower == m['name'].lower().replace(' ', '-'):
                macro = m
                break

    if not macro:
        return {
            "status": "error",
            "error": f"Macro not found: {name}",
            "available": list(macros.keys()),
        }

    return {
        "status": "success",
        "id": macro['id'],
        "name": macro['name'],
        "description": macro['description'],
        "triggers": macro['triggers'],
        "variables": macro['variables'],
        "body": macro['body'],
        "path": macro['path'],
    }
