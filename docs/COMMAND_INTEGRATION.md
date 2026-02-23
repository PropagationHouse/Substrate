# Tiny Pirate Remote Command Integration

This document explains how to integrate the remote command system with your main Tiny Pirate application to ensure commands are executed properly.

## The Problem

When sending commands from the web UI, you get chat responses but the commands don't trigger on your PC. This happens because:

1. The web UI and the main app are running in separate processes
2. Even though both use the same `CommandParser` and `CommandExecutor` classes, they are different instances
3. The web UI's command executor doesn't have access to the same system context as your main app

## The Solution: Command Pipe

We've implemented a named pipe communication system that allows the remote bridge to send commands directly to your main Tiny Pirate application. This ensures that commands are executed in the same process and context as your main app.

## Integration Steps

### 1. Install Dependencies

Run the `install_dependencies.bat` script to install the required Python packages:

```
install_dependencies.bat
```

### 2. Integrate with Main App

Add the following code to your main Tiny Pirate application (`proxy_server.py`):

```python
# At the top of the file
from main_app_integration import start_command_pipe_server

# After your agent is initialized (typically in the main section)
start_command_pipe_server(agent)
```

### 3. Start the Remote Bridge System

Run the `start_command_bridge.bat` script:

```
start_command_bridge.bat
```

## How It Works

1. When you send a command from the web UI, it goes to the remote bridge
2. The remote bridge forwards it to the command server
3. The command server sends it through the named pipe to your main app
4. Your main app executes the command using its own agent instance
5. The result is sent back through the pipe to the command server
6. The command server sends it to the remote bridge
7. The remote bridge displays the result in the web UI

This ensures that commands are executed in the same process and context as your main app, so they will trigger on your PC just like they do when you enter them in the main app's chat window.

## Troubleshooting

If commands still aren't triggering on your PC:

1. Make sure your main Tiny Pirate application is running
2. Make sure you've added the integration code to your main app
3. Check the logs in the command server window for any errors
4. Try restarting both your main app and the remote bridge system

## Technical Details

The system uses Windows named pipes (`\\.\pipe\TinyPirateCommandPipe`) for inter-process communication. This is a low-level system mechanism that allows two processes to communicate directly, even if they are running in different contexts or with different permissions.

The command pipe server runs in your main app's process and listens for commands from the remote bridge. When it receives a command, it passes it directly to your main app's agent for processing, ensuring that the command is executed in the same context as your main app.
