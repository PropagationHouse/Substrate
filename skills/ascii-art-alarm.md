---
name: ASCII Art Alarm
description: Sets an alarm that plays a sound and displays ASCII art in a popup terminal window.
triggers: alarm,set alarm,ascii alarm,alarm with art
---

# ASCII Art Alarm
This skill allows the agent to set an alarm that plays a sound and displays ASCII art in a popup terminal window.

## Triggers
- "set an alarm"
- "ascii alarm"
- "alarm with art"

## Workflow
1. **Time Calculation**: Identify the target time (HH:mm format).
2. **Script Generation**: Create a PowerShell script (e.g., `alarm_with_art.ps1`) containing:
   - `Clear-Host`
   - ASCII art string
   - `Write-Host` to display the art
   - `[System.Media.SystemSounds]::Exclamation.Play()` or similar for audio
   - `Read-Host` to keep the window open until dismissed
3. **Task Scheduling**: Use `schtasks` to schedule the script.
   - Important: Use `-WindowStyle Normal` to ensure the terminal pops up.
   - Command: `schtasks /create /tn "ArtAlarm" /tr "powershell -NoProfile -WindowStyle Normal -ExecutionPolicy Bypass -File C:\Path\To\alarm_with_art.ps1" /sc once /st HH:mm /f`

## Example Art
```
      .-------.
     /   ...   \
    |  O     O  |
    |    ___    |
     \  '---'  /
      '-------'
     /|       |\
    / |       | \
      |_______|
      /       \
     /         \
```

