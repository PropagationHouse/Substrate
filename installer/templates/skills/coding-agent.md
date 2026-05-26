---
name: Coding Agent Delegation
description: Delegate complex coding tasks to OpenCode, a specialized agentic coding tool with LSP-aware editing and multi-file capabilities
triggers: refactor,implement,feature,bug fix,code change,multi-file,rewrite,add tests,code review
---

# Coding Agent Delegation

You have access to OpenCode — a specialized coding agent that can handle complex, multi-step code tasks autonomously.

## When to delegate to OpenCode

- Multi-file refactoring or restructuring
- Implementing a new feature that touches several files
- Bug fixes that require understanding code relationships across files
- Adding comprehensive test coverage
- Large code changes where you'd need many sequential edit calls
- Tasks where LSP understanding of the code structure helps

## When to just use text_editor directly

- Single-line or few-line edits
- Config file changes
- Adding an import or a small function
- Anything you can do in 1-3 tool calls

## How to use

```
opencode(action="run", prompt="<detailed description of what to do>")
```

Optional parameters:
- `agent`: "build" (default, best for implementation), "plan" (for analysis), "explore" (for understanding code)
- `working_dir`: directory to operate in (defaults to Substrate root)
- `model`: override model (e.g. "anthropic/claude-sonnet-4-20250514")
- `files`: list of specific files to attach as context

## Tips

- Be specific in the prompt — describe exactly what you want changed and where
- For multi-turn work, use `start_server` + `session_create` + `session_chat`
- Check `status` first if unsure whether OpenCode is available
- The coding agent operates on the filesystem directly — changes are immediate
