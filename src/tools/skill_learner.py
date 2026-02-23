"""
Skill Learner - Transforms F9 recordings into dynamic, intelligent skills.
==========================================================================
Instead of replaying exact clicks, this module analyzes recordings to understand
the user's INTENT, extracts decision points, and generates parameterized skills
that the agent can execute adaptively.

Pipeline:
  1. analyze_recording() - Parse recording JSON, identify goal/apps/decisions/variables
  2. The agent uses the analysis to ASK the user clarifying questions
  3. generate_skill_draft() - Produce a dynamic skill markdown from analysis + user answers
  4. The agent practices the skill with user watching
  5. save_skill() - Finalize after user confirmation
"""

import os
import json
import logging
import re
from typing import Dict, Any, List, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SOMA = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))
RECORDINGS_DIR = os.path.join(SOMA, 'workspace', 'recordings')
SKILLS_DIR = os.path.join(SOMA, 'skills')


# ── Recording Analysis ──────────────────────────────────────────────

def analyze_recording(path: str) -> Dict[str, Any]:
    """
    Analyze a recording JSON file and extract structured understanding.
    
    Returns a rich analysis dict that the agent uses to have a learning
    conversation with the user.
    """
    try:
        with open(path, 'r', encoding='utf-8') as f:
            recording = json.load(f)
    except Exception as e:
        return {"status": "error", "error": f"Failed to read recording: {e}"}

    steps = recording.get('steps', [])
    if not steps:
        return {"status": "error", "error": "Recording has no steps"}

    # ── Extract windows used ──
    windows = []
    window_sequence = []
    for step in steps:
        w = step.get('window', '')
        if w and w != 'Unknown':
            if not window_sequence or window_sequence[-1] != w:
                window_sequence.append(w)
            if w not in windows:
                windows.append(w)

    # ── Identify apps from window titles ──
    apps = _identify_apps(windows)

    # ── Group steps into phases (by window switches) ──
    phases = _extract_phases(steps)

    # ── Find typed content (variable parts) ──
    typed_content = []
    for step in steps:
        if step.get('action') == 'type' and step.get('value'):
            typed_content.append({
                'text': step['value'],
                'window': step.get('window', ''),
                'time': step.get('t', 0),
            })

    # ── Find URLs (from typed content or window titles) ──
    urls = _extract_urls(steps, windows)

    # ── Identify decision points ──
    # These are moments where the user looked at something, then chose what to do
    decision_points = _identify_decision_points(phases)

    # ── Identify repeated patterns ──
    patterns = _identify_patterns(steps)

    # ── Build summary ──
    analysis = {
        "status": "success",
        "recording_path": path,
        "recording_name": recording.get('name', ''),
        "duration_sec": recording.get('duration_sec', 0),
        "total_steps": len(steps),

        # What apps/sites were involved
        "apps": apps,
        "windows": windows[:10],  # Cap for readability
        "window_flow": window_sequence[:20],

        # The workflow broken into phases
        "phases": phases,

        # Content the user typed (likely variable)
        "typed_content": typed_content,

        # URLs visited
        "urls": urls,

        # Where the user made context-dependent choices
        "decision_points": decision_points,

        # Repeated action patterns
        "patterns": patterns,

        # Suggested questions for the agent to ask
        "suggested_questions": _generate_questions(apps, phases, typed_content, decision_points, urls),

        # Raw steps for the agent to reference
        "steps": steps,
    }

    return analysis


