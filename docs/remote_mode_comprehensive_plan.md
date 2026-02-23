# TPXGO Remote Mode Implementation - Comprehensive Plan

## Overview

This document outlines the implementation plan for adding a remote mode feature to the TPXGO application. The remote mode will allow the XGO device to capture audio and send it to the Tower Desk PC for processing.

## Current State Analysis

### Existing Components

1. **XGO Remote Microphone (`xgo_remote_mic.py`)**
   - Already implemented and functional
   - Handles microphone access on XGO
   - Implements voice activity detection
   - Captures and processes audio
   - Sends audio to the server over ZeroTier
   - Tries multiple endpoints:
     - `http://{REMOTE_HOST}:5000/api/xgo_audio`
     - `http://{REMOTE_HOST}:5000/api/xgo-audio-http/1.1`
     - `http://{REMOTE_HOST}:5000/transcribe`

2. **PC Audio Receiver Server (`pc_audio_receiver_server.py`)**
   - Already implemented and functional
   - Runs on port 5000
   - Handles all three endpoints that `xgo_remote_mic.py` tries to use
   - Saves audio files to the `speech_components/xgo_audio_input` directory
   - Designed to work with the existing speech recognition system

3. **Home PC Server (`home_pc_server.py`)**
   - Alternative server implementation
   - Runs on port 8766
   - Has a `/transcribe` endpoint
   - Saves audio to `xgo_audio_input` directory
   - Sends transcriptions to Tiny Pirate API

4. **ZeroTier Network**
   - Already set up and connecting both devices
   - Provides secure network connectivity between XGO and Tower Desk PC

### UI Structure

The TPXGO UI uses a radial configuration panel (`radial_config_new.js`) with sections for different settings:
- Agent & Model
- System Prompt
- Screenshot Prompt
- Note Creation
- Autonomy Settings
- API Settings

Each section has its own content function (e.g., `getAgentModelContent()`) that returns HTML for that section.

## Implementation Plan

### 1. Add Remote Mode Section to UI

Update `radial_config_new.js` to add a new section for Remote Mode:

```javascript
// Add to sections array
const sections = [
    { id: "agent-model", title: "Agent & Model" },
    { id: "system-prompt", title: "System Prompt" },
    { id: "screenshot-prompt", title: "Screenshot Prompt" },
    { id: "note-creation", title: "Note Creation" },
    { id: "autonomy", title: "Autonomy Settings" },
    { id: "api", title: "API Settings" },
    { id: "remote-mode", title: "Remote Mode" }  // New section
];

// Create remote mode content function
function getRemoteModeContent() {
    return `
        <div class="config-section">
            <h3>Remote Mode</h3>
            <div class="config-row">
                <label for="remote-mode-toggle">Enable Remote Mode:</label>
                <input type="checkbox" id="remote-mode-toggle">
            </div>
            <div class="config-row">
                <label for="remote-host-address">Home PC Address:</label>
                <input type="text" id="remote-host-address" value="10.147.17.235">
            </div>
            <div class="config-help">When enabled, XGO will use its microphone and send audio to your home PC.</div>
        </div>
    `;
}

// Add to createSectionCards function
function createSectionCards() {
    // ... existing code
    
    // Remote mode section
    cardsHTML += createSectionCard("remote-mode", "Remote Mode", getRemoteModeContent());
    
    // ... rest of function
}
```

### 2. Add Remote Mode Toggle Handler in `preload.js`

```javascript
// Add to exposed IPC channels
contextBridge.exposeInMainWorld('remoteMode', {
    toggle: (enabled) => ipcRenderer.send('toggle-remote-mode', enabled),
    setHostAddress: (address) => ipcRenderer.send('set-remote-host', address),
    getStatus: () => ipcRenderer.invoke('get-remote-mode-status'),
    onStatusChange: (callback) => ipcRenderer.on('remote-status-change', callback)
});
```

### 3. Implement Remote Mode in `main.js`

