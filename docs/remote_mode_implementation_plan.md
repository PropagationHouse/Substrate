# TPXGO Remote Mode Implementation Plan

## Project Overview
This plan outlines the steps to implement remote audio processing for TPXGO, allowing it to connect to the main Tower Desk PC over ZeroTier when away from home.

## Prerequisites
- ZeroTier network already configured on both devices
  - Tower Desk PC: 10.147.17.235
  - TPXGO: 10.147.17.147
- Node.js installed on Tower Desk PC
- Existing audio processing pipeline on main PC

## Implementation Steps

### Phase 1: Tower Desk Server Setup

#### Step 1.1: Create Server Project
```bash
# Create project directory
mkdir C:\Users\Bl0ck\Desktop\tpxgo-remote-server
cd C:\Users\Bl0ck\Desktop\tpxgo-remote-server

# Initialize Node.js project
npm init -y
npm install express body-parser cors
```

**Testing**: Verify packages installed correctly by checking `node_modules` directory and `package.json`

#### Step 1.2: Create Basic Server
Create `server.js` with:
```javascript
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Configure middleware
app.use(cors());
app.use(bodyParser.json({limit: '50mb'}));

// Simple test endpoint
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Start server on ZeroTier interface
const PORT = 3000;
const HOST = '10.147.17.235'; // Tower Desk ZeroTier IP

app.listen(PORT, HOST, () => {
  console.log(`Remote server running at http://${HOST}:${PORT}`);
});
```

**Testing**: 
1. Start server: `node server.js`
2. From TPXGO, run: `curl http://10.147.17.235:3000/ping`
3. Should receive: `{"status":"ok","message":"Server is running"}`

#### Step 1.3: Implement Audio Processing Endpoint
Add to `server.js`:
```javascript
// Endpoint to receive audio from TPXGO
app.post('/process-audio', async (req, res) => {
  try {
    console.log('Received audio processing request');
    
    // Extract audio data
    const audioData = req.body.audio;
    if (!audioData) {
      return res.status(400).json({ error: 'No audio data provided' });
    }
    
    // Log receipt (for testing)
    console.log(`Received audio data: ${audioData.substring(0, 50)}...`);
    
    // TODO: Process with your main application
    // This is where you'll integrate with your existing processing pipeline
    // For testing, just echo back a simple response
    const mockResponse = {
      text: "This is a test response from the remote server",
      timestamp: new Date().toISOString()
    };
    
    // Return response to TPXGO
    res.json({
      success: true,
      response: mockResponse
    });
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).json({ error: 'Processing failed', details: error.message });
  }
});
```

**Testing**:
1. Start server: `node server.js`
2. Test with curl:
```bash
curl -X POST http://10.147.17.235:3000/process-audio \
  -H "Content-Type: application/json" \
  -d '{"audio":"TEST_AUDIO_DATA_BASE64"}'
```
3. Should receive JSON response with mock data

### Phase 2: TPXGO Client Implementation

#### Step 2.1: Add Remote Mode Configuration
Add to `radial_config_new.js`:

1. Add remote mode section to sections array:
```javascript
// Define sections for the radial wheel
const sections = [
    { id: "agent-model", title: "Agent & Model" },
    { id: "system-prompt", title: "System Prompt" },
    // ... existing sections
    { id: "remote-mode", title: "Remote Mode" }
];
```

2. Create remote mode content function:
```javascript
// Remote mode settings content
function getRemoteModeContent() {
    return `
        <div class="config-section">
            <h3>Remote Processing Mode</h3>
            <div class="config-row">
                <label for="remote-mode-enabled-radial">Enable Remote Mode:</label>
                <input type="checkbox" id="remote-mode-enabled-radial">
            </div>
            <div class="config-row">
                <label for="remote-server-address-radial">Server Address:</label>
                <input type="text" id="remote-server-address-radial" value="10.147.17.235:3000">
            </div>
            <div class="config-help">When enabled, audio will be processed on your home PC instead of locally.</div>
        </div>
    `;
}
```

3. Add to `createSectionCards()` function:
```javascript
// Remote mode section
cardsHTML += createSectionCard("remote-mode", "Remote Mode", getRemoteModeContent());
```

**Testing**:
1. Verify the Remote Mode section appears in the radial config panel
2. Check that the toggle and server address field are displayed correctly

#### Step 2.2: Create Remote Connection Module
Create new file `remote_connection.js`:
```javascript
// Remote connection handler for TPXGO
const remoteConfig = {
    enabled: false,
    serverAddress: '10.147.17.235:3000'
};

// Load configuration from localStorage
function loadRemoteConfig() {
    const savedEnabled = localStorage.getItem('remote-mode-enabled');
    const savedAddress = localStorage.getItem('remote-server-address');
    
    if (savedEnabled !== null) {
        remoteConfig.enabled = savedEnabled === 'true';
    }
    
    if (savedAddress) {
        remoteConfig.serverAddress = savedAddress;
    }
    
    console.log('Remote config loaded:', remoteConfig);
}

// Save configuration to localStorage
function saveRemoteConfig() {
    localStorage.setItem('remote-mode-enabled', remoteConfig.enabled);
    localStorage.setItem('remote-server-address', remoteConfig.serverAddress);
}

// Check if remote mode is enabled
function isRemoteModeEnabled() {
    return remoteConfig.enabled;
}

// Send audio data to remote server
async function processAudioRemotely(audioData) {
    try {
        console.log('Sending audio to remote server:', remoteConfig.serverAddress);
        
        const response = await fetch(`http://${remoteConfig.serverAddress}/process-audio`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                audio: audioData
            })
        });
        
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Remote processing result:', result);
        return result;
    } catch (error) {
        console.error('Remote processing failed:', error);
        throw error;
    }
}