def _identify_apps(windows: List[str]) -> List[Dict[str, str]]:
    """Identify applications from window titles."""
    app_patterns = {
        'Chrome': r'Google Chrome$|— Google Chrome$',
        'Firefox': r'Mozilla Firefox$|— Mozilla Firefox$',
        'Edge': r'Microsoft Edge$|— Microsoft Edge$',
        'X/Twitter': r'X$|\/ X$|Twitter',
        'Reddit': r'Reddit',
        'Discord': r'Discord',
        'VS Code': r'Visual Studio Code',
        'File Explorer': r'File Explorer',
        'Terminal': r'PowerShell|Command Prompt|Terminal|cmd\.exe',
        'Notepad': r'Notepad',
        'Obsidian': r'Obsidian',
    }

    found = []
    seen = set()
    for window in windows:
        for app_name, pattern in app_patterns.items():
            if app_name not in seen and re.search(pattern, window, re.IGNORECASE):
                # Extract the page/tab name from the window title
                page = window
                for suffix in ['- Google Chrome', '— Google Chrome', '- Mozilla Firefox',
                               '— Mozilla Firefox', '- Microsoft Edge', '— Microsoft Edge']:
                    page = page.replace(suffix, '').strip()
                found.append({"app": app_name, "context": page})
                seen.add(app_name)
                break

    return found


def _extract_phases(steps: List[Dict]) -> List[Dict[str, Any]]:
    """Group steps into phases based on window switches and pauses."""
    if not steps:
        return []

    phases = []
    current_phase = {
        "window": steps[0].get('window', 'Unknown'),
        "start_time": steps[0].get('t', 0),
        "steps": [],
        "summary_actions": [],
    }

    for step in steps:
        window = step.get('window', 'Unknown')
        t = step.get('t', 0)

        # New phase on window switch or long pause (>5s)
        if (window != current_phase['window'] or
                (current_phase['steps'] and t - current_phase['steps'][-1].get('t', 0) > 5)):
            # Finalize current phase
            current_phase['end_time'] = current_phase['steps'][-1].get('t', 0) if current_phase['steps'] else t
            current_phase['duration'] = round(current_phase['end_time'] - current_phase['start_time'], 1)
            current_phase['summary_actions'] = _summarize_phase_actions(current_phase['steps'])
            current_phase['step_count'] = len(current_phase['steps'])
            del current_phase['steps']  # Don't bloat the output
            phases.append(current_phase)

            current_phase = {
                "window": window,
                "start_time": t,
                "steps": [],
                "summary_actions": [],
            }

        current_phase['steps'].append(step)

    # Finalize last phase
    if current_phase['steps']:
        current_phase['end_time'] = current_phase['steps'][-1].get('t', 0)
        current_phase['duration'] = round(current_phase['end_time'] - current_phase['start_time'], 1)
        current_phase['summary_actions'] = _summarize_phase_actions(current_phase['steps'])
        current_phase['step_count'] = len(current_phase['steps'])
        del current_phase['steps']
        phases.append(current_phase)

    return phases


def _summarize_phase_actions(steps: List[Dict]) -> List[str]:
    """Summarize what happened in a phase as human-readable actions."""
    summaries = []
    for step in steps:
        action = step.get('action', '')
        if action == 'click':
            elem = step.get('element', '')
            btn = step.get('button', 'left')
            if elem:
                summaries.append(f"Clicked '{elem}'" + (f" ({btn})" if btn != 'left' else ''))
            else:
                x, y = step.get('coords', [0, 0])
                summaries.append(f"Clicked at ({x}, {y})")
        elif action == 'type':
            text = step.get('value', '')
            preview = text[:50] + ('...' if len(text) > 50 else '')
            summaries.append(f"Typed: \"{preview}\"")
        elif action == 'keypress':
            key = step.get('key', '')
            summaries.append(f"Pressed {key}")
        elif action == 'scroll':
            direction = step.get('direction', 'down')
            summaries.append(f"Scrolled {direction}")

    # Collapse consecutive scrolls
    collapsed = []
    scroll_count = 0
    for s in summaries:
        if s.startswith('Scrolled'):
            scroll_count += 1
        else:
            if scroll_count > 0:
                collapsed.append(f"Scrolled ({scroll_count}x)")
                scroll_count = 0
            collapsed.append(s)
    if scroll_count > 0:
        collapsed.append(f"Scrolled ({scroll_count}x)")

    return collapsed


