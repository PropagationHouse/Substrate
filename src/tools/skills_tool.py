"""
Skills Tool - Loadable workflow definitions
============================================
Skills are markdown files that teach the agent specific workflows.
The agent reads relevant skills before executing tasks.

Features:
- Load skills from .windsurf/skills/ or skills/ directory
- Match skills to user requests
- Provide step-by-step instructions
"""

import os
import re
import logging
from typing import Dict, Any, Optional, List
from pathlib import Path

logger = logging.getLogger(__name__)

# Default skills directory
SKILLS_DIRS = [
    "skills",
    ".windsurf/skills",
    ".substrate/skills",
]

# In-memory skill cache
_skills_cache: Dict[str, Dict[str, Any]] = {}
_cache_time: float = 0


def _find_skills_dir() -> Optional[Path]:
    """Find the skills directory."""
    # Check relative to current working directory
    cwd = Path.cwd()
    for dir_name in SKILLS_DIRS:
        skills_path = cwd / dir_name
        if skills_path.exists() and skills_path.is_dir():
            return skills_path
    
    # Check relative to this file's directory (soma / project root)
    soma = Path(__file__).parent.parent.parent
    for dir_name in SKILLS_DIRS:
        skills_path = soma / dir_name
        if skills_path.exists() and skills_path.is_dir():
            return skills_path
    
    return None


def _check_gating_rules(metadata: Dict[str, Any]) -> tuple:
    """
    Check gating rules for a skill.
    
    Gating rules can require:
    - Environment variables to exist
    - Binaries to be available
    - Config values to be set
    
    Returns:
        (is_available, reason)
    """
    # Check required environment variables
    require_env = metadata.get('require_env', '').split(',')
    for env_var in require_env:
        env_var = env_var.strip()
        if env_var and not os.environ.get(env_var):
            return False, f"Missing env var: {env_var}"
    
    # Check required binaries
    require_binary = metadata.get('require_binary', '').split(',')
    for binary in require_binary:
        binary = binary.strip()
        if binary:
            import shutil
            if not shutil.which(binary):
                return False, f"Missing binary: {binary}"
    
    return True, None


def _parse_skill_file(path: Path) -> Dict[str, Any]:
    """Parse a skill markdown file."""
    try:
        content = path.read_text(encoding='utf-8')
        
        # Parse YAML frontmatter if present
        metadata = {}
        body = content
        
        if content.startswith('---'):
            end_idx = content.find('---', 3)
            if end_idx != -1:
                frontmatter = content[3:end_idx].strip()
                body = content[end_idx + 3:].strip()
                
                # Simple YAML parsing
                for line in frontmatter.split('\n'):
                    if ':' in line:
                        key, value = line.split(':', 1)
                        metadata[key.strip()] = value.strip().strip('"\'')
        
        # Extract title from first heading if not in frontmatter
        if 'name' not in metadata and 'title' not in metadata:
            title_match = re.search(r'^#\s+(.+)$', body, re.MULTILINE)
            if title_match:
                metadata['name'] = title_match.group(1)
        
        # Extract description from frontmatter or first paragraph
        if 'description' not in metadata:
            # Find first non-heading paragraph
            paragraphs = re.findall(r'^(?!#)(.+?)(?:\n\n|\n#|$)', body, re.MULTILINE | re.DOTALL)
            if paragraphs:
                metadata['description'] = paragraphs[0].strip()[:200]
        
        # Check gating rules
        is_available, gate_reason = _check_gating_rules(metadata)
        
        # Parse custom tool definitions from frontmatter
        custom_tools = []
        if 'command-tool' in metadata:
            custom_tools.append({
                'name': metadata.get('command-tool'),
                'dispatch': metadata.get('command-dispatch', 'tool'),
            })
        
        return {
            "name": metadata.get('name', metadata.get('title', path.stem)),
            "description": metadata.get('description', ''),
            "triggers": [t.strip() for t in metadata.get('triggers', '').split(',') if t.strip()],
            "content": body,
            "path": str(path),
            "available": is_available,
            "gate_reason": gate_reason,
            "custom_tools": custom_tools,
            "metadata": metadata,
        }
        
    except Exception as e:
        logger.error(f"Error parsing skill file {path}: {e}")
        return None


def _load_skills() -> Dict[str, Dict[str, Any]]:
    """Load all skills from the skills directory."""
    global _skills_cache, _cache_time
    
    import time
    current_time = time.time()
    
    # Use cache if less than 30 seconds old
    if _skills_cache and (current_time - _cache_time) < 30:
        return _skills_cache
    
    skills_dir = _find_skills_dir()
    if not skills_dir:
        return {}
    
    skills = {}
    
    for skill_file in skills_dir.glob('*.md'):
        skill = _parse_skill_file(skill_file)
        if skill:
            skill_id = skill_file.stem.lower().replace(' ', '-')
            skills[skill_id] = skill
    
    _skills_cache = skills
    _cache_time = current_time
    
    logger.info(f"Loaded {len(skills)} skills from {skills_dir}")
    return skills


