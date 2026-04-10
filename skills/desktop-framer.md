---
name: Desktop Framer
description: Organizes open windows into a sleek, tiled layout on the desktop.
triggers: organize windows,clean up desktop,sleek framing
---

# Desktop Framer Skill

This skill organizes open windows into a clean, sleek tiling layout on the primary monitor. It prioritizes the most recently used windows and ignores system/background processes.

## Workflow

1. **Identify Windows**: List all visible windows with titles and filter out background processes (like 'Program Manager', 'Taskbar', etc.).
2. **Get Screen Geometry**: Retrieve the dimensions of the primary monitor.
3. **Calculate Layout**:
   - **1 Window**: Centered with 10% margins.
   - **2 Windows**: 70/30 split (Main work area + Sidebar).
   - **3 Windows**: 70/30 split, with the 30% side split horizontally for two smaller windows.
   - **4+ Windows**: Balanced grid layout.
4. **Execute Repositioning**: Use a PowerShell script to call `MoveWindow` for each target window.

## PowerShell Implementation Snippet

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@

# Example: Move window to (x, y, w, h)
# [Win32]::MoveWindow($hwnd, 0, 0, 1920, 1080, $true)
```

## Usage
Trigger this skill by saying "organize my windows" or "clean up my desktop".