def _extract_urls(steps: List[Dict], windows: List[str]) -> List[str]:
    """Extract URLs from typed content and window titles."""
    urls = []
    url_pattern = re.compile(r'https?://[^\s<>"\']+')

    for step in steps:
        if step.get('action') == 'type':
            for match in url_pattern.finditer(step.get('value', '')):
                if match.group() not in urls:
                    urls.append(match.group())

    # Also extract from window titles (browsers show URLs sometimes)
    for w in windows:
        for match in url_pattern.finditer(w):
            if match.group() not in urls:
                urls.append(match.group())

    return urls


def _identify_decision_points(phases: List[Dict]) -> List[Dict[str, str]]:
    """
    Identify decision points — moments where the user had to read/evaluate
    before choosing an action. These are the key parts that make a skill
    dynamic rather than a macro.
    """
    decisions = []

    for i, phase in enumerate(phases):
        actions = phase.get('summary_actions', [])
        window = phase.get('window', '')

        # A phase with scrolling followed by clicking = user was scanning content
        has_scroll = any('Scrolled' in a for a in actions)
        has_click = any('Clicked' in a for a in actions)
        if has_scroll and has_click:
            decisions.append({
                "phase": i + 1,
                "window": window,
                "type": "scan_and_select",
                "description": f"User scrolled through content in '{window}' and selected something — this requires reading and choosing based on context.",
            })

        # A phase with typing in a text field = user composed content
        has_typing = any('Typed' in a for a in actions)
        if has_typing and len([a for a in actions if 'Typed' in a]) > 0:
            typed_actions = [a for a in actions if 'Typed' in a]
            for ta in typed_actions:
                decisions.append({
                    "phase": i + 1,
                    "window": window,
                    "type": "content_creation",
                    "description": f"User typed content in '{window}' — {ta}. This content will vary each time.",
                })

        # Window switch = user moved between apps (navigation decision)
        if i > 0 and phase.get('window') != phases[i-1].get('window'):
            decisions.append({
                "phase": i + 1,
                "window": window,
                "type": "navigation",
                "description": f"User switched to '{window}' — need to know when/why to navigate here.",
            })

    return decisions


def _identify_patterns(steps: List[Dict]) -> List[Dict[str, Any]]:
    """Identify repeated action patterns (e.g. scroll-click-scroll-click)."""
    if len(steps) < 4:
        return []

    # Look for repeated 2-3 step sequences
    action_seq = [s.get('action', '') for s in steps]
    patterns = []

    for length in [2, 3]:
        counts = defaultdict(int)
        for i in range(len(action_seq) - length + 1):
            pattern = tuple(action_seq[i:i+length])
            counts[pattern] += 1

        for pattern, count in counts.items():
            if count >= 3:
                patterns.append({
                    "sequence": list(pattern),
                    "occurrences": count,
                    "description": f"Repeated {count}x: {' → '.join(pattern)}",
                })

    return patterns


def _generate_questions(
    apps: List[Dict],
    phases: List[Dict],
    typed_content: List[Dict],
    decision_points: List[Dict],
    urls: List[str],
) -> List[str]:
    """Generate smart questions for the agent to ask the user."""
    questions = []

    # Goal question
    if apps:
        app_names = ', '.join(a['app'] for a in apps)
        questions.append(
            f"I see you used {app_names}. What was the overall goal of this workflow?"
        )

    # Variable content questions
    for tc in typed_content:
        preview = tc['text'][:60]
        questions.append(
            f"You typed \"{preview}\" — would this change each time, or is it always the same?"
        )

    # Decision point questions
    scan_decisions = [d for d in decision_points if d['type'] == 'scan_and_select']
    if scan_decisions:
        questions.append(
            "I noticed you scrolled through content and selected something. "
            "What were you looking for? How should I decide what to click?"
        )

    # Navigation questions
    nav_decisions = [d for d in decision_points if d['type'] == 'navigation']
    if len(nav_decisions) > 1:
        questions.append(
            "You switched between several windows/apps. Is the order important, "
            "or is it more about completing each step regardless of order?"
        )

    # URL questions
    if urls:
        questions.append(
            f"I see URL(s): {', '.join(urls[:3])}. Would these change, "
            "or do you always go to the same pages?"
        )

    # Completion question
    questions.append(
        "How do I know when this task is done? What does success look like?"
    )

    # Variation question
    questions.append(
        "Are there variations of this workflow? (e.g. different sites, "
        "different content types, different conditions)"
    )

    return questions