```javascript
// Add to imports
const { spawn } = require('child_process');
const path = require('path');

// Add global variables
let remoteMicProcess = null;
let remoteMode = {
    enabled: false,
    hostAddress: '10.147.17.235',
    status: 'disconnected'
};

// Add IPC handlers
ipcMain.on('toggle-remote-mode', (event, enabled) => {
    remoteMode.enabled = enabled;
    
    if (enabled) {
        startRemoteMic();
    } else {
        stopRemoteMic();
    }
    
    // Save settings
    saveSettings();
    
    // Notify renderer
    mainWindow.webContents.send('remote-status-change', {
        enabled: remoteMode.enabled,
        status: remoteMode.status
    });
});

ipcMain.on('set-remote-host', (event, address) => {
    remoteMode.hostAddress = address;
    
    // Save settings
    saveSettings();
    
    // Restart remote mic if running
    if (remoteMode.enabled && remoteMicProcess) {
        stopRemoteMic();
        startRemoteMic();
    }
});

ipcMain.handle('get-remote-mode-status', () => {
    return {
        enabled: remoteMode.enabled,
        hostAddress: remoteMode.hostAddress,
        status: remoteMode.status
    };
});

// Function to start remote mic
function startRemoteMic() {
    try {
        // Stop any existing process
        stopRemoteMic();
        
        // Path to Python script
        const scriptPath = path.join(__dirname, 'xgo_remote_mic.py');
        
        // Start the process
        remoteMicProcess = spawn('python', [scriptPath, '--ip', remoteMode.hostAddress]);
        
        // Handle stdout
        remoteMicProcess.stdout.on('data', (data) => {
            console.log(`Remote mic: ${data}`);
        });
        
        // Handle stderr
        remoteMicProcess.stderr.on('data', (data) => {
            console.error(`Remote mic error: ${data}`);
        });
        
        // Handle process exit
        remoteMicProcess.on('close', (code) => {
            console.log(`Remote mic process exited with code ${code}`);
            remoteMicProcess = null;
            remoteMode.status = 'disconnected';
            
            // Notify renderer
            if (mainWindow) {
                mainWindow.webContents.send('remote-status-change', {
                    enabled: remoteMode.enabled,
                    status: remoteMode.status
                });
            }
        });
        
        remoteMode.status = 'connected';
        console.log('Remote mic started');
    } catch (error) {
        console.error('Failed to start remote mic:', error);
        remoteMode.status = 'error';
        remoteMicProcess = null;
    }
}

// Function to stop remote mic
function stopRemoteMic() {
    if (remoteMicProcess) {
        try {
            // On Windows, we need to kill the process group
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', remoteMicProcess.pid, '/f', '/t']);
            } else {
                remoteMicProcess.kill('SIGINT');
            }
        } catch (error) {
            console.error('Error stopping remote mic:', error);
        }
        
        remoteMicProcess = null;
        remoteMode.status = 'disconnected';
    }
}

// Add to app shutdown
app.on('before-quit', () => {
    stopRemoteMic();
});

// Add to loadSettings function
function loadSettings() {
    // ... existing code
    
    // Load remote mode settings
    if (settings.remoteMode) {
        remoteMode.enabled = settings.remoteMode.enabled || false;
        remoteMode.hostAddress = settings.remoteMode.hostAddress || '10.147.17.235';
    }
    
    // Start remote mic if enabled
    if (remoteMode.enabled) {
        startRemoteMic();
    }
}

// Add to saveSettings function
function saveSettings() {
    // ... existing code
    
    // Save remote mode settings
    settings.remoteMode = {
        enabled: remoteMode.enabled,
        hostAddress: remoteMode.hostAddress
    };
    
    // ... rest of function
}
```

### 4. Add Event Listeners in UI JavaScript

