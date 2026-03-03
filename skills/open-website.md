---
name: Open Website
description: How to navigate to and interact with websites
triggers: open,go to,navigate,visit,website
---

# Open Website

Use this workflow to open and interact with websites.

## Simple Navigation

For just opening a website:

1. **Navigate directly**
   ```
   browser_goto {"url": "https://example.com"}
   ```

2. **DONE** - Report the page opened

## Interactive Navigation

For clicking links or buttons:

1. **Navigate to the page**
   ```
   browser_goto {"url": "https://example.com"}
   ```

2. **Get snapshot of interactive elements**
   ```
   browser_snapshot
   ```

3. **Click the desired element by ref**
   ```
   browser_click_ref {"ref": "@3"}
   ```

4. **Verify the action worked**
   ```
   browser_content
   ```

## Tips

- Always use `browser_snapshot` before clicking to see available elements
- Use refs (@1, @2, etc.) instead of guessing CSS selectors
- After clicking, use `browser_content` to verify the page changed
