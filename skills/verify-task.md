---
name: Verify Task
description: Post-task verification — self-check after completing any non-trivial task
triggers: verify,check,validate,confirm,test,done,finished,complete
gating: auto
---

# Verify Task

After completing any non-trivial task, run through this checklist before reporting success.

## When to Verify

- File creation or modification (code, config, docs)
- Command execution with expected output
- Multi-step workflows
- Anything the user explicitly asked to "make sure" or "double-check"

## Verification Steps

### 1. Re-read the output

If you wrote or edited a file, read it back to confirm the changes landed correctly.

```
text_editor {"action": "read", "path": "<file_you_just_modified>"}
```

### 2. Syntax / parse check

For code files, run a quick syntax check if applicable:

- **Python**: `python -c "import ast; ast.parse(open(r'<file>').read())"`
- **JSON**: `python -c "import json; json.load(open(r'<file>'))"`
- **YAML**: `python -c "import yaml; yaml.safe_load(open(r'<file>'))"`
- **JavaScript/TypeScript**: `npx tsc --noEmit <file>` or `node -c <file>`

### 3. Functional spot-check

If the task involved running something, re-run or test the specific output:

- Check that a created file exists and is non-empty
- Verify a command produced the expected output
- Confirm an API endpoint returns the right shape

### 4. Diff against intent

Compare what you did against what was asked:

- Did you address **all** parts of the request?
- Did you introduce any unintended side effects?
- Are there leftover debug statements or placeholder values?

### 5. Report

Summarize what was verified and any issues found. If everything checks out, confirm completion. If issues are found, fix them before reporting.

## Tips

- Don't skip verification just because the task seemed simple
- If verification reveals a problem, fix it immediately rather than reporting partial success
- For large changes, verify the most critical parts first
- Use `grep` to search for common mistakes: TODO, FIXME, hardcoded values, debug prints