```javascript
// Add event listeners for remote mode
document.addEventListener('DOMContentLoaded', () => {
    // ... existing code
    
    // Remote mode toggle
    const remoteToggle = document.getElementById('remote-mode-toggle');
    const remoteHostInput = document.getElementById('remote-host-address');
    
    if (remoteToggle && remoteHostInput) {
        // Get initial status
        window.remoteMode.getStatus().then(status => {
            remoteToggle.checked = status.enabled;
            remoteHostInput.value = status.hostAddress;
            updateRemoteStatus(status);
        });
        
        // Toggle remote mode
        remoteToggle.addEventListener('change', (e) => {
            window.remoteMode.toggle(e.target.checked);
        });
        
        // Set host address
        remoteHostInput.addEventListener('change', (e) => {
            window.remoteMode.setHostAddress(e.target.value);
        });
        
        // Listen for status changes
        window.remoteMode.onStatusChange((event, status) => {
            updateRemoteStatus(status);
        });
    }
});

// Function to update remote status in UI
function updateRemoteStatus(status) {
    const statusIndicator = document.getElementById('remote-status-indicator') || createRemoteStatusIndicator();
    
    if (status.enabled) {
        if (status.status === 'connected') {
            statusIndicator.className = 'status-indicator connected';
            statusIndicator.textContent = 'Remote Mode: Connected';
        } else {
            statusIndicator.className = 'status-indicator error';
            statusIndicator.textContent = 'Remote Mode: Error';
        }
    } else {
        statusIndicator.className = 'status-indicator disconnected';
        statusIndicator.textContent = 'Local Mode';
    }
}

// Create status indicator if it doesn't exist
function createRemoteStatusIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'remote-status-indicator';
    indicator.className = 'status-indicator';
    document.body.appendChild(indicator);
    return indicator;
}
```

### 5. Add CSS for Status Indicator

```css
.status-indicator {
    position: fixed;
    bottom: 10px;
    right: 10px;
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 1000;
    color: white;
}

.status-indicator.connected {
    background-color: #4CAF50;
}

.status-indicator.disconnected {
    background-color: #607D8B;
}

.status-indicator.error {
    background-color: #F44336;
}
```

## Server Setup

The server component is already implemented in `pc_audio_receiver_server.py`. To use it:

1. Start the server on the Tower Desk PC:
   ```
   python pc_audio_receiver_server.py
   ```

2. The server will listen on port 5000 and handle audio uploads from the XGO.

3. Audio files will be saved to `speech_components/xgo_audio_input` for processing by the existing speech recognition system.

## Testing Plan

### 1. Test Remote Mode Toggle
- Enable remote mode in TPXGO UI
- Verify the Python script starts
- Check logs for successful initialization

### 2. Test Audio Capture
- Speak into XGO microphone
- Check logs for voice activity detection
- Verify audio is being captured

### 3. Test Audio Transmission
- Verify audio is being sent to Tower Desk
- Check server logs for received audio
- Confirm proper processing

### 4. Test End-to-End Flow
- Speak a command into XGO
- Verify it's processed by the main app
- Check for appropriate response

## Potential Issues and Solutions

### 1. Network Connectivity
- **Issue**: XGO cannot connect to Tower Desk PC over ZeroTier
- **Solution**: Verify ZeroTier network is active on both devices and check firewall settings

### 2. Audio Quality
- **Issue**: Poor audio quality or sensitivity
- **Solution**: Adjust `VAD_THRESHOLD` in `xgo_remote_mic.py` to improve voice detection

### 3. Process Management
- **Issue**: Python process doesn't terminate properly
- **Solution**: Implement more robust process management in `main.js`

## Time Estimate

Since most of the code already exists, implementation should take approximately 2-3 hours:
- UI toggle and settings: 45-60 minutes
- Integration with existing Python script: 45-60 minutes
- Testing and debugging: 30-60 minutes

## Future Enhancements

1. **Status Monitoring**: Add more detailed status monitoring for the remote connection
2. **Audio Quality Settings**: Allow adjustment of audio quality parameters from the UI
3. **Fallback Mode**: Implement automatic fallback to local mode if remote connection fails
4. **Multiple Profiles**: Support multiple remote PC profiles for different setups
