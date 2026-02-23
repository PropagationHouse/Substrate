# Tiny Pirate IPC Communication System

This document details the Inter-Process Communication (IPC) system that enables the Electron frontend and Python backend to communicate in Tiny Pirate.

## Overview

Tiny Pirate uses a bidirectional communication system:
1. **Electron to Python**: Commands and requests flow from the UI to the backend
2. **Python to Electron**: Responses, status updates, and events flow from the backend to the UI

## Communication Channels

### Frontend to Backend

Communication from Electron to Python uses:
1. **Standard Input (stdin)**: The Python process receives JSON-formatted messages via stdin
2. **Electron IPC**: Messages are sent from the renderer process to the main process

```javascript
// In renderer process (preload.js)
contextBridge.exposeInMainWorld('electronAPI', {
  executeAction: (data) => ipcRenderer.send('execute-action', data),
  saveConfig: (config) => ipcRenderer.send('save-config', config),
  sendCommand: (command) => ipcRenderer.send('command', command)
});

// In main process (main.js)
ipcMain.on('execute-action', (event, data) => {
  pythonProcess.stdin.write(JSON.stringify(data) + '\n');
});
```

### Backend to Frontend

Communication from Python to Electron uses:
1. **Standard Output (stdout)**: The Python process sends JSON-formatted messages via stdout
2. **Electron IPC**: Messages are forwarded from the main process to the renderer process

```javascript
// In main process (main.js)
pythonProcess.stdout.on('data', (data) => {
  const output = data.toString();
  const lines = output.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const message = JSON.parse(line);
      mainWindow.webContents.send('python-message', message);
      
      // Special handling for specific message types
      if (message.type === 'config') {
        mainWindow.webContents.send('config-update', message.content);
      } else if (message.type === 'voice') {
        mainWindow.webContents.send('voice-status', message.status);
      }
    } catch (e) {
      console.log('Non-JSON output:', line);
    }
  }
});

// In renderer process (preload.js)
contextBridge.exposeInMainWorld('electronAPI', {
  onPythonMessage: (callback) => ipcRenderer.on('python-message', (_, data) => callback(data)),
  onConfigUpdate: (callback) => ipcRenderer.on('config-update', (_, data) => callback(data)),
  onVoiceStatus: (callback) => ipcRenderer.on('voice-status', (_, data) => callback(data))
});
```

## Message Format

All messages use a JSON format for consistency:

### Frontend to Backend Messages

```json
{
  "command": "string",     // Command identifier
  "text": "string",        // Text content (if applicable)
  "action": "string",      // Action type (if applicable)
  "params": {},            // Additional parameters (if applicable)
  "debug": boolean         // Debug flag (optional)
}
```

### Backend to Frontend Messages

```json
{
  "type": "string",        // Message type (e.g., "response", "config", "voice")
  "content": {},           // Message content
  "status": "string",      // Status information (if applicable)
  "result": "string",      // Result information (if applicable)
  "clear_thinking": boolean, // UI control flag
  "suppress_chat": boolean   // UI control flag
}
```

## Message Types

### Frontend to Backend

1. **Text Commands**:
   ```json
   { "text": "/command argument" }
   ```

2. **Action Requests**:
   ```json
   { "action": "screenshot", "params": { "region": "full" } }
   ```

3. **Configuration Updates**:
   ```json
   { "command": "saveConfig", "config": { "model": "deepseek-r1:latest" } }
   ```

### Backend to Frontend

1. **Text Responses**:
   ```json
   { "type": "response", "content": "Hello, I'm Tiny Pirate!" }
   ```

2. **Configuration Updates**:
   ```json
   { "type": "config", "content": { "model": "deepseek-r1:latest" } }
   ```

3. **Voice Status**:
   ```json
   { "type": "voice", "status": "speaking" }
   ```

4. **Error Messages**:
   ```json
   { "status": "error", "result": "Error message" }
   ```

## Special Message Handling

### Configuration Messages

Configuration messages receive special handling to ensure UI synchronization:

```javascript
// In main.js
ipcMain.on('save-config', (event, config) => {
  // Save to Python backend
  pythonProcess.stdin.write(JSON.stringify({
    command: 'saveConfig',
    config: config
  }) + '\n');
  
  // Request updated config after a delay
  setTimeout(() => {
    pythonProcess.stdin.write(JSON.stringify({
      command: 'requestConfig'
    }) + '\n');
  }, 1500);
});
```

### Voice Status Messages

Voice status messages are used to synchronize avatar animations with speech:

```javascript
// In index.html
window.electronAPI.onVoiceStatus((status) => {
  if (status === 'speaking') {
    avatar.startSpeaking();
  } else if (status === 'stopped') {
    avatar.stopSpeaking();
  }
});
```

## Error Handling

The IPC system includes robust error handling:

1. **JSON Parsing Errors**:
   ```javascript
   try {
     const message = JSON.parse(line);
     // Process message
   } catch (e) {
     console.log('Non-JSON output:', line);
   }
   ```

2. **Process Errors**:
   ```javascript
   pythonProcess.stderr.on('data', (data) => {
     const error = data.toString();
     console.log('Python stderr:', error);
     
     // Skip certain warnings
     if (error.includes('Warning:') || error.includes('pygame')) {
       return;
     }
     
     // Send actual errors to UI
     mainWindow.webContents.send('error', 'Python Error: ' + error);
   });
   ```

3. **Process Termination**:
   ```javascript
   pythonProcess.on('close', (code) => {
     console.log(`Python process exited with code ${code}`);
     if (code !== 0) {
       mainWindow.webContents.send('error', `Backend process terminated with code ${code}`);
     }
   });
   ```

## Debugging

For debugging IPC communication:

1. **Debug Flags**:
   ```javascript
   ipcMain.on('debug-config', (event) => {
     console.log('Debug command received: Displaying current configuration');
     pythonProcess.stdin.write(JSON.stringify({
       command: 'requestConfig',
       debug: true
     }) + '\n');
   });
   ```

2. **Console Logging**:
   ```javascript
   // Log all messages sent to Python
   console.log('Sending to Python:', JSON.stringify(data));
   
   // Log all messages received from Python
   console.log('Received from Python:', output);
   ```

## Best Practices

When extending the IPC system:

1. Always use JSON for message formatting
2. Include proper error handling for all message processing
3. Add type information to messages for easier routing
4. Use separate channels for different types of messages
5. Implement timeouts for requests that require responses
6. Add debugging information when needed