// Initialize
loadRemoteConfig();

// Export functions
module.exports = {
    remoteConfig,
    isRemoteModeEnabled,
    processAudioRemotely,
    saveRemoteConfig
};
```

**Testing**:
1. Add console logs to verify the module loads correctly
2. Check localStorage to ensure settings are saved/loaded properly

#### Step 2.3: Implement Audio Capture and Sending
Create new file `audio_capture.js` or modify existing audio handling:
```javascript
// Audio capture and processing
const { isRemoteModeEnabled, processAudioRemotely } = require('./remote_connection');

// Capture audio from microphone
async function captureAudio() {
    // Use existing audio capture code or implement new
    // For testing, return dummy data
    return "TEST_AUDIO_DATA_BASE64";
}

// Process captured audio
async function processAudio(audioData) {
    try {
        // Check if remote mode is enabled
        if (isRemoteModeEnabled()) {
            console.log('Remote mode enabled, sending to server');
            
            // Send to remote server
            const result = await processAudioRemotely(audioData);
            
            // Handle response
            if (result && result.success) {
                return result.response;
            } else {
                throw new Error('Remote processing failed');
            }
        } else {
            console.log('Using local processing');
            
            // Use existing local processing
            // ...
            
            return { text: "Local processing result" };
        }
    } catch (error) {
        console.error('Audio processing error:', error);
        return { text: "Error processing audio" };
    }
}

// Export functions
module.exports = {
    captureAudio,
    processAudio
};
```

**Testing**:
1. Test with remote mode disabled - should use local processing
2. Test with remote mode enabled - should send to server
3. Verify correct handling of server responses

#### Step 2.4: Add UI Connection Status Indicator
Add to `index.html`:
```html
<!-- Connection status indicator -->
<div id="connection-status" class="status-indicator">
    <span class="status-dot"></span>
    <span class="status-text">Local Mode</span>
</div>
```

Add to CSS:
```css
.status-indicator {
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.7);
    padding: 5px 10px;
    border-radius: 15px;
    font-size: 12px;
    display: flex;
    align-items: center;
    z-index: 1000;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 5px;
}

.status-dot.connected {
    background-color: #4CAF50;
}

.status-dot.disconnected {
    background-color: #F44336;
}

.status-dot.local {
    background-color: #2196F3;
}
```

Add to JavaScript:
```javascript
// Update connection status
function updateConnectionStatus(mode, isConnected) {
    const statusDot = document.querySelector('#connection-status .status-dot');
    const statusText = document.querySelector('#connection-status .status-text');
    
    if (mode === 'remote') {
        if (isConnected) {
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'Remote: Connected';
        } else {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'Remote: Disconnected';
        }
    } else {
        statusDot.className = 'status-dot local';
        statusText.textContent = 'Local Mode';
    }
}
```

**Testing**:
1. Verify indicator appears in UI
2. Test status changes when toggling remote mode
3. Test connection status updates

### Phase 3: Integration and Testing

#### Step 3.1: Connect Event Handlers
Add to `preload.js`:
```javascript
// Remote mode IPC handlers
contextBridge.exposeInMainWorld('remoteMode', {
    toggle: (enabled) => ipcRenderer.send('toggle-remote-mode', enabled),
    setServerAddress: (address) => ipcRenderer.send('set-remote-server', address),
    onStatusChange: (callback) => ipcRenderer.on('remote-status-change', callback)
});
```

Add to `main.js`:
```javascript
// Remote mode handlers
ipcMain.on('toggle-remote-mode', (event, enabled) => {
    console.log('Remote mode toggled:', enabled);
    // Store in app settings
    // ...
    
    // Notify renderer
    mainWindow.webContents.send('remote-status-change', {
        enabled,
        connected: enabled // For initial state
    });
});

ipcMain.on('set-remote-server', (event, address) => {
    console.log('Remote server address set:', address);
    // Store in app settings
    // ...
});
```

**Testing**:
1. Verify IPC events are triggered when toggling remote mode
2. Check that status updates are received by renderer

#### Step 3.2: Implement Connection Testing
Add to `remote_connection.js`:
```javascript
// Test connection to remote server
async function testConnection() {
    try {
        const response = await fetch(`http://${remoteConfig.serverAddress}/ping`);
        if (response.ok) {
            const data = await response.json();
            return data.status === 'ok';
        }
        return false;
    } catch (error) {
        console.error('Connection test failed:', error);
        return false;
    }
}
```

**Testing**:
1. Call `testConnection()` when remote mode is toggled
2. Update UI based on connection test result

#### Step 3.3: Full System Testing
1. Start Tower Desk server
2. Enable remote mode on TPXGO
3. Capture and send audio
4. Verify processing and response

## Troubleshooting Guide

### Network Connectivity Issues
- **Symptom**: Cannot connect to Tower Desk server
- **Check**:
  1. Verify both devices are connected to ZeroTier network
  2. Ping Tower Desk from TPXGO: `ping 10.147.17.235`
  3. Check server is running: `curl http://10.147.17.235:3000/ping`
  4. Verify no firewall blocking connections

### Audio Processing Issues
- **Symptom**: Audio sent but no response received
- **Check**:
  1. Check server logs for errors
  2. Verify audio data format is correct
  3. Test with smaller audio samples
  4. Check response format matches expected format

### UI Issues
- **Symptom**: Remote mode toggle not working
- **Check**:
  1. Verify event listeners are attached
  2. Check localStorage for saved settings
  3. Inspect browser console for JavaScript errors

## Deployment Checklist
- [ ] Server starts automatically on Tower Desk boot
- [ ] Remote mode settings persist across TPXGO restarts
- [ ] Connection status updates correctly
- [ ] Audio processing works reliably
- [ ] Error handling and fallback mechanisms work properly
