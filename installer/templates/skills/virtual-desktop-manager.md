---
name: Virtual Desktop Manager
description: Cycle through and manage Windows virtual desktops
triggers: virtual desktop,cycle desktop,switch desktop,desktop manager
---

# Virtual Desktop Manager

## Overview
This skill provides functions to manage Windows 10/11 virtual desktops using keyboard shortcuts and PowerShell commands.

## Key Functions

### Cycle Through Desktops
```python
# Cycle to next desktop
send_keys("{WIN+CTRL+RIGHT}")

# Cycle to previous desktop  
send_keys("{WIN+CTRL+LEFT}")
```

### Create New Desktop
```python
send_keys("{WIN+CTRL+D}")
```

### Close Current Desktop
```python
send_keys("{WIN+CTRL+F4}")
```

### Switch to Specific Desktop (1-10)
```python
# Switch to desktop 1-10 using Win+Ctrl+Number
send_keys("{WIN+CTRL+1}")  # Desktop 1
send_keys("{WIN+CTRL+2}")  # Desktop 2
# ... etc
```

### Get Desktop Information
```powershell
# Get virtual desktop info via Task View
Get-Process | Where-Object {$_.ProcessName -eq "explorer"} | Select-Object Id, ProcessName
```

### Full Desktop Cycle Function
```python
def cycle_all_desktops(screenshot_each=True):
    """Cycle through all virtual desktops and optionally take screenshots"""
    desktops = []
    
    # Start from current desktop
    if screenshot_each:
        screenshot = screenshot_window()
        desktops.append({"desktop": "current", "screenshot": screenshot})
    
    # Cycle through up to 10 desktops (Windows limit)
    for i in range(10):
        send_keys("{WIN+CTRL+RIGHT}")
        time.sleep(0.5)  # Brief pause to allow switch
        
        if screenshot_each:
            screenshot = screenshot_window()
            desktops.append({"desktop": f"desktop_{i+1}", "screenshot": screenshot})
    
    return desktops
```

## Usage Examples

1. **Simple cycle to next desktop:**
   ```python
   send_keys("{WIN+CTRL+RIGHT}")
   ```

2. **Cycle and screenshot all desktops:**
   ```python
   # Take screenshot of current desktop
   current = screenshot_window()
   
   # Cycle through and capture each
   for i in range(5):  # Adjust number as needed
       send_keys("{WIN+CTRL+RIGHT}")
       screenshot_window(save_path=f"desktop_{i}.png")
   ```

3. **Create and switch to new desktop:**
   ```python
   send_keys("{WIN+CTRL+D}")  # Create new
   screenshot_window()  # See the new desktop
   ```

## Keyboard Shortcuts Reference
- `Win+Ctrl+D` - Create new virtual desktop
- `Win+Ctrl+F4` - Close current virtual desktop
- `Win+Ctrl+Right` - Switch to next virtual desktop
- `Win+Ctrl+Left` - Switch to previous virtual desktop
- `Win+Ctrl+1-10` - Switch to specific desktop number
- `Win+Tab` - Open Task View (shows all desktops)

## Notes
- Windows supports up to 10 virtual desktops
- Cycling wraps around (after last desktop goes to first)
- Screenshots capture the active desktop content
- Some applications may span multiple desktops