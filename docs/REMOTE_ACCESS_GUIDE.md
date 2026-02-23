# Tiny Pirate Remote Access Guide

This guide explains how to access your Tiny Pirate agent remotely using ZeroTier and how to integrate with XGO.

## Overview

The remote access system allows you to:

1. Chat with your Tiny Pirate agent from any device connected to your ZeroTier network
2. Forward voice responses to your XGO device
3. Access your agent securely without exposing it to the public internet

## Setup Instructions

### Prerequisites

- ZeroTier installed and configured on both your home computer and mobile device
- Both devices connected to the same ZeroTier network
- Tiny Pirate installed and working on your home computer
- (Optional) XGO device connected to the same network

### Starting the Remote Server

1. On your home computer, run the startup script:
   ```
   start_remote_access.bat
   ```

2. The script will display the server's IP addresses, including your ZeroTier IP

3. Note the ZeroTier IP address (typically starts with 10.147.x.x)

### Connecting from Your Mobile Device

1. Make sure your mobile device is connected to the ZeroTier network

2. Open a web browser on your mobile device

3. Navigate to:
   ```
   http://<zerotier-ip>:8080
   ```
   Replace `<zerotier-ip>` with your home computer's ZeroTier IP address

4. You should see the Tiny Pirate Remote interface

## Using the Remote Interface

### Basic Chat

1. Type your message in the input field at the bottom of the screen

2. Press "Send" or hit Enter

3. The agent will process your message and respond

4. All conversations are stored in the message history

### XGO Integration

If you have an XGO device, you can forward voice responses to it:

1. Check that the XGO status shows as "available"

2. Enter your XGO's ZeroTier IP address (default: 10.147.17.147)

3. Click "Test" to verify the connection

4. When the connection is successful, voice responses will be automatically forwarded to XGO

## Troubleshooting

### Connection Issues

- Verify that both devices are connected to the same ZeroTier network
- Check that the server is running on your home computer
- Try pinging the ZeroTier IP from your mobile device
- Restart the ZeroTier service if needed

### XGO Issues

- Verify that XGO is powered on and connected to the network
- Check that the XGO IP address is correct
- Make sure XGO is on the same ZeroTier network
- Try restarting the XGO device

### Server Issues

- Check the server logs for errors
- Verify that Python and all required dependencies are installed
- Make sure the proxy_server.py file is in the correct location
- Restart the server if needed

## Security Considerations

- The remote access server has no authentication by default
- Only connect to it over your private ZeroTier network
- Do not expose the server to the public internet
- Consider adding authentication if needed (see Advanced Configuration)

## Advanced Configuration

### Adding Authentication

For additional security, you can add basic authentication to the server:

1. Edit the `simple_test_server.py` file
2. Add the following code at the top of the file:
   ```python
   from functools import wraps
   from flask import request, Response

   def check_auth(username, password):
       return username == 'your_username' and password == 'your_password'

   def authenticate():
       return Response(
           'Authentication required', 401,
           {'WWW-Authenticate': 'Basic realm="Login Required"'})

   def requires_auth(f):
       @wraps(f)
       def decorated(*args, **kwargs):
           auth = request.authorization
           if not auth or not check_auth(auth.username, auth.password):
               return authenticate()
           return f(*args, **kwargs)
       return decorated
   ```

3. Add the `@requires_auth` decorator to each route you want to protect

### Customizing the Interface

You can customize the appearance of the remote interface by editing the HTML template in the `simple_test_server.py` file.

### Running as a Service

To keep the server running in the background:

1. On Windows, you can use NSSM (Non-Sucking Service Manager) to create a Windows service
2. On Linux, you can create a systemd service

## Future Enhancements

- Voice input from mobile device
- File transfer capabilities
- System status monitoring
- Multiple simultaneous connections
- Mobile app for better experience
