# Substrate Remote Bridge

The Remote Bridge allows you to access your Substrate AI agent from any device on your network, including phones and tablets.

## Components

The Remote Bridge system consists of three main components:

1. **IPC Server**: Connects directly to your main Substrate application to send commands and receive responses.
2. **Command Server**: Handles command parsing and execution, communicating with the IPC Server.
3. **Remote Bridge**: Provides a web interface that you can access from any device.

## Setup Instructions

### Prerequisites

- Main Substrate application must be installed and running
- Python 3.8 or higher
- ZeroTier network set up (for remote access outside your local network)

### Installation

1. Copy all files to a directory on your Substrate machine
2. Install required Python packages:
   ```
   pip install flask requests
   ```

### Starting the Remote Bridge

1. First, make sure your main Substrate application is running
2. Run the start script:
   ```
   start_command_bridge.bat
   ```
3. This will start all three components:
   - IPC Server (connects to main app)
   - Command Server
   - Remote Bridge

### Accessing the Remote Interface

- **Local Network**: `http://[your-local-ip]:8080`
- **ZeroTier Network**: `http://[your-zerotier-ip]:8080`

## How It Works

1. When you send a message from the remote interface, it goes to the Remote Bridge
2. The Remote Bridge forwards it to the Command Server
3. The Command Server sends it to the IPC Server
4. The IPC Server sends it to your main Substrate application
5. The main application processes the message and sends the response back
6. The response is displayed in the remote interface

This ensures that commands are executed on your main machine and that the remote interface has access to all the same memory, context, and capabilities as the main application.

## Troubleshooting

- **"Upgrade Required" Error**: This is usually a browser compatibility issue. Try using a different browser or updating your current one.
- **Commands Not Executing**: Make sure the IPC Server is running and connected to the main application.
- **No Response**: Check that all three components are running and that the main application is active.
- **Connection Issues**: Verify your network settings and that the ports are not blocked by a firewall.

## Architecture

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│                │     │                │     │                │     │                │
│  Remote Device │────▶│ Remote Bridge  │────▶│ Command Server │────▶│   IPC Server   │
│  (Web Browser) │     │  (Flask App)   │     │  (Socket API)  │     │ (Main App IPC) │
│                │     │                │     │                │     │                │
└────────────────┘     └────────────────┘     └────────────────┘     └────────────────┘
                                                                            │
                                                                            ▼
                                                                     ┌────────────────┐
                                                                     │                │
                                                                     │  Substrate   │
                                                                     │ Main Application│
                                                                     │                │
                                                                     └────────────────┘
```

## Adding IPC Server to Main Application

To fully integrate the Remote Bridge with your main Substrate application:

1. Copy the code from `add_to_main_app.py` into your main application (proxy_server.py or main.py)
2. Add the following line to your main application's startup code:
   ```python
   start_ipc_server(agent)
   ```
3. Restart your main application

This will allow the Remote Bridge to communicate directly with your main application, ensuring that all commands are executed in the same context and with access to the same memory and capabilities.
