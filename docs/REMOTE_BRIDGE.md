# Remote Bridge System

The Remote Bridge System allows you to access your Substrate agent from any device on your network, including mobile phones and tablets.

## Overview

The Remote Bridge System consists of several components:

1. **Remote Bridge** - A lightweight web server that provides a web interface to interact with your Substrate agent
2. **Command Server** - A server that receives commands from the Remote Bridge and forwards them to your main Substrate application
3. **Command Pipe** - A named pipe communication system that allows direct communication between the Command Server and your main Substrate application
4. **Response Server** - A server that receives responses from your main Substrate application and forwards them to the Remote Bridge

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │      │                 │      │                 │
│  Remote Bridge  │◄────►│ Command Server  │◄────►│  Main App       │
│  (Web UI)       │      │                 │      │  (Substrate)  │
│                 │      │                 │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        ▲                        ▲                        │
        │                        │                        │
        │                        │                        │
        │                        │                        ▼
        │                 ┌─────────────────┐      ┌─────────────────┐
        │                 │                 │      │                 │
        └────────────────►│Response Server  │◄─────┤Response Notifier│
                          │                 │      │                 │
                          └─────────────────┘      └─────────────────┘
```

## Setup Instructions

1. Install the required dependencies:
   ```
   install_dependencies.bat
   ```

2. Integrate with your main Substrate application:
   - Copy `main_app_integration.py` to your main Substrate directory
   - Add the following code to your main application (`proxy_server.py`):
     ```python
     # Import the command pipe server
     from main_app_integration import start_command_pipe_server
     
     # After initializing your agent, start the command pipe server
     start_command_pipe_server(agent)
     ```
   - Restart your main Substrate application

3. Start the Remote Bridge System:
   ```
   start_command_bridge.bat
   ```

4. Access the Remote Bridge from any device on your network:
   - Local access: http://localhost:8080
   - Network access: http://YOUR_IP_ADDRESS:8080 (Your ZeroTier IP will be displayed when starting)

## Components

### Remote Bridge (`remote_bridge.py`)

The Remote Bridge provides a web interface that mimics the Substrate chat interface. It:
- Serves a web UI accessible from any device on your network
- Forwards commands to the Command Server
- Displays responses from your main Substrate application
- Provides status information about the system

### Command Server (`command_server.py`)

The Command Server receives commands from the Remote Bridge and forwards them to your main Substrate application. It:
- Listens for commands on port 8766
- Uses the Command Pipe to send commands to your main Substrate application
- Receives responses from your main Substrate application
- Forwards responses back to the Remote Bridge

### Command Pipe (`command_pipe.py`)

The Command Pipe provides direct communication between the Command Server and your main Substrate application using Windows named pipes. It:
- Creates a named pipe server in your main Substrate application
- Allows the Command Server to send commands directly to your main Substrate application
- Ensures commands are executed in the same process and context as your main app

### Response Server (`response_server.py`)

The Response Server receives responses from your main Substrate application and makes them available to the Remote Bridge. It:
- Listens for responses on port 8767
- Stores responses in a queue
- Allows the Remote Bridge to retrieve responses

### Response Notifier (`response_notifier.py`)

The Response Notifier is integrated into your main Substrate application and sends responses to the Response Server. It:
- Intercepts responses sent to the frontend in your main Substrate application
- Forwards these responses to the Response Server
- Ensures chat responses are properly captured and displayed in the Remote Bridge

## Troubleshooting

If you encounter issues with the Remote Bridge System:

1. **No connection to Command Server**
   - Make sure the Command Server is running
   - Check if the Command Server is listening on port 8766
   - Verify that your firewall allows connections to port 8766

2. **Commands not executing**
   - Make sure your main Substrate application is running
   - Verify that the Command Pipe is properly integrated with your main app
   - Check the Command Server logs for errors

3. **No responses in the Remote Bridge**
   - Make sure the Response Server is running
   - Verify that the Response Notifier is properly integrated with your main app
   - Check the Response Server logs for errors

4. **Web UI not accessible**
   - Make sure the Remote Bridge is running
   - Verify that your firewall allows connections to port 8080
   - Try accessing the web UI from a different device or browser

## Advanced Configuration

You can customize the Remote Bridge System by modifying the following files:

- `remote_bridge.py` - Configure the web UI and port (default: 8080)
- `command_server.py` - Configure the Command Server port (default: 8766)
- `response_server.py` - Configure the Response Server port (default: 8767)
- `main_app_integration.py` - Configure the Command Pipe name and behavior

## Security Considerations

The Remote Bridge System is designed for use on trusted networks only. It does not include authentication or encryption. If you need to access your Substrate agent from untrusted networks, consider:

1. Setting up a VPN for secure access
2. Implementing authentication in the Remote Bridge
3. Using HTTPS for the web interface
4. Restricting access to specific IP addresses

## Limitations

- The Remote Bridge System is designed for text-based interaction only
- Voice output is only available on the main Substrate application
- Some advanced features may not be available through the Remote Bridge
- Performance may be affected by network conditions