# ── Skill Draft Generation ──────────────────────────────────────────

def generate_skill_draft(
    name: str,
    description: str,
    triggers: List[str],
    goal: str,
    apps: List[str],
    workflow_steps: List[str],
    decision_logic: List[str],
    variables: List[Dict[str, str]],
    success_criteria: str,
    notes: str = "",
) -> Dict[str, Any]:
    """
    Generate a dynamic skill markdown file from analyzed recording + user input.
    
    This produces a skill that understands WHAT to do, not just WHERE to click.
    The skill uses screen reading, snapshots, and context-aware decisions.
    """
    # Build frontmatter
    trigger_str = ','.join(triggers)

    # Build variable documentation
    var_section = ""
    if variables:
        var_lines = []
        for v in variables:
            var_lines.append(f"- **{v.get('name', 'param')}**: {v.get('description', '')} "
                           f"(default: {v.get('default', 'none')})")
        var_section = f"\n## Variables\n" + '\n'.join(var_lines) + "\n"

    # Build decision logic section
    decision_section = ""
    if decision_logic:
        decision_lines = [f"- {d}" for d in decision_logic]
        decision_section = f"\n## Decision Points\n" + '\n'.join(decision_lines) + "\n"

    # Build workflow steps
    step_lines = [f"{i+1}. {step}" for i, step in enumerate(workflow_steps)]
    workflow_section = '\n'.join(step_lines)

    # Build the skill content
    content = f"""---
name: {name}
description: {description}
triggers: {trigger_str}
---

# {name}

## Goal
{goal}

## Apps & Tools
{', '.join(apps)}
{var_section}
## Workflow
{workflow_section}
{decision_section}
## Success Criteria
{success_criteria}

## Execution Notes
- This is a DYNAMIC skill — adapt to what you see on screen, don't replay exact coordinates.
- Use `screen` → screenshot or `browser` → snapshot to read the current state before acting.
- Use `desktop` → read_element or read_all_text to understand UI context.
- If something looks different from expected, pause and ask the user.
- Always verify the result before reporting success.
"""

    if notes:
        content += f"\n## Additional Notes\n{notes}\n"

    return {
        "status": "success",
        "skill_name": name,
        "content": content,
        "preview": content[:500] + "..." if len(content) > 500 else content,
    }


def save_skill_draft(name: str, content: str) -> Dict[str, Any]:
    """
    Save a skill draft to workspace/emergent/ for testing.
    Only promote to skills/ after user confirmation.
    """
    emergent_dir = os.path.join(SOMA, 'workspace', 'emergent')
    os.makedirs(emergent_dir, exist_ok=True)

    # Sanitize filename
    safe_name = re.sub(r'[^a-z0-9-]', '-', name.lower().strip())
    safe_name = re.sub(r'-+', '-', safe_name).strip('-')
    filepath = os.path.join(emergent_dir, f"{safe_name}.md")

    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return {
            "status": "success",
            "path": filepath,
            "message": f"Skill draft saved to {filepath}. Use skill promote to finalize.",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def promote_skill(draft_path: str) -> Dict[str, Any]:
    """
    Promote a tested skill from workspace/emergent/ to skills/.
    Called after user confirms the skill works.
    """
    import shutil

    if not os.path.isfile(draft_path):
        return {"status": "error", "error": f"Draft not found: {draft_path}"}

    os.makedirs(SKILLS_DIR, exist_ok=True)
    filename = os.path.basename(draft_path)
    dest = os.path.join(SKILLS_DIR, filename)

    try:
        shutil.move(draft_path, dest)
        return {
            "status": "success",
            "path": dest,
            "message": f"Skill promoted to {dest}. It's now available for use.",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}
