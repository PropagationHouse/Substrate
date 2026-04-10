---
name: Obsidian Visual Workflow
description: Workflow for creating Obsidian notes via visual input simulation (focus, click, hotkeys, typing).
triggers: obsidian note visually,type in obsidian,visual obsidian note
---

# Visual Obsidian Note Creation

This skill describes how to create a note in Obsidian using visual/input simulation rather than direct file manipulation or URI schemes. This is useful for ensuring the note appears immediately in the user's active workspace.

## Triggers
- "create an obsidian note visually"
- "show me you can write in obsidian"
- "type a note in obsidian"

## Workflow

1. **Locate the Window**: Use `list_windows(title_filter="Obsidian")` to find the handle (`hwnd`) of the Obsidian window.
2. **Focus**: Use `focus_window(hwnd=...)` to bring Obsidian to the foreground.
3. **Ensure Input Focus**: Click in the center of the window to make sure it's active and ready for input.
   - Example: `click(x=960, y=540)` (assuming standard resolution, or calculate based on window rect).
4. **Create New Note**: Send the hotkey `Ctrl+N`.
   - Example: `hotkey(keys="ctrl+n")`.
5. **Type Content**: Use `type_text` to enter the note content.
   - Example: `type_text(text="# My New Note\nThis was typed visually.")`.

## Notes
- Always verify the window is in focus before typing.
- Taking a screenshot after typing (`screenshot_window`) is a good way to confirm success to the user.

