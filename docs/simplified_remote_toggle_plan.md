# Simplified Remote Mode Toggle Implementation

## Overview
This plan focuses solely on adding a UI toggle to enable/disable the remote audio processing feature. All the necessary components already exist:

1. `xgo_remote_mic.py` - Handles microphone access and audio forwarding
2. `pc_audio_receiver_server.py` - Receives and processes audio on the Tower Desk PC

## Implementation Steps

### 1. Add Remote Mode Toggle to UI

Add to your UI configuration file (e.g., `radial_config_new.js`):

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

### 2. Add Remote Mode Toggle Handler in Electron

In your preload.js:

```javascript
// Add to exposed IPC channels
contextBridge.exposeInMainWorld('remoteMode', {
    toggle: (enabled) => ipcRenderer.send('toggle-remote-mode', enabled),
    setHostAddress: (address) => ipcRenderer.send('set-remote-host', address),
    getStatus: () => ipcRenderer.invoke('get-remote-mode-status')
});
```

In your main.js:

```javascript
// Add to imports
const { spawn } = require('child_process');
const path = require('path');

// Add global variables
let remoteMicProcess = null;
let remoteMode = {
    enabled: false,
    hostAddress: '10.147.17.235'
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
        hostAddress: remoteMode.hostAddress
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
        });
        
        console.log('Remote mic started');
    } catch (error) {
        console.error('Failed to start remote mic:', error);
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

### 3. Add Event Listeners in UI

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
        });
        
        // Toggle remote mode
        remoteToggle.addEventListener('change', (e) => {
            window.remoteMode.toggle(e.target.checked);
        });
        
        // Set host address
        remoteHostInput.addEventListener('change', (e) => {
            window.remoteMode.setHostAddress(e.target.value);
        });
    }
});
```

## Testing Plan

1. **Test UI Toggle**
   - Enable remote mode in TPXGO UI
   - Verify the Python script starts
   - Check logs for successful initialization

2. **Test End-to-End Flow**
   - Start `pc_audio_receiver_server.py` on Tower Desk PC
   - Enable remote mode on XGO
   - Speak into XGO microphone
   - Verify audio is received on Tower Desk PC

## Time Estimate

Since most of the code already exists, implementation should take approximately 1-2 hours:
- UI toggle and settings: 30-45 minutes
- Integration with existing Python script: 30-45 minutes
- Testing and debugging: 30 minutes