def list_skills(include_unavailable: bool = False) -> Dict[str, Any]:
    """
    List all available skills.
    
    Args:
        include_unavailable: Include skills that fail gating rules
    
    Returns:
        Dict with skill list
    """
    try:
        skills = _load_skills()
        
        skill_list = []
        unavailable_count = 0
        
        for skill_id, skill in skills.items():
            is_available = skill.get("available", True)
            
            if not is_available:
                unavailable_count += 1
                if not include_unavailable:
                    continue
            
            skill_list.append({
                "id": skill_id,
                "name": skill.get("name", skill_id),
                "description": skill.get("description", "")[:100],
                "triggers": skill.get("triggers", []),
                "available": is_available,
                "gate_reason": skill.get("gate_reason"),
                "custom_tools": skill.get("custom_tools", []),
            })
        
        return {
            "status": "success",
            "skills": skill_list,
            "total": len(skill_list),
            "unavailable_count": unavailable_count,
            "skills_dir": str(_find_skills_dir()) if _find_skills_dir() else None,
        }
        
    except Exception as e:
        logger.error(f"Error listing skills: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def get_skill(skill_id: str) -> Dict[str, Any]:
    """
    Get a specific skill by ID.
    
    Args:
        skill_id: Skill identifier (filename without .md)
        
    Returns:
        Dict with skill content
    """
    try:
        skills = _load_skills()
        
        # Normalize skill_id
        skill_id = skill_id.lower().replace(' ', '-')
        
        if skill_id not in skills:
            # Try partial match
            matches = [k for k in skills.keys() if skill_id in k]
            if matches:
                skill_id = matches[0]
            else:
                return {
                    "status": "error",
                    "error": f"Skill not found: {skill_id}",
                    "available": list(skills.keys()),
                }
        
        skill = skills[skill_id]
        
        return {
            "status": "success",
            "skill_id": skill_id,
            "name": skill.get("name"),
            "description": skill.get("description"),
            "content": skill.get("content"),
        }
        
    except Exception as e:
        logger.error(f"Error getting skill: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def find_skill(query: str) -> Dict[str, Any]:
    """
    Find a skill that matches a query/task description.
    
    Args:
        query: Task or query to match against skills
        
    Returns:
        Dict with matching skill or suggestions
    """
    try:
        skills = _load_skills()
        
        if not skills:
            return {
                "status": "info",
                "message": "No skills available. Create .md files in skills/ directory.",
            }
        
        query_lower = query.lower()
        matches = []
        
        for skill_id, skill in skills.items():
            score = 0
            
            # Check triggers
            for trigger in skill.get("triggers", []):
                if trigger.lower() in query_lower:
                    score += 10
            
            # Check name
            if skill.get("name", "").lower() in query_lower:
                score += 5
            
            # Check description
            desc = skill.get("description", "").lower()
            for word in query_lower.split():
                if word in desc:
                    score += 1
            
            # Check content keywords
            content = skill.get("content", "").lower()
            for word in query_lower.split():
                if len(word) > 3 and word in content:
                    score += 0.5
            
            if score > 0:
                matches.append({
                    "skill_id": skill_id,
                    "name": skill.get("name"),
                    "score": score,
                    "description": skill.get("description", "")[:100],
                })
        
        # Sort by score
        matches.sort(key=lambda x: x["score"], reverse=True)
        
        if matches:
            best_match = matches[0]
            skill = skills[best_match["skill_id"]]
            
            return {
                "status": "success",
                "matched": True,
                "skill_id": best_match["skill_id"],
                "name": skill.get("name"),
                "content": skill.get("content"),
                "other_matches": matches[1:5],
            }
        else:
            return {
                "status": "success",
                "matched": False,
                "message": "No matching skill found",
                "available": [{"id": k, "name": v.get("name")} for k, v in skills.items()],
            }
        
    except Exception as e:
        logger.error(f"Error finding skill: {e}")
        return {
            "status": "error",
            "error": str(e),
        }


def create_skill(
    name: str,
    content: str,
    description: str = "",
    triggers: List[str] = None,
) -> Dict[str, Any]:
    """
    Create a new skill file.
    
    Args:
        name: Skill name
        content: Skill content (markdown)
        description: Short description
        triggers: List of trigger words/phrases
        
    Returns:
        Dict with result
    """
    try:
        # Find or create skills directory
        skills_dir = _find_skills_dir()
        if not skills_dir:
            # Create default skills directory
            soma = Path(__file__).parent.parent.parent
            skills_dir = soma / "skills"
            skills_dir.mkdir(exist_ok=True)
        
        # Generate filename
        filename = name.lower().replace(' ', '-')
        filename = re.sub(r'[^a-z0-9-]', '', filename)
        filepath = skills_dir / f"{filename}.md"
        
        # Build content with frontmatter
        frontmatter_parts = [
            f"name: {name}",
        ]
        if description:
            frontmatter_parts.append(f"description: {description}")
        if triggers:
            frontmatter_parts.append(f"triggers: {','.join(triggers)}")
        
        full_content = f"---\n{chr(10).join(frontmatter_parts)}\n---\n\n{content}"
        
        filepath.write_text(full_content, encoding='utf-8')
        
        # Clear cache
        global _skills_cache
        _skills_cache = {}
        
        return {
            "status": "success",
            "message": f"Created skill: {name}",
            "path": str(filepath),
        }
        
    except Exception as e:
        logger.error(f"Error creating skill: {e}")
        return {
            "status": "error",
            "error": str(e),
        }
