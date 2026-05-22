---
name: Windows Task Scheduling
description: Manage and automate Windows tasks using the schtasks command-line utility.
triggers: schedule,schtasks,alarm,timer,task scheduler
---

# Windows Task Scheduling

This skill allows the agent to schedule commands, scripts, or programs to run at specific times or intervals using the Windows `schtasks` utility.

## Capabilities
- **Schedule Types (`/SC`)**: ONCE, MINUTE, HOURLY, DAILY, WEEKLY, MONTHLY, ONSTART, ONLOGON, ONIDLE, ONEVENT.
- **Modifiers (`/MO`)**: Fine-tune frequency (e.g., every 2 weeks, first Monday of the month).
- **Repetition (`/RI`)**: Repeat a task within its scheduled interval (e.g., every 15 minutes).
- **Permissions (`/RL HIGHEST`)**: Run with administrative privileges.
- **User Context (`/RU`)**: Run as a specific user or SYSTEM.

## Common Commands

### Create a one-time task
```cmd
schtasks /create /tn "TaskName" /tr "path\to\command.exe" /sc once /st HH:mm
```

### Create a daily task at a specific time
```cmd
schtasks /create /tn "DailyTask" /tr "path\to\script.bat" /sc daily /st 09:00
```

### Delete a task
```cmd
schtasks /delete /tn "TaskName" /f
```

### List all tasks
```cmd
schtasks /query /fo TABLE
```

## Tips
- Use `/f` with `/create` to overwrite an existing task with the same name.
- For complex commands, wrap them in a batch file or use PowerShell.
- Ensure paths with spaces are properly quoted.
