# Substrate Remote Mode Implementation Plan

## Overview
This plan leverages your existing `xgo_remote_mic.py` script to implement a remote mode toggle in the Substrate interface.

## Implementation Steps

### 1. Create Remote Mode Toggle in UI

Add to `radial_config_new.js`:

```javascript
// Add to sections array
const sections = [
    // ... existing sections
    { id: "remote-mode", title: "Remote Mode" }
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

### 4. Add Event Listeners in UI

Add to your main UI JavaScript:

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

Add to your CSS:

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

### 6. Create Simple Server Endpoint on Tower Desk PC

Create a new file `xgo_audio_server.js` on your Tower Desk PC:

```javascript
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const upload = multer({ dest: 'xgo_audio_uploads/' });

// Create upload directory if it doesn't exist
if (!fs.existsSync('xgo_audio_uploads')) {
    fs.mkdirSync('xgo_audio_uploads');
}

// Endpoint to receive audio from XGO
app.post('/api/xgo_audio', upload.single('audio'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file received' });
        }
        
        console.log(`Received audio from XGO: ${req.file.originalname} (${req.file.size} bytes)`);
        
        // Process the audio with your existing pipeline
        // For example, you might want to run your speech recognition on it
        
        // For now, just acknowledge receipt
        res.json({
            success: true,
            message: 'Audio received and being processed'
        });
        
        // Process the audio asynchronously (don't wait for it to complete)
        processAudio(req.file.path);
    } catch (error) {
        console.error('Error handling audio upload:', error);
        res.status(500).json({ error: 'Server error processing audio' });
    }
});

// Function to process audio with your existing pipeline
function processAudio(audioPath) {
    // This is where you'd integrate with your existing audio processing
    // For example, you might run your speech recognition script
    
    // Example: Run basic_speech.py with the audio file
    const speechProcess = spawn('python', ['speech_components/basic_speech.py', audioPath]);
    
    speechProcess.stdout.on('data', (data) => {
        console.log(`Speech recognition output: ${data}`);
    });
    
    speechProcess.stderr.on('data', (data) => {
        console.error(`Speech recognition error: ${data}`);
    });
    
    speechProcess.on('close', (code) => {
        console.log(`Speech recognition process exited with code ${code}`);
        
        // Clean up the temporary file
        fs.unlink(audioPath, (err) => {
            if (err) console.error(`Error deleting temp file: ${err}`);
        });
    });
}

// Start the server
const PORT = 5000;
const HOST = '10.147.17.235'; // Your Tower Desk ZeroTier IP

app.listen(PORT, HOST, () => {
    console.log(`XGO audio server running at http://${HOST}:${PORT}`);
});
```

## Testing Plan

### 1. Test Remote Mode Toggle
- Enable remote mode in Substrate UI
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

## Time Estimate

Since most of the code already exists, implementation should take approximately 3-4 hours:
- UI toggle and settings: 1 hour
- Integration with existing Python script: 1 hour
- Server endpoint on Tower Desk: 1 hour
- Testing and debugging: 1 hour
