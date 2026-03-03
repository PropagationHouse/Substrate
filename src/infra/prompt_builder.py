"""
Prompt Builder — Assembles the agent system prompt dynamically.

Replaces the static DEFAULT_SYSTEM_PROMPT + TOOL_PROMPT.md approach with
a programmatic builder.

Sections:
- Identity (from SUBSTRATE.md or fallback)
- Tooling (dynamic from registry)
- Tool call style
- Skills (scan skills/ directory, embed descriptions)
- Memory recall (proactive search instruction)
- Workspace
- Circuits / Silent replies
- Project Context (auto-loaded .md files)
- Runtime info
"""

import os
import re
import platform
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────
SILENT_TOKEN = "[SILENT]"
CIRCUITS_OK_TOKEN = "CIRCUITS_OK"
HEARTBEAT_OK_TOKEN = CIRCUITS_OK_TOKEN  # Backward compat

# Files to auto-load as project context
CONTEXT_FILES = ["SUBSTRATE.md", "CIRCUITS.md"]

# Soma — the agent's own codebase / project root
SOMA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ─── File loaders ─────────────────────────────────────────────────────

def _load_file(filename: str) -> Optional[str]:
    """Load a file from project root. Returns content or None."""
    paths = [
        os.path.join(SOMA, filename),
        os.path.join(os.getcwd(), filename),
    ]
    for p in paths:
        if os.path.isfile(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                if content:
                    return content
            except Exception as e:
                logger.debug(f"[PROMPT] Failed to load {filename}: {e}")
    return None


def _load_substrate() -> Optional[str]:
    """Load SUBSTRATE.md persona content."""
    return _load_file("SUBSTRATE.md")


def _scan_skills() -> List[Dict[str, str]]:
    """
    Scan skills/ directory for .md files, extract frontmatter.
    Returns list of {name, description, triggers, location}.
    """
    skills_dir = os.path.join(SOMA, "skills")
    if not os.path.isdir(skills_dir):
        return []

    skills = []
    try:
        for fname in sorted(os.listdir(skills_dir)):
            if not fname.endswith('.md'):
                continue
            fpath = os.path.join(skills_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    raw = f.read(2000)  # Only need frontmatter
                # Parse YAML frontmatter
                fm = _parse_frontmatter(raw)
                if fm.get('name') and fm.get('description'):
                    skills.append({
                        'name': fm['name'],
                        'description': fm['description'],
                        'triggers': fm.get('triggers', ''),
                        'location': f"skills/{fname}",
                    })
            except Exception as e:
                logger.debug(f"[PROMPT] Failed to parse skill {fname}: {e}")
    except Exception as e:
        logger.debug(f"[PROMPT] Failed to scan skills dir: {e}")

    return skills


def _parse_frontmatter(text: str) -> Dict[str, str]:
    """Parse YAML frontmatter from markdown text."""
    match = re.match(r'^---\s*\n(.*?)\n---', text, re.DOTALL)
    if not match:
        return {}
    fm = {}
    for line in match.group(1).split('\n'):
        line = line.strip()
        if ':' in line:
            key, _, value = line.partition(':')
            fm[key.strip()] = value.strip()
    return fm


# ─── Section builders ─────────────────────────────────────────────────

def _build_identity_section(substrate_content: Optional[str]) -> List[str]:
    """Build identity section from SUBSTRATE.md or fallback."""
    if substrate_content:
        return [
            "# Identity",
            "Embody the persona and tone described below. Avoid stiff, generic replies.",
            "",
            substrate_content,
            "",
        ]
    # Fallback if SUBSTRATE.md is missing
    return [
        "# Identity",
        "You are a personal assistant with full desktop control.",
        "",
    ]


def _build_tooling_section(tool_registry=None) -> List[str]:
    """Build tooling section dynamically from tool registry."""
    lines = [
        "## Tooling",
        "Tool names are case-sensitive. Call tools exactly as listed.",
    ]

    if tool_registry:
        try:
            schemas = tool_registry.get_schemas_for_llm()
            if schemas:
                # Group tools by category based on name prefix
                tool_names = sorted(s.get('function', {}).get('name', '') for s in schemas)
                lines.append(f"Available tools ({len(tool_names)}):")
                for name in tool_names:
                    desc = ""
                    for s in schemas:
                        if s.get('function', {}).get('name') == name:
                            desc = s.get('function', {}).get('description', '')[:80]
                            break
                    if desc:
                        lines.append(f"- {name}: {desc}")
                    else:
                        lines.append(f"- {name}")
            else:
                lines.append("No tools currently available.")
        except Exception as e:
            logger.warning(f"[PROMPT] Failed to get tool schemas: {e}")
            lines.append("Tool registry unavailable.")
    else:
        lines.append("Tools are available via function calling schemas.")

    lines.append("")
    return lines


def _build_tool_style_section() -> List[str]:
    """Build tool call style instructions."""
    return [
        "## Tool Call Style",
        "- Simplicity first — fewest tool calls possible. Direct action over research-then-action.",
        "- `exec` is your primary tool — use it for anything you can do from a terminal.",
        "- Read before editing. Verify after acting.",
        "",
        "## File Editing Rules (saves tokens)",
        "1. **grep first**: Before reading a file, use `grep` to find which files and line numbers are relevant.",
        "2. **Line ranges**: When reading large files (>100 lines), ALWAYS use `start_line`/`end_line`.",
        "3. **edit_file over write_file**: To modify existing files, use `edit_file` (surgical find-and-replace). Never rewrite entire files.",
        "4. **Small edits**: Keep `old_string`/`new_string` as small as possible while staying unique.",
        "5. **Discovery**: Use `exec` with `dir`, `find`, or `tree` commands to explore project structure.",
        "",
        "## Web Research Rules",
        "1. **web_search first**: For any web research, use `web_search`. It returns a summarized answer with citations.",
        "2. **exec for fetching**: If you need raw page content, use `exec` with `curl` or similar.",
        "",
        "## Desktop Automation (PRIMARY approach)",
        "For ALL desktop and browser UI automation, prefer `desktop` + `screen` + `mouse`. This works on ANY window — browsers, native apps, dialogs, everything — without requiring special setup.",
        "",
        "**`desktop` tool** (pywinauto — Windows UI Automation) — YOUR MAIN TOOL:",
        "- Works on ANY window including browser windows, file dialogs, system apps, everything",
        "",
        "**Discovery (always start here):**",
        "- `desktop(action='list_windows')` — see all open windows",
        "- `desktop(action='get_elements', title='...', control_type='Button')` — find clickable elements (Button, Edit, Text, MenuItem, Hyperlink, CheckBox, etc.)",
        "- `desktop(action='dump_tree', title='...')` — full UI hierarchy for debugging",
        "- `desktop(action='get_props', title='...', element_name='...')` — detailed element properties (automation_id, state, value)",
        "- `desktop(action='find_by_id', title='...', automation_id='...')` — find element by automation ID (more reliable than name)",
        "",
        "**Interaction:**",
        "- `desktop(action='click', title='...', element_name='...')` — left/right/double click any element",
        "- `desktop(action='type', title='...', element_name='...', text='...')` — type into text fields (clears first by default, optional press_enter=true)",
        "- `desktop(action='send_keys', title='...', keys='{ENTER}')` — send key sequences ({ENTER}, {TAB}, ^c for Ctrl+C, %{F4} for Alt+F4, +a for Shift+A)",
        "- `desktop(action='select_item', title='...', element_name='...', item_text='...')` — select in ComboBox/ListBox/Tab/TreeView",
        "- `desktop(action='toggle', title='...', element_name='...', state='on')` — check/uncheck CheckBox or RadioButton",
        "- `desktop(action='scroll', title='...', direction='down', amount=3)` — scroll within windows or elements",
        "- `desktop(action='drag', title='...', from_element='...', to_element='...')` — drag and drop",
        "- `desktop(action='set_value', title='...', element_name='...', value='...')` — set slider/spinner values",
        "- `desktop(action='context_menu', title='...', element_name='...', menu_item='...')` — right-click and select from context menu",
        "- `desktop(action='menu_select', title='...', menu_path='File->Save As')` — navigate app menus",
        "- `desktop(action='toolbar_click', title='...', button_name='...')` — click toolbar buttons",
        "- `desktop(action='invoke', title='...', element_name='...')` — invoke default action on any element",
        "- `desktop(action='multi_select', title='...', element_name='...', items=[...])` — select multiple items",
        "",
        "**Reading:**",
        "- `desktop(action='read_all_text', title='...')` — scrape ALL visible text from a window",
        "- `desktop(action='read_element', title='...', element_name='...')` — read specific element text",
        "- `desktop(action='read_table', title='...')` — read DataGrid/Table/ListView rows as structured data",
        "",
        "**Window management:**",
        "- `desktop(action='window_action', title='...', action_type='focus')` — focus/minimize/maximize/restore/close/move/resize",
        "- `desktop(action='wait', title='...', timeout=10)` — wait for a window or element to appear",
        "- `desktop(action='launch_app', path='...')` — launch an application",
        "- `desktop(action='handle_dialog', action_type='detect')` — find modal dialogs; use action_type='click', button='OK' to dismiss",
        "- `desktop(action='clipboard', action_type='read')` — read/write clipboard",
        "- `desktop(action='screenshot_window', title='...')` — screenshot a specific window",
        "",
        "**Standard workflow**: `list_windows` → `get_elements` (discover what's there) → `click`/`type`/`send_keys` (interact) → `read_all_text` (verify result)",
        "",
        "**Vision workflow** (for anything desktop can't reach by name):",
        "- `screen(screenshot)` → analyze what you see → `mouse(click, x, y)` → `screen(screenshot)` to verify",
        "- This handles ANY UI element on screen, even custom-rendered ones with no automation support",
        "",
        "**Opening URLs**: Use `exec('start https://...')` to open URLs in the default browser. Do NOT use the `browser` tool to navigate.",
        "",
        "**`browser` tool** (CDP) — FALLBACK ONLY:",
        "- Requires Edge running with `--remote-debugging-port=9222` — often fails with 'No tab connected'",
        "- Only use if you specifically need DOM/CSS selector access and CDP is already connected",
        "- For posting to social media, filling web forms, etc.: use `desktop` + `screen` + `mouse` instead",
        "",
        "## Vision & Screen Control",
        "- `screen(action='screenshot')` — capture the full desktop (returns base64 image). Use to SEE what's on screen.",
        "- `mouse(action='click', x=..., y=...)` — click at pixel coordinates. Use AFTER a screenshot to click what you see.",
        "- `mouse(action='scroll', clicks=-3)` — scroll down (negative) or up (positive).",
        "- Vision workflow: `screen(screenshot)` → analyze image → `mouse(click, x, y)` → `screen(screenshot)` to verify.",
        "",
        "## Documents & Memory",
        "- `pdf(action='extract', path='...')` — read text from a PDF file.",
        "- `memory(action='search', query='...')` — search past conversations by topic.",
        "- `obsidian(action='create', title='...', content='...')` — create notes in Obsidian vault.",
        "",
    ]


def _scan_macros() -> List[Dict[str, Any]]:
    """
    Scan macros/ directory for .py/.ps1 files, extract frontmatter.
    Returns list of {name, description, triggers, variables, location}.
    """
    macros_dir = os.path.join(SOMA, "macros")
    if not os.path.isdir(macros_dir):
        return []

    macros = []
    try:
        for fname in sorted(os.listdir(macros_dir)):
            if not (fname.endswith('.py') or fname.endswith('.ps1')):
                continue
            fpath = os.path.join(macros_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    raw = f.read(2000)
                fm = _parse_frontmatter(raw)
                if fm.get('name') or fm.get('description'):
                    # Parse variables from frontmatter
                    variables = {}
                    if 'variables' in fm:
                        # Simple single-line parse
                        variables = {fm['variables']: ''}
                    macros.append({
                        'name': fm.get('name', fname),
                        'description': fm.get('description', ''),
                        'triggers': fm.get('triggers', ''),
                        'variables': variables,
                        'location': f"macros/{fname}",
                    })
            except Exception as e:
                logger.debug(f"[PROMPT] Failed to parse macro {fname}: {e}")
    except Exception as e:
        logger.debug(f"[PROMPT] Failed to scan macros dir: {e}")

    return macros


def _build_macros_section(macros: List[Dict[str, Any]]) -> List[str]:
    """Build macros section for the system prompt."""
    if not macros:
        return []

    lines = [
        "## Macros",
        "Macros are deterministic scripts with {{variable}} slots. You decide WHICH macro to run and fill in the variables — the script executes exactly the same way every time.",
        "**Always prefer a macro over improvising with tools** when one matches the task.",
        "Use: `macro(action='run', name='...', variables={...})`",
        "",
        "<available_macros>",
    ]
    for m in macros:
        triggers = f" (triggers: {m['triggers']})" if m.get('triggers') else ""
        lines.append(f"- **{m['name']}**: {m['description']}{triggers}")
        lines.append(f"  <location>{m['location']}</location>")
    lines.append("</available_macros>")
    lines.append("")
    return lines


def _build_skills_section(skills: List[Dict[str, str]]) -> List[str]:
    """Build skills section."""
    if not skills:
        return []

    lines = [
        "## Skills",
        "For complex multi-step tasks, check if an <available_skills> entry matches before improvising.",
        "Simple tasks — just use the right tool directly.",
        "",
        "<available_skills>",
    ]
    for skill in skills:
        triggers = f" (triggers: {skill['triggers']})" if skill.get('triggers') else ""
        lines.append(f"- **{skill['name']}**: {skill['description']}{triggers}")
        lines.append(f"  <location>{skill['location']}</location>")
    lines.append("</available_skills>")
    lines.append("")
    return lines


def _build_memory_section() -> List[str]:
    """Build proactive memory recall and fact storage instructions."""
    return [
        "## Memory & Context",
        "You have a `memory` tool with three actions:",
        "- `memory(action='search', query='...')` — search past conversations by topic",
        "- `memory(action='facts')` — read stored user facts (name, preferences, etc.)",
        "- `memory(action='store_fact', key='...', value='...')` — persistently save a fact about the user",
        "",
        "**Proactive fact storage:** When the user shares personal info (name, preferences, timezone,",
        "favorite tools, workflows, pet names, anything personal), store it immediately with store_fact.",
        "These facts persist across sessions and are always loaded into your context.",
        "",
        "**Proactive recall:** When the user references past work, decisions, or preferences,",
        "use memory search to find relevant context before answering.",
        "",
    ]


def _build_workspace_section(workspace_dir: str) -> List[str]:
    """Build workspace section."""
    return [
        "## Soma & Workspace",
        f"Soma (your codebase): {SOMA}",
        f"Workspace: {workspace_dir}",
        "- `macros/` — deterministic parameterized scripts (use `macro` tool to run)",
        "- `skills/` — open-ended workflow instructions (agent interprets)",
        "- `workspace/emergent/` — in-progress scripts and skills",
        "- `workspace/output/` — generated files",
        "- `workspace/temp/` — scratch files",
        "",
        "## Recordings",
        "F9 records UI actions to `workspace/recordings/`. Review with read_file, discuss with user, save as emergent skill.",
        "",
    ]


def _build_circuits_section() -> List[str]:
    """Build circuits and silent reply instructions."""
    return [
        "## Circuits & Silent Replies",
        "If you receive a circuits poll and there is nothing that needs attention, reply exactly:",
        f"{CIRCUITS_OK_TOKEN}",
        f'If something needs attention, do NOT include "{CIRCUITS_OK_TOKEN}"; reply with the alert text instead.',
        "",
        f"When you have nothing useful to say (no-op, ack-only, or empty response), respond with ONLY: {SILENT_TOKEN}",
        "",
        "Rules:",
        f"- {SILENT_TOKEN} must be your ENTIRE message — nothing else",
        f'- Never append it to an actual response (never include "{SILENT_TOKEN}" in real replies)',
        "- Never wrap it in markdown or code blocks",
        "",
    ]


def _build_context_files_section() -> List[str]:
    """Auto-load project context files (SUBSTRATE.md handled separately as identity)."""
    lines = []
    # Load non-SUBSTRATE context files
    for filename in CONTEXT_FILES:
        if filename == "SUBSTRATE.md":
            continue  # Handled in identity section
        content = _load_file(filename)
        if content:
            lines.extend([
                f"## {filename}",
                "",
                content,
                "",
            ])
    return lines


def _build_runtime_section(config: Optional[Dict[str, Any]] = None) -> List[str]:
    """Build runtime info section."""
    from datetime import datetime
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S %Z").strip()
    parts = [
        f"os={platform.system()} ({platform.machine()})",
    ]
    if config:
        model = config.get('model', 'unknown')
        parts.append(f"model={model}")
    return [
        "## Runtime",
        f"CURRENT_TIME: {now_str}",
        f"Runtime: {' | '.join(parts)}",
        "",
    ]


# ─── Main builder ─────────────────────────────────────────────────────

def build_system_prompt(
    config: Optional[Dict[str, Any]] = None,
    tool_registry=None,
    workspace_dir: Optional[str] = None,
    include_tools: bool = True,
    include_skills: bool = True,
    include_memory: bool = True,
    include_circuits: bool = True,
) -> str:
    """
    Build the complete agent system prompt.

    Args:
        config: Agent config dict
        tool_registry: Tool registry instance for dynamic tool listing
        workspace_dir: Working directory path
        include_tools: Include tooling section
        include_skills: Include skills scanning section
        include_memory: Include memory recall instructions
        include_circuits: Include circuits/silent reply instructions

    Returns:
        Complete system prompt string
    """
    config = config or {}
    if not workspace_dir:
        workspace_dir = os.path.join(SOMA, "workspace")

    # Load SUBSTRATE.md
    substrate_content = _load_substrate()

    # Scan skills and macros
    skills = _scan_skills() if include_skills else []
    macros = _scan_macros() if include_skills else []

    # Assemble sections
    sections: List[str] = []

    # 1. Identity (SUBSTRATE.md or fallback)
    sections.extend(_build_identity_section(substrate_content))

    # 2. Tooling (dynamic)
    if include_tools:
        sections.extend(_build_tooling_section(tool_registry))
        sections.extend(_build_tool_style_section())

    # 3. Macros (deterministic scripts — checked before skills)
    if macros:
        sections.extend(_build_macros_section(macros))

    # 4. Skills (open-ended workflows)
    if skills:
        sections.extend(_build_skills_section(skills))

    # 5. Memory recall
    if include_memory:
        sections.extend(_build_memory_section())

    # 6. Workspace
    sections.extend(_build_workspace_section(workspace_dir))

    # 7. Circuits / Silent replies
    if include_circuits:
        sections.extend(_build_circuits_section())

    # 8. Project Context (auto-loaded files)
    context_lines = _build_context_files_section()
    if context_lines:
        sections.append("# Project Context")
        sections.append("")
        sections.extend(context_lines)

    # 9. Runtime
    sections.extend(_build_runtime_section(config))

    # 10. Extra system prompt from config (user customization)
    extra = config.get("extra_system_prompt", "").strip()
    if extra:
        sections.extend(["## Custom Instructions", extra, ""])

    prompt = "\n".join(sections)
    logger.info(f"[PROMPT] Built system prompt: {len(prompt)} chars, "
                f"substrate={'yes' if substrate_content else 'no'}, "
                f"tools={include_tools}, "
                f"macros={len(macros)}, "
                f"skills={len(skills)}, "
                f"memory={include_memory}")
    return prompt
